import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// TASK-97: потомок оболочки, появившийся после снимка дерева tree-kill, переживает kill и держит stdio.
// Гонку со снимком не воспроизвести детерминированно, поэтому tree-kill подменён: он убивает только
// переданный PID — ровно то, что делает `taskkill /T`, в чей снимок внук не попал.
vi.mock('tree-kill', () => ({
  default: (pid: number, _signal: string, cb?: (err?: Error) => void) => {
    try {
      process.kill(pid, 'SIGKILL');
      cb?.();
    } catch (err) {
      cb?.(err as Error);
    }
  }
}));

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  },
  BrowserWindow: { getAllWindows: () => [] }
}));

const { claudeBridgeService, SUBPROCESS_CLOSE_GRACE_MS } = await import('../../electron/services/claudeBridgeService');

const PROJECT = process.cwd();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projecthub-orphans-'));
const leftovers = new Set<number>();

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitDead(pid: number, ms = 3000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !isAlive(pid);
}

/** Скрипт node в файле: без экранирования кавычек внутри PowerShell -Command. */
function nodeScript(name: string, body: string): string {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, body);
  return `& ${JSON.stringify(process.execPath)} ${JSON.stringify(file)}`;
}

/** Ждёт, пока в выводе появится `pid:<n>`, и возвращает n. */
function pidFromOutput(): { onProgress: (s: string) => void; pid: Promise<number> } {
  let resolvePid!: (pid: number) => void;
  const pid = new Promise<number>((r) => { resolvePid = r; });
  return {
    pid,
    onProgress: (s) => {
      const m = /pid:(\d+)/.exec(s);
      if (m) resolvePid(Number(m[1]));
    }
  };
}

const LONG_LIVED = nodeScript('long-lived.cjs', "process.stdout.write('pid:' + process.pid + '\\n'); setInterval(() => {}, 1000);");

afterEach(() => {
  claudeBridgeService.killAll();
  for (const pid of leftovers) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* уже мёртв */ }
  }
  leftovers.clear();
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe.runIf(process.platform === 'win32')('executeSubprocess: потомок переживает kill оболочки (TASK-97)', () => {
  it('abortSession завершает промис за ограниченное время и добивает потомка, держащего stdio', async () => {
    const { onProgress, pid } = pidFromOutput();
    const p = claudeBridgeService.executeSubprocess(LONG_LIVED, PROJECT, onProgress, {
      timeoutMs: 60_000,
      sessionId: 'orphan-abort'
    });
    const grandchild = await pid;
    leftovers.add(grandchild);

    const started = Date.now();
    claudeBridgeService.abortSession('orphan-abort');
    const res = await p;

    expect(res.exitCode).not.toBe(0);
    expect(res.output).toContain(`pid:${grandchild}`);
    expect(Date.now() - started).toBeLessThan(SUBPROCESS_CLOSE_GRACE_MS + 10_000);
    expect(await waitDead(grandchild)).toBe(true);
    expect(claudeBridgeService.getActiveProcessCount()).toBe(0);
  }, 30_000);

  it('таймаут завершает промис и добивает потомка, даже когда оболочка уже мертва', async () => {
    const { onProgress, pid } = pidFromOutput();
    const res = await claudeBridgeService.executeSubprocess(LONG_LIVED, PROJECT, onProgress, {
      timeoutMs: 2000,
      sessionId: 'orphan-timeout'
    });
    const grandchild = await pid;
    leftovers.add(grandchild);

    expect(res.timedOut).toBe(true);
    expect(await waitDead(grandchild)).toBe(true);
    expect(claudeBridgeService.getActiveProcessCount()).toBe(0);
  }, 30_000);

  it('обычный выход оболочки не ждёт close бесконечно, если stdio держит фоновый потомок', async () => {
    // detached: иначе libuv на Windows кладёт потомка в Job Object спаунера с KILL_ON_JOB_CLOSE,
    // и он умирает вместе с ним; stdio при этом наследуется.
    const spawner = nodeScript(
      'spawner.cjs',
      "const { spawn } = require('node:child_process');\n" +
      "const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit', detached: true });\n" +
      "process.stdout.write('pid:' + c.pid + '\\n');\n" +
      'setTimeout(() => process.exit(0), 200);\n'
    );
    const { onProgress, pid } = pidFromOutput();
    const res = await claudeBridgeService.executeSubprocess(spawner, PROJECT, onProgress, { timeoutMs: 60_000 });
    const grandchild = await pid;
    leftovers.add(grandchild);

    expect(res.exitCode).toBe(0);
    expect(res.timedOut).toBe(false);
    // Без abort/таймаута фоновый процесс не трогаем: это мог быть намеренный запуск.
    expect(isAlive(grandchild)).toBe(true);
  }, 30_000);
});
