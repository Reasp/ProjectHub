import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// TASK-99: то же, что TASK-97 для executeSubprocess, но для CLI-агентов Swarm/Handoff. Процесс
// агента — cmd.exe (spawn с shell: true), сам движок — его потомок. Гонку со снимком taskkill не
// воспроизвести детерминированно, поэтому tree-kill подменён: он убивает только переданный PID,
// как `taskkill /T`, в чей снимок потомок не попал.
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

const { AgentFleetService } = await import('../../electron/services/agentFleetService');
const { CHILD_CLOSE_GRACE_MS } = await import('../../electron/services/processSweep');
type SwarmSession = import('../../electron/services/agentFleetService').SwarmSession;
type AgentSlotState = SwarmSession['agents'][number];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projecthub-fleet-orphans-'));
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

/**
 * Каталог-cwd агента с фейковыми `claude.cmd`, `codex.cmd`, `gemini.cmd`. Он же ставится в начало
 * PATH (см. setup): текущий каталог cmd.exe не просматривает при NoDefaultCurrentDirectoryInExePath,
 * а настоящие CLI из PATH запускаться не должны.
 */
function agentDir(name: string, scriptBody: string): string {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'agent.cjs');
  fs.writeFileSync(script, scriptBody);
  for (const cmd of ['claude', 'codex', 'gemini']) {
    fs.writeFileSync(path.join(dir, `${cmd}.cmd`), `@"${process.execPath}" "${script}"\r\n`);
  }
  return dir;
}

// PID пишется в файл: gemini разбирает stdout только по завершении процесса.
const LONG_LIVED =
  "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'agent.pid'), String(process.pid));\n" +
  "process.stdout.write('работаю\\n');\n" +
  'setInterval(() => {}, 1000);\n';

// Фоновый потомок с унаследованным stdio (detached: иначе libuv кладёт его в Job Object
// спаунера, и он умирает вместе с ним).
const SPAWNER =
  "const { spawn } = require('node:child_process');\n" +
  "const fs = require('node:fs');\n" +
  "const path = require('node:path');\n" +
  "const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit', detached: true });\n" +
  "fs.writeFileSync(path.join(__dirname, 'bg.pid'), String(c.pid));\n" +
  "process.stdout.write('готово\\n');\n" +
  'setTimeout(() => process.exit(0), 200);\n';

type Engine = 'runClaudeCliAgent' | 'runCodexCliAgent' | 'runGeminiCliAgent';
const ENGINES: Engine[] = ['runClaudeCliAgent', 'runCodexCliAgent', 'runGeminiCliAgent'];

const originalPath = process.env.PATH;

/** Приватные члены сервиса, к которым тест обращается напрямую. */
interface FleetInternals {
  resolveEffectivePermissions: (...args: unknown[]) => Promise<unknown>;
  prepareAgentHitl: (...args: unknown[]) => Promise<unknown>;
  runApiAgent: (...args: unknown[]) => Promise<void>;
  newAgentState: (cfg: unknown, id: string, startTime: number) => AgentSlotState;
  ensureSessionTracking: (swarmId: string) => void;
  killAgentProcess: (agentId: string) => void;
  activeProcesses: Map<string, Set<unknown>>;
  runClaudeCliAgent: (...args: unknown[]) => Promise<void>;
  runCodexCliAgent: (...args: unknown[]) => Promise<void>;
  runGeminiCliAgent: (...args: unknown[]) => Promise<void>;
}

function setup(dir: string) {
  // Агент наследует process.env на момент spawn.
  process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
  const internals = new AgentFleetService() as unknown as FleetInternals;
  vi.spyOn(internals, 'resolveEffectivePermissions').mockResolvedValue({ provider: 'anthropic', model: 'test' });
  vi.spyOn(internals, 'prepareAgentHitl').mockResolvedValue({ args: [], env: {}, cleanup: () => undefined });
  // API-fallback не должен срабатывать: он означал бы, что CLI-путь не отработал.
  const apiFallback = vi.spyOn(internals, 'runApiAgent').mockRejectedValue(new Error('API fallback в тесте'));

  const agent = internals.newAgentState({ id: 'a1', name: 'a1', provider: 'cli' }, 'a1', Date.now());
  agent.status = 'running';
  const session = {
    id: 'swarm-orphans',
    projectPath: dir,
    mode: 'fan_out',
    prompt: 'test',
    status: 'running',
    agents: [agent]
  } as unknown as SwarmSession;
  internals.ensureSessionTracking(session.id);

  const run = (engine: Engine): Promise<void> => internals[engine](session, agent, dir, 'test');
  const stop = () => {
    agent.status = 'stopped';
    internals.killAgentProcess(agent.id);
  };
  return { internals, agent, run, stop, apiFallback };
}

async function waitFor<T>(fn: () => T | undefined, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor: не дождались');
}

afterEach(async () => {
  process.env.PATH = originalPath;
  vi.restoreAllMocks();
  for (const pid of leftovers) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* уже мёртв */ }
  }
  // Каталог агента — cwd этих процессов: пока они живы, его не удалить (EBUSY).
  for (const pid of leftovers) await waitDead(pid);
  leftovers.clear();
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe.runIf(process.platform === 'win32')('agentFleetService: потомок CLI-агента переживает tree-kill (TASK-99)', () => {
  it.each(ENGINES)('%s: остановка завершает ожидание за ограниченное время и добивает потомка', async (engine) => {
    const dir = agentDir(`stop-${engine}`, LONG_LIVED);
    const { internals, run, stop, apiFallback } = setup(dir);
    const done = run(engine);

    const pidFile = path.join(dir, 'agent.pid');
    const grandchild = await waitFor(() => (fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf-8')) : undefined));
    leftovers.add(grandchild);

    const started = Date.now();
    stop();
    await done;

    expect(Date.now() - started).toBeLessThan(CHILD_CLOSE_GRACE_MS + 10_000);
    expect(await waitDead(grandchild)).toBe(true);
    expect(apiFallback).not.toHaveBeenCalled();
    // Процесс снимается с учёта сессии только в finish агента.
    expect(internals.activeProcesses.get('swarm-orphans')?.size).toBe(0);
  }, 30_000);

  it.each(ENGINES)('%s: обычный выход не ждёт close бесконечно, если stdio держит фоновый потомок', async (engine) => {
    const dir = agentDir(`bg-${engine}`, SPAWNER);
    const { agent, run, apiFallback } = setup(dir);

    await run(engine);
    const bg = Number(fs.readFileSync(path.join(dir, 'bg.pid'), 'utf-8'));
    leftovers.add(bg);

    expect(agent.finalOutput).toContain('готово');
    expect(apiFallback).not.toHaveBeenCalled();
    // Без остановки фоновый процесс не трогаем: это мог быть намеренный запуск.
    expect(isAlive(bg)).toBe(true);
  }, 30_000);
});
