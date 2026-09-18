import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectDescendantPids,
  parseProcessList,
  superviseChildExit,
  type ProcessEntry
} from '../../electron/services/processSweep';

describe('parseProcessList', () => {
  it('разбирает строки pid,ppid,createdAt и пропускает мусор', () => {
    const text = '0,0,0\r\n4,0,0\r\n\r\nWARNING: x\r\n100,4,1700000000000\n 200,100,1700000000500 \n';
    expect(parseProcessList(text)).toEqual([
      { pid: 0, ppid: 0, createdAt: 0 },
      { pid: 4, ppid: 0, createdAt: 0 },
      { pid: 100, ppid: 4, createdAt: 1700000000000 },
      { pid: 200, ppid: 100, createdAt: 1700000000500 }
    ]);
  });
});

describe('collectDescendantPids', () => {
  const T = 1_700_000_000_000;
  const e = (pid: number, ppid: number, createdAt: number): ProcessEntry => ({ pid, ppid, createdAt });

  it('находит потомков мёртвого корня по цепочке ParentProcessId', () => {
    // корень 10 уже мёртв и в снимке отсутствует
    const entries = [e(20, 10, T + 100), e(30, 20, T + 200), e(31, 20, T + 250), e(40, 99, T + 300)];
    expect(collectDescendantPids(entries, 10, T).sort()).toEqual([20, 30, 31]);
  });

  it('отсекает процессы, созданные раньше родителя (переиспользованный PID)', () => {
    const entries = [e(20, 10, T - 60_000), e(21, 10, T + 50), e(30, 21, T - 60_000)];
    expect(collectDescendantPids(entries, 10, T)).toEqual([21]);
  });

  it('учитывает допуск на расхождение часов и пропускает процессы без времени создания', () => {
    const entries = [e(20, 10, T - 1500), e(21, 10, 0)];
    expect(collectDescendantPids(entries, 10, T)).toEqual([20]);
    expect(collectDescendantPids(entries, 10, T, 1000)).toEqual([]);
  });

  it('не зацикливается на циклах и не включает сам корень', () => {
    const entries = [e(10, 30, T + 1), e(20, 10, T + 2), e(30, 20, T + 3), e(40, 40, T + 4)];
    expect(collectDescendantPids(entries, 10, T).sort()).toEqual([20, 30]);
  });
});

/** Фейковый процесс без PID: добивание потомков (снимок процессов) при этом не запускается. */
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    pid: undefined as number | undefined,
    exitCode: null as number | null,
    signalCode: null as string | null,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough()
  });
  const exit = (code: number | null) => {
    child.exitCode = code;
    child.emit('exit', code, null);
  };
  return { child, proc: child as unknown as ChildProcess, exit };
}

describe('superviseChildExit', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('по close без ожидания, onDone один раз', () => {
    const { child, proc, exit } = fakeChild();
    const onDone = vi.fn();
    superviseChildExit(proc, { startedAt: 0, killTree: vi.fn(), onDone, graceMs: 1000 });
    exit(0);
    child.emit('close', 0);
    child.emit('close', 0);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(0);
  });

  it('без close завершает через grace после exit с кодом из exit и уничтожает потоки', async () => {
    vi.useFakeTimers();
    const { child, proc, exit } = fakeChild();
    const onDone = vi.fn();
    superviseChildExit(proc, { startedAt: 0, killTree: vi.fn(), onDone, graceMs: 1000 });
    exit(3);
    await vi.advanceTimersByTimeAsync(999);
    expect(onDone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onDone).toHaveBeenCalledWith(3);
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(child.stdin.destroyed).toBe(true);
  });

  it('close без кода берёт код из exit', () => {
    const { child, proc, exit } = fakeChild();
    const onDone = vi.fn();
    superviseChildExit(proc, { startedAt: 0, killTree: vi.fn(), onDone });
    exit(5);
    child.emit('close', null);
    expect(onDone).toHaveBeenCalledWith(5);
  });

  it('dispose отменяет ожидание', async () => {
    vi.useFakeTimers();
    const { proc, exit } = fakeChild();
    const onDone = vi.fn();
    const s = superviseChildExit(proc, { startedAt: 0, killTree: vi.fn(), onDone, graceMs: 1000 });
    exit(0);
    s.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('kill живого процесса — tree-kill, уже вышедшего — без повторного tree-kill', () => {
    const { proc, exit } = fakeChild();
    const killTree = vi.fn();
    const s = superviseChildExit(proc, { startedAt: 0, killTree, onDone: vi.fn() });
    s.kill();
    expect(killTree).toHaveBeenCalledTimes(1);
    exit(1);
    s.kill();
    expect(killTree).toHaveBeenCalledTimes(1);
  });
});
