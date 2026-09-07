import { afterAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import type { ManagedProcess } from '../../src/types/electron';

// processManager шлёт статусы через BrowserWindow — подменяем electron фиктивным окном,
// которое накапливает отправленные события.
const sent: Array<{ channel: string; payload: any }> = [];
vi.mock('electron', () => ({
  shell: { openExternal: async () => {} },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string, payload: any) => sent.push({ channel, payload }) }
      }
    ]
  }
}));

const {
  appendLogChunk,
  LOG_BUFFER_MAX_BYTES,
  processManager,
  resolveShellSpawn,
  resolveWorkingDir,
  parseProcessId,
  containsUrl,
  isAutoOpenUrlAllowed
} = await import('../../electron/services/processManager');

/** Долгоживущая кроссплатформенная команда для shell (cmd.exe / sh). */
const longRunningCommand = (ms: number) => `node -e "setTimeout(function(){}, ${ms})"`;

function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Временный «проект» с реестром env-tools и живым процессом в нём. */
function makeEnvToolsProject(name: string, extra: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-envstate-'));
  const child = spawn(process.execPath, ['-e', 'setTimeout(function(){}, 60000)'], { stdio: 'ignore' });
  child.unref();
  const registryFile = path.join(dir, '.env-state', 'processes.json');
  fs.mkdirSync(path.dirname(registryFile), { recursive: true });
  const registry = {
    [name]: {
      pid: child.pid,
      command: longRunningCommand(60000),
      cwd: dir,
      startedAt: new Date().toISOString(),
      ...extra
    }
  };
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));
  return { dir, pid: child.pid!, registryFile, child };
}

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
    const spec = resolveShellSpawn('echo x', 'win32', 'C:\\Windows\\System32\\cmd.exe');
    expect(spec.file).toBe('C:\\Windows\\System32\\cmd.exe');
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


describe('parseProcessId / containsUrl / isAutoOpenUrlAllowed (TASK-45)', () => {
  it('режет id по последнему `::`, путь Windows с двоеточием не ломает разбор', () => {
    expect(parseProcessId('F:\\proj::dev')).toEqual({ projectPath: 'F:\\proj', name: 'dev' });
    expect(parseProcessId('/home/u/proj::web::api')).toEqual({ projectPath: '/home/u/proj::web', name: 'api' });
    expect(parseProcessId('no-separator')).toBeNull();
    expect(parseProcessId('path::')).toBeNull();
  });

  it('находит http(s)-URL в строке лога', () => {
    expect(containsUrl('  ➜  Local:   http://localhost:5173/')).toBe(true);
    expect(containsUrl('Uvicorn running on https://127.0.0.1:8000 (Press CTRL+C)')).toBe(true);
    expect(containsUrl('compiling... done')).toBe(false);
  });

  it('разрешает автооткрытие только http/https', () => {
    expect(isAutoOpenUrlAllowed('http://localhost:3000')).toBe(true);
    expect(isAutoOpenUrlAllowed('https://example.com/x')).toBe(true);
    expect(isAutoOpenUrlAllowed('file:///C:/Windows')).toBe(false);
    expect(isAutoOpenUrlAllowed('javascript:alert(1)')).toBe(false);
    expect(isAutoOpenUrlAllowed('not a url')).toBe(false);
  });
});

describe('autoOpenUrl (TASK-45, AC #3)', () => {
  it('открывает настроенный URL один раз, когда в логе появляется строка с адресом', async () => {
    processManager.configureRetention({ finishedTtlMs: 60000, maxFinished: 50 });
    const opened: string[] = [];
    processManager.setUrlOpener(async (url) => {
      opened.push(url);
    });
    const info = await processManager.startProcess(
      CWD,
      'echo Local: http://localhost:1234/ && echo again http://localhost:1234/',
      'auto-open-log',
      { autoOpenUrl: 'http://localhost:9999/app', autoOpenDelayMs: 0 }
    );
    await waitFor(() => finished(info.id));
    expect(opened).toEqual(['http://localhost:9999/app']);
  }, 20000);

  it('открывает URL по задержке, если сервер не напечатал адрес, и не открывает после завершения', async () => {
    processManager.configureRetention({ finishedTtlMs: 60000, maxFinished: 50 });
    const opened: string[] = [];
    processManager.setUrlOpener(async (url) => {
      opened.push(url);
    });

    const silent = await processManager.startProcess(CWD, longRunningCommand(4000), 'auto-open-delay', {
      autoOpenUrl: 'http://localhost:7777',
      autoOpenDelayMs: 300
    });
    await waitFor(() => opened.length === 1, 5000);
    expect(opened).toEqual(['http://localhost:7777']);
    await processManager.stopProcess(silent.id);

    // Процесс завершился раньше задержки — открывать нечего.
    const quick = await processManager.startProcess(CWD, 'echo done', 'auto-open-quick', {
      autoOpenUrl: 'http://localhost:7778',
      autoOpenDelayMs: 300
    });
    await waitFor(() => finished(quick.id));
    await sleep(500);
    expect(opened).toEqual(['http://localhost:7777']);
  }, 20000);

  it('не открывает URL с недопустимой схемой', async () => {
    const opened: string[] = [];
    processManager.setUrlOpener(async (url) => {
      opened.push(url);
    });
    const info = await processManager.startProcess(CWD, 'echo http://localhost:1/', 'auto-open-bad', {
      autoOpenUrl: 'file:///etc/passwd',
      autoOpenDelayMs: 0
    });
    await waitFor(() => finished(info.id));
    expect(opened).toEqual([]);
  }, 20000);
});

describe('остановка и перезапуск процессов env-tools по реестру .env-state (TASK-45, AC #4)', () => {
  it('stopProcess убивает процесс по pid из processes.json и удаляет запись из реестра', async () => {
    const { dir, pid, registryFile } = makeEnvToolsProject('env-web');
    expect(isAlive(pid)).toBe(true);

    const listed = await processManager.listProcessesForProject(dir);
    const envProc = listed.find((p) => p.name === 'env-web');
    expect(envProc?.source).toBe('env-tools');
    expect(envProc?.status).toBe('running');

    const ok = await processManager.stopProcess(envProc!.id);
    expect(ok).toBe(true);
    await waitFor(() => !isAlive(pid), 5000);

    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf-8'));
    expect(registry['env-web']).toBeUndefined();
    expect(lastStatusOf(envProc!.id)?.status).toBe('stopped');
    expect(lastStatusOf(envProc!.id)?.source).toBe('env-tools');

    const after = await processManager.listProcessesForProject(dir);
    expect(after.find((p) => p.name === 'env-web')).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 20000);

  it('stopProcess для неизвестного id без реестра возвращает false', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-noreg-'));
    expect(await processManager.stopProcess(`${dir}::ghost`)).toBe(false);
    expect(await processManager.stopProcess('garbage')).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('restartProcess останавливает процесс env-tools и запускает ту же команду под управлением Hub', async () => {
    processManager.configureRetention({ finishedTtlMs: 60000, maxFinished: 50 });
    const { dir, pid, registryFile } = makeEnvToolsProject('env-api');
    const id = `${path.normalize(dir)}::env-api`;

    const restarted = await processManager.restartProcess(id);
    expect(restarted.id).toBe(id);
    expect(restarted.source).toBe('hub');
    expect(restarted.status).toBe('running');
    expect(restarted.command).toBe(longRunningCommand(60000));
    await waitFor(() => !isAlive(pid), 5000);
    expect(JSON.parse(fs.readFileSync(registryFile, 'utf-8'))['env-api']).toBeUndefined();

    const listed = await processManager.listProcessesForProject(dir);
    expect(listed.filter((p) => p.name === 'env-api')).toHaveLength(1);
    expect(listed[0].source).toBe('hub');

    await processManager.stopProcess(id);
    await waitFor(() => finished(id));
    fs.rmSync(dir, { recursive: true, force: true });
  }, 20000);
});

describe('перезапуск hub-процесса (TASK-45, AC #2)', () => {
  it('restartProcess стартует заново с теми же env/cwd и не даёт старому close перетереть статус', async () => {
    processManager.configureRetention({ finishedTtlMs: 60000, maxFinished: 50 });
    const isWin = process.platform === 'win32';
    const command = isWin
      ? `echo %PH_RESTART_VAR% && ${longRunningCommand(60000)}`
      : `echo $PH_RESTART_VAR && ${longRunningCommand(60000)}`;
    const first = await processManager.startProcess(CWD, command, 'hub-restart', {
      env: { PH_RESTART_VAR: 'restart-value' },
      cwd: 'tests'
    });
    await waitFor(() => processManager.getLogs(first.id).join('').includes('restart-value'));
    const firstPid = first.pid;

    const second = await processManager.restartProcess(first.id);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('running');
    expect(second.pid).not.toBe(firstPid);
    expect(second.workingDir).toBe(path.resolve(CWD, 'tests'));
    expect(isAlive(firstPid)).toBe(false);
    await waitFor(() => processManager.getLogs(second.id).join('').includes('restart-value'));

    // Старый процесс закрылся, но его статус «stopped» не должен уйти в рендерер поверх нового «running».
    await sleep(300);
    expect(lastStatusOf(second.id)?.status).toBe('running');
    expect(lastStatusOf(second.id)?.pid).toBe(second.pid);

    const listed = await processManager.listProcessesForProject(CWD);
    expect(listed.filter((p) => p.id === second.id)).toHaveLength(1);

    await processManager.stopProcess(second.id);
    await waitFor(() => finished(second.id));
  }, 30000);

  it('stopProcess ждёт фактического завершения дочернего процесса', async () => {
    processManager.configureRetention({ finishedTtlMs: 60000, maxFinished: 50 });
    const info = await processManager.startProcess(CWD, longRunningCommand(60000), 'hub-stop-wait');
    expect(isAlive(info.pid)).toBe(true);
    const ok = await processManager.stopProcess(info.id);
    expect(ok).toBe(true);
    expect(isAlive(info.pid)).toBe(false);
    expect(lastStatusOf(info.id)?.status).toBe('stopped');
    // Повторная остановка уже остановленного — true без ошибок.
    expect(await processManager.stopProcess(info.id)).toBe(true);
  }, 20000);
});
