import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { aiAgentService } from './aiAgentService.js';
import { claudeBridgeService } from './claudeBridgeService.js';
import { computerUseService } from './computerUseService.js';
import { hitlService } from './hitlService.js';
import { searchProjectDocs } from './ragSearch.js';
import { ApiToolExecutor, type ApiToolExecutorDeps } from './apiToolExecutor.js';
import type { HitlOrigin } from './hitlTypes.js';

/**
 * Боевые зависимости исполнителя API-инструментов Swarm (decision-46 п. 1): единая очередь HITL и аудит
 * (`hitlService`), команды через `claudeBridgeService.executeSubprocess` (их убивает `abortSession` по
 * `sessionId`), запись через `aiAgentService.applyDiff`, прокси `computer_*` с политикой внутри.
 */
export function createApiToolExecutorDeps(): ApiToolExecutorDeps {
  return {
    newRequestId: () => hitlService.newRequestId(),
    requestApproval: (request, options) => hitlService.request(request, options),
    recordAutoDecision: (info, decision, rule, detail) => hitlService.recordAutoDecision(info, decision, rule, detail),
    recordOutcome: (requestId, outcome, detail) => hitlService.recordOutcome(requestId, outcome, detail),
    readFile: (absPath) => fs.readFile(absPath, 'utf-8'),
    fileExists: (absPath) => existsSync(absPath),
    listDir: async (absPath) =>
      (await fs.readdir(absPath, { withFileTypes: true })).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
    writeFile: async (workDir, filePath, content) => {
      await aiAgentService.applyDiff(workDir, filePath, content);
    },
    generateDiff: (oldContent, newContent, filePath) => aiAgentService.generateDiff(oldContent, newContent, filePath),
    runCommand: (command, cwd, options) => claudeBridgeService.executeSubprocess(command, cwd, undefined, options),
    searchDocs: async (projectPath, query) => {
      const results = await searchProjectDocs({ projectPath, query, mode: 'all', limit: 5 });
      return results.map((r) => `- [${r.category}] ${r.fileRelative}${r.heading ? ` — ${r.heading}` : ''}: ${r.snippet}`).join('\n') || 'Ничего не найдено';
    },
    parseQuestion: (args) => claudeBridgeService.parseQuestionData(args),
    callComputerTool: async (name, args, ctx) => {
      const res = await computerUseService.callTool(name, args, {
        sessionId: ctx.sessionId,
        projectPath: ctx.workDir,
        origin: ctx.origin as Exclude<HitlOrigin, 'studio' | 'external'>,
        engine: ctx.engine ?? 'api',
        agentId: ctx.agentId,
        agentName: ctx.agentName,
        role: ctx.role,
        doneLoop: ctx.doneLoop,
        taskAllowsComputerUse: ctx.taskAllowsComputerUse,
        autoApprove: ctx.roleAutoApprove,
        approvalTimeoutMs: ctx.config.autoApproveRules?.approvalTimeoutMin
          ? ctx.config.autoApproveRules.approvalTimeoutMin * 60_000
          : undefined,
        onApprovalRequest: (request) => ctx.onApprovalRequest?.(request)
      });
      const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).filter(Boolean).join('\n');
      const images = res.content.flatMap((c) => (c.type === 'image' ? [{ mimeType: c.mimeType, data: c.data }] : []));
      return { content: text, isError: res.isError, images };
    }
  };
}

let shared: ApiToolExecutor | null = null;

/** Один исполнитель на процесс: состояния у него нет, контекст передаётся на каждый вызов. */
export function getApiToolExecutor(): ApiToolExecutor {
  shared ??= new ApiToolExecutor(createApiToolExecutorDeps());
  return shared;
}
