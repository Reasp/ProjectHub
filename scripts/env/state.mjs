import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { INFRA_ROOT, PROJECT_ROOT } from '../config.mjs';

// Служебное состояние (pid'ы, логи) — implementation detail самой инфраструктуры,
// живёт рядом со скриптами (INFRA_ROOT), а не в целевом проекте. Дефолтная рабочая
// директория для запускаемых процессов (dev-сервер и т.п.) — PROJECT_ROOT.
export const ROOT = PROJECT_ROOT;
export const STATE_DIR = path.join(INFRA_ROOT, '.env-state');
export const LOG_DIR = path.join(STATE_DIR, 'logs');
export const REGISTRY_PATH = path.join(STATE_DIR, 'processes.json');

const IS_WINDOWS = process.platform === 'win32';

export function ensureDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function readRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export function writeRegistry(registry) {
  ensureDirs();
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

// Перечитать реестр прямо перед записью: между чтением и записью (ожидание pid-файла, запрос к ОС)
// другая сессия env-tools могла добавить или удалить свои записи.
export function updateRegistry(mutate) {
  const registry = readRegistry();
  mutate(registry);
  writeRegistry(registry);
  return registry;
}

// Только «есть ли процесс с таким pid». Чей он — не говорит: ОС переиспользует pid, и запись
// реестра из прошлой сессии может указывать на чужой процесс. Для записей реестра — entryStatus.
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function logPath(name) {
  return path.join(LOG_DIR, `${name}.log`);
}

// ---- Идентичность процесса (TASK-110, decision-59) ----
//
// Запись реестра хранит pidCreatedAt — время создания процесса по данным ОС (мс Unix). Процесс
// с тем же pid, но другим временем создания — чужой (pid переиспользован). Время пишется и
// сверяется из одного источника: на Windows — Process.StartTime (совпадает с CIM
// Win32_Process.CreationDate до миллисекунды), на POSIX — `ps -o lstart=` (точность 1 с).

export const IDENTITY_TOLERANCE_MS = 1000;
const QUERY_TIMEOUT_MS = 15_000;

// Разбор вывода запроса времени старта: строки `pid,ms` (Windows) или `pid lstart` (POSIX).
// pid без читаемого времени (системные процессы Windows) попадает в карту со значением null.
export function parseStartTimes(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const win = /^\s*(\d+),(\d*)\s*$/.exec(line);
    if (win) {
      out.set(Number(win[1]), win[2] ? Number(win[2]) : null);
      continue;
    }
    const posix = /^\s*(\d+)\s+(\S.*\S)\s*$/.exec(line);
    if (posix) {
      const ms = Date.parse(posix[2]);
      out.set(Number(posix[1]), Number.isFinite(ms) ? ms : null);
    }
  }
  return out;
}

// Время создания процессов одним запросом к ОС. В карте только существующие pid.
// Бросает, если сам запрос не удался (нет powershell/ps, тайм-аут).
export function queryStartTimes(pids) {
  const list = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
  if (list.length === 0) return new Map();
  if (IS_WINDOWS) {
    const script =
      `Get-Process -Id ${list.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { ` +
      `$t = if ($_.StartTime) { ([DateTimeOffset]$_.StartTime).ToUnixTimeMilliseconds() } else { '' }; ` +
      `"$($_.Id),$t" }; exit 0`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: QUERY_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseStartTimes(out.toString());
  }
  let out;
  try {
    out = execFileSync('ps', ['-o', 'pid=,lstart=', '-p', list.join(',')], {
      timeout: QUERY_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    // ps завершается с кодом 1, если ни один pid не найден, — это не ошибка запроса.
    if (err.status === 1 && err.stdout) out = err.stdout;
    else throw err;
  }
  return parseStartTimes(out.toString());
}

// Статус записи реестра по времени старта процессов (карта из queryStartTimes):
// 'running' — процесс тот самый; 'dead' — процесса нет или pid занят другим;
// 'unknown' — pid занят, но сопоставить нельзя: запись без pidCreatedAt (до TASK-110) или ОС
// не отдала время старта. Такую запись нельзя ни считать дубликатом, ни останавливать.
export function entryStatus(entry, startTimes) {
  if (!startTimes.has(entry.pid)) return 'dead';
  const osStart = startTimes.get(entry.pid);
  if (osStart == null) return 'unknown';
  if (Number.isFinite(entry.pidCreatedAt)) {
    return Math.abs(osStart - entry.pidCreatedAt) <= IDENTITY_TOLERANCE_MS ? 'running' : 'dead';
  }
  // Старая запись: startedAt записан после получения pid, значит, настоящий процесс создан
  // не позже него. Процесс, созданный позже, — точно чужой.
  const registeredAt = Date.parse(entry.startedAt);
  if (Number.isFinite(registeredAt) && osStart > registeredAt + IDENTITY_TOLERANCE_MS) return 'dead';
  return 'unknown';
}

// Статусы записей одним запросом к ОС (только по pid, которые kill(pid, 0) считает живыми).
// strict=false: если запрос не удался, живые pid получают 'unknown'; strict=true — ошибка.
export function readStatuses(entries, { strict = false } = {}) {
  const alivePids = entries.map((e) => e.pid).filter(isAlive);
  let startTimes;
  try {
    startTimes = queryStartTimes(alivePids);
  } catch (err) {
    if (strict) {
      throw new Error(`Не удалось проверить время старта процессов: ${err.message}`, { cause: err });
    }
    startTimes = new Map(alivePids.map((pid) => [pid, null]));
  }
  return entries.map((entry) => entryStatus(entry, startTimes));
}
