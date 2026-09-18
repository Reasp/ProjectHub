import { execFile } from 'node:child_process';
import treeKill from 'tree-kill';

/**
 * Добивание потомков оболочки, переживших tree-kill (TASK-97, decision-37).
 *
 * На Windows tree-kill — это `taskkill /T /F` по снимку дерева. Если оболочка порождает
 * процесс уже после снимка, он остаётся жить с ParentProcessId мёртвой оболочки и держит
 * унаследованные stdio. Такие процессы находятся по цепочке ParentProcessId от PID оболочки;
 * время создания отсекает чужие процессы при повторном использовании PID.
 */

export interface ProcessEntry {
  pid: number;
  ppid: number;
  /** Время создания, мс Unix; 0 — неизвестно (системные процессы). */
  createdAt: number;
}

/** Допуск на расхождение времени создания процесса и отметки `Date.now()` перед spawn. */
export const SWEEP_CREATION_SLACK_MS = 2000;

/** Разбирает строки `pid,ppid,createdAtMs` из снимка процессов; мусорные строки пропускаются. */
export function parseProcessList(text: string): ProcessEntry[] {
  const out: ProcessEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+),(\d+),(\d+)\s*$/.exec(line);
    if (!m) continue;
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), createdAt: Number(m[3]) });
  }
  return out;
}

/**
 * Все потомки `rootPid` (сам корень может быть уже мёртв и отсутствовать в снимке).
 * Потомок должен быть создан не раньше родителя (с допуском `slackMs`): иначе его
 * ParentProcessId указывает на прежнего владельца переиспользованного PID.
 */
export function collectDescendantPids(
  entries: ProcessEntry[],
  rootPid: number,
  rootStartedAt: number,
  slackMs = SWEEP_CREATION_SLACK_MS
): number[] {
  const byParent = new Map<number, ProcessEntry[]>();
  for (const e of entries) {
    if (e.pid === e.ppid) continue;
    const list = byParent.get(e.ppid) ?? [];
    list.push(e);
    byParent.set(e.ppid, list);
  }
  const result: number[] = [];
  const seen = new Set<number>([rootPid]);
  const queue: Array<{ pid: number; createdAt: number }> = [{ pid: rootPid, createdAt: rootStartedAt }];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const e of byParent.get(parent.pid) ?? []) {
      if (seen.has(e.pid)) continue;
      if (e.createdAt === 0 || e.createdAt < parent.createdAt - slackMs) continue;
      seen.add(e.pid);
      result.push(e.pid);
      queue.push({ pid: e.pid, createdAt: e.createdAt });
    }
  }
  return result;
}

const LIST_PROCESSES_SCRIPT =
  'Get-CimInstance Win32_Process | ForEach-Object { ' +
  '$t = if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }; ' +
  '"$($_.ProcessId),$($_.ParentProcessId),$t" }';

/** Снимок процессов Windows (pid, ppid, время создания). */
export function listWindowsProcesses(timeoutMs = 15_000): Promise<ProcessEntry[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', LIST_PROCESSES_SCRIPT],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(parseProcessList(String(stdout))))
    );
  });
}

/**
 * Убивает оставшихся потомков завершившейся оболочки. Возвращает PID, которым отправлен kill.
 * Только Windows: на POSIX осиротевший процесс переподчиняется init и по ppid не находится.
 */
export async function sweepOrphanedDescendants(rootPid: number, rootStartedAt: number): Promise<number[]> {
  if (process.platform !== 'win32') return [];
  const pids = collectDescendantPids(await listWindowsProcesses(), rootPid, rootStartedAt);
  await Promise.all(
    pids.map((pid) => new Promise<void>((resolve) => treeKill(pid, 'SIGKILL', () => resolve())))
  );
  return pids;
}
