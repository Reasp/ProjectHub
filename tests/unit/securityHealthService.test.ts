import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIT_MIN_INTERVAL_MS,
  defaultRunTool,
  projectKey,
  SecurityHealthService,
  type SecurityHealthDeps,
  type ToolRunResult
} from '../../electron/services/securityHealthService';
import type { AppBusEvent } from '../../electron/services/hitlTypes';

/** Сервис Security Health (TASK-73.2, decision-56 п. 2, 8, 9): ответы инструментов — настоящие выводы из фикстур. */

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', 'security', name), 'utf8');
const ok = (stdout: string, code = 1): ToolRunResult => ({ code, stdout, stderr: '', timedOut: false });

describe('SecurityHealthService', () => {
  let stateDir: string;
  let now: number;
  let calls: Array<{ command: string; args: string[] }>;
  let responses: Array<(command: string, args: string[]) => ToolRunResult | undefined>;
  let rootFiles: string[];
  let events: AppBusEvent[];
  let createdTasks: Array<{ title: string; labels: string[]; priority: string }>;
  let service: SecurityHealthService;
  const root = path.resolve('C:/projects/demo');

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(os.tmpdir(), 'ph-security-'));
    now = Date.parse('2026-09-27T12:00:00Z');
    calls = [];
    responses = [];
    rootFiles = ['package.json', 'package-lock.json'];
    events = [];
    createdTasks = [];
    const deps: SecurityHealthDeps = {
      stateDir: () => stateDir,
      now: () => now,
      runTool: async (command, args) => {
        calls.push({ command, args });
        for (const r of responses) {
          const res = r(command, args);
          if (res) return res;
        }
        return { code: 1, stdout: '', stderr: `${command}: not recognized`, timedOut: false, error: 'spawn ENOENT' };
      },
      listRootFiles: async () => rootFiles,
      createTask: async (_root, task) => {
        createdTasks.push(task);
        return { id: `TASK-${100 + createdTasks.length}` };
      },
      publish: (event) => events.push(event),
      notifyRenderer: () => undefined
    };
    service = new SecurityHealthService(deps);
  });

  afterEach(() => rmSync(stateDir, { recursive: true, force: true }));

  const npmReturns = (file: string) => responses.push((c, a) => (c === 'npm' && a[0] === 'audit' ? ok(fixture(file)) : undefined));

  it('аудит npm по кнопке: отчёт в userData, уровни, без уведомления', async () => {
    npmReturns('npm-audit-direct.json');
    const res = await service.runAudit(root, { reason: 'manual' });
    expect(calls[0]).toEqual({ command: 'npm', args: ['audit', '--json'] });
    expect(res.fromCache).toBe(false);
    expect(res.report.counts).toMatchObject({ critical: 1, high: 1 });
    expect(res.newFindings.map((f) => f.package).sort()).toEqual(['lodash', 'minimist']);
    expect(events).toEqual([]);
    const stored = JSON.parse(readFileSync(path.join(stateDir, `${projectKey(root)}.json`), 'utf8'));
    expect(stored.ecosystems[0]).toMatchObject({ ecosystem: 'npm', manifest: 'package-lock.json', status: 'done' });
    expect(await service.getReport(root)).toMatchObject({ counts: { critical: 1 } });
  });

  it('офлайн после успешного аудита: прошлый результат остаётся с пометкой stale', async () => {
    npmReturns('npm-audit-direct.json');
    await service.runAudit(root, { reason: 'manual' });
    responses = [];
    npmReturns('npm-audit-offline.json');
    now += 60_000;
    const res = await service.runAudit(root, { reason: 'manual' });
    const npm = res.report.ecosystems[0];
    expect(npm).toMatchObject({ status: 'done', stale: true, errorKind: 'network' });
    expect(npm.findings.length).toBe(2);
    expect(npm.message).toContain('ECONNREFUSED');
  });

  it('без lock-файла, yarn и cargo — статусы без запуска инструмента', async () => {
    rootFiles = ['package.json', 'yarn.lock', 'Cargo.lock'];
    const res = await service.runAudit(root, { reason: 'manual' });
    expect(calls).toEqual([]);
    expect(res.report.ecosystems.map((e) => `${e.ecosystem}:${e.status}`)).toEqual(['yarn:unsupported', 'cargo:unsupported']);
  });

  it('pip-audit не установлен — not_installed; установлен — безопасный режим без установки пакетов', async () => {
    rootFiles = ['requirements.txt'];
    let res = await service.runAudit(root, { reason: 'manual' });
    expect(res.report.ecosystems[0]).toMatchObject({ ecosystem: 'pip', status: 'not_installed' });

    const fresh = new SecurityHealthService({
      ...(service as unknown as { deps: SecurityHealthDeps }).deps
    });
    responses.push((c, a) => (c === 'pip-audit' && a[0] === '--version' ? ok('pip-audit 2.10.1', 0) : undefined));
    responses.push((c, a) => (c === 'pip-audit' && a[0] === '-r' ? ok(fixture('pip-audit-no-deps.json')) : undefined));
    calls = [];
    res = await fresh.runAudit(root, { reason: 'manual' });
    expect(calls.at(-1)).toEqual({
      command: 'pip-audit',
      args: ['-r', 'requirements.txt', '--no-deps', '--disable-pip', '-f', 'json', '--progress-spinner', 'off']
    });
    expect(res.report.ecosystems[0]).toMatchObject({ ecosystem: 'pip', status: 'done' });
    expect(res.report.counts.unknown).toBe(2);
  });

  it('автоматизация: интервал 10 минут, событие только о новых находках не ниже порога', async () => {
    npmReturns('npm-audit-transitive.json');
    const first = await service.runAudit(root, { reason: 'automation', minSeverity: 'high' });
    expect(first.fromCache).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'security:finding', source: 'audit', severity: 'critical', count: 2, projectPath: root });

    now += AUDIT_MIN_INTERVAL_MS - 1000;
    const cached = await service.runAudit(root, { reason: 'automation' });
    expect(cached.fromCache).toBe(true);
    expect(calls).toHaveLength(1);

    now += 2000;
    responses = [];
    npmReturns('npm-audit-direct.json');
    const second = await service.runAudit(root, { reason: 'automation', minSeverity: 'critical' });
    // minimist уже был (те же advisory), новый lodash — high: ниже порога critical — без события
    expect(second.newFindings.map((f) => f.package)).toContain('lodash');
    expect(events).toHaveLength(1);
  });

  it('один аудит проекта одновременно', async () => {
    npmReturns('npm-audit-clean.json');
    const [a, b] = await Promise.all([service.runAudit(root, { reason: 'manual' }), service.runAudit(root, { reason: 'manual' })]);
    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
  });

  it('задача из находки создаётся один раз', async () => {
    npmReturns('npm-audit-direct.json');
    await service.runAudit(root, { reason: 'manual' });
    const first = await service.createTaskFromFinding(root, 'npm', 'minimist');
    expect(first).toEqual({ ok: true, taskId: 'TASK-101', existed: false });
    expect(createdTasks[0]).toMatchObject({ labels: ['security'], priority: 'high' });
    expect(createdTasks[0].title).toContain('minimist');
    const again = await service.createTaskFromFinding(root, 'npm', 'minimist');
    expect(again).toEqual({ ok: true, taskId: 'TASK-101', existed: true });
    expect(createdTasks).toHaveLength(1);
    expect(await service.createTaskFromFinding(root, 'npm', 'nope')).toMatchObject({ ok: false });
  });

  it('registry: кэш на 7 дней, 404 кэшируется, сбой — нет', async () => {
    responses.push((c, a) => (c === 'npm' && a[1] === 'left-pad@1.3.0' ? ok(fixture('npm-view-left-pad.json'), 0) : undefined));
    responses.push((c, a) => (c === 'npm' && a[1] === 'ghost-pkg-zz' ? ok(fixture('npm-view-e404.json')) : undefined));
    responses.push((c, a) => (c === 'npm' && a[1] === 'flaky' ? { code: null, stdout: '', stderr: '', timedOut: true } : undefined));
    const first = await service.lookupRegistry(root, ['left-pad@1.3.0', 'ghost-pkg-zz', 'flaky', 'bad name;rm']);
    expect(first.get('left-pad@1.3.0')).toMatchObject({ deprecated: 'use String.prototype.padStart()', publishedAt: '2018-04-09T01:10:45.796Z' });
    expect(first.get('ghost-pkg-zz')).toEqual({ notFound: true });
    expect(first.get('flaky')).toEqual({ error: 'тайм-аут registry' });
    expect(first.has('bad name;rm')).toBe(false);
    expect(calls.map((c) => c.args.join(' ')).sort()).toEqual([
      'view flaky time deprecated --json',
      'view ghost-pkg-zz time deprecated --json',
      'view left-pad@1.3.0 time deprecated --json'
    ]);

    calls = [];
    const again = await new SecurityHealthService((service as unknown as { deps: SecurityHealthDeps }).deps).lookupRegistry(root, ['left-pad@1.3.0', 'ghost-pkg-zz', 'flaky']);
    expect(calls.map((c) => c.args[1])).toEqual(['flaky']);
    expect(again.get('ghost-pkg-zz')).toEqual({ notFound: true });
  });

  it('настройки: registryLookups по умолчанию включён', async () => {
    expect(await service.getSettings()).toEqual({ version: 1, registryLookups: true });
    expect(await service.saveSettings({ registryLookups: false })).toEqual({ version: 1, registryLookups: false });
    expect((await service.getSettings()).registryLookups).toBe(false);
  });
});

describe('defaultRunTool', () => {
  it('отклоняет аргументы с метасимволами оболочки, ничего не запуская', async () => {
    const res = await defaultRunTool('npm', ['view', 'x & calc'], { cwd: os.tmpdir(), timeoutMs: 1000 });
    expect(res.error).toContain('Недопустимый аргумент');
    expect(res.code).toBeNull();
  });

  it('запускает настоящую команду и возвращает stdout целиком', async () => {
    const res = await defaultRunTool('node', ['-e', 'process.stdout.write(String(40+2))'], { cwd: os.tmpdir(), timeoutMs: 20_000 });
    expect(res.error).toContain('Недопустимый аргумент');
    const real = await defaultRunTool('node', ['--version'], { cwd: os.tmpdir(), timeoutMs: 20_000 });
    expect(real.code).toBe(0);
    expect(real.stdout.trim()).toMatch(/^v\d+\./);
  });
});
