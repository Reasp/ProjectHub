import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentFleetService } from '../../electron/services/agentFleetService';
import { SwarmSessionStore } from '../../electron/services/swarmSessionStore';
import { aiAgentService, type StreamChatOptions } from '../../electron/services/aiAgentService';
import { claudeBridgeService } from '../../electron/services/claudeBridgeService';
import { hitlService } from '../../electron/services/hitlService';
import { CheckpointService } from '../../electron/services/checkpointService';
import { execGit } from '../../electron/services/checkpointGit';
import type { AppBusEvent, HitlRequest } from '../../electron/services/hitlTypes';
import type { AgentSlotState } from '../../electron/services/swarmTypes';

/**
 * API-агент Swarm исполняет инструменты (TASK-101, decision-46): исполнитель с HITL в рабочем каталоге
 * слота, лимит шагов по maxTurns роли, бюджет между шагами, остановка, запрет fallback по исполнению и
 * трасса. Модель заменена моком `streamChat`, который зовёт переданный исполнитель, как tool-loop.
 */

let root: string;
let repo: string;
let store: SwarmSessionStore;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('timeout');
    await wait(25);
  }
}
const git = (cwd: string, ...args: string[]) => execGit(args, { cwd });

beforeEach(async () => {
  vi.restoreAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-apitools-'));
  repo = path.join(root, 'project');
  await fs.mkdir(path.join(repo, '.projecthub', 'roles'), { recursive: true });
  await fs.writeFile(path.join(repo, 'input.txt'), 'hello swarm\n');
  await fs.writeFile(
    path.join(repo, '.projecthub', 'roles', 'short.md'),
    '---\nslug: short\nname: Короткий\nengine: api\ntools: ["read", "write"]\nmaxTurns: 2\n---\nПиши кратко.\n'
  );
  store = new SwarmSessionStore(path.join(root, 'swarms'), 10);
  vi.spyOn(AgentFleetService.prototype, 'runJudge').mockResolvedValue(null);
  vi.spyOn(aiAgentService, 'getConfig').mockResolvedValue({ provider: 'ollama', model: 'qwen', autoApprove: true });
});

afterEach(async () => {
  await store.flush();
  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe('AgentFleetService: API-агент исполняет инструменты (TASK-101)', () => {
  it('чтение и запись в рабочем каталоге слота, результаты — модели, аудит с агентом, трасса с длительностями', async () => {
    const autos: Array<{ info: Omit<HitlRequest, 'id' | 'createdAt'>; decision: string; rule: string }> = [];
    const recordAuto = hitlService.recordAutoDecision.bind(hitlService);
    vi.spyOn(hitlService, 'recordAutoDecision').mockImplementation((info, decision, rule, detail) => {
      autos.push({ info, decision, rule });
      return recordAuto(info, decision, rule, detail);
    });
    const fleet = new AgentFleetService(store);
    let seen: { opts?: StreamChatOptions; results: string[]; sessionId?: string } = { results: [] };
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (req, onChunk, onComplete, _onError, options?: StreamChatOptions) => {
      seen = { opts: options, results: [], sessionId: req.sessionId };
      const call = async (step: number, id: string, name: string, args: Record<string, unknown>) => {
        await options?.onToolBoundary?.({ kind: 'step', step, model: 'qwen' });
        await options?.onToolBoundary?.({ kind: 'step_usage', step, usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 110, costSource: 'unknown', model: 'qwen' } });
        onChunk({ toolCall: { id, name, args } });
        const t0 = Date.now();
        const res = await options!.executeTool!({ id, name, args });
        seen.results.push(res.content);
        await options?.onToolBoundary?.({ kind: 'tool_result', id, name, ok: res.isError !== true, outputChars: res.content.length, durationMs: Date.now() - t0 });
      };
      await call(0, 'c1', 'read_file', { filePath: 'input.txt' });
      await call(1, 'c2', 'write_file', { filePath: 'out/output.txt', content: 'HELLO SWARM\n' });
      await call(2, 'c3', 'write_file', { filePath: '../escape.txt', content: 'x' });
      await options?.onToolBoundary?.({ kind: 'step', step: 3, model: 'qwen' });
      onChunk({ text: 'готово' });
      onComplete({ id: 'm1', role: 'assistant', content: 'готово', timestamp: new Date().toISOString() });
    });

    const session = await fleet.startFanOut({
      projectPath: repo,
      prompt: 'Прочитай input.txt и запиши output.txt',
      useWorktrees: false,
      autoCommitAgentResults: false,
      agents: [{ id: 'agent-1', name: 'API', engine: 'api', role: 'implementer', providerConfig: { provider: 'ollama', model: 'qwen' } }]
    });
    await waitFor(() => session.status === 'completed');

    expect(seen.sessionId).toBe('swarm-agent-1');
    expect(seen.opts?.executeTool).toBeTypeOf('function');
    expect(seen.opts?.maxSteps).toBe(25);
    expect(seen.opts?.computerTools).toEqual([]);
    expect(seen.results[0]).toBe('hello swarm\n');
    expect(seen.results[1]).toContain('записан');
    expect(seen.results[2]).toContain('вне корня проекта');
    expect(await fs.readFile(path.join(repo, 'out', 'output.txt'), 'utf-8')).toBe('HELLO SWARM\n');
    await expect(fs.access(path.join(root, 'escape.txt'))).rejects.toThrow();

    expect(autos.map((a) => [a.info.tool, a.decision, a.rule])).toEqual([
      ['read_file', 'allow', 'auto-read'],
      ['write_file', 'allow', 'auto-write'],
      ['write_file', 'deny', 'outside-project']
    ]);
    expect(autos[1].info).toMatchObject({ sessionId: 'swarm-agent-1', origin: 'swarm', engine: 'api', agentId: 'agent-1', agentName: 'API', role: 'implementer' });

    // usage по шагам (3 шага × 110 токенов, итог streamChat не пришёл)
    const agent = session.agents[0];
    expect(agent.metrics.usage?.inputTokens).toBe(300);

    const view = await fleet.getTimeline(session.id, 'agent-1');
    const tools = view!.timeline.tools;
    expect(tools.map((t) => [t.name, t.status])).toEqual([
      ['read_file', 'ok'],
      ['write_file', 'ok'],
      ['write_file', 'error']
    ]);
    expect(tools.every((t) => typeof t.durationMs === 'number')).toBe(true);
    // решение HITL привязано к инструменту в таймлайне
    expect(view!.timeline.hitl.map((h) => [h.tool, h.decision, h.rule])).toEqual([
      ['read_file', 'allow', 'auto-read'],
      ['write_file', 'allow', 'auto-write'],
      ['write_file', 'deny', 'outside-project']
    ]);
    expect(view!.timeline.turns.filter((t) => t.usage).length).toBe(3);
    expect(view!.timeline.runs[0].turns.length).toBe(4);
  }, 60_000);

  it('два вызова записи одного шага: каждое решение HITL привязано к своему вызову (живой прогон qwen2.5)', async () => {
    vi.mocked(aiAgentService.getConfig).mockResolvedValue({ provider: 'ollama', model: 'qwen', autoApprove: false });
    const decide = (event: AppBusEvent) => {
      if (event.type === 'hitl:requested') setTimeout(() => hitlService.decide(event.request.id, { approved: true }, { kind: 'mcp' }), 5);
    };
    const { appEventBus } = await import('../../electron/services/eventBus');
    const unsubscribe = appEventBus.subscribe(decide);
    const fleet = new AgentFleetService(store);
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (_req, onChunk, onComplete, _e, options?: StreamChatOptions) => {
      await options?.onToolBoundary?.({ kind: 'step', step: 0 });
      const calls = [
        { id: 'w1', name: 'write_file', args: { filePath: 'one.txt', content: '1' } },
        { id: 'w2', name: 'write_file', args: { filePath: 'two.txt', content: '2' } }
      ];
      for (const c of calls) onChunk({ toolCall: c });
      for (const c of calls) {
        const r = await options!.executeTool!(c);
        await options?.onToolBoundary?.({ kind: 'tool_result', id: c.id, name: c.name, ok: !r.isError, outputChars: r.content.length, durationMs: 1 });
      }
      onComplete({ id: 'm', role: 'assistant', content: 'ok', timestamp: new Date().toISOString() });
    });
    const session = await fleet.startFanOut({
      projectPath: repo,
      prompt: 'p',
      useWorktrees: false,
      autoCommitAgentResults: false,
      agents: [{ id: 'h', name: 'H', engine: 'api', providerConfig: { provider: 'ollama', model: 'qwen' } }]
    });
    await waitFor(() => session.status === 'completed');
    if (typeof unsubscribe === 'function') unsubscribe();
    const view = await fleet.getTimeline(session.id, 'h');
    expect(view!.timeline.tools.map((t) => [t.toolId, t.hitl.map((x) => `${x.decision}/${x.decidedBy ?? ''}`)])).toEqual([
      ['w1', ['requested/', 'allow/mcp']],
      ['w2', ['requested/', 'allow/mcp']]
    ]);
    expect(await fs.readFile(path.join(repo, 'two.txt'), 'utf-8')).toBe('2');
  }, 60_000);

  it('maxTurns роли — лимит шагов; step_limit пишется в лог', async () => {
    const fleet = new AgentFleetService(store);
    let maxSteps: number | undefined;
    let allowed: string[] | undefined;
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (req, onChunk, onComplete, _e, options?: StreamChatOptions) => {
      maxSteps = options?.maxSteps;
      allowed = req.allowedToolNames;
      await options?.onToolBoundary?.({ kind: 'step_limit', step: 1, maxSteps: 2, pendingCalls: 1 });
      onComplete({ id: 'm', role: 'assistant', content: 'x', timestamp: new Date().toISOString() });
    });
    const session = await fleet.startFanOut({
      projectPath: repo,
      prompt: 'p',
      useWorktrees: false,
      autoCommitAgentResults: false,
      agents: [{ id: 'a', name: 'A', engine: 'api', roleSlug: 'short', providerConfig: { provider: 'ollama', model: 'qwen' } }]
    });
    await waitFor(() => session.status === 'completed');
    expect(maxSteps).toBe(2);
    expect(allowed).toEqual(['read_file', 'list_dir', 'write_file']);
    expect(session.agents[0].logs.join('\n')).toContain('Достигнут лимит ходов роли (2)');
    expect(session.agents[0].logs.join('\n')).not.toContain('не поддерживает нативно');
  }, 60_000);

  it('бюджет между шагами останавливает слот и прерывает сессию агента', async () => {
    const fleet = new AgentFleetService(store);
    const abort = vi.spyOn(claudeBridgeService, 'abortSession');
    let executedAfterBudget = false;
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (_req, _onChunk, _onComplete, _e, options?: StreamChatOptions) => {
      await options?.onToolBoundary?.({ kind: 'step', step: 0 });
      await options?.onToolBoundary?.({
        kind: 'step_usage',
        step: 0,
        usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 20, costUsd: 1, costSource: 'provider', model: 'paid' }
      });
      // tool-loop после прерывания исполнитель уже не зовёт; проверяем, что исполнитель отказывает
      const res = await options!.executeTool!({ id: 'w', name: 'write_file', args: { filePath: 'late.txt', content: 'x' } });
      executedAfterBudget = res.isError !== true;
      // прерванный streamChat возвращается без onComplete/onError
    });
    const session = await fleet.startFanOut({
      projectPath: repo,
      prompt: 'p',
      useWorktrees: false,
      autoCommitAgentResults: false,
      agents: [{ id: 'b', name: 'B', engine: 'api', budgetUsd: 0.5, providerConfig: { provider: 'ollama', model: 'paid' } }]
    });
    await waitFor(() => session.agents[0].status === 'budget_exceeded' && session.status !== 'running');
    await waitFor(() => !['running', 'pending'].includes(session.status));
    expect(abort).toHaveBeenCalledWith('swarm-b');
    expect(executedAfterBudget).toBe(false);
    await expect(fs.access(path.join(repo, 'late.txt'))).rejects.toThrow();
  }, 60_000);

  it('fallback модели запрещается исполнением, а не вызовом: отклонённый вызов его не блокирует', async () => {
    const fleet = new AgentFleetService(store);
    const activity: boolean[] = [];
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (_req, onChunk, onComplete, _e, options?: StreamChatOptions) => {
      onChunk({ toolCall: { id: 'x', name: 'write_file', args: { filePath: '../out.txt', content: '' } } });
      await options!.executeTool!({ id: 'x', name: 'write_file', args: { filePath: '../out.txt', content: '' } });
      activity.push((fleet as unknown as { toolActivity: Set<string> }).toolActivity.has('f'));
      await options!.executeTool!({ id: 'y', name: 'read_file', args: { filePath: 'input.txt' } });
      activity.push((fleet as unknown as { toolActivity: Set<string> }).toolActivity.has('f'));
      onComplete({ id: 'm', role: 'assistant', content: '', timestamp: new Date().toISOString() });
    });
    const session = await fleet.startFanOut({
      projectPath: repo,
      prompt: 'p',
      useWorktrees: false,
      autoCommitAgentResults: false,
      agents: [{ id: 'f', name: 'F', engine: 'api', providerConfig: { provider: 'ollama', model: 'qwen' } }]
    });
    await waitFor(() => session.status === 'completed');
    expect(activity).toEqual([false, true]);
  }, 60_000);

  it('чекпоинт хода API снимается до следующего запроса к модели (tool-loop ждёт снимок)', async () => {
    await git(repo, 'init', '-q', '-b', 'main');
    await git(repo, 'config', 'user.name', 't');
    await git(repo, 'config', 'user.email', 't@t');
    await git(repo, 'config', 'core.autocrlf', 'false');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-qm', 'base');
    const fleet = new AgentFleetService(store, { checkpoints: new CheckpointService() });
    const checkpointsBeforeNextStep: number[] = [];
    const ref: { agent?: AgentSlotState } = {};
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (_req, onChunk, onComplete, _e, options?: StreamChatOptions) => {
      await options?.onToolBoundary?.({ kind: 'step', step: 0 });
      onChunk({ toolCall: { id: 'w1', name: 'write_file', args: { filePath: 'a.txt', content: 'A' } } });
      const r = await options!.executeTool!({ id: 'w1', name: 'write_file', args: { filePath: 'a.txt', content: 'A' } });
      await options?.onToolBoundary?.({ kind: 'tool_result', id: 'w1', name: 'write_file', ok: !r.isError, outputChars: r.content.length, durationMs: 1 });
      // без паузы: снимок хода уже должен быть в списке
      checkpointsBeforeNextStep.push((ref.agent?.checkpoints ?? []).filter((c) => c.kind === 'turn').length);
      await options?.onToolBoundary?.({ kind: 'step', step: 1 });
      onComplete({ id: 'm', role: 'assistant', content: 'ok', timestamp: new Date().toISOString() });
    });
    const session = await fleet.startFanOut({
      projectPath: repo,
      prompt: 'p',
      useWorktrees: false,
      autoCommitAgentResults: false,
      agents: [{ id: 'k', name: 'K', engine: 'api', providerConfig: { provider: 'ollama', model: 'qwen' } }]
    });
    ref.agent = session.agents[0];
    await waitFor(() => session.status === 'completed');
    expect(checkpointsBeforeNextStep).toEqual([1]);
    expect(session.agents[0].checkpoints!.map((c) => c.kind)).toEqual(['start', 'turn']);
    await fleet.discardSwarm(session.id, false);
  }, 60_000);
});
