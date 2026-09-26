import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { aiAgentService } from './aiAgentService.js';
import { claudeBridgeService } from './claudeBridgeService.js';
import { computerUseService } from './computerUseService.js';
import { hitlService } from './hitlService.js';
import { searchProjectDocs } from './ragSearch.js';
import { ApiToolExecutor, type ApiToolExecutorDeps } from './apiToolExecutor.js';
import { processManager } from './processManager.js';
import type { ComputerOrigin } from './computerPolicy.js';
import { callMemoryTool as runMemoryTool } from './memoryTools.js';
import { memoryToolDeps } from './memoryToolDeps.js';

/**
 * Боевые зависимости исполнителя API-инструментов Swarm и AI Studio (decision-46 п. 1, decision-47): единая
 * очередь HITL и аудит (`hitlService`), команды через `claudeBridgeService.executeSubprocess` (их убивает
 * `abortSession` по `sessionId`), фоновые процессы AI Studio через `processManager`, запись через
 * `aiAgentService.applyDiff`, прокси `computer_*` с политикой внутри.
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
    runCommand: (command, cwd, { onOutput, ...options }) => claudeBridgeService.executeSubprocess(command, cwd, onOutput, options),
    startBackgroundProcess: async (projectPath, command, name, workDir) => {
      const info = await processManager.startProcess(projectPath, command, name, { workspaceRoot: workDir });
      return { id: info.id, name: info.name, pid: info.pid };
    },
    searchDocs: async (projectPath, query) => {
      const results = await searchProjectDocs({ projectPath, query, mode: 'all', limit: 5 });
      return results.map((r) => `- [${r.category}] ${r.fileRelative}${r.heading ? ` — ${r.heading}` : ''}: ${r.snippet}`).join('\n') || 'Ничего не найдено';
    },
    parseQuestion: (args) => claudeBridgeService.parseQuestionData(args),
    callComputerTool: async (name, args, ctx) => {
      const res = await computerUseService.callTool(name, args, {
        sessionId: ctx.sessionId,
        projectPath: ctx.hitlProjectPath || ctx.workDir,
        // Прокси понимает все источники исполнителя: studio (AI Studio) и swarm/handoff/assigned.
        origin: ctx.origin as ComputerOrigin,
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
    },
    callMemoryTool: async (name, args, ctx) => {
      // Память всегда в основном дереве проекта, даже если агент работает в worktree (decision-51 п. 3)
      const res = await runMemoryTool(
        name,
        args,
        {
          sessionPath: ctx.projectPath,
          sessionId: ctx.sessionId,
          origin: ctx.origin,
          engine: ctx.engine ?? 'api',
          ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
          ...(ctx.agentName ? { agentName: ctx.agentName } : {}),
          ...(ctx.role ? { role: ctx.role } : {}),
          ...(ctx.taskId ? { taskId: ctx.taskId } : {})
        },
        memoryToolDeps
      );
      return { content: res.text, isError: res.isError };
    }
  };
}

let shared: ApiToolExecutor | null = null;

/** Один исполнитель на процесс: состояния у него нет, контекст передаётся на каждый вызов. */
export function getApiToolExecutor(): ApiToolExecutor {
  shared ??= new ApiToolExecutor(createApiToolExecutorDeps());
  return shared;
}
