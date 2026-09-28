import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { removeTempDir } from '../helpers/removeTempDir';

// Живая проверка scripts/env/process-manager.mjs (env-tools, TASK-109, decision-58): процесс реально
// запускается, пишет лог, виден в реестре и останавливается вместе с деревом. Регрессионный страж для
// Windows: прямой detached-spawn powershell.exe (вариант ProjectTemplate) молча не стартует, и тест
// упал бы на startProcess. Скрипты копируются во временный INFRA_ROOT, чтобы не трогать реестр
// `.env-state` проекта.
//
// TASK-110, decision-59: запись реестра хранит время старта процесса (pidCreatedAt), и pid, который ОС
// отдала другому процессу, не считается ни работающим, ни дубликатом, а stop_process его не убивает.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type Status = 'running' | 'dead' | 'unknown';
type Entry = { pid: number; pidCreatedAt?: number; command: string; cwd: string; startedAt: string };
type ProcessManager = {
  startProcess(args: { name: string; command: string; cwd?: string }): Entry;
  stopProcess(args: { name: string }): { name: string; pid: number; status: Status; killed: boolean };
  listProcesses(): { processes: Array<Entry & { name: string; status: Status; alive: boolean }>; pruned: string[] };
  tailLog(args: { name: string; lines?: number }): string;
};
type State = { parseStartTimes(text: string): Map<number, number | null> };

const REPO = path.resolve(__dirname, '..', '..');
const NAME = 'ticker';
const DAY_MS = 24 * 60 * 60 * 1000;
// Заведомо несуществующий pid (на Windows pid кратны 4 и намного меньше).
const DEAD_PID = 2147483644;
let root: string;
let pm: ProcessManager;
let state: State;
let foreign: ChildProcess | undefined;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return check();
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-env-pm-'));
  fs.mkdirSync(path.join(root, 'scripts', 'env'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'scripts', 'config.mjs'), path.join(root, 'scripts', 'config.mjs'));
  for (const f of ['state.mjs', 'process-manager.mjs']) {
    fs.copyFileSync(path.join(REPO, 'scripts', 'env', f), path.join(root, 'scripts', 'env', f));
  }
  fs.writeFileSync(path.join(root, 'infra.config.json'), JSON.stringify({ projectRoot: '.' }));
  // Тикер пишет свой pid — по нему проверяем, что остановка убивает всё дерево, а не только обёртку.
  fs.writeFileSync(
    path.join(root, 'ticker.cjs'),
    "require('fs').writeFileSync('ticker.pid', String(process.pid));\n" +
      "setInterval(() => console.log('tick ' + Date.now()), 200);\n",
  );
  pm = (await import(pathToFileURL(path.join(root, 'scripts', 'env', 'process-manager.mjs')).href)) as ProcessManager;
  state = (await import(pathToFileURL(path.join(root, 'scripts', 'env', 'state.mjs')).href)) as State;
});

afterAll(async () => {
  foreign?.kill();
  if (!root) return;
  for (const name of [NAME, 'restartable']) {
    try {
      pm?.stopProcess({ name });
    } catch {
      // уже остановлен тестом
    }
  }
  await removeTempDir(root);
});

function registryFile(): string {
  return path.join(root, '.env-state', 'processes.json');
}

function writeRegistry(registry: Record<string, Partial<Entry>>): void {
  fs.mkdirSync(path.join(root, '.env-state', 'logs'), { recursive: true });
  fs.writeFileSync(registryFile(), JSON.stringify(registry, null, 2));
}

describe('env-tools process-manager', () => {
  it('запускает процесс, пишет лог, не дублирует и останавливает всё дерево', async () => {
    const before = Date.now();
    const entry = pm.startProcess({ name: NAME, command: 'node ticker.cjs', cwd: root });
    expect(entry.pid).toBeGreaterThan(0);
    expect(isAlive(entry.pid)).toBe(true);
    // Время старта процесса по данным ОС — в пределах запуска (с допуском на округление).
    expect(entry.pidCreatedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(entry.pidCreatedAt).toBeLessThanOrEqual(Date.now() + 1000);

    expect(await waitFor(() => pm.tailLog({ name: NAME, lines: 5 }).includes('tick '), 30_000)).toBe(true);
    expect(pm.listProcesses()).toEqual({
      processes: [expect.objectContaining({ name: NAME, pid: entry.pid, status: 'running', alive: true })],
      pruned: [],
    });
    expect(() => pm.startProcess({ name: NAME, command: 'node ticker.cjs', cwd: root })).toThrow(/уже запущен/);

    if (process.platform === 'win32') {
      // Обёртка — не наш потомок (её родитель — завершившийся cmd.exe из `start /b`), поэтому
      // `taskkill /T` по хосту env-server её не заденет.
      const ppid = Number(
        execFileSync('powershell.exe', [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${entry.pid}").ParentProcessId`,
        ]).toString().trim(),
      );
      expect(ppid).not.toBe(process.pid);
    }

    const tickerPidFile = path.join(root, 'ticker.pid');
    expect(await waitFor(() => fs.existsSync(tickerPidFile), 10_000)).toBe(true);
    const tickerPid = Number(fs.readFileSync(tickerPidFile, 'utf-8'));

    expect(pm.stopProcess({ name: NAME })).toEqual({ name: NAME, pid: entry.pid, status: 'running', killed: true });
    expect(pm.listProcesses()).toEqual({ processes: [], pruned: [] });
    expect(await waitFor(() => !isAlive(entry.pid) && !isAlive(tickerPid), 15_000)).toBe(true);
  });

  it('PID переиспользован: чужой процесс не считается ни работающим, ни дубликатом, stop_process его не убивает', async () => {
    // «Посторонний» процесс, которому ОС будто бы отдала pid записей реестра.
    foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    const pid = foreign.pid!;
    expect(await waitFor(() => isAlive(pid), 5_000)).toBe(true);

    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const base = { command: 'node server.js', cwd: root };
    writeRegistry({
      // Время старта записано и не совпадает с временем старта процесса, занявшего pid.
      reused: { ...base, pid, pidCreatedAt: now - 3_600_000, startedAt: iso(now - 3_600_000) },
      // Старая запись без идентичности, но pid занят процессом, созданным позже записи, — точно чужой.
      // Заодно мёртвая больше 7 дней — list_processes её удалит.
      legacyReused: { ...base, pid, startedAt: iso(now - 30 * DAY_MS) },
      // Старая запись без идентичности, процесс создан раньше записи — сопоставить нельзя.
      legacyUnknown: { ...base, pid, startedAt: iso(now + 60_000) },
      restartable: { ...base, pid, startedAt: iso(now + 60_000) },
      // Мёртвые: давняя удаляется вместе с логом, недавняя остаётся как «НЕ работает».
      stale: { ...base, pid: DEAD_PID, pidCreatedAt: now - 30 * DAY_MS, startedAt: iso(now - 30 * DAY_MS) },
      recentDead: { ...base, pid: DEAD_PID, pidCreatedAt: now - DAY_MS, startedAt: iso(now - DAY_MS) },
    });
    const staleLog = path.join(root, '.env-state', 'logs', 'stale.log');
    fs.writeFileSync(staleLog, 'old\n');
    fs.utimesSync(staleLog, new Date(now - 30 * DAY_MS), new Date(now - 30 * DAY_MS));

    const { processes, pruned } = pm.listProcesses();
    expect(pruned.sort()).toEqual(['legacyReused', 'stale']);
    expect(fs.existsSync(staleLog)).toBe(false);
    expect(Object.fromEntries(processes.map((p) => [p.name, p.status]))).toEqual({
      reused: 'dead',
      legacyUnknown: 'unknown',
      restartable: 'unknown',
      recentDead: 'dead',
    });
    expect(processes.every((p) => p.alive === (p.status === 'running'))).toBe(true);

    expect(pm.stopProcess({ name: 'reused' })).toEqual({ name: 'reused', pid, status: 'dead', killed: false });
    expect(pm.stopProcess({ name: 'legacyUnknown' })).toEqual({
      name: 'legacyUnknown',
      pid,
      status: 'unknown',
      killed: false,
    });

    // Запись 'unknown' не мешает запустить процесс под тем же именем; новая запись — с идентичностью.
    const restarted = pm.startProcess({ name: 'restartable', command: 'node ticker.cjs', cwd: root });
    expect(restarted.pid).not.toBe(pid);
    expect(restarted.pidCreatedAt).toEqual(expect.any(Number));
    expect(pm.stopProcess({ name: 'restartable' })).toMatchObject({ status: 'running', killed: true });

    // Посторонний процесс пережил все остановки, в реестре осталась только недавняя мёртвая запись.
    await new Promise((r) => setTimeout(r, 1000));
    expect(isAlive(pid)).toBe(true);
    expect(Object.keys(JSON.parse(fs.readFileSync(registryFile(), 'utf-8')))).toEqual(['recentDead']);
  });

  it('разбирает время старта из вывода Get-Process и ps -o pid=,lstart=', () => {
    const win = state.parseStartTimes('1234,1790000000123\r\n4,\r\nмусор\r\n');
    expect([...win]).toEqual([
      [1234, 1790000000123],
      [4, null],
    ]);
    const posix = state.parseStartTimes('    1 Mon Sep 28 08:38:51 2026\n  777 Tue Sep 29 00:00:05 2026\n');
    expect(posix.get(1)).toBe(new Date(2026, 8, 28, 8, 38, 51).getTime());
    expect(posix.get(777)).toBe(new Date(2026, 8, 29, 0, 0, 5).getTime());
  });
});
