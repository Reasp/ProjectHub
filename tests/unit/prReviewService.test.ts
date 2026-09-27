import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { AppBusEvent, ApprovalResponse, HitlRequest } from '../../electron/services/hitlTypes';
import type { AgentSlotConfig, StartFanOutOptions, SwarmSession } from '../../electron/services/swarmTypes';
import { PrReviewService, type PrReviewDeps } from '../../electron/services/prReviewService';

/**
 * Сервис ревью PR (TASK-81, decision-53 п. 3–9) на поддельных gh, флоте и HITL: ревьюеры на чтение,
 * проверяющий, идемпотентность, бюджет, публикация только после человека.
 */

const ROOT = 'C:/Work/app';
let dir: string;

const REVIEW_A = [
  'Нашёл проблему.',
  '```projecthub-review',
  JSON.stringify({
    summary: 'PR добавляет разбор',
    findings: [
      { file: 'src/parse.ts', line: 10, severity: 'major', title: 'Пустая строка роняет разбор', description: 'Пустая строка конфига роняет разбор с исключением' },
      { file: 'src/log.ts', line: 3, severity: 'minor', title: 'Лишний лог', description: 'Лишний отладочный лог в цикле' }
    ]
  }),
  '```'
].join('\n');
const REVIEW_B = '```projecthub-review\n' + JSON.stringify({ findings: [{ file: 'src/parse.ts', line: 11, severity: 'critical', title: 'Пустая строка', description: 'Разбор падает с исключением на пустой строке конфига' }] }) + '\n```';

interface Harness {
  service: PrReviewService;
  started: StartFanOutOptions[];
  approvals: HitlRequest[];
  comments: string[];
  events: AppBusEvent[];
  notes: string[];
  decide: (response: ApprovalResponse) => void;
}

function makeHarness(options: { outputs?: Record<string, string[]>; costs?: Record<string, number>; headSha?: string } = {}): Harness {
  const outputs = options.outputs ?? { review: [REVIEW_A, REVIEW_B], verify: ['```projecthub-verify\n{"verdicts":[{"id":"F1","verdict":"confirmed","evidence":"if (!s) throw"},{"id":"F2","verdict":"refuted","reason":"лог под флагом"}]}\n```'] };
  const costs = options.costs ?? { review: 0.3, verify: 0.1 };
  const listeners = new Set<(s: SwarmSession) => void>();
  const sessions = new Map<string, SwarmSession>();
  const h = { started: [] as StartFanOutOptions[], approvals: [] as HitlRequest[], comments: [] as string[], events: [] as AppBusEvent[], notes: [] as string[] };
  let resolveApproval: (r: ApprovalResponse) => void = () => undefined;
  let seq = 0;
  const deps: PrReviewDeps = {
    gh: {
      getPr: async (_root, n) => ({ number: n, title: 'Разбор конфига', body: 'Описание', url: `https://github.com/o/r/pull/${n}`, headSha: options.headSha ?? 'abcdef1234567890', headRef: 'feat/task-5', baseRef: 'main', draft: false, state: 'OPEN' }),
      getDiff: async () => 'diff --git a/src/parse.ts b/src/parse.ts',
      fetchHead: async (_root, n) => ({ ref: `refs/projecthub/pr/${n}`, sha: options.headSha ?? 'abcdef1234567890' }),
      comment: async (_root, n, body) => {
        h.comments.push(body);
        return `https://github.com/o/r/pull/${n}#issuecomment-1`;
      }
    },
    fleet: {
      buildRoleSlot: async (_root, slug, slotId, overrides) =>
        slug === 'missing' ? { error: 'Роль "missing" не найдена' } : ({ id: slotId, name: overrides.name ?? slug, engine: 'api', roleSlug: slug, permissions: overrides.permissions } as AgentSlotConfig),
      startFanOut: async (opts) => {
        h.started.push(opts);
        const id = `swarm-${++seq}`;
        const stage = opts.review!.stage;
        const session = {
          id,
          projectPath: opts.projectPath,
          mode: 'fan_out',
          status: 'running',
          review: opts.review,
          agents: opts.agents.map((a) => ({ id: a.id, config: a, status: 'running' }))
        } as unknown as SwarmSession;
        sessions.set(id, session);
        setTimeout(() => {
          const done = {
            ...session,
            status: 'completed',
            totalCostUsd: costs[stage],
            agents: session.agents.map((a, i) => ({ ...a, status: 'completed', finalOutput: outputs[stage][i] ?? '' }))
          } as SwarmSession;
          sessions.set(id, done);
          for (const l of listeners) l(done);
        }, 5);
        return session;
      },
      getSwarm: (id) => sessions.get(id),
      onSwarm: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      }
    },
    findTask: async (_root, id) => ({ id, title: 'Конфиг', description: 'Разбирать конфиг', criteria: ['Пустой файл не падает'] }),
    appendTaskNote: async (_root, _id, note) => {
      h.notes.push(note);
    },
    requestApproval: (request) => {
      h.approvals.push(request);
      return new Promise((resolve) => {
        resolveApproval = resolve;
      });
    },
    readOnlyTools: ['Read', 'Grep', 'read_file'],
    publish: (e) => h.events.push(e),
    stateDir: dir,
    now: () => Date.now(),
    log: () => undefined
  };
  return { ...h, service: new PrReviewService(deps), decide: (r) => resolveApproval(r) };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-prreview-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const input = { projectPath: ROOT, prNumber: 12, reviewers: ['reviewer', 'reviewer-local'], budgetUsd: 1, publish: 'hitl' as const, origin: 'automation' as const };

describe('PrReviewService', () => {
  it('ревьюеры на чтение от головы PR, дедупликация, проверка, заметка, событие и запрос публикации', async () => {
    const h = makeHarness();
    const sessionsSeen: string[] = [];
    const started = await h.service.start({ ...input, onSessionStarted: (id) => sessionsSeen.push(id) });
    expect('completion' in started).toBe(true);
    const result = await (started as { completion: Promise<{ outcome: string; detail?: string; costUsd?: number; swarmIds?: string[] }> }).completion;

    expect(result).toMatchObject({ outcome: 'success', costUsd: 0.4, swarmIds: ['swarm-1', 'swarm-2'] });
    expect(result.detail).toMatch(/находок 2, подтверждено 1, отброшено 1/);
    expect(sessionsSeen).toEqual(['swarm-1', 'swarm-2']);

    const [review, verify] = h.started;
    expect(review).toMatchObject({ baseBranch: 'refs/projecthub/pr/12', autoCommitAgentResults: false, budgetUsd: 0.7, origin: 'automation', review: { stage: 'review', prNumber: 12 } });
    expect(review.agents).toHaveLength(2);
    expect(review.agents[0].permissions).toEqual({ allowFileWrite: false, allowCommands: false, allowSubagents: false, allowedTools: ['Read', 'Grep', 'read_file'] });
    expect(review.prompt).toContain('Связанная задача TASK-5');
    expect(verify).toMatchObject({ review: { stage: 'verify' }, budgetUsd: 0.7 });
    expect(verify.prompt).toContain('### F1 [critical] src/parse.ts:10-11');

    const [record] = await h.service.list(ROOT, 12);
    expect(record).toMatchObject({ status: 'done', taskId: 'TASK-5', costUsd: 0.4, publish: { mode: 'hitl', state: 'pending' } });
    expect(record.findings.map((f) => [f.id, f.verdict, f.agreement])).toEqual([
      ['F1', 'confirmed', 2],
      ['F2', 'refuted', 1]
    ]);
    expect(record.comment).toContain('Подтверждено замечаний: **1**');
    expect(h.notes[0]).toMatch(/Ревью PR #12/);
    expect(h.events.find((e) => e.type === 'pr:reviewFinished')).toMatchObject({ confirmed: 1, refuted: 1, publish: 'pending' });

    // Публикация — только после решения человека.
    await vi.waitFor(() => expect(h.approvals).toHaveLength(1));
    expect(h.approvals[0]).toMatchObject({ type: 'command', tool: 'gh pr comment', origin: 'automation' });
    expect(h.comments).toEqual([]);
    h.decide({ approved: true });
    await vi.waitFor(async () => expect((await h.service.list(ROOT, 12))[0].publish.state).toBe('published'));
    expect(h.comments).toHaveLength(1);
    expect((await h.service.list(ROOT, 12))[0].publish.commentUrl).toMatch(/issuecomment/);
  });

  it('отказ HITL не публикует; «Опубликовать» человеком публикует; повторный той же головы — пропуск', async () => {
    const h = makeHarness();
    const started = await h.service.start(input);
    await (started as { completion: Promise<unknown> }).completion;
    await vi.waitFor(() => expect(h.approvals).toHaveLength(1));
    h.decide({ approved: false });
    await vi.waitFor(async () => expect((await h.service.list(ROOT, 12))[0].publish.state).toBe('declined'));
    expect(h.comments).toEqual([]);

    expect(await h.service.start(input)).toMatchObject({ skipped: expect.stringMatching(/уже проверен/) });

    const [record] = await h.service.list(ROOT, 12);
    expect(await h.service.publishNow(ROOT, record.id)).toMatchObject({ ok: true });
    expect(h.comments).toHaveLength(1);
    expect(await h.service.publishNow(ROOT, record.id)).toMatchObject({ ok: false, error: 'Уже опубликовано' });
  });

  it('проверяющий не разобрался — находки не проверены, публиковать нечего', async () => {
    const h = makeHarness({ outputs: { review: [REVIEW_A, REVIEW_B], verify: ['не могу'] } });
    const started = await h.service.start({ ...input, publish: 'manual' });
    const result = await (started as { completion: Promise<{ outcome: string }> }).completion;
    expect(result.outcome).toBe('success');
    const [record] = await h.service.list(ROOT, 12);
    expect(record.verifier).toMatchObject({ status: 'failed' });
    expect(record.comment).toBeUndefined();
    expect(h.approvals).toEqual([]);
    expect(await h.service.publishNow(ROOT, record.id)).toMatchObject({ ok: false });
  });

  it('все ревьюеры без отчёта — ревью провалено; неизвестная роль — ошибка без сессий', async () => {
    const h = makeHarness({ outputs: { review: ['нет отчёта', 'и тут'], verify: [] } });
    const started = await h.service.start(input);
    const result = await (started as { completion: Promise<{ outcome: string; detail?: string }> }).completion;
    expect(result).toMatchObject({ outcome: 'failed', detail: 'Ни один ревьюер не вернул разобранный отчёт' });
    expect(h.events.find((e) => e.type === 'pr:reviewFinished')).toMatchObject({ status: 'failed' });

    const h2 = makeHarness({ headSha: 'fedcba9876543210' });
    const bad = await h2.service.start({ ...input, reviewers: ['missing'] });
    const badResult = await (bad as { completion: Promise<{ outcome: string; detail?: string }> }).completion;
    expect(badResult).toMatchObject({ outcome: 'failed', detail: 'Роль "missing" не найдена' });
    expect(h2.started).toEqual([]);
  });

  it('секрет в тексте находки маскируется в комментарии', async () => {
    const leaky = '```projecthub-review\n' + JSON.stringify({ findings: [{ file: 'a.ts', line: 1, severity: 'major', title: 'Ключ в коде', description: 'В коде ключ sk-ant-api03-AbCdEf0123456789xyzXYZ' }] }) + '\n```';
    const h = makeHarness({ outputs: { review: [leaky], verify: ['```projecthub-verify\n{"verdicts":[{"id":"F1","verdict":"confirmed"}]}\n```'] } });
    const started = await h.service.start({ ...input, reviewers: ['reviewer'], publish: 'manual' });
    await (started as { completion: Promise<unknown> }).completion;
    const [record] = await h.service.list(ROOT, 12);
    expect(record.comment).not.toContain('AbCdEf0123456789');
    expect(record.comment).toContain('sk-***');
  });
});
