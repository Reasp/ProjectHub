import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Git-команды чекпоинтов агента (TASK-72, decision-45 п. 1, 4, 5). Чистый модуль без Electron.
 *
 * Чекпоинт — коммит-объект вне истории ветки: снимок рабочего дерева через временный индекс
 * (`GIT_INDEX_FILE`) и `commit-tree` с родителем HEAD, закреплённый ref
 * `refs/projecthub/checkpoints/<swarmId>/<agentId>/<n>`. Индекс и HEAD рабочего каталога не
 * меняются: агент может работать параллельно со снимком.
 */

export const CHECKPOINT_REF_ROOT = 'refs/projecthub/checkpoints';
export const CHECKPOINT_AUTHOR_NAME = 'ProjectHub Checkpoint';
export const CHECKPOINT_AUTHOR_EMAIL = 'agent@projecthub.local';

/** Запуск git: stdout команды или исключение с stderr. */
export type GitRunner = (args: string[], options: { cwd: string; env?: Record<string, string> }) => Promise<string>;

export const execGit: GitRunner = (args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr || '').trim();
          reject(new Error(`git ${args[0]}: ${detail || err.message}`, { cause: err }));
          return;
        }
        resolve(String(stdout));
      }
    );
  });

/** Сегмент ref: только символы, допустимые в имени ref и безопасные для путей. */
export function sanitizeRefSegment(value: string): string {
  const cleaned = String(value ?? '')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100);
  return cleaned || 'x';
}

export function checkpointRefPrefix(swarmId: string, agentId?: string): string {
  const base = `${CHECKPOINT_REF_ROOT}/${sanitizeRefSegment(swarmId)}/`;
  return agentId === undefined ? base : `${base}${sanitizeRefSegment(agentId)}/`;
}

export function checkpointRef(swarmId: string, agentId: string, n: number): string {
  return `${checkpointRefPrefix(swarmId, agentId)}${Math.max(0, Math.floor(n))}`;
}

/** swarmId из имени ref чекпоинта или `null`, если ref чужой. */
export function swarmIdFromCheckpointRef(ref: string): string | null {
  const prefix = `${CHECKPOINT_REF_ROOT}/`;
  if (!ref.startsWith(prefix)) return null;
  const rest = ref.slice(prefix.length).split('/');
  return rest.length >= 3 && rest[0] ? rest[0] : null;
}

export interface CheckpointSnapshot {
  commit: string;
  tree: string;
  /** HEAD в момент снимка — родитель коммита чекпоинта; `null` в репозитории без коммитов. */
  parent: string | null;
}

/** Рабочий каталог — git-репозиторий (worktree или основное дерево). */
export async function isGitWorkTree(git: GitRunner, cwd: string): Promise<boolean> {
  try {
    return (await git(['rev-parse', '--is-inside-work-tree'], { cwd })).trim() === 'true';
  } catch {
    return false;
  }
}

async function resolveHead(git: GitRunner, cwd: string): Promise<string | null> {
  try {
    return (await git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd })).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Дерево текущего состояния рабочего каталога без изменения его индекса: копия индекса во
 * временный файл (сохраняет кэш stat, `add -A` идёт инкрементально), `add -A`, `write-tree`.
 * Неотслеживаемые файлы входят, игнорируемые `.gitignore` — нет.
 */
export async function snapshotTree(git: GitRunner, cwd: string, tmpDir: string = os.tmpdir()): Promise<string> {
  // Без `--path-format=absolute` (git ≥ 2.31): путь бывает относительным к cwd.
  const realIndex = path.resolve(cwd, (await git(['rev-parse', '--git-path', 'index'], { cwd })).trim());
  const tmpIndex = path.join(tmpDir, `projecthub-checkpoint-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.index`);
  try {
    try {
      await fs.copyFile(realIndex, tmpIndex);
    } catch {
      // Индекса ещё нет (репозиторий без единого `git add`) — git создаст временный с нуля.
    }
    const env = { GIT_INDEX_FILE: tmpIndex };
    await git(['add', '-A'], { cwd, env });
    return (await git(['write-tree'], { cwd, env })).trim();
  } finally {
    await fs.rm(tmpIndex, { force: true }).catch(() => undefined);
    await fs.rm(`${tmpIndex}.lock`, { force: true }).catch(() => undefined);
  }
}

/**
 * Снимок рабочего каталога коммит-объектом с родителем HEAD и закрепление его `ref`.
 * `skipIfTree` — дерево предыдущего чекпоинта: при совпадении снимок не создаётся (`null`).
 */
export async function createCheckpoint(
  git: GitRunner,
  cwd: string,
  options: { ref: string; message: string; skipIfTree?: string; tmpDir?: string }
): Promise<CheckpointSnapshot | null> {
  const tree = await snapshotTree(git, cwd, options.tmpDir);
  if (options.skipIfTree && options.skipIfTree === tree) return null;
  const parent = await resolveHead(git, cwd);
  const env = {
    GIT_AUTHOR_NAME: CHECKPOINT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: CHECKPOINT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: CHECKPOINT_AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: CHECKPOINT_AUTHOR_EMAIL
  };
  const args = ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', options.message];
  const commit = (await git(args, { cwd, env })).trim();
  await git(['update-ref', options.ref, commit], { cwd });
  return { commit, tree, parent };
}

/** Число файлов, различающихся между двумя деревьями (для подписи чекпоинта). */
export async function countChangedFiles(git: GitRunner, cwd: string, fromTree: string | null, toTree: string): Promise<number> {
  const out = fromTree
    ? await git(['diff-tree', '-r', '--name-only', '--no-commit-id', fromTree, toTree], { cwd })
    : await git(['ls-tree', '-r', '--name-only', toTree], { cwd });
  return out.split('\n').filter((l) => l.trim()).length;
}

/** Разбор вывода `-z`: пути без пустых хвостов. */
export function splitNul(output: string): string[] {
  return output.split('\0').filter((p) => p.length > 0);
}

/**
 * Файлы, которые нужно удалить после `checkout <снимок> -- .`, чтобы рабочий каталог совпал со
 * снимком: удалённые в снимке относительно родителя и неотслеживаемые, которых в снимке нет.
 * Каталоги (вложенные репозитории, `ls-files` отдаёт их с `/` на конце) не трогаются.
 */
export function filesToRemoveAfterCheckout(deletedInSnapshot: string[], untracked: string[]): string[] {
  const out = new Set<string>();
  for (const p of [...deletedInSnapshot, ...untracked]) {
    if (!p || p.endsWith('/') || p.includes('\0')) continue;
    const norm = p.replace(/\\/g, '/');
    if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm) || norm.split('/').includes('..')) continue;
    out.add(norm);
  }
  return Array.from(out).sort();
}

export interface RewindResult {
  /** Файлы, удалённые из рабочего каталога, чтобы он совпал со снимком. */
  removedFiles: string[];
  /** HEAD после отката — родитель снимка. */
  head: string | null;
}

/**
 * Откат рабочего каталога к снимку (decision-45 п. 4, проверено вживую): HEAD — на родителя снимка,
 * файлы — как в снимке, неотслеживаемые файлы вне снимка удаляются по списку (не `clean -fdx`),
 * игнорируемые не трогаются, индекс возвращается к родителю.
 */
export async function rewindWorkTree(git: GitRunner, cwd: string, checkpointCommit: string): Promise<RewindResult> {
  const commit = (await git(['rev-parse', '--verify', `${checkpointCommit}^{commit}`], { cwd })).trim();
  const parents = (await git(['rev-list', '--parents', '-n', '1', commit], { cwd })).trim().split(/\s+/).slice(1);
  const parent = parents[0] ?? null;

  if (parent) {
    await git(['reset', '-q', '--hard', parent], { cwd });
  }
  await git(['checkout', commit, '--', '.'], { cwd });
  const deleted = parent
    ? splitNul(await git(['diff', '--name-only', '-z', '--diff-filter=D', parent, commit], { cwd }))
    : [];
  const untracked = splitNul(await git(['ls-files', '--others', '--exclude-standard', '-z'], { cwd }));
  const toRemove = filesToRemoveAfterCheckout(deleted, untracked);
  const root = path.resolve(cwd);
  const removed: string[] = [];
  for (const rel of toRemove) {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) continue;
    try {
      const stat = await fs.lstat(abs);
      if (stat.isDirectory()) continue;
      await fs.rm(abs, { force: true });
      removed.push(rel);
    } catch {
      /* файла уже нет */
    }
  }
  if (parent) {
    await git(['reset', '-q'], { cwd });
  }
  return { removedFiles: removed, head: parent };
}

/** Все ref под префиксом. */
export async function listRefs(git: GitRunner, cwd: string, prefix: string): Promise<string[]> {
  const out = await git(['for-each-ref', '--format=%(refname)', prefix], { cwd });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Удаление ref чекпоинтов (чужие ref игнорируются). Ref немного — лимит 50 на агента. */
export async function deleteRefs(git: GitRunner, cwd: string, refs: string[]): Promise<number> {
  const valid = refs.filter((r) => r.startsWith(`${CHECKPOINT_REF_ROOT}/`));
  let deleted = 0;
  for (const ref of valid) {
    try {
      await git(['update-ref', '-d', ref], { cwd });
      deleted++;
    } catch {
      /* ref уже удалён */
    }
  }
  return deleted;
}

/** Удаление всех ref под префиксом (сессия или агент). */
export async function deleteRefsByPrefix(git: GitRunner, cwd: string, prefix: string): Promise<number> {
  if (!prefix.startsWith(`${CHECKPOINT_REF_ROOT}/`)) return 0;
  return deleteRefs(git, cwd, await listRefs(git, cwd, prefix));
}

/** Какие номера чекпоинтов удалить, чтобы осталось не больше `limit` (самые старые). */
export function checkpointsToPrune<T extends { n: number }>(checkpoints: T[], limit: number): T[] {
  if (limit <= 0 || checkpoints.length <= limit) return [];
  return [...checkpoints].sort((a, b) => a.n - b.n).slice(0, checkpoints.length - limit);
}
