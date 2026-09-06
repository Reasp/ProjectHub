import { afterAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type { ManagedProcess } from '../../src/types/electron';

// processManager шлёт статусы через BrowserWindow — подменяем electron фиктивным окном,
// которое накапливает отправленные события.
const sent: Array<{ channel: string; payload: any }> = [];
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string, payload: any) => sent.push({ channel, payload }) }
      }
    ]
  }
}));

const { appendLogChunk, LOG_BUFFER_MAX_BYTES, processManager, resolveShellSpawn, resolveWorkingDir } = await import(
  '../../electron/services/processManager'
);

const CWD = process.cwd();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, timeoutMs = 10000, stepMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor: превышено время ожидания');
    await sleep(stepMs);
  }
}

function lastStatusOf(id: string): ManagedProcess | undefined {
  for (let i = sent.length - 1; i >= 0; i--) {
    const e = sent[i];
    if (e.channel === 'process:statusChanged' && e.payload.id === id) return e.payload;
  }
  return undefined;
}

const finished = (id: string) => lastStatusOf(id)?.status !== undefined && lastStatusOf(id)!.status !== 'running';

afterAll(() => {
  processManager.cleanupAll();
});

describe('appendLogChunk (аудит 2.1: лимит буфера по байтам)', () => {
  it('вытесняет старые чанки при превышении лимита', () => {
    const state = { logBuffer: [] as string[], logBytes: 0 };
    appendLogChunk(state, 'a'.repeat(60), 100);
    appendLogChunk(state, 'b'.repeat(30), 100);
    expect(state.logBuffer.length).toBe(2);
    expect(state.logBytes).toBe(90);

    appendLogChunk(state, 'c'.repeat(30), 100);
    expect(state.logBuffer).toEqual(['b'.repeat(30), 'c'.repeat(30)]);
    expect(state.logBytes).toBe(60);
  });

  it('усекает одиночный чанк больше лимита до хвоста', () => {
    const state = { logBuffer: ['old'], logBytes: 3 };
    appendLogChunk(state, 'x'.repeat(150) + 'TAIL', 100);
    expect(state.logBuffer.length).toBe(1);
    expect(state.logBuffer[0].endsWith('TAIL')).toBe(true);
    expect(state.logBytes).toBe(100);
  });

  it('считает байты, а не символы (UTF-8)', () => {
    const state = { logBuffer: [] as string[], logBytes: 0 };
    appendLogChunk(state, 'ж'.repeat(10), 100); // 20 байт
    expect(state.logBytes).toBe(20);
    expect(LOG_BUFFER_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe('удаление завершённых процессов из activeProcesses (аудит 2.1)', () => {
  it('удаляет завершённый процесс по TTL, статус до этого доступен', async () => {
    processManager.configureRetention({ finishedTtlMs: 200, maxFinished: 50 });
    const info = await processManager.startProcess(CWD, 'echo ttl-test', 'ttl-test');
    expect(info.status).toBe('running');
    expect(processManager.getActiveProcessCount()).toBeGreaterThanOrEqual(1);

    await waitFor(() => finished(info.id));
    // Сразу после завершения запись ещё на месте: вкладка Processes видит статус и хвост лога.
    const listed = await processManager.listProcessesForProject(CWD);
    expect(listed.find((p) => p.id === info.id)?.status).toBe('stopped');
    expect(processManager.getLogs(info.id).join('')).toContain('ttl-test');

    await waitFor(() => !processManager.getLogs(info.id).length, 5000);
    const after = await processManager.listProcessesForProject(CWD);
    expect(after.find((p) => p.id === info.id && p.source === 'hub')).toBeUndefined();
  }, 20000);

  it('держит не больше maxFinished завершённых записей', async () => {
    processManager.configureRetention({ finishedTtlMs: 60000, maxFinished: 1 });
    const a = await processManager.startProcess(CWD, 'echo a', 'limit-a');
    await waitFor(() => finished(a.id));
    const b = await processManager.startProcess(CWD, 'echo b', 'limit-b');
    await waitFor(() => finished(b.id));

    const listed = await processManager.listProcessesForProject(CWD);
    const hub = listed.filter((p) => p.source === 'hub' && p.id.startsWith(`${CWD}::limit-`));
    expect(hub.map((p) => p.name)).toEqual(['limit-b']);
  }, 20000);

  it('перезапуск с тем же именем не стирается таймером старой записи', async () => {
    processManager.configureRetention({ finishedTtlMs: 100, maxFinished: 50 });
    const first = await processManager.startProcess(CWD, 'echo first', 'restart');
    await waitFor(() => finished(first.id));

    const second = await processManager.startProcess(CWD, 'sleep 2', 'restart');
    expect(second.id).toBe(first.id);
    expect(processManager.hasRunningProcess(CWD)).toBe(true);

    await sleep(300); // таймер первой записи уже сработал бы
    const listed = await processManager.listProcessesForProject(CWD);
    expect(listed.find((p) => p.id === second.id)?.status).toBe('running');

    await processManager.stopProcess(second.id);
    await waitFor(() => finished(second.id));
    expect(processManager.hasRunningProcess(CWD)).toBe(false);
  }, 20000);
});

describe('resolveShellSpawn / resolveWorkingDir (аудит 5.5: && на Windows, env/cwd действия)', () => {
  it('на Windows использует cmd.exe /d /s /c с командой в кавычках без переэкранирования', () => {
    const spec = resolveShellSpawn('npm run build && npm run deploy', 'win32', '');
    expect(spec.file).toBe('cmd.exe');
    expect(spec.args).toEqual(['/d', '/s', '/c', '"npm run build && npm run deploy"']);
    expect(spec.windowsVerbatimArguments).toBe(true);
  });

  it('на Windows уважает COMSPEC', () => {
    const spec = resolveShellSpawn('echo x', 'win32', 'C:\Windows\System32\cmd.exe');
    expect(spec.file).toBe('C:\Windows\System32\cmd.exe');
  });

  it('вне Windows — /bin/sh -c', () => {
    const spec = resolveShellSpawn('echo a && echo b', 'linux', '');
    expect(spec).toEqual({ file: '/bin/sh', args: ['-c', 'echo a && echo b'], windowsVerbatimArguments: false });
  });

  it('cwd действия резолвится относительно корня проекта, пустой — сам корень', () => {
    expect(resolveWorkingDir('/proj', 'sub/dir')).toBe(path.resolve('/proj', 'sub/dir'));
    expect(resolveWorkingDir('/proj', '  ')).toBe(path.normalize('/proj'));
    expect(resolveWorkingDir('/proj')).toBe(path.normalize('/proj'));
    const abs = path.resolve('/other');
    expect(resolveWorkingDir('/proj', abs)).toBe(abs);
  });

  it('команда с && выполняется целиком на текущей платформе', async () => {
    processManager.configureRetention({ finishedTtlMs: 60000, maxFinished: 50 });
    const info = await processManager.startProcess(CWD, 'echo first && echo second', 'and-chain');
    await waitFor(() => finished(info.id));
    expect(lastStatusOf(info.id)?.status).toBe('stopped');
    const log = processManager.getLogs(info.id).join('');
    expect(log).toContain('first');
    expect(log).toContain('second');
  }, 20000);

  it('применяет env и cwd из ActionDefinition', async () => {
    processManager.configureRetention({ finishedTtlMs: 60000, maxFinished: 50 });
    const isWin = process.platform === 'win32';
    const command = isWin ? 'echo %PH_TEST_VAR% & cd' : 'echo $PH_TEST_VAR && pwd';
    const info = await processManager.startProcess(CWD, command, 'env-cwd', {
      env: { PH_TEST_VAR: 'hub-value' },
      cwd: 'tests'
    });
    expect(info.workingDir).toBe(path.resolve(CWD, 'tests'));
    expect(info.cwd).toBe(CWD);
    await waitFor(() => finished(info.id));
    const log = processManager.getLogs(info.id).join('');
    expect(log).toContain('hub-value');
    expect(log.toLowerCase()).toContain(path.resolve(CWD, 'tests').toLowerCase());
  }, 20000);

  it('несуществующий cwd — понятная ошибка до spawn', async () => {
    await expect(
      processManager.startProcess(CWD, 'echo x', 'bad-cwd', { cwd: 'definitely/missing/dir' })
    ).rejects.toThrow(/Рабочий каталог не найден/);
  });
});
