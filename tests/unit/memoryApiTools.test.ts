import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { apiToolKind, isApiToolAllowed, planApiToolCall } from '../../electron/services/apiToolPolicy';
import { ApiToolExecutor, type ApiToolContext, type ApiToolExecutorDeps } from '../../electron/services/apiToolExecutor';
import { apiToolNamesForCategories } from '../../electron/services/roleEngineAdapter';
import type { AIProviderConfig } from '../../electron/services/aiAgentService';

/** Память проекта у API-агента: политика, категории роли, делегирование исполнителя (TASK-76.2, decision-51 п. 4). */

const auto: AIProviderConfig = { provider: 'ollama', model: 'm', autoApprove: true };
const manual: AIProviderConfig = { provider: 'ollama', model: 'm', autoApprove: false };
const WT = path.resolve('/tmp/wt-slot');

describe('apiToolPolicy — память', () => {
  it('memory_* — отдельный вид, разрешается без карточки даже без auto-approve', () => {
    expect(apiToolKind('memory_write')).toBe('memory');
    expect(apiToolKind('memory_forget')).toBe('unknown');
    expect(planApiToolCall(manual, WT, 'memory_write', {})).toMatchObject({ kind: 'memory', verdict: 'allow', rule: 'memory', approvalType: 'file_write' });
    expect(planApiToolCall(manual, WT, 'memory_search', {})).toMatchObject({ verdict: 'allow', approvalType: 'question' });
  });

  it('allow-список роли: поиск — с Read, запись и удаление — с Write', () => {
    expect(isApiToolAllowed('memory_search', ['Read'])).toBe(true);
    expect(isApiToolAllowed('memory_write', ['Read'])).toBe(false);
    expect(isApiToolAllowed('memory_write', ['Edit'])).toBe(true);
    expect(isApiToolAllowed('memory_delete', ['Bash'])).toBe(false);
    expect(isApiToolAllowed('memory_write', ['memory_write'])).toBe(true);
    const rules = { enabled: true, allowCommands: true, allowFileWrite: true, allowFileRead: true, allowSubagents: true, writeExcludePatterns: [], readExcludePatterns: [], commandDenyList: [], allowedTools: ['Read'] };
    expect(planApiToolCall({ ...auto, autoApproveRules: rules }, WT, 'memory_write', {})).toMatchObject({ verdict: 'deny', rule: 'tool-not-allowed' });
  });

  it('категории роли дают инструменты памяти', () => {
    expect(apiToolNamesForCategories(['read'])).toEqual(expect.arrayContaining(['memory_search']));
    expect(apiToolNamesForCategories(['read'])).not.toContain('memory_write');
    expect(apiToolNamesForCategories(['write'])).toEqual(expect.arrayContaining(['memory_write', 'memory_delete']));
  });
});

describe('ApiToolExecutor — память', () => {
  const baseDeps = (): ApiToolExecutorDeps => ({
    newRequestId: () => 'r',
    requestApproval: async () => ({ approved: true }),
    recordAutoDecision: () => 'a',
    recordOutcome: () => undefined,
    readFile: async () => '',
    fileExists: () => false,
    listDir: async () => [],
    writeFile: async () => undefined,
    generateDiff: () => '',
    runCommand: async () => ({ output: '', exitCode: 0, timedOut: false }),
    searchDocs: async () => '',
    parseQuestion: () => ({ title: '', subtitle: '', options: [] })
  });
  const ctx = (over: Partial<ApiToolContext> = {}): ApiToolContext => ({
    sessionId: 'swarm-1',
    workDir: WT,
    projectPath: path.resolve('/tmp/project'),
    config: manual,
    origin: 'swarm',
    engine: 'api',
    taskId: 'TASK-7',
    isActive: () => true,
    ...over
  });

  it('делегирует сервису памяти с контекстом слота, статус accepted/done', async () => {
    const calls: Array<{ name: string; taskId?: string; projectPath: string }> = [];
    const updates: string[] = [];
    const deps = baseDeps();
    deps.callMemoryTool = async (name, _args, c) => {
      calls.push({ name, taskId: c.taskId, projectPath: c.projectPath });
      return { content: `ok ${name}` };
    };
    const ex = new ApiToolExecutor(deps);
    const onToolUpdate: ApiToolContext['onToolUpdate'] = (_call, u) => updates.push(u.status);
    expect(await ex.execute({ id: '1', name: 'memory_write', args: { title: 't' } }, ctx({ onToolUpdate }))).toEqual({ content: 'ok memory_write' });
    await ex.execute({ id: '2', name: 'memory_search', args: { query: 'q' } }, ctx({ onToolUpdate }));
    expect(calls).toEqual([
      { name: 'memory_write', taskId: 'TASK-7', projectPath: path.resolve('/tmp/project') },
      { name: 'memory_search', taskId: 'TASK-7', projectPath: path.resolve('/tmp/project') }
    ]);
    expect(updates).toEqual(['running', 'accepted', 'running', 'done']);
  });

  it('без сервиса памяти — ошибка, а не падение', async () => {
    const res = await new ApiToolExecutor(baseDeps()).execute({ id: '1', name: 'memory_write', args: {} }, ctx());
    expect(res.isError).toBe(true);
  });
});
