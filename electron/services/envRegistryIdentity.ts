import type { ProcessEntry } from './processSweep';

/**
 * Идентичность процессов из реестра env-tools `.env-state/processes.json` (TASK-111, decision-59, decision-60).
 *
 * `process.kill(pid, 0)` говорит лишь, что pid занят. ОС переиспользует pid, и запись из прошлой
 * сессии может указывать на чужой процесс. Запись хранит `pidCreatedAt` — время создания процесса
 * по данным ОС (мс Unix); процесс с тем же pid, но другим временем создания — чужой. Правило то же,
 * что `entryStatus` в `scripts/env/state.mjs`. Модуль без Electron: IO передаётся параметрами.
 */

/** Допуск сравнения времени создания: `ps -o lstart=` на POSIX даёт секундную точность. */
export const IDENTITY_TOLERANCE_MS = 1000;

/** Максимальный возраст снимка для отображения (вкладка процессов, сканер проектов). Остановка — всегда свежий. */
export const DISPLAY_SNAPSHOT_MAX_AGE_MS = 10_000;

/**
 * `running` — процесс тот самый; `dead` — процесса нет или pid занят другим;
 * `unknown` — pid занят, но сопоставить нельзя (запись без `pidCreatedAt` или ОС не отдала время).
 */
export type EnvEntryStatus = 'running' | 'dead' | 'unknown';

export interface EnvIdentityEntry {
  pid?: number;
  pidCreatedAt?: number;
  startedAt?: string;
}

/** Снимок процессов с моментом, когда он снят. */
export interface ProcessSnapshot {
  entries: ProcessEntry[];
  takenAt: number;
}

export function isPidAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Время создания для запрошенных pid; `null` — pid есть, но время неизвестно (createdAt 0). */
export function startTimesFor(entries: ProcessEntry[], pids: Iterable<number>): Map<number, number | null> {
  const wanted = new Set(pids);
  const out = new Map<number, number | null>();
  for (const e of entries) {
    if (wanted.has(e.pid)) out.set(e.pid, e.createdAt > 0 ? e.createdAt : null);
  }
  return out;
}

/** Статус записи по карте времени создания живых pid (как `entryStatus` в `scripts/env/state.mjs`). */
export function entryStatus(entry: EnvIdentityEntry, startTimes: Map<number, number | null>): EnvEntryStatus {
  if (!entry.pid || !startTimes.has(entry.pid)) return 'dead';
  const osStart = startTimes.get(entry.pid);
  if (osStart == null) return 'unknown';
  if (typeof entry.pidCreatedAt === 'number' && Number.isFinite(entry.pidCreatedAt)) {
    return Math.abs(osStart - entry.pidCreatedAt) <= IDENTITY_TOLERANCE_MS ? 'running' : 'dead';
  }
  // Старая запись: startedAt записан после получения pid, значит, настоящий процесс создан
  // не позже него. Процесс, созданный позже, — точно чужой.
  const registeredAt = entry.startedAt ? Date.parse(entry.startedAt) : NaN;
  if (Number.isFinite(registeredAt) && osStart > registeredAt + IDENTITY_TOLERANCE_MS) return 'dead';
  return 'unknown';
}

/**
 * Нужен ли свежий снимок вместо кэшированного: живой pid в снимке отсутствует или запись
 * появилась не раньше снимка — процесс мог стартовать (и занять pid) уже после него.
 */
export function snapshotIsStaleFor(entries: EnvIdentityEntry[], snapshot: ProcessSnapshot): boolean {
  const present = new Set(snapshot.entries.map((e) => e.pid));
  for (const entry of entries) {
    if (!entry.pid || !present.has(entry.pid)) return true;
    const registeredAt = entry.pidCreatedAt ?? (entry.startedAt ? Date.parse(entry.startedAt) : NaN);
    if (!Number.isFinite(registeredAt) || registeredAt >= snapshot.takenAt - IDENTITY_TOLERANCE_MS) return true;
  }
  return false;
}

export interface ResolveEntryStatusesOptions {
  /** Снимок процессов; `fresh: true` — не брать из кэша. */
  snapshot: (opts: { fresh: boolean }) => Promise<ProcessSnapshot>;
  /** Сразу свежий снимок (остановка процесса). */
  fresh?: boolean;
  /** Если снимок не удался: `true` — ошибка, `false` — живые pid получают `unknown`. */
  strict?: boolean;
  isAlive?: (pid: number | undefined) => boolean;
}

/**
 * Статусы записей реестра одним снимком процессов. Снимок снимается, только если `kill(pid, 0)`
 * нашёл живые pid; кэшированный снимок заменяется свежим, если он старше записей.
 */
export async function resolveEntryStatuses(
  entries: EnvIdentityEntry[],
  { snapshot, fresh = false, strict = false, isAlive = isPidAlive }: ResolveEntryStatusesOptions
): Promise<EnvEntryStatus[]> {
  const aliveEntries = entries.filter((e) => isAlive(e.pid));
  if (aliveEntries.length === 0) return entries.map(() => 'dead');
  const alivePids = new Set(aliveEntries.map((e) => e.pid!));

  let startTimes: Map<number, number | null>;
  try {
    let snap = await snapshot({ fresh });
    if (!fresh && snapshotIsStaleFor(aliveEntries, snap)) snap = await snapshot({ fresh: true });
    startTimes = startTimesFor(snap.entries, alivePids);
  } catch (err) {
    if (strict) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Не удалось проверить время старта процессов: ${message}`, { cause: err });
    }
    startTimes = new Map([...alivePids].map((pid) => [pid, null]));
  }
  return entries.map((entry) => (alivePids.has(entry.pid!) ? entryStatus(entry, startTimes) : 'dead'));
}

export interface SnapshotCache {
  /** Снимок не старше `maxAgeMs`; `0` — всегда новый. Параллельные вызовы делят один запрос. */
  get(maxAgeMs: number): Promise<ProcessSnapshot>;
  clear(): void;
}

/**
 * Кэш снимка процессов: сканер проектов осматривает все проекты параллельно, вкладка процессов
 * опрашивает список каждые 5 с — один снимок (~0,5 с PowerShell на Windows) делится между ними.
 * Ошибки не кэшируются.
 */
export function createSnapshotCache(
  fetch: () => Promise<ProcessEntry[]>,
  now: () => number = Date.now
): SnapshotCache {
  let cached: ProcessSnapshot | null = null;
  let inflight: { startedAt: number; promise: Promise<ProcessSnapshot> } | null = null;

  const start = () => {
    const startedAt = now();
    const promise = fetch().then(
      (entries) => {
        const snap = { entries, takenAt: startedAt };
        if (!cached || cached.takenAt <= startedAt) cached = snap;
        return snap;
      }
    );
    const current = { startedAt, promise };
    inflight = current;
    const release = () => {
      if (inflight === current) inflight = null;
    };
    promise.then(release, release);
    return promise;
  };

  return {
    get(maxAgeMs) {
      const t = now();
      if (maxAgeMs > 0) {
        if (cached && t - cached.takenAt <= maxAgeMs) return Promise.resolve(cached);
        if (inflight && t - inflight.startedAt <= maxAgeMs) return inflight.promise;
      }
      return start();
    },
    clear() {
      cached = null;
    }
  };
}
