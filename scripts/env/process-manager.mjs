import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import {
  ROOT,
  STATE_DIR,
  readRegistry,
  updateRegistry,
  logPath,
  ensureDirs,
  queryStartTimes,
  readStatuses,
} from './state.mjs';

const IS_WINDOWS = process.platform === 'win32';
const WRAPPER_DIR = path.join(STATE_DIR, 'wrappers');

// Мёртвые записи реестра без активности (старт, запись в лог) дольше этого срока list_processes
// удаляет вместе с логом и файлами обёртки (decision-59). Недавние оставляем: «НЕ работает» и
// tail_log — сигнал агенту, что его dev-сервер упал.
export const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// На Windows связка shell:true + detached:true у child_process теряет перенаправление
// stdout/stderr в файл (проверено эмпирически: с прямым spawn без shell редирект работает,
// как только добавляется shell-обёртка — вывод пропадает независимо от того, через fd или
// через "> file" в самой команде). Поэтому на Windows используем PowerShell-обёртку,
// запущенную через `cmd /c start /b`, которая переживает завершение родителя, сама
// записывает свой $PID в файл и делает редирект средствами самого PowerShell.
//
// Прямой `spawn('powershell.exe', ..., { detached: true })` (вариант ProjectTemplate/ProxiHorror)
// не использовать (decision-58, TASK-109): Windows PowerShell 5.1 с DETACHED_PROCESS (без консоли)
// завершается с кодом 0, не выполнив скрипт, — pid-файл не появляется, start_process падает по
// тайм-ауту. Кроме того, родителем обёртки стал бы сам env-server, и `taskkill /T` по нему убил бы
// dev-сервер; здесь родитель — уже завершившийся cmd.exe. windowsHide + stdio 'ignore' дают cmd.exe
// (а через start /b — и PowerShell с её потомками) собственную консоль без окна (CREATE_NO_WINDOW):
// окна не всплывают, закрытие терминала родителя обёртку не задевает.
function startWindows({ name, command, cwd }) {
  fs.mkdirSync(WRAPPER_DIR, { recursive: true });
  const wrapperPath = path.join(WRAPPER_DIR, `${name}.ps1`);
  const pidFile = path.join(WRAPPER_DIR, `${name}.pid`);
  const pidTmpFile = `${pidFile}.tmp`;
  const logFile = logPath(name);

  fs.writeFileSync(logFile, '');
  for (const f of [pidFile, pidTmpFile]) if (fs.existsSync(f)) fs.unlinkSync(f);

  // pid-файл: `pid,время старта в мс Unix` — идентичность записи реестра (decision-59). Пишется
  // во временный файл и переименовывается, чтобы ожидающий Node не прочитал его наполовину.
  const script = [
    `Set-Location -LiteralPath '${cwd}'`,
    `$started = ([DateTimeOffset]([System.Diagnostics.Process]::GetCurrentProcess().StartTime)).ToUnixTimeMilliseconds()`,
    `"$PID,$started" | Out-File -FilePath '${pidTmpFile}' -Encoding ascii -NoNewline`,
    `Move-Item -LiteralPath '${pidTmpFile}' -Destination '${pidFile}' -Force`,
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
  const pidLine = fs.readFileSync(pidFile, 'utf-8').trim();
  const m = /^(\d+),(\d+)$/.exec(pidLine);
  if (!m) {
    throw new Error(`Не удалось запустить "${name}": неожиданное содержимое pid-файла "${pidLine}".`);
  }
  return { pid: Number(m[1]), pidCreatedAt: Number(m[2]) };
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

  // Процесс только что создан, его pid ещё не мог достаться другому. Если он уже завершился или
  // ps недоступен, запись останется без идентичности — такую stop_process не убивает.
  let pidCreatedAt = null;
  try {
    pidCreatedAt = queryStartTimes([child.pid]).get(child.pid) ?? null;
  } catch {
    // см. выше
  }
  return { pid: child.pid, pidCreatedAt };
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

  // Дубликат — только запись, чей pid подтверждённо принадлежит запущенному ею процессу.
  // Запись со статусом 'unknown' (без времени старта) дубликатом не считается (decision-59).
  const existing = readRegistry()[name];
  if (existing && readStatuses([existing])[0] === 'running') {
    throw new Error(
      `Процесс "${name}" уже запущен (pid ${existing.pid}, команда: ${existing.command}). ` +
        `Останови его через stop_process, если нужно перезапустить.`,
    );
  }

  const resolvedCwd = cwd ?? ROOT;
  const { pid, pidCreatedAt } = IS_WINDOWS
    ? startWindows({ name, command, cwd: resolvedCwd })
    : startPosix({ name, command, cwd: resolvedCwd });

  const entry = { pid, command, cwd: resolvedCwd, startedAt: new Date().toISOString() };
  if (Number.isFinite(pidCreatedAt)) entry.pidCreatedAt = pidCreatedAt;
  updateRegistry((registry) => {
    registry[name] = entry;
  });
  return entry;
}

// Останавливает процесс записи, только если pid подтверждённо его ('running'). Для 'dead' и
// 'unknown' запись просто удаляется: pid мог достаться чужому процессу, и taskkill /T /F по нему
// убил бы постороннее дерево (TASK-110). Если время старта проверить не удалось — ошибка,
// запись остаётся.
export function stopProcess({ name }) {
  const entry = readRegistry()[name];
  if (!entry) {
    throw new Error(`Процесс "${name}" не найден в реестре.`);
  }

  const status = readStatuses([entry], { strict: true })[0];
  if (status === 'running') {
    if (IS_WINDOWS) {
      stopWindows({ pid: entry.pid });
    } else {
      stopPosix({ pid: entry.pid });
    }
  }

  updateRegistry((registry) => {
    if (registry[name]?.pid === entry.pid) delete registry[name];
  });
  return { name, pid: entry.pid, status, killed: status === 'running' };
}

function lastActivityMs(name, entry) {
  let last = Date.parse(entry.startedAt) || 0;
  try {
    last = Math.max(last, fs.statSync(logPath(name)).mtimeMs);
  } catch {
    // лога нет
  }
  return last;
}

function removeProcessFiles(name) {
  const files = [
    logPath(name),
    path.join(WRAPPER_DIR, `${name}.ps1`),
    path.join(WRAPPER_DIR, `${name}.pid`),
    path.join(WRAPPER_DIR, `${name}.pid.tmp`),
  ];
  for (const f of files) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      // файл занят — останется до следующей чистки
    }
  }
}

// Список записей со статусами ('running' | 'dead' | 'unknown'; alive — то же, что 'running').
// Попутно удаляет мёртвые записи без активности дольше PRUNE_AFTER_MS; их имена — в pruned.
export function listProcesses({ now = Date.now() } = {}) {
  const entries = Object.entries(readRegistry());
  const statuses = readStatuses(entries.map(([, entry]) => entry));

  const processes = [];
  const stale = [];
  entries.forEach(([name, entry], i) => {
    const status = statuses[i];
    if (status === 'dead' && now - lastActivityMs(name, entry) > PRUNE_AFTER_MS) {
      stale.push([name, entry]);
    } else {
      processes.push({ name, ...entry, status, alive: status === 'running' });
    }
  });

  const pruned = [];
  if (stale.length > 0) {
    updateRegistry((registry) => {
      for (const [name, entry] of stale) {
        // Другая сессия могла за это время перезапустить процесс под тем же именем.
        if (registry[name]?.pid === entry.pid && registry[name]?.startedAt === entry.startedAt) {
          delete registry[name];
          pruned.push(name);
        }
      }
    });
    for (const name of pruned) removeProcessFiles(name);
  }
  return { processes, pruned };
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
