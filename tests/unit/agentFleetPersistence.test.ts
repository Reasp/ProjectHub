import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentFleetService, RESUME_PROMPT_SUFFIX } from '../../electron/services/agentFleetService';
import { SwarmSessionStore } from '../../electron/services/swarmSessionStore';
import type { SwarmSession } from '../../electron/services/swarmTypes';
import { worktreeService } from '../../electron/services/worktreeService';
import { aiAgentService } from '../../electron/services/aiAgentService';

let baseDir: string;
let store: SwarmSessionStore;

function runningSession(id: string, extra: Partial<SwarmSession> = {}): SwarmSession {
  return {
    id,
    projectPath: 'F:/ProjectHub',
    mode: 'fan_out',
    prompt: 'Сделай фичу',
    baseBranch: 'master',
    useWorktrees: true,
    status: 'running',
    createdAt: Date.now(),
    agents: [
      {
        id: 'a-live',
        config: { id: 'a-live', name: 'Live', engine: 'api' },
        status: 'running',
        worktreePath: 'F:/ProjectHub/.worktrees/swarm-live',
        worktreeBranch: 'swarm/x/live',
        logs: [],
        liveOutput: 'partial',
        metrics: { startTime: 1 }
      },
      {
        id: 'a-lost',
        config: { id: 'a-lost', name: 'Lost', engine: 'api' },
        status: 'running',
        worktreePath: 'F:/ProjectHub/.worktrees/swarm-lost',
        worktreeBranch: 'swarm/x/lost',
        logs: [],
        liveOutput: '',
        metrics: { startTime: 1 }
      },
      {
        id: 'a-done',
        config: { id: 'a-done', name: 'Done', engine: 'api' },
        status: 'completed',
        logs: [],
        liveOutput: 'ok',
        metrics: { startTime: 1, durationMs: 10 }
      }
    ],
    ...extra
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-fleet-'));
  store = new SwarmSessionStore(baseDir, 10);
  vi.restoreAllMocks();
});

afterEach(async () => {
  await store.flush();
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe('AgentFleetService: персистентность и восстановление (TASK-56, AC #1)', () => {
  it('restoreFromDisk помечает незавершённые сессии interrupted и сверяет worktree с git', async () => {
    await store.save(runningSession('swarm-r1'));
    await store.save(runningSession('swarm-r2', { status: 'completed', completedAt: Date.now() }));

    vi.spyOn(worktreeService, 'listWorktrees').mockResolvedValue([
      { path: 'F:/ProjectHub/.worktrees/swarm-live', branch: 'swarm/x/live', commit: '1', isMain: false, isDetached: false, isLocked: false, isPrunable: false }
    ] as any);

    const fleet = new AgentFleetService(store);
    vi.spyOn(fleet as any, 'pathExists').mockImplementation((p: unknown) => String(p).endsWith('swarm-live'));

    await fleet.init();
    await fleet.ready;

    const restored = fleet.getSwarm('swarm-r1')!;
    expect(restored.status).toBe('interrupted');
    expect(restored.restored).toBe(true);
    expect(restored.interruptedAt).toBeTypeOf('number');
    const live = restored.agents.find((a) => a.id === 'a-live')!;
    const lost = restored.agents.find((a) => a.id === 'a-lost')!;
    const done = restored.agents.find((a) => a.id === 'a-done')!;
    expect(live.status).toBe('interrupted');
    expect(live.worktreeMissing).toBeUndefined();
    expect(lost.status).toBe('interrupted');
    expect(lost.worktreeMissing).toBe(true);
    expect(done.status).toBe('completed');
    expect(live.logs.some((l) => l.includes('прервана'))).toBe(true);

    // завершённая сессия остаётся как есть
    expect(fleet.getSwarm('swarm-r2')!.status).toBe('completed');
    expect(fleet.listSwarms('f:\\projecthub').map((s) => s.id).sort()).toEqual(['swarm-r1', 'swarm-r2']);

    // изменённое состояние записано обратно на диск
    await store.flush();
    const onDisk = (await store.list()).find((s) => s.id === 'swarm-r1')!;
    expect(onDisk.status).toBe('interrupted');
  });

  it('resumeSwarm перезапускает прерванных агентов в их worktree с промптом «продолжи», потерянные → failed', async () => {
    await store.save(runningSession('swarm-res'));
    vi.spyOn(worktreeService, 'listWorktrees').mockResolvedValue([
      { path: 'F:/ProjectHub/.worktrees/swarm-live', branch: 'swarm/x/live', commit: '1', isMain: false, isDetached: false, isLocked: false, isPrunable: false }
    ] as any);
    vi.spyOn(worktreeService, 'getWorktreeDiff').mockResolvedValue('');
    const addWorktree = vi.spyOn(worktreeService, 'addWorktree');

    const prompts: string[] = [];
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (req, onChunk, onComplete) => {
      prompts.push(req.messages[0].content);
      onChunk({ text: 'continued' });
      onComplete({ id: 'm', role: 'assistant', content: 'continued', timestamp: new Date().toISOString() });
    });

    const fleet = new AgentFleetService(store);
    vi.spyOn(fleet as any, 'pathExists').mockImplementation((p: unknown) => String(p).endsWith('swarm-live'));
    vi.spyOn(fleet as any, 'getWorktreeGit').mockReturnValue({ status: async () => ({ isClean: () => true }), raw: async () => '' });
    await fleet.init();

    const res = await fleet.resumeSwarm('swarm-res');
    expect(res.success).toBe(true);
    await wait(50);

    const session = fleet.getSwarm('swarm-res')!;
    expect(addWorktree).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Сделай фичу');
    expect(prompts[0]).toContain(RESUME_PROMPT_SUFFIX.trim());
    const live = session.agents.find((a) => a.id === 'a-live')!;
    expect(live.status).toBe('completed');
    expect(live.resumeCount).toBe(1);
    expect(live.finalOutput).toBe('continued');
    expect(session.agents.find((a) => a.id === 'a-lost')!.status).toBe('failed');
    expect(session.status).toBe('completed');

    expect((await fleet.resumeSwarm('swarm-res')).success).toBe(false);
    expect((await fleet.resumeSwarm('nope')).success).toBe(false);
  });

  it('discardSwarm убивает, чистит worktree/ветки и удаляет файлы состояния и транскриптов', async () => {
    await store.save(runningSession('swarm-del'));
    await store.appendTranscript('swarm-del', 'a-live', 'transcript');
    vi.spyOn(worktreeService, 'listWorktrees').mockResolvedValue([] as any);
    const removeWt = vi.spyOn(worktreeService, 'removeWorktree').mockResolvedValue(true);
    vi.spyOn(worktreeService, 'pruneWorktrees').mockResolvedValue(true);

    const fleet = new AgentFleetService(store);
    vi.spyOn(fleet as any, 'pathExists').mockImplementation((p: unknown) => String(p).endsWith('swarm-live'));
    vi.spyOn(fleet as any, 'getWorktreeGit').mockReturnValue({ status: async () => ({ isClean: () => true }), raw: async () => '' });
    await fleet.init();

    const events: string[] = [];
    fleet.on('swarmEvent', (e) => events.push(e.type));

    const res = await fleet.discardSwarm('swarm-del');
    expect(res.success).toBe(true);
    expect(removeWt).toHaveBeenCalledWith('F:/ProjectHub', 'F:/ProjectHub/.worktrees/swarm-live', true);
    expect(fleet.getSwarm('swarm-del')).toBeUndefined();
    expect(events).toContain('swarm_removed');
    await expect(fs.access(store.sessionFile('swarm-del'))).rejects.toThrow();
    await expect(fs.access(store.transcriptDir('swarm-del'))).rejects.toThrow();
  });

  it('startFanOut пишет сессию и транскрипт на диск, shutdown помечает активные сессии interrupted', async () => {
    vi.spyOn(worktreeService, 'addWorktree').mockImplementation(async (_p, opts) => ({
      path: `F:/ProjectHub/.worktrees/${opts.branch.replace(/\//g, '_')}`,
      branch: opts.branch,
      commit: '1',
      isMain: false,
      isDetached: false,
      isLocked: false,
      isPrunable: false
    }) as any);
    vi.spyOn(worktreeService, 'getWorktreeDiff').mockResolvedValue('');
    // Агент «зависает» до shutdown: onComplete не вызывается.
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (_req, onChunk) => {
      onChunk({ text: 'streamed chunk' });
    });

    const fleet = new AgentFleetService(store);
    vi.spyOn(fleet as any, 'pathExists').mockReturnValue(false);
    const session = await fleet.startFanOut({
      projectPath: 'F:/ProjectHub',
      prompt: 'p',
      agents: [{ id: 'agent-1', name: 'A', engine: 'api' }]
    });
    await wait(60);

    const transcript = await fleet.readTranscript(session.id, 'agent-1');
    expect(transcript).not.toBeNull();
    expect(transcript!.content).toContain('streamed chunk');
    expect(transcript!.content).toContain('[Swarm] Старт агента');

    await fleet.shutdown();
    const onDisk = (await store.list()).find((s) => s.id === session.id)!;
    expect(onDisk.status).toBe('interrupted');
    expect(onDisk.agents[0].status).toBe('interrupted');
  });
});

describe('AgentFleetService: стоимость и бюджет (TASK-56, AC #3, #4)', () => {
  it('usage API-агента считается по таблице цен, превышение бюджета слота → budget_exceeded', async () => {
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (_req, onChunk, onComplete) => {
      onChunk({ text: 'answer' });
      onChunk({
        usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 1_000_000, costSource: 'unknown' }
      });
      onComplete({ id: 'm', role: 'assistant', content: 'answer', timestamp: new Date().toISOString() });
    });

    const fleet = new AgentFleetService(null);
    const session = await fleet.startFanOut({
      projectPath: 'F:/ProjectHub',
      prompt: 'p',
      useWorktrees: false,
      agents: [
        { id: 'cheap', name: 'Cheap', engine: 'api', providerConfig: { provider: 'deepseek', model: 'deepseek-chat' }, budgetUsd: 1 },
        { id: 'pricey', name: 'Pricey', engine: 'api', providerConfig: { provider: 'anthropic', model: 'claude-opus-5' }, budgetUsd: 1 }
      ]
    });
    await wait(50);

    const cheap = session.agents.find((a) => a.id === 'cheap')!;
    const pricey = session.agents.find((a) => a.id === 'pricey')!;
    expect(cheap.status).toBe('completed');
    expect(cheap.metrics.usage!.costUsd).toBeCloseTo(0.28, 6);
    expect(cheap.metrics.usage!.costSource).toBe('price-table');
    expect(cheap.metrics.tokensEstimated).toBeUndefined();

    expect(pricey.status).toBe('budget_exceeded');
    expect(pricey.metrics.usage!.costUsd).toBeCloseTo(5, 6);
    expect(pricey.error).toContain('Бюджет агента');
    expect(pricey.logs.some((l) => l.includes('[Swarm Budget]'))).toBe(true);
    expect(session.totalCostUsd).toBeCloseTo(5.28, 6);
    expect(session.status).toBe('completed');
  });

  it('бюджет сессии останавливает всех активных агентов, сессия → failed с понятной ошибкой', async () => {
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (_req, onChunk, onComplete) => {
      onChunk({
        usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 1_000_000, costSource: 'unknown' }
      });
      onComplete({ id: 'm', role: 'assistant', content: 'x', timestamp: new Date().toISOString() });
    });
    const fleet = new AgentFleetService(null);
    const session = await fleet.startFanOut({
      projectPath: 'F:/ProjectHub',
      prompt: 'p',
      useWorktrees: false,
      budgetUsd: 3,
      agents: [
        { id: 'a', name: 'A', engine: 'api', providerConfig: { provider: 'anthropic', model: 'claude-opus-5' } },
        { id: 'b', name: 'B', engine: 'api', providerConfig: { provider: 'anthropic', model: 'claude-opus-5' } }
      ]
    });
    await wait(50);
    expect(session.status).toBe('failed');
    expect(session.error).toContain('Бюджет сессии');
    expect(session.agents.some((a) => a.status === 'budget_exceeded')).toBe(true);
    expect(session.totalCostUsd).toBeGreaterThan(3);
  });

  it('пользовательская таблица цен из agent-pricing.json применяется через setPriceTable', async () => {
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (_req, onChunk, onComplete) => {
      onChunk({ usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 1_000_000, costSource: 'unknown' } });
      onComplete({ id: 'm', role: 'assistant', content: 'x', timestamp: new Date().toISOString() });
    });
    const fleet = new AgentFleetService(null);
    fleet.setPriceTable({ updatedAt: '2026-01-01', models: { 'my-local': { input: 0.5, output: 0.5 } } });
    const session = await fleet.startFanOut({
      projectPath: 'F:/ProjectHub',
      prompt: 'p',
      useWorktrees: false,
      agents: [{ id: 'a', name: 'A', engine: 'api', providerConfig: { provider: 'custom', model: 'my-local' } }]
    });
    await wait(30);
    expect(session.agents[0].metrics.usage!.costUsd).toBeCloseTo(0.5, 6);
    expect(fleet.exportSession(session.id, 'markdown')).toContain('$0.50');
    expect(JSON.parse(fleet.exportSession(session.id, 'json')!).totals.costUsd).toBeCloseTo(0.5, 6);
    expect(fleet.exportSession('missing', 'json')).toBeNull();
  });
});
