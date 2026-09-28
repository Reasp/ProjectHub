import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
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
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type Entry = { pid: number; command: string; cwd: string; startedAt: string };
type ProcessManager = {
  startProcess(args: { name: string; command: string; cwd?: string }): Entry;
  stopProcess(args: { name: string }): { name: string; stopped: boolean };
  listProcesses(): Array<Entry & { name: string; alive: boolean }>;
  tailLog(args: { name: string; lines?: number }): string;
};

const REPO = path.resolve(__dirname, '..', '..');
const NAME = 'ticker';
let root: string;
let pm: ProcessManager;

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
});

afterAll(async () => {
  if (!root) return;
  try {
    pm?.stopProcess({ name: NAME });
  } catch {
    // уже остановлен тестом
  }
  await removeTempDir(root);
});

describe('env-tools process-manager', () => {
  it('запускает процесс, пишет лог, не дублирует и останавливает всё дерево', async () => {
    const entry = pm.startProcess({ name: NAME, command: 'node ticker.cjs', cwd: root });
    expect(entry.pid).toBeGreaterThan(0);
    expect(isAlive(entry.pid)).toBe(true);

    expect(await waitFor(() => pm.tailLog({ name: NAME, lines: 5 }).includes('tick '), 30_000)).toBe(true);
    expect(pm.listProcesses()).toEqual([expect.objectContaining({ name: NAME, pid: entry.pid, alive: true })]);
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

    expect(pm.stopProcess({ name: NAME })).toEqual({ name: NAME, stopped: true });
    expect(pm.listProcesses()).toEqual([]);
    expect(await waitFor(() => !isAlive(entry.pid) && !isAlive(tickerPid), 15_000)).toBe(true);
  });
});
