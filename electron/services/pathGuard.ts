import path from 'node:path';

/**
 * Проверка принадлежности путей корню проекта (TASK-32).
 *
 * Модуль намеренно чистый (только `node:path`), чтобы его можно было покрыть unit-тестами
 * без Electron. Все проверки построены на `path.relative`, а не на `startsWith`: префикс без
 * разделителя (`C:\Projects\App` против `C:\Projects\App2\file`) здесь корректно отклоняется.
 */

/** Windows и macOS сравнивают пути без учёта регистра. */
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';

export class PathOutsideProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathOutsideProjectError';
  }
}

function comparable(p: string): string {
  return CASE_INSENSITIVE_FS ? p.toLowerCase() : p;
}

/**
 * Лежит ли `targetPath` внутри `projectPath` (или совпадает с ним).
 * Относительный `targetPath` разрешается от корня проекта; абсолютный берётся как есть.
 */
export function isInsideProject(projectPath: string, targetPath: string): boolean {
  if (typeof projectPath !== 'string' || typeof targetPath !== 'string') return false;
  if (!projectPath.trim() || targetPath.includes('\0')) return false;

  const root = path.resolve(projectPath);
  const target = path.resolve(root, targetPath);
  const rel = path.relative(comparable(root), comparable(target));

  if (rel === '') return true; // сам корень
  if (path.isAbsolute(rel)) return false; // другой диск на Windows
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) return false;
  return true;
}

/**
 * Возвращает абсолютный путь `filePath` внутри `projectPath` либо бросает
 * {@link PathOutsideProjectError}. Принимает и относительные (`src/a.ts`, `../x`),
 * и абсолютные пути.
 */
export function assertInsideProject(projectPath: string, filePath: string): string {
  if (!isInsideProject(projectPath, filePath)) {
    throw new PathOutsideProjectError(
      `Доступ запрещён: путь "${filePath}" находится вне корня проекта "${projectPath}"`
    );
  }
  return path.resolve(path.resolve(projectPath), filePath);
}

/**
 * Находит проект из списка, которому принадлежит `filePath`. При вложенных проектах
 * (инфраструктура как подпапка другого проекта) возвращает самый глубокий корень.
 */
export function findOwningProject(projectPaths: readonly string[], filePath: string): string | null {
  let best: string | null = null;
  for (const projectPath of projectPaths) {
    if (typeof projectPath !== 'string' || !projectPath.trim()) continue;
    if (!isInsideProject(projectPath, filePath)) continue;
    if (best === null || path.resolve(projectPath).length > path.resolve(best).length) {
      best = projectPath;
    }
  }
  return best;
}

/**
 * Путь к каталогу git из файла `.git` рабочего дерева (`gitdir: ...`), TASK-62.
 * В worktree `.git` — файл со ссылкой на `<project>/.git/worktrees/<name>`, а не каталог.
 * Возвращает null, если содержимое не похоже на указатель.
 */
export function parseGitDirPointer(content: string): string | null {
  const line = content.split(/\r?\n/).find((l) => l.trim().startsWith('gitdir:'));
  if (!line) return null;
  const target = line.trim().slice('gitdir:'.length).trim();
  return target || null;
}

/**
 * Является ли `gitdir` из файла `.git` указателем на рабочее дерево проекта `projectPath`,
 * то есть лежит ли он внутри `<projectPath>/.git/worktrees/`. Путь может быть и
 * относительным — тогда он разрешается от каталога самого рабочего дерева.
 */
export function isWorktreeGitDirOf(projectPath: string, worktreePath: string, gitdir: string): boolean {
  if (!gitdir) return false;
  const resolved = path.isAbsolute(gitdir) ? path.resolve(gitdir) : path.resolve(worktreePath, gitdir);
  const worktreesRoot = path.join(path.resolve(projectPath), '.git', 'worktrees');
  return isInsideProject(worktreesRoot, resolved);
}

/** Совпадает ли `candidate` с одним из корней `projectPaths` (с учётом нормализации и регистра ФС). */
export function isRegisteredProjectRoot(projectPaths: readonly string[], candidate: string): boolean {
  if (typeof candidate !== 'string' || !candidate.trim()) return false;
  const target = comparable(path.resolve(candidate));
  return projectPaths.some(
    (p) => typeof p === 'string' && p.trim() !== '' && comparable(path.resolve(p)) === target
  );
}
