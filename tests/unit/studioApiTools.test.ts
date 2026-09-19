import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { aiAgentService, type AIMessage, type AIProviderConfig, type AIToolCall, type StreamChatOptions } from '../../electron/services/aiAgentService';
import { claudeBridgeService, type ClaudeBridgeMessageChunk } from '../../electron/services/claudeBridgeService';
import { hitlService } from '../../electron/services/hitlService';
import { processManager } from '../../electron/services/processManager';
import { appEventBus } from '../../electron/services/eventBus';
import type { ApprovalResponse, HitlRequest } from '../../electron/services/hitlTypes';

/**
 * API-путь AI Studio на общем исполнителе (TASK-103, decision-47): чанки чата прежнего формата, статусы
 * проекта, общая политика, фоновые команды и worktree. Модель заменена моком `streamChat`, который
 * зовёт исполнитель, как tool-loop, и возвращает итоговое сообщение из тех же объектов вызова.
 */

let root: string;
let repo: string;

beforeEach(async () => {
  vi.restoreAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-studio-tools-'));
  repo = path.join(root, 'project');
  await fs.mkdir(repo, { recursive: true });
  await fs.writeFile(path.join(repo, 'input.txt'), 'hello\n');
  await fs.writeFile(path.join(root, 'outside.txt'), 'secret\n');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

interface Step {
  name: string;
  args: Record<string, unknown>;
  decision?: ApprovalResponse;
}

async function runStudio(config: AIProviderConfig, steps: Step[], extra: { workspaceRoot?: string } = {}) {
  const chunks: ClaudeBridgeMessageChunk[] = [];
  const statuses: Array<{ path: string; status: string; message?: string }> = [];
  const requests: HitlRequest[] = [];
  let decision: ApprovalResponse = { approved: true };
  const unsub = appEventBus.subscribe((e) => {
    if (e.type !== 'hitl:requested') return;
    requests.push(e.request);
    setTimeout(() => hitlService.decide(e.request.id, decision, { kind: 'mcp' }), 5);
  });
  vi.spyOn(claudeBridgeService, 'setProjectStatus').mockImplementation((p, status, message) => {
    statuses.push({ path: p, status, message });
  });
  const results: Array<{ content: string; isError?: boolean }> = [];
  let final: AIMessage | undefined;
  vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (_req, onChunk, onComplete, _onError, options?: StreamChatOptions) => {
    const calls: AIToolCall[] = [];
    for (const [i, s] of steps.entries()) {
      const tc: AIToolCall = { id: `call-${i}`, name: s.name, args: s.args, status: 'pending' };
      calls.push(tc);
      decision = s.decision ?? { approved: true };
      onChunk({ toolCall: { ...tc } });
      results.push(await options!.executeTool!(tc));
    }
    onComplete({ id: 'm', role: 'assistant', content: 'ok', timestamp: '', toolCalls: calls.map((tc) => ({ ...tc })) });
  });
  try {
    await claudeBridgeService.runAgentTask(
      { sessionId: `studio-${Math.random().toString(36).slice(2)}`, projectPath: repo, messages: [], config, mode: 'chat', ...extra },
      (chunk) => chunks.push(chunk),
      (msg) => { final = msg; },
      () => undefined
    );
  } finally {
    unsub();
  }
  return { chunks, statuses, requests, results, final };
}

const manual: AIProviderConfig = { provider: 'ollama', model: 'qwen', autoApprove: false };

describe('AI Studio: API-инструменты через общий исполнитель (TASK-103)', () => {
  it('запись с карточкой: чанк карточки с вызовом и диффом, статусы проекта, итог в сообщении', async () => {
    const { chunks, statuses, requests, results, final } = await runStudio(manual, [
      { name: 'write_file', args: { filePath: 'out.txt', content: 'NEW\n', explanation: 'пишу' } }
    ]);
    expect(await fs.readFile(path.join(repo, 'out.txt'), 'utf-8')).toBe('NEW\n');
    expect(results[0].isError).toBeUndefined();
    const card = chunks.find((c) => c.approvalRequest);
    expect(card?.approvalRequest).toMatchObject({ type: 'file_write', origin: 'studio', engine: 'api', projectPath: repo, details: 'пишу' });
    expect(card?.toolCall).toMatchObject({ id: 'call-0', status: 'pending', diff: { filePath: 'out.txt', newContent: 'NEW\n' } });
    expect(chunks.at(-1)?.toolCall).toMatchObject({ id: 'call-0', status: 'accepted' });
    expect(requests).toHaveLength(1);
    expect(statuses.map((s) => s.status)).toEqual(['running', 'waiting_approval', 'running', 'done']);
    expect(statuses.every((s) => s.path === repo)).toBe(true);
    expect(final?.toolCalls?.[0]).toMatchObject({ status: 'accepted', diff: { newContent: 'NEW\n' } });
  });

  it('отказ по карточке записи — файл не меняется, модель получает отказ', async () => {
    const { chunks, results } = await runStudio(manual, [
      { name: 'write_file', args: { filePath: 'input.txt', content: 'X\n' }, decision: { approved: false, text: 'нет' } }
    ]);
    expect(await fs.readFile(path.join(repo, 'input.txt'), 'utf-8')).toBe('hello\n');
    expect(results[0]).toEqual({ content: 'Отклонено пользователем: нет', isError: true });
    expect(chunks.at(-1)?.toolCall).toMatchObject({ status: 'rejected' });
  });

  it('команда: вывод чанками running, статус «Выполняется», итог accepted', async () => {
    const { chunks, statuses, results } = await runStudio(manual, [{ name: 'run_command', args: { command: 'node -e "console.log(12345)"' } }]);
    expect(results[0].content).toContain('12345');
    const tool = chunks.filter((c) => c.toolCall).map((c) => c.toolCall!.status);
    expect(tool[0]).toBe('pending');
    expect(tool.at(-1)).toBe('accepted');
    expect(tool).toContain('running');
    expect(statuses.some((s) => s.message?.startsWith('Выполняется: node'))).toBe(true);
  });

  it('вопрос: карточка-вопрос, ответ человека — модели', async () => {
    const { requests, results } = await runStudio(manual, [
      { name: 'ask_question', args: { title: 'Что делаем?', question: 'Выбери', options: [{ label: 'A' }, { label: 'B' }] }, decision: { approved: true, text: 'A' } }
    ]);
    expect(requests[0]).toMatchObject({ type: 'question', title: 'Что делаем?' });
    expect(results[0]).toEqual({ content: 'A' });
  });

  it('фоновая команда уходит в менеджер процессов в рабочем дереве сессии', async () => {
    const worktree = path.join(root, 'wt');
    await fs.mkdir(worktree, { recursive: true });
    const started: unknown[] = [];
    vi.spyOn(processManager, 'startProcess').mockImplementation(async (projectPath, command, name, options) => {
      started.push({ projectPath, command, name, workspaceRoot: options?.workspaceRoot });
      return { id: 'proc-1', name, pid: 42 } as never;
    });
    const auto: AIProviderConfig = { provider: 'ollama', model: 'qwen', autoApprove: true };
    const { results, chunks } = await runStudio(auto, [{ name: 'run_command', args: { command: 'npm run dev', background: true, name: 'dev' } }], { workspaceRoot: worktree });
    expect(results[0].content).toContain('запущен в фоне (pid 42');
    expect(started).toEqual([{ projectPath: repo, command: 'npm run dev', name: 'dev', workspaceRoot: worktree }]);
    expect(chunks.at(-1)?.toolCall).toMatchObject({ status: 'accepted' });
  });

  it('общая политика: чтение вне корня и при выключенном «Чтении файлов» — карточка; spawn_subagent отклоняется', async () => {
    const outside = await runStudio(manual, [{ name: 'read_file', args: { filePath: '../outside.txt' } }]);
    expect(outside.requests[0]).toMatchObject({ type: 'question', projectPath: repo });
    expect(outside.results[0]).toEqual({ content: 'secret\n' });

    const noRead: AIProviderConfig = {
      ...manual,
      autoApprove: true,
      autoApproveRules: { enabled: true, allowCommands: true, allowFileWrite: true, allowFileRead: false, allowSubagents: true, writeExcludePatterns: [], readExcludePatterns: [], commandDenyList: [] }
    };
    const manualRead = await runStudio(noRead, [{ name: 'read_file', args: { filePath: 'input.txt' } }]);
    expect(manualRead.requests).toHaveLength(1);

    const sub = await runStudio(manual, [{ name: 'spawn_subagent', args: { task: 'x' } }]);
    expect(sub.results[0].isError).toBe(true);
    expect(sub.chunks.some((c) => c.subagent)).toBe(false);
  });

  it('файлы в worktree сессии, карточки и статус — по корню проекта', async () => {
    const worktree = path.join(root, 'wt');
    await fs.mkdir(worktree, { recursive: true });
    const { requests, statuses } = await runStudio(manual, [{ name: 'write_file', args: { filePath: 'w.txt', content: 'W' } }], { workspaceRoot: worktree });
    expect(await fs.readFile(path.join(worktree, 'w.txt'), 'utf-8')).toBe('W');
    await expect(fs.access(path.join(repo, 'w.txt'))).rejects.toThrow();
    expect(requests[0].projectPath).toBe(repo);
    expect(statuses.every((s) => s.path === repo)).toBe(true);
  });
});
