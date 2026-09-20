import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentFleetService } from '../../electron/services/agentFleetService';
import { SwarmSessionStore } from '../../electron/services/swarmSessionStore';
import { aiAgentService, type AIMessage, type StreamChatOptions } from '../../electron/services/aiAgentService';
import { CheckpointService } from '../../electron/services/checkpointService';
import { execGit } from '../../electron/services/checkpointGit';
import { processManager } from '../../electron/services/processManager';
import { REPORT_FENCE } from '../../electron/services/doneLoop';

/**
 * Продолжение после отката в цикле «до готовности» и перезапуск этапов handoff (TASK-102, decision-48).
 * Проект — временный git-репозиторий, движок — мок `streamChat` с инструментом записи файла.
 */

const TASK = [
  '---',
  'id: TASK-1',
  'title: Файлы',
  'status: In Progress',
  "created_date: '2026-09-19 10:00'",
  '---',
  '',
  '## Acceptance Criteria',
  '<!-- AC:BEGIN -->',
  '- [ ] #1 Файлы созданы',
  '<!-- AC:END -->',
  ''
].join('\n');

const report = (status: string) =>
  `Готово.\n\`\`\`${REPORT_FENCE}\n${JSON.stringify({ summary: 's', criteria: [{ index: 1, status, evidence: 'one.txt и two.txt созданы в корне проекта' }] })}\n\`\`\``;

let root: string;
let repo: string;
let taskFile: string;
let store: SwarmSessionStore;

const git = (cwd: string, ...args: string[]) => execGit(args, { cwd });
const exists = (p: string) => fs.access(p).then(() => true, () => false);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('timeout');
    await wait(25);
  }
}

interface Call {
  prompt: string;
  messages: number;
  projectPath: string;
}

/** Мок движка: пишет файл инструментом (граница хода → чекпоинт), затем отвечает текстом. */
function mockEngine(
  checkpoints: CheckpointService,
  ids: { swarm: string },
  plan: (n: number, call: Call) => { file?: string; text: string; agentId: string; hang?: () => boolean }
): Call[] {
  const calls: Call[] = [];
  vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (req, onChunk, onComplete, _onError, options?: StreamChatOptions) => {
    const call: Call = { prompt: String(req.messages[req.messages.length - 1].content), messages: req.messages.length, projectPath: req.projectPath ?? '' };
    calls.push(call);
    const step = plan(calls.length, call);
    options?.onToolBoundary?.({ kind: 'step', step: 0, model: 'm' });
    if (step.file) {
      await fs.writeFile(path.join(call.projectPath, step.file), step.file);
      const id = `c${calls.length}`;
      onChunk({ toolCall: { id, name: 'write_file', args: { path: step.file } } });
      options?.onToolBoundary?.({ kind: 'tool_result', id, name: 'write_file', ok: true, outputChars: 2, durationMs: 3 });
      await checkpoints.whenIdle(ids.swarm, step.agentId);
    }
    if (step.hang) {
      // «Зависший» ход: возвращается без колбэков только после отмены.
      await waitFor(step.hang, 10_000);
      return;
    }
    onChunk({ text: step.text });
    onComplete({ id: `m${calls.length}`, role: 'assistant', content: step.text, timestamp: new Date().toISOString() } as AIMessage);
  });
  return calls;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-rewcont-'));
  repo = path.join(root, 'project');
  await fs.mkdir(path.join(repo, 'backlog', 'tasks'), { recursive: true });
  await git(repo, 'init', '-q', '-b', 'main');
  await git(repo, 'config', 'user.name', 't');
  await git(repo, 'config', 'user.email', 't@t');
  await git(repo, 'config', 'core.autocrlf', 'false');
  taskFile = path.join(repo, 'backlog', 'tasks', 'task-1 - Файлы.md');
  await fs.writeFile(taskFile, TASK);
  await fs.writeFile(
    path.join(repo, '.projecthub.json'),
    JSON.stringify({ checks: [{ id: 't', kind: 'test', name: 'Tests', command: 'npm test' }], doneLoop: { docChecks: false } })
  );
  await fs.writeFile(path.join(repo, '.gitignore'), '.worktrees/\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-qm', 'base');
  store = new SwarmSessionStore(path.join(root, 'swarms'), 10);
  vi.spyOn(processManager, 'runOnce').mockResolvedValue({ exitCode: 0, output: 'ok', truncated: false, timedOut: false, durationMs: 1, startedAt: Date.now() });
});

afterEach(async () => {
  await store.flush();
  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe('Продолжение после отката: цикл «до готовности» (decision-48 п. 2)', () => {
  it('откат помечает итерации, продолжение открывает отрезок с новым лимитом и отменяет прошлый успех', async () => {
    const checkpoints = new CheckpointService();
    const fleet = new AgentFleetService(store, { checkpoints });
    const ids = { swarm: '' };
    // 1: не готово → повтор; 2: готово (успех); после отката 3: не готово → повтор; 4: готово.
    const calls = mockEngine(checkpoints, ids, (n) => ({
      agentId: 'dl',
      file: n === 1 ? 'one.txt' : n === 2 ? 'two.txt' : n === 3 ? 'three.txt' : undefined,
      text: report(n === 1 || n === 3 ? 'not_done' : 'done')
    }));

    const session = await fleet.startDoneLoop({
      projectPath: repo,
      taskId: 'TASK-1',
      prompt: 'Создай файлы',
      agent: { id: 'dl', name: 'DL', engine: 'api', role: 'impl' },
      useWorktrees: true,
      maxIterations: 2
    });
    ids.swarm = session.id;
    await waitFor(() => session.status === 'completed');
    const agent = session.agents[0];
    const wt = agent.worktreePath!;
    expect(session.doneLoop!.iterations.map((i) => [i.index, i.decision, i.run])).toEqual([
      [1, 'retry', 1],
      [2, 'finish', 2]
    ]);
    // успех записан в задачу основного дерева
    let saved = await fs.readFile(taskFile, 'utf-8');
    expect(saved).toContain('- [x] #1 Файлы созданы');
    expect(saved).toMatch(/status: Review/);
    expect(session.doneLoop!.task).toMatchObject({ previousStatus: 'In Progress', criteriaChecked: [1] });

    // без отката продолжить цикл нельзя
    const noRewind = await fleet.continueAgent(session.id, agent.id);
    expect(noRewind).toMatchObject({ success: false, mode: 'loop' });
    expect(noRewind.error).toMatch(/после отката/);
    const view0 = await fleet.getTimeline(session.id, agent.id);
    expect(view0!.continueAgent).toMatchObject({ allowed: false, mode: 'loop' });

    // откат к ходу первой итерации: итерация 1 отменена частично, 2 — целиком
    const cpTurn1 = agent.checkpoints!.find((c) => c.kind === 'turn' && c.run === 1)!;
    const rw = await fleet.rewindAgent(session.id, agent.id, cpTurn1.n);
    expect(rw.success).toBe(true);
    expect(await exists(path.join(wt, 'two.txt'))).toBe(false);
    expect(session.doneLoop!.iterations.map((i) => i.rolledBack)).toEqual(['partial', 'full']);
    const view1 = await fleet.getTimeline(session.id, agent.id);
    expect(view1!.continueAgent).toEqual({ allowed: true, mode: 'loop' });

    const usageBefore = agent.metrics.usage!;
    const cont = await fleet.continueAgent(session.id, agent.id, 'создай three.txt');
    expect(cont).toEqual({ success: true, mode: 'loop' });
    // прошлый успех отменён сразу, до нового хода
    saved = await fs.readFile(taskFile, 'utf-8');
    expect(saved).toContain('- [ ] #1 Файлы созданы');
    expect(saved).toMatch(/status: In Progress/);
    expect(saved).toContain('Итог цикла «до готовности» отменён откатом к чекпоинту #');

    await waitFor(() => session.status === 'completed' && calls.length === 4);
    const loop = session.doneLoop!;
    // сквозные номера, отрезок 1, лимит 2 действует на отрезок: итерация 3 — повтор, а не «лимит»
    expect(loop.iterations.map((i) => [i.index, i.decision, i.segment ?? 0, i.rolledBack ?? null])).toEqual([
      [1, 'retry', 0, 'partial'],
      [2, 'finish', 0, 'full'],
      [3, 'retry', 1, null],
      [4, 'finish', 1, null]
    ]);
    expect(loop.outcome).toBe('success');
    expect(session.continuations).toHaveLength(1);
    expect(session.continuations![0]).toMatchObject({ mode: 'loop', agentId: 'dl', afterIteration: 2, toCheckpoint: cpTurn1.n, instruction: 'создай three.txt' });
    expect(session.continuations![0].note).toContain('откатён к чекпоинту');

    // первая итерация отрезка — новая сессия движка с пояснением; следующая продолжает её
    expect(calls[2].messages).toBe(1);
    expect(calls[2].prompt).toContain('Цикл продолжен после отката: итерация 2 отменена откатом, итерация 1 отменена частично');
    expect(calls[2].prompt).toContain('Уточнение пользователя: создай three.txt');
    expect(calls[2].prompt).toContain(`откатён к чекпоинту #${cpTurn1.n}`);
    expect(calls[3].messages).toBeGreaterThan(1);
    expect(calls[3].prompt).toContain('Итерация 1 из 2 не принята');

    // файлы соответствуют откатанному состоянию плюс новая работа
    expect(await exists(path.join(wt, 'one.txt'))).toBe(true);
    expect(await exists(path.join(wt, 'two.txt'))).toBe(false);
    expect(await exists(path.join(wt, 'three.txt'))).toBe(true);
    saved = await fs.readFile(taskFile, 'utf-8');
    expect(saved).toContain('- [x] #1 Файлы созданы');
    // лимит действует на отрезок, поэтому в итоге — и сквозной счётчик, и счётчик отрезка
    expect(saved).toContain('итераций 4, после отката 2 из 2');

    // usage накопился, а не затёрт итогом
    expect(agent.metrics.usage!.inputTokens).toBeGreaterThan(usageBefore.inputTokens);

    // трасса и таймлайн знают о продолжении, экспорт — тоже
    const tl = (await fleet.getTimeline(session.id, agent.id))!.timeline;
    expect(tl.continuations).toEqual([expect.objectContaining({ type: 'continue', mode: 'loop', iteration: 3, toCheckpoint: cpTurn1.n, instruction: true })]);
    expect(tl.runs.map((r) => [r.run, r.iteration, r.afterRewind ?? false])).toEqual([
      [1, 1, false],
      [2, 2, false],
      [3, 3, true],
      [4, 4, false]
    ]);
    const md = await fleet.exportSession(session.id, 'markdown');
    expect(md).toContain('## Продолжения после отката');
    expect(md).toContain('цикл продолжен с итерации 3');
    expect(md).toContain('отменена откатом частично');
    await fleet.discardSwarm(session.id);
  }, 60_000);

  it('остановка во время продолжения работает как при первом запуске', async () => {
    const checkpoints = new CheckpointService();
    const fleet = new AgentFleetService(store, { checkpoints });
    const ids = { swarm: '' };
    const ref: { session?: { status: string } } = {};
    const calls = mockEngine(checkpoints, ids, (n) => ({
      agentId: 'dl',
      file: n === 1 ? 'one.txt' : undefined,
      text: report('done'),
      ...(n === 2 ? { hang: () => ref.session?.status === 'stopped' } : {})
    }));
    const session = await fleet.startDoneLoop({
      projectPath: repo,
      taskId: 'TASK-1',
      prompt: 'p',
      agent: { id: 'dl', name: 'DL', engine: 'api' },
      useWorktrees: true
    });
    ids.swarm = session.id;
    ref.session = session;
    await waitFor(() => session.status === 'completed');
    const agent = session.agents[0];
    const start = agent.checkpoints!.find((c) => c.kind === 'start')!;
    expect((await fleet.rewindAgent(session.id, agent.id, start.n)).success).toBe(true);
    expect(session.doneLoop!.iterations[0].rolledBack).toBe('full');
    expect((await fleet.continueAgent(session.id, agent.id)).success).toBe(true);
    await waitFor(() => calls.length === 2 && agent.status === 'running');
    expect(fleet.stopSwarm(session.id)).toBe(true);
    await waitFor(() => session.doneLoop!.phase === 'stopped');
    expect(session.status).toBe('stopped');
    expect(session.doneLoop!.outcome).toBe('stopped');
    // пояснение израсходовано: снова продолжить можно только после нового отката
    const again = await fleet.continueAgent(session.id, agent.id);
    expect(again.error).toMatch(/после отката/);
    await fleet.discardSwarm(session.id);
  }, 60_000);
});

describe('Продолжение после отката: handoff (decision-48 п. 3)', () => {
  it('откат этапа 1 отменяет этапы 1–2, перезапуск повторяет оба этапа в общем worktree', async () => {
    const checkpoints = new CheckpointService();
    const fleet = new AgentFleetService(store, { checkpoints });
    const ids = { swarm: '' };
    const calls = mockEngine(checkpoints, ids, (n, call) => {
      const stage1 = call.prompt.includes('"architect"');
      return { agentId: stage1 ? 'h1' : 'h2', file: stage1 ? `arch-${n}.txt` : `impl-${n}.txt`, text: `этап ${stage1 ? 1 : 2}, вызов ${n}` };
    });
    const session = await fleet.startHandoff({
      projectPath: repo,
      prompt: 'Конвейер',
      useWorktrees: true,
      stages: [
        { role: 'architect', agent: { id: 'h1', name: 'H1', engine: 'api' } },
        { role: 'implementer', agent: { id: 'h2', name: 'H2', engine: 'api' } }
      ]
    });
    ids.swarm = session.id;
    await waitFor(() => session.status === 'completed');
    const [a1, a2] = session.agents;
    const wt = a1.worktreePath!;
    expect(a2.worktreePath).toBe(wt);

    // без отката перезапуск недоступен
    expect((await fleet.continueAgent(session.id, a1.id)).error).toMatch(/после отката его агента/);

    const cp = a1.checkpoints!.find((c) => c.kind === 'turn')!;
    const rw = await fleet.rewindAgent(session.id, a1.id, cp.n);
    expect(rw.success).toBe(true);
    expect(await exists(path.join(wt, 'arch-1.txt'))).toBe(true);
    expect(await exists(path.join(wt, 'impl-2.txt'))).toBe(false);
    // этапы 1 и 2 отменены, результат этапа 2 очищен
    expect(session.handoffStages!.map((s) => [s.status, Boolean(s.invalidatedAt), s.commitHash ?? null, s.reportPath ?? null])).toEqual([
      ['pending', true, null, null],
      ['pending', true, null, null]
    ]);
    expect(a2).toMatchObject({ status: 'pending' });
    expect(a2.commitHash).toBeUndefined();
    // откат этапа 2 теперь запрещён: его чекпоинты описывают отменённое «будущее»
    const v2 = await fleet.getTimeline(session.id, a2.id);
    expect(v2!.rewind.allowed).toBe(false);
    expect(v2!.rewind.reason).toMatch(/Этап 1/);
    expect((await fleet.rewindAgent(session.id, a2.id, 1)).success).toBe(false);
    const v1 = await fleet.getTimeline(session.id, a1.id);
    expect(v1!.continueAgent).toEqual({ allowed: true, mode: 'handoff', fromStage: 0 });

    const usage1 = a1.metrics.usage!;
    const cont = await fleet.continueAgent(session.id, a1.id, 'короче');
    expect(cont).toEqual({ success: true, mode: 'handoff' });
    await waitFor(() => session.status === 'completed' && calls.length === 4);

    expect(calls[2].prompt).toContain('Выполни свою часть работы в рамках роли "architect"');
    expect(calls[2].prompt).toContain('Уточнение пользователя: короче');
    expect(calls[2].prompt).toContain(`откатён к чекпоинту #${cp.n}`);
    // второй этап получил артефакт перезапущенного первого
    expect(calls[3].prompt).toContain('этап 1, вызов 3');
    expect(calls[3].prompt).not.toContain('откатён');

    expect(session.handoffStages!.map((s) => [s.status, s.rerunCount, s.invalidatedAt ?? null])).toEqual([
      ['completed', 1, null],
      ['completed', 1, null]
    ]);
    expect(session.continuations).toEqual([expect.objectContaining({ mode: 'handoff', agentId: 'h1', fromStage: 0, stages: [0, 1], instruction: 'короче' })]);
    expect((await git(wt, 'log', '--format=%s')).trim().split('\n')).toEqual([
      `agent(implementer): ${session.id}`,
      `agent(architect): ${session.id}`,
      `rewind(architect): чекпоинт #${cp.n} (после хода 1)`,
      'base'
    ]);
    expect(await exists(path.join(wt, 'arch-3.txt'))).toBe(true);
    expect(await exists(path.join(wt, 'impl-4.txt'))).toBe(true);
    expect(a1.metrics.usage!.inputTokens).toBeGreaterThan(usage1.inputTokens);
    // трасса второго этапа помечает повторный запуск
    const tl2 = (await fleet.getTimeline(session.id, a2.id))!.timeline;
    expect(tl2.continuations).toEqual([expect.objectContaining({ mode: 'handoff', stage: 1 })]);
    expect(tl2.runs).toHaveLength(2);
    const md = await fleet.exportSession(session.id, 'markdown');
    expect(md).toContain('перезапуск этапов 1, 2');
    await fleet.discardSwarm(session.id);
  }, 60_000);
});
