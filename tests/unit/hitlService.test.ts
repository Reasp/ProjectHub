import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HitlService, ApprovalCancelledError, HITL_PENDING_FILE, HITL_MIN_TIMEOUT_MS } from '../../electron/services/hitlService';
import { appEventBus } from '../../electron/services/eventBus';
import type { AppBusEvent, HitlRequest } from '../../electron/services/hitlTypes';

let baseDir: string;
let service: HitlService;
let events: AppBusEvent[];
let unsubscribe: (() => void) | null = null;

function req(id: string, extra: Partial<HitlRequest> = {}): HitlRequest {
  return {
    id,
    sessionId: extra.sessionId ?? 's1',
    projectPath: 'F:/ProjectHub',
    type: 'command',
    title: `Разрешение на запуск команды: npm test`,
    command: 'npm test',
    createdAt: Date.now(),
    origin: 'studio',
    engine: 'claude-cli',
    tool: 'Bash',
    ...extra
  };
}

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-hitl-'));
  service = new HitlService({ hostId: 'host-test' });
  events = [];
  unsubscribe = appEventBus.subscribe((e) => events.push(e));
});

afterEach(async () => {
  unsubscribe?.();
  unsubscribe = null;
  service.cancelAll('cleanup');
  await service.flush();
  vi.useRealTimers();
  await fs.rm(baseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('HitlService: очередь и адресация по requestId (TASK-57)', () => {
  it('request → decide резолвит именно адресованный запрос, остальные остаются', async () => {
    const p1 = service.request(req('r1'));
    const p2 = service.request(req('r2'));
    expect(service.listPending().map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(service.pendingCount('s1')).toBe(2);

    const result = service.decide('r2', { approved: true, text: 'ok' }, { kind: 'local' });
    expect(result.ok).toBe(true);
    await expect(p2).resolves.toEqual({ approved: true, text: 'ok' });
    expect(service.listPending().map((r) => r.id)).toEqual(['r1']);

    service.decide('r1', { approved: false }, { kind: 'remote', deviceId: 'dev-1', deviceName: 'Phone' });
    await expect(p1).resolves.toEqual({ approved: false });

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'hitl:requested')).toHaveLength(2);
    expect(types.filter((t) => t === 'hitl:decided')).toHaveLength(2);
    const decided = events.find((e): e is Extract<AppBusEvent, { type: 'hitl:decided' }> => e.type === 'hitl:decided' && e.request.id === 'r1');
    expect(decided?.source).toEqual({ kind: 'remote', deviceId: 'dev-1', deviceName: 'Phone' });
  });

  it('повторное решение возвращает already_decided, неизвестный id — not_found', async () => {
    const p = service.request(req('r1'));
    expect(service.decide('r1', { approved: true }, { kind: 'local' }).ok).toBe(true);
    await p;
    expect(service.decide('r1', { approved: false }, { kind: 'mcp' })).toEqual({ ok: false, reason: 'already_decided' });
    expect(service.decide('nope', { approved: true }, { kind: 'local' })).toEqual({ ok: false, reason: 'not_found' });
  });

  it('дублирующийся requestId в очереди отклоняется', async () => {
    const p1 = service.request(req('dup'));
    await expect(service.request(req('dup'))).rejects.toThrow(/уже в очереди/);
    service.cancelAll();
    await expect(p1).rejects.toBeInstanceOf(ApprovalCancelledError);
  });

  it('cancelSession отклоняет только запросы своей сессии с ApprovalCancelledError', async () => {
    const own = service.request(req('a', { sessionId: 's1' }));
    const other = service.request(req('b', { sessionId: 's2' }));
    const cancelled = service.cancelSession('s1', 'Сессия прервана');
    expect(cancelled.map((r) => r.id)).toEqual(['a']);
    await expect(own).rejects.toBeInstanceOf(ApprovalCancelledError);
    expect(service.listPending().map((r) => r.id)).toEqual(['b']);
    expect(events.some((e) => e.type === 'hitl:cancelled')).toBe(true);
    service.decide('b', { approved: true }, { kind: 'local' });
    await other;
  });

  it('таймаут → решение deny (resolve, не reject) и событие hitl:expired', async () => {
    vi.useFakeTimers();
    const p = service.request(req('t1'), { timeoutMs: HITL_MIN_TIMEOUT_MS });
    expect(service.getPending('t1')?.expiresAt).toBeGreaterThan(Date.now());
    vi.advanceTimersByTime(HITL_MIN_TIMEOUT_MS + 5);
    const res = await p;
    expect(res.approved).toBe(false);
    expect(res.text).toMatch(/Таймаут/);
    expect(service.listPending()).toEqual([]);
    expect(events.some((e) => e.type === 'hitl:expired')).toBe(true);
    expect(service.decide('t1', { approved: true }, { kind: 'local' })).toEqual({ ok: false, reason: 'already_decided' });
  });

  it('таймаут меньше минимального поднимается до HITL_MIN_TIMEOUT_MS', () => {
    const p = service.request(req('t2'), { timeoutMs: 1 });
    const pending = service.getPending('t2')!;
    expect(pending.expiresAt! - pending.createdAt).toBe(HITL_MIN_TIMEOUT_MS);
    service.cancelAll();
    return p.catch(() => undefined);
  });
});

describe('HitlService: персистентность и восстановление', () => {
  it('очередь пишется в pending.json и восстанавливается как orphaned после перезапуска', async () => {
    await service.init({ dir: path.join(baseDir, 'hitl'), auditDir: path.join(baseDir, 'audit') });
    const p = service.request(req('persist-1', { diff: { filePath: 'a.ts', oldContent: 'x'.repeat(60_000), newContent: 'y', patch: 'p' } }));
    await service.flush();

    const raw = JSON.parse(await fs.readFile(path.join(baseDir, 'hitl', HITL_PENDING_FILE), 'utf-8'));
    expect(raw.version).toBe(1);
    expect(raw.requests).toHaveLength(1);
    expect(raw.requests[0].id).toBe('persist-1');
    expect(raw.requests[0].diff.oldContent.length).toBeLessThan(60_000);

    // «Перезапуск»: старые промисы отклоняются, запись остаётся на диске.
    const settled = p.then(() => 'resolved', (err) => err);
    await service.shutdown();
    expect(await settled).toBeInstanceOf(ApprovalCancelledError);
    const afterShutdown = JSON.parse(await fs.readFile(path.join(baseDir, 'hitl', HITL_PENDING_FILE), 'utf-8'));
    expect(afterShutdown.requests[0].orphaned).toBe(true);

    const restarted = new HitlService({ hostId: 'host-test' });
    const restored = await restarted.init({ dir: path.join(baseDir, 'hitl'), auditDir: path.join(baseDir, 'audit') });
    expect(restored.map((r) => r.id)).toEqual(['persist-1']);
    expect(restarted.listPending()[0].orphaned).toBe(true);

    // Решение по orphaned-запросу попадает в аудит с outcome session_gone и убирает его из очереди.
    expect(restarted.decide('persist-1', { approved: true }, { kind: 'local' }).ok).toBe(true);
    expect(restarted.listPending()).toEqual([]);
    await restarted.flush();
    const entries = await restarted.listAudit({ sessionId: 's1' });
    const decision = entries.find((e) => e.kind === 'decision' && e.requestId === 'persist-1');
    expect(decision?.outcome).toBe('session_gone');
    expect(decision?.decision).toBe('allow');

    const afterDecide = JSON.parse(await fs.readFile(path.join(baseDir, 'hitl', HITL_PENDING_FILE), 'utf-8'));
    expect(afterDecide.requests).toEqual([]);

    // Закрытый сервис инертен: решения и отмены не трогают диск.
    expect(service.decide('persist-1', { approved: true }, { kind: 'local' })).toEqual({ ok: false, reason: 'not_found' });
    expect(service.cancelAll()).toEqual([]);
    await restarted.shutdown();
  });

  it('просроченные при восстановлении запросы закрываются как timeout', async () => {
    const dir = path.join(baseDir, 'hitl');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, HITL_PENDING_FILE),
      JSON.stringify({ version: 1, savedAt: 1, hostId: 'x', requests: [req('old', { createdAt: 1, expiresAt: 2 })] })
    );
    const restored = await service.init({ dir, auditDir: path.join(baseDir, 'audit') });
    expect(restored).toEqual([]);
    expect(service.listPending()).toEqual([]);
    await service.flush();
    const entries = await service.listAudit({});
    expect(entries.find((e) => e.requestId === 'old')?.decidedBy).toBe('timeout');
  });
});

describe('HitlService: аудит', () => {
  it('решение, результат и fallback пишутся в jsonl без секретов', async () => {
    await service.init({ dir: path.join(baseDir, 'hitl'), auditDir: path.join(baseDir, 'audit') });
    const secretCmd = 'curl -H "Authorization: Bearer sk-ant-verysecret123456" https://api.example.com';
    const p = service.request(req('audit-1', { command: secretCmd, agentName: 'Coder', role: 'implementer', origin: 'swarm' }));
    service.decide('audit-1', { approved: true, text: 'go' }, { kind: 'local' });
    await p;
    service.recordOutcome('audit-1', 'executed', 'exit 0');
    service.recordFallback({ sessionId: 's1', projectPath: 'F:/ProjectHub', origin: 'swarm', engine: 'claude-cli', reason: 'MCP недоступен' });
    const autoId = service.recordAutoDecision(
      { sessionId: 's1', projectPath: 'F:/ProjectHub', type: 'file_write', title: 'Write', tool: 'Write', filePath: '../etc/passwd' },
      'deny',
      'outside-project'
    );
    await service.flush();

    const months = await service.listAuditMonths();
    expect(months).toHaveLength(1);
    const files = await fs.readdir(path.join(baseDir, 'audit'));
    expect(files[0]).toMatch(/^hitl-\d{4}-\d{2}\.jsonl$/);

    const raw = await fs.readFile(path.join(baseDir, 'audit', files[0]), 'utf-8');
    expect(raw).not.toContain('sk-ant-verysecret123456');
    expect(raw).not.toContain('verysecret');

    const all = await service.listAudit({});
    expect(all.map((e) => e.kind).sort()).toEqual(['decision', 'decision', 'fallback', 'outcome']);
    const decision = all.find((e) => e.kind === 'decision' && e.requestId === 'audit-1')!;
    expect(decision.commandHash).toMatch(/^[a-f0-9]{64}$/);
    expect(decision.commandPreview).toContain('curl -H "Authorization: ***');
    expect(decision.commandPreview).not.toContain('sk-ant');
    expect(decision.agentName).toBe('Coder');
    expect(decision.role).toBe('implementer');
    expect(decision.decidedBy).toBe('local');
    expect(decision.comment).toBe('go');
    expect(decision.hostId).toBe('host-test');
    expect(typeof decision.waitedMs).toBe('number');

    const outcome = all.find((e) => e.kind === 'outcome')!;
    expect(outcome.requestId).toBe('audit-1');
    expect(outcome.outcome).toBe('executed');

    const auto = all.find((e) => e.requestId === autoId)!;
    expect(auto.decidedBy).toBe('auto');
    expect(auto.rule).toBe('outside-project');
    expect(auto.decision).toBe('deny');

    expect(await service.listAudit({ decidedBy: 'auto' })).toHaveLength(1);
    expect(await service.listAudit({ kind: 'fallback' })).toHaveLength(1);
    expect(await service.listAudit({ search: 'coder' })).toHaveLength(2);

    const csv = await service.exportAudit({}, 'csv');
    expect(csv.split('\n')[0]).toContain('requestId');
    expect(csv).not.toContain('verysecret');
  });
});
