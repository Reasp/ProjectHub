import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentFleetService } from '../../electron/services/agentFleetService';
import { SwarmSessionStore } from '../../electron/services/swarmSessionStore';
import { CheckpointService } from '../../electron/services/checkpointService';
import { aiAgentService, type AIMessage, type StreamChatOptions } from '../../electron/services/aiAgentService';
import { execGit } from '../../electron/services/checkpointGit';
import { hitlService } from '../../electron/services/hitlService';
import { processManager } from '../../electron/services/processManager';
import { REPORT_FENCE } from '../../electron/services/doneLoop';
import { PLAN_FENCE } from '../../electron/services/planSchema';
import { PlanService } from '../../electron/services/planService';
import { PlanStore } from '../../electron/services/planStore';
import type { PlanState } from '../../electron/services/planTypes';

/**
 * Планировщик на настоящем `AgentFleetService` (TASK-80.2, decision-49): генерация плана,
 * создание подзадач, параллельные узлы «до готовности», слияние в интеграционную ветку,
 * конфликт в HITL и блокировка зависимых. Проект — временный git-репозиторий, движок — мок.
 */

const PARENT_TASK = [
  '---',
  'id: TASK-1',
  'title: Большая задача',
  'status: In Progress',
  "created_date: '2026-09-20 10:00'",
  '---',
  '',
  '## Description',
  '<!-- SECTION:DESCRIPTION:BEGIN -->',
  'Нужно сделать три вещи.',
  '<!-- SECTION:DESCRIPTION:END -->',
  '',
  '## Acceptance Criteria',
  '<!-- AC:BEGIN -->',
  '- [ ] #1 Все три файла созданы',
  '<!-- AC:END -->',
  ''
].join('\n');

/** Ответ роли architect: три подзадачи, третья зависит от первых двух. */
const planAnswer = (files = ['a.txt', 'b.txt', 'c.txt']) =>
  `Разобрал задачу.\n\`\`\`${PLAN_FENCE}\n${JSON.stringify({
    summary: 'Две независимые части и сборка',
    subtasks: [
      { key: 'one', title: `Создать ${files[0]}`, description: `Создай файл ${files[0]}`, acceptanceCriteria: [`Файл ${files[0]} есть`], dependsOn: [] },
      { key: 'two', title: `Создать ${files[1]}`, description: `Создай файл ${files[1]}`, acceptanceCriteria: [`Файл ${files[1]} есть`], dependsOn: [] },
      { key: 'three', title: `Создать ${files[2]}`, description: `Создай файл ${files[2]}`, acceptanceCriteria: [`Файл ${files[2]} есть`], dependsOn: ['one', 'two'] }
    ]
  })}\n\`\`\``;

const nodeReport = () =>
  `Готово.\n\`\`\`${REPORT_FENCE}\n${JSON.stringify({
    summary: 'файл создан',
    criteria: [{ index: 1, status: 'done', evidence: 'файл создан в корне рабочего каталога агента' }]
  })}\n\`\`\``;

let root: string;
let repo: string;
/** Сколько слияний планировщика шло одновременно: интеграционный worktree один на план. */
let mergeStats: { inFlight: number; max: number; delayFirstMs: number };
let store: SwarmSessionStore;
let planStore: PlanStore;
let fleet: AgentFleetService;
let plans: PlanService;

const git = (cwd: string, ...args: string[]) => execGit(args, { cwd });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const taskFile = (id: string) => path.join(repo, 'backlog', 'tasks', `${id.toLowerCase()} - ${id === 'task-1' ? 'Большая задача' : 'x'}.md`);

async function waitFor(check: () => boolean, timeoutMs = 40_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('timeout');
    await wait(25);
  }
}

const finished = (plan: PlanState) => plan.phase === 'finished' || plan.phase === 'failed';

/**
 * Мок движка: ход роли architect отвечает планом, ход узла создаёт свой файл и отчитывается.
 * `plan(n)` позволяет подменить ответ architect, `nodeFile` — файл, который пишет узел.
 */
function mockEngine(options: {
  architect: (attempt: number) => string;
  nodeFile?: (taskId: string) => { name: string; content: string } | null;
  /** Узел не отдаёт отчёт ни на одном ходе — цикл «до готовности» исчерпает лимит итераций. */
  nodeFails?: (taskId: string) => boolean;
  /** Узел «зависает», пока условие не выполнится (проверка остановки). */
  nodeHangs?: (taskId: string) => boolean;
  hangUntil?: () => boolean;
  /**
   * Перечисленные узлы ждут друг друга: ход не отвечает, пока в работе не окажется столько же
   * ходов. Если бы планировщик запускал узлы по очереди, ожидание упёрлось бы в таймаут и
   * `maxInFlight` остался бы равен 1 — так проверка параллельности не зависит от скорости машины.
   */
  barrier?: string[];
}): { architectCalls: string[]; nodeCalls: string[]; stats: { maxInFlight: number } } {
  const architectCalls: string[] = [];
  const nodeCalls: string[] = [];
  const inFlight = new Set<string>();
  const stats = { maxInFlight: 0 };
  // Повторный ход цикла не содержит id задачи в промпте, поэтому узел опознаётся по сессии.
  const taskBySession = new Map<string, string>();

  vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (req, onChunk, onComplete, _onError, opts?: StreamChatOptions) => {
    const last = String(req.messages[req.messages.length - 1].content);
    const reply = (text: string) => {
      onChunk({ text });
      onComplete({ id: `m${Date.now()}`, role: 'assistant', content: text, timestamp: new Date().toISOString() } as AIMessage);
    };

    if (req.sessionId.startsWith('plan-')) {
      architectCalls.push(last);
      reply(options.architect(architectCalls.length));
      return;
    }

    const known = taskBySession.get(req.sessionId);
    const taskId = known ?? /TASK-1\.\d+/.exec(last)?.[0] ?? 'unknown';
    taskBySession.set(req.sessionId, taskId);
    nodeCalls.push(taskId);
    inFlight.add(taskId);
    stats.maxInFlight = Math.max(stats.maxInFlight, inFlight.size);
    try {
      if (options.barrier?.includes(taskId)) {
        await waitFor(() => inFlight.size >= options.barrier!.length, 20_000).catch(() => undefined);
        stats.maxInFlight = Math.max(stats.maxInFlight, inFlight.size);
      }
      opts?.onToolBoundary?.({ kind: 'step', step: 0, model: 'm' });
      const file = options.nodeFile ? options.nodeFile(taskId) : { name: `${taskId.replace(/\W/g, '')}.txt`, content: taskId };
      if (file) {
        await fs.writeFile(path.join(req.projectPath ?? '', file.name), file.content);
        onChunk({ toolCall: { id: `c-${taskId}`, name: 'write_file', args: { path: file.name } } });
        opts?.onToolBoundary?.({ kind: 'tool_result', id: `c-${taskId}`, name: 'write_file', ok: true, outputChars: 2, durationMs: 1 });
      }
      if (options.nodeHangs?.(taskId)) {
        // Возврат без колбэков = «зависший» ход: завершаемся только по отмене.
        await waitFor(() => options.hangUntil?.() === true, 30_000);
        return;
      }
      if (options.nodeFails?.(taskId)) {
        reply('Не смог: не хватает данных.');
        return;
      }
      reply(nodeReport());
    } finally {
      inFlight.delete(taskId);
    }
  });
  return { architectCalls, nodeCalls, stats };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-plan-'));
  repo = path.join(root, 'project');
  await fs.mkdir(path.join(repo, 'backlog', 'tasks'), { recursive: true });
  await git(repo, 'init', '-q', '-b', 'main');
  await git(repo, 'config', 'user.name', 't');
  await git(repo, 'config', 'user.email', 't@t');
  await git(repo, 'config', 'core.autocrlf', 'false');
  await fs.writeFile(taskFile('task-1'), PARENT_TASK);
  await fs.writeFile(path.join(repo, 'shared.txt'), 'base\n');
  await fs.writeFile(
    path.join(repo, '.projecthub.json'),
    JSON.stringify({ checks: [{ id: 't', kind: 'test', name: 'Tests', command: 'npm test' }], doneLoop: { docChecks: false } })
  );
  await fs.writeFile(path.join(repo, '.gitignore'), '.worktrees/\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-qm', 'base');

  store = new SwarmSessionStore(path.join(root, 'swarms'), 10);
  planStore = new PlanStore(path.join(root, 'plans'), 10);
  fleet = new AgentFleetService(store, { checkpoints: new CheckpointService() });
  mergeStats = { inFlight: 0, max: 0, delayFirstMs: 0 };
  plans = new PlanService(planStore, {
    fleet,
    git: async (cwd, args) => {
      const isMerge = args[0] === 'merge' && args[1] !== '--abort';
      if (!isMerge) return execGit(args, { cwd });
      mergeStats.inFlight += 1;
      mergeStats.max = Math.max(mergeStats.max, mergeStats.inFlight);
      try {
        // Задержка внутри «критической секции»: без очереди слияний второй merge успеет
        // зайти в тот же worktree, пока первый ещё идёт, и счётчик покажет 2.
        if (mergeStats.delayFirstMs > 0) {
          const delay = mergeStats.delayFirstMs;
          mergeStats.delayFirstMs = 0;
          await wait(delay);
        }
        return await execGit(args, { cwd });
      } finally {
        mergeStats.inFlight -= 1;
      }
    }
  });
  await plans.init();
  vi.spyOn(processManager, 'runOnce').mockResolvedValue({ exitCode: 0, output: 'ok', truncated: false, timedOut: false, durationMs: 1, startedAt: Date.now() });
});

afterEach(async () => {
  await store.flush();
  await plans.flush();
  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

const startPlan = () =>
  plans.generatePlan({
    projectPath: repo,
    taskId: 'TASK-1',
    settings: { maxParallel: 2, agent: { id: 'node', name: 'Исполнитель', engine: 'api' } }
  });

describe('генерация плана и подзадачи Backlog', () => {
  it('невалидный план повторяется с замечаниями, валидный создаёт подзадачи с зависимостями', async () => {
    const calls = mockEngine({
      architect: (attempt) => (attempt === 1 ? 'Давай обсудим, задача сложная.' : planAnswer()),
      nodeFile: () => null
    });

    const plan = await startPlan();
    expect(plan.phase).toBe('awaiting_approval');
    expect(plan.architect.attempts).toBe(2);
    expect(calls.architectCalls[1]).toContain('План не принят (попытка 1 из 3)');
    expect(calls.architectCalls[1]).toContain(PLAN_FENCE);
    // контекст задачи ушёл модели первым ходом
    expect(calls.architectCalls[0]).toContain('TASK-1');
    expect(calls.architectCalls[0]).toContain('Все три файла созданы');

    expect(plan.nodes.map((n) => [n.taskId, n.dependsOn])).toEqual([
      ['TASK-1.1', []],
      ['TASK-1.2', []],
      ['TASK-1.3', ['TASK-1.1', 'TASK-1.2']]
    ]);

    const files = await fs.readdir(path.join(repo, 'backlog', 'tasks'));
    expect(files.filter((f) => f.startsWith('task-1.'))).toHaveLength(3);
    const sub = await fs.readFile(path.join(repo, 'backlog', 'tasks', files.find((f) => f.startsWith('task-1.3'))!), 'utf-8');
    expect(sub).toContain('parent_task_id: TASK-1');
    expect(sub).toContain('- TASK-1.1');
    expect(sub).toContain('- TASK-1.2');
    expect(sub).toContain('- [ ] #1 Файл c.txt есть');

    // читаемый план записан в родительскую задачу
    const parent = await fs.readFile(taskFile('task-1'), 'utf-8');
    expect(parent).toContain('## Implementation Plan');
    expect(parent).toContain('TASK-1.3 — Создать c.txt (после TASK-1.1, TASK-1.2)');
  }, 60_000);

  it('после трёх неудачных попыток план проваливается и не создаёт подзадач', async () => {
    mockEngine({ architect: () => 'Плана не будет.' });
    const plan = await startPlan();
    expect(plan.phase).toBe('failed');
    expect(plan.architect.attempts).toBe(3);
    expect(plan.reason).toContain('не вернула валидный план');
    expect(plan.nodes).toEqual([]);
    const files = await fs.readdir(path.join(repo, 'backlog', 'tasks'));
    expect(files.filter((f) => f.startsWith('task-1.'))).toHaveLength(0);
  }, 60_000);
});

describe('запуск плана', () => {
  it('без утверждения узлы не стартуют', async () => {
    mockEngine({ architect: () => planAnswer() });
    const plan = await startPlan();
    await wait(200);
    expect(plan.nodes.every((n) => n.state === 'pending')).toBe(true);
    expect(plan.integrationBranch).toBeUndefined();
  }, 60_000);

  it('независимые узлы идут параллельно, зависимый ждёт слияния обоих', async () => {
    const files: Record<string, string> = { 'TASK-1.1': 'a.txt', 'TASK-1.2': 'b.txt', 'TASK-1.3': 'c.txt' };
    const calls = mockEngine({
      architect: () => planAnswer(),
      nodeFile: (taskId) => ({ name: files[taskId] ?? 'x.txt', content: taskId }),
      barrier: ['TASK-1.1', 'TASK-1.2']
    });

    const plan = await startPlan();
    const branchBefore = (await git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
    expect(await plans.approvePlan(plan.id)).toEqual({ success: true });

    // под нагрузкой полного прогона (сборка запускает весь набор) узлы идут заметно дольше
    await waitFor(() => finished(plan), 120_000);
    // два независимых узла действительно работали одновременно, третий — нет
    expect(calls.stats.maxInFlight).toBe(2);
    // а вот слияния — строго по очереди: два `git merge` в одном интеграционном worktree мешают
    // друг другу, и `merge --abort` одного обрывал бы слияние другого (TASK-80.4)
    expect(mergeStats.max).toBe(1);
    expect(plan.outcome).toBe('success');
    expect(plan.nodes.map((n) => n.state)).toEqual(['merged', 'merged', 'merged']);
    expect(calls.nodeCalls.sort()).toEqual(['TASK-1.1', 'TASK-1.2', 'TASK-1.3']);

    // зависимый узел стартовал после слияния предшественников и видел их файлы
    const third = plan.nodes[2];
    expect(third.startedAt!).toBeGreaterThanOrEqual(Math.max(plan.nodes[0].finishedAt!, plan.nodes[1].finishedAt!));

    // всё влито в интеграционную ветку, основное дерево не тронуто
    const merged = (await git(repo, 'ls-tree', '--name-only', plan.integrationBranch!)).trim().split('\n');
    expect(merged).toEqual(expect.arrayContaining(['a.txt', 'b.txt', 'c.txt']));
    expect((await git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe(branchBefore);
    // файлы узлов есть только в интеграционной ветке, в рабочем дереве человека их нет
    await expect(fs.access(path.join(repo, 'a.txt'))).rejects.toThrow();
    expect(plan.nodes.every((n) => Boolean(n.mergeCommit))).toBe(true);

    // итог в родительской задаче: сводка и Review, но не Done
    const parent = await fs.readFile(taskFile('task-1'), 'utf-8');
    expect(parent).toContain('## Final Summary');
    expect(parent).toContain('влито — 3');
    expect(parent).toContain(plan.integrationBranch!);
    expect(parent).not.toMatch(/status: Done/);
  }, 120_000);

  it('провал узла блокирует зависимых, независимая ветвь доходит до конца', async () => {
    mockEngine({
      architect: () => planAnswer(),
      nodeFile: (taskId) => ({ name: `${taskId.replace(/\W/g, '')}.txt`, content: taskId }),
      nodeFails: (taskId) => taskId === 'TASK-1.1'
    });

    const plan = await startPlan();
    await plans.approvePlan(plan.id);
    await waitFor(() => finished(plan), 90_000);

    expect(plan.nodes.map((n) => [n.taskId, n.state])).toEqual([
      ['TASK-1.1', 'failed'],
      ['TASK-1.2', 'merged'],
      ['TASK-1.3', 'blocked']
    ]);
    expect(plan.outcome).toBe('partial');
    expect(plan.nodes[2].reason).toContain('TASK-1.1');
    const parent = await fs.readFile(taskFile('task-1'), 'utf-8');
    expect(parent).toContain('заблокирована');
  }, 120_000);

  it('остановка плана прекращает запуск новых узлов', async () => {
    const ref: { plan?: PlanState } = {};
    const calls = mockEngine({
      architect: () => planAnswer(),
      nodeFile: () => null,
      nodeHangs: () => true,
      hangUntil: () => ref.plan?.stopped === true
    });
    const plan = await startPlan();
    ref.plan = plan;
    await plans.approvePlan(plan.id);
    await waitFor(() => plan.nodes.filter((n) => n.state === 'running').length === 2);
    plans.stopPlan(plan.id);
    await waitFor(() => finished(plan), 90_000);
    expect(plan.outcome).toBe('stopped');
    // третий узел так и не стартовал: остановленные предшественники его заблокировали
    expect(calls.nodeCalls).not.toContain('TASK-1.3');
    expect(plan.nodes[2].state).toBe('blocked');
  }, 120_000);
});

describe('конфликт слияния', () => {
  it('конфликт уходит в HITL с диффом; «пропустить» блокирует зависимых', async () => {
    // оба независимых узла правят один и тот же файл — второе слияние конфликтует
    mockEngine({
      architect: () => planAnswer(),
      nodeFile: (taskId) => ({ name: 'shared.txt', content: `base\nот ${taskId}\n` })
    });
    const requests: { title: string; details?: string }[] = [];
    vi.spyOn(hitlService, 'request').mockImplementation(async (req) => {
      requests.push({ title: req.title, details: req.details });
      return { approved: true, text: 'skip' };
    });

    const plan = await startPlan();
    await plans.approvePlan(plan.id);
    await waitFor(() => finished(plan), 90_000);

    expect(requests).toHaveLength(1);
    expect(requests[0].title).toContain('Конфликт слияния');
    expect(requests[0].details).toContain('shared.txt');

    const states = plan.nodes.map((n) => n.state);
    expect(states[0] === 'merged' || states[1] === 'merged').toBe(true);
    expect(states.filter((s) => s === 'failed')).toHaveLength(1);
    expect(states[2]).toBe('blocked');
    expect(plan.outcome).toBe('partial');
    // интеграционный worktree остался чистым после merge --abort
    expect((await git(plan.integrationWorktree!, 'status', '--porcelain')).trim()).toBe('');
  }, 120_000);
});

describe('очередь слияний', () => {
  it('слияния узлов не накладываются друг на друга, конфликт не оставляет мусора', async () => {
    // Оба узла держатся барьером и правят один файл, а первое слияние искусственно замедлено:
    // второе не должно зайти в тот же worktree, пока первое идёт. Точную гонку тест не
    // воспроизводит (её видно только под полной нагрузкой), но инвариант фиксирует.
    mockEngine({
      architect: () => planAnswer(),
      nodeFile: (taskId) => ({ name: 'shared.txt', content: `base\nот ${taskId}\n` }),
      barrier: ['TASK-1.1', 'TASK-1.2']
    });
    vi.spyOn(hitlService, 'request').mockResolvedValue({ approved: true, text: 'skip' });

    const plan = await startPlan();
    mergeStats.delayFirstMs = 1500;
    await plans.approvePlan(plan.id);
    await waitFor(() => finished(plan), 120_000);

    expect(mergeStats.max).toBe(1);
    expect((await git(plan.integrationWorktree!, 'status', '--porcelain')).trim()).toBe('');
    expect(plan.nodes.filter((n) => n.state === 'merged')).toHaveLength(1);
  }, 120_000);
});

describe('правки человека между генерацией и запуском', () => {
  it('удалённая подзадача помечается missing, а её зависимые блокируются', async () => {
    mockEngine({ architect: () => planAnswer(), nodeFile: () => null });
    const plan = await startPlan();

    const files = await fs.readdir(path.join(repo, 'backlog', 'tasks'));
    await fs.rm(path.join(repo, 'backlog', 'tasks', files.find((f) => f.startsWith('task-1.1'))!));

    await plans.refreshGraph(plan);
    expect(plan.nodes[0].state).toBe('missing');

    await plans.approvePlan(plan.id);
    await waitFor(() => finished(plan), 90_000);
    expect(plan.nodes.map((n) => n.state)).toEqual(['missing', 'merged', 'blocked']);
    expect(plan.outcome).toBe('partial');
  }, 120_000);

  it('добавленная человеком подзадача попадает в граф и требует повторного утверждения', async () => {
    mockEngine({ architect: () => planAnswer(), nodeFile: () => null });
    const plan = await startPlan();
    await plans.approvePlan(plan.id);
    await waitFor(() => finished(plan), 90_000);

    await fs.writeFile(
      path.join(repo, 'backlog', 'tasks', 'task-1.9 - Дописанная.md'),
      ['---', 'id: TASK-1.9', 'title: Дописанная', 'status: To Do', 'parent_task_id: TASK-1', 'dependencies: []', '---', '', 'тело'].join('\n')
    );
    await plans.refreshGraph(plan);
    expect(plan.nodes.map((n) => n.taskId)).toContain('TASK-1.9');
    // граф изменился — утверждение больше не действует
    const before = plan.approvedGraphHash;
    await plans.approvePlan(plan.id);
    expect(plan.approvedGraphHash).not.toBe(before);
    await waitFor(() => finished(plan), 90_000);
    expect(plan.nodes.find((n) => n.taskId === 'TASK-1.9')!.state).toBe('merged');
  }, 120_000);
});
