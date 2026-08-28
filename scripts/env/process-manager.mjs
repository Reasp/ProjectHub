import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { ROOT, STATE_DIR, readRegistry, writeRegistry, isAlive, logPath, ensureDirs } from './state.mjs';

const IS_WINDOWS = process.platform === 'win32';
const WRAPPER_DIR = path.join(STATE_DIR, 'wrappers');

// На Windows связка shell:true + detached:true у child_process теряет перенаправление
// stdout/stderr в файл (проверено эмпирически: с прямым spawn без shell редирект работает,
// как только добавляется shell-обёртка — вывод пропадает независимо от того, через fd или
// через "> file" в самой команде). Поэтому на Windows используем PowerShell-обёртку,
// запущенную через `cmd /c start /b`, которая переживает завершение родителя, сама
// записывает свой $PID в файл и делает редирект средствами самого PowerShell.
function startWindows({ name, command, cwd }) {
  fs.mkdirSync(WRAPPER_DIR, { recursive: true });
  const wrapperPath = path.join(WRAPPER_DIR, `${name}.ps1`);
  const pidFile = path.join(WRAPPER_DIR, `${name}.pid`);
  const logFile = logPath(name);

  fs.writeFileSync(logFile, '');
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);

  const script = [
    `Set-Location -LiteralPath '${cwd}'`,
    `$PID | Out-File -FilePath '${pidFile}' -Encoding ascii -NoNewline`,
    `${command} 2>&1 | Out-File -FilePath '${logFile}' -Append -Encoding utf8`,
    '',
  ].join('\r\n');
  fs.writeFileSync(wrapperPath, script);

  const launcher = spawn(
    'cmd.exe',
    [
      '/c', 'start', '/b', '""',
      'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', wrapperPath,
    ],
    { cwd, stdio: 'ignore', windowsHide: true },
  );
  launcher.unref();

  // start /b возвращает управление почти сразу, до того как PowerShell успевает
  // записать свой $PID — ждём появления файла (обычно первые сотни мс).
  const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(pidFile) && Date.now() < deadline) {
    Atomics.wait(sleepBuf, 0, 0, 50);
  }
  if (!fs.existsSync(pidFile)) {
    throw new Error(`Не удалось запустить "${name}": PowerShell-обёртка не стартовала за 5с.`);
  }
  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
  return { pid };
}

function stopWindows({ pid }) {
  execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

function startPosix({ name, command, cwd }) {
  const logFile = logPath(name);
  fs.writeFileSync(logFile, `# ${new Date().toISOString()} — старт: ${command}\n`);
  const logFd = fs.openSync(logFile, 'a');

  const child = spawn(command, {
    shell: true,
    cwd,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();

  return { pid: child.pid };
}

function stopPosix({ pid }) {
  try {
    process.kill(-pid, 'SIGTERM'); // группа процессов (detached создаёт новую группу)
  } catch {
    process.kill(pid, 'SIGTERM');
  }
}

export function startProcess({ name, command, cwd }) {
  ensureDirs();
  const registry = readRegistry();

  const existing = registry[name];
  if (existing && isAlive(existing.pid)) {
    throw new Error(
      `Процесс "${name}" уже запущен (pid ${existing.pid}, команда: ${existing.command}). ` +
        `Останови его через stop_process, если нужно перезапустить.`,
    );
  }

  const resolvedCwd = cwd ?? ROOT;
  const { pid } = IS_WINDOWS
    ? startWindows({ name, command, cwd: resolvedCwd })
    : startPosix({ name, command, cwd: resolvedCwd });

  registry[name] = { pid, command, cwd: resolvedCwd, startedAt: new Date().toISOString() };
  writeRegistry(registry);

  return registry[name];
}

export function stopProcess({ name }) {
  const registry = readRegistry();
  const entry = registry[name];
  if (!entry) {
    throw new Error(`Процесс "${name}" не найден в реестре.`);
  }

  if (isAlive(entry.pid)) {
    if (IS_WINDOWS) {
      stopWindows({ pid: entry.pid });
    } else {
      stopPosix({ pid: entry.pid });
    }
  }

  delete registry[name];
  writeRegistry(registry);
  return { name, stopped: true };
}

export function listProcesses() {
  const registry = readRegistry();
  return Object.entries(registry).map(([name, entry]) => ({
    name,
    ...entry,
    alive: isAlive(entry.pid),
  }));
}

export function tailLog({ name, lines = 100 }) {
  const file = logPath(name);
  if (!fs.existsSync(file)) {
    throw new Error(`Лог для "${name}" не найден (процесс не запускался через env-tools?).`);
  }
  // PowerShell-редирект пишет UTF-8 с BOM — срезаем его, если есть.
  let content = fs.readFileSync(file, 'utf-8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const allLines = content.split('\n');
  return allLines.slice(-lines - 1).join('\n');
}
