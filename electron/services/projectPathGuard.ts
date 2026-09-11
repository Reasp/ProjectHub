import path from 'node:path';
import fs from 'node:fs';
import { projectRegistry } from './projectRegistry';
import {
  findOwningProject,
  isRegisteredProjectRoot,
  isWorktreeGitDirOf,
  parseGitDirPointer,
  PathOutsideProjectError
} from './pathGuard';

/**
 * Привязка проверок путей к реестру проектов (TASK-32).
 *
 * IPC-обработчики получают от рендерера либо абсолютный `filePath`, либо `projectPath`.
 * Ни то, ни другое нельзя принимать на веру: рендерер может быть скомпрометирован, а main
 * работает с полными правами пользователя. Единственный доверенный источник — реестр
 * проектов (`~/.projecthub/projects.json`), который заполняется только через диалог выбора
 * папки и сканирование.
 */

/**
 * Проверяет, что абсолютный `filePath` лежит внутри одного из зарегистрированных проектов.
 * Возвращает нормализованный абсолютный путь, иначе бросает {@link PathOutsideProjectError}.
 */
export async function assertInsideRegisteredProject(filePath: string): Promise<string> {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new PathOutsideProjectError('Доступ запрещён: путь к файлу не задан');
  }
  const projects = await projectRegistry.getProjects();
  const owner = findOwningProject(projects.map((p) => p.path), filePath);
  if (!owner) {
    throw new PathOutsideProjectError(
      `Доступ запрещён: путь "${filePath}" не принадлежит ни одному зарегистрированному проекту`
    );
  }
  return path.resolve(filePath);
}

/**
 * Проверяет, что `projectPath` — корень одного из зарегистрированных проектов.
 * Возвращает нормализованный абсолютный путь, иначе бросает {@link PathOutsideProjectError}.
 */
export async function assertRegisteredProject(projectPath: string): Promise<string> {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    throw new PathOutsideProjectError('Доступ запрещён: путь к проекту не задан');
  }
  const projects = await projectRegistry.getProjects();
  if (!isRegisteredProjectRoot(projects.map((p) => p.path), projectPath)) {
    throw new PathOutsideProjectError(
      `Доступ запрещён: "${projectPath}" не является зарегистрированным проектом`
    );
  }
  return path.resolve(projectPath);
}

/**
 * Рабочее дерево проекта (TASK-62): корень зарегистрированного проекта либо git-worktree
 * внутри него. Worktree опознаётся не по имени каталога, а по файлу `.git` с указателем
 * `gitdir:` внутрь `<project>/.git/worktrees/` — произвольную подпапку проекта под видом
 * рабочего дерева так не подсунуть.
 */
export function isProjectWorktreeRoot(projectPath: string, candidate: string): boolean {
  const gitFile = path.join(path.resolve(candidate), '.git');
  let content: string;
  try {
    const stat = fs.statSync(gitFile);
    if (!stat.isFile()) return false;
    content = fs.readFileSync(gitFile, 'utf-8');
  } catch {
    return false;
  }
  const gitdir = parseGitDirPointer(content);
  return gitdir !== null && isWorktreeGitDirOf(projectPath, candidate, gitdir);
}

/**
 * Проверяет, что путь — рабочее дерево: корень зарегистрированного проекта или его worktree.
 * Возвращает нормализованный абсолютный путь, иначе бросает {@link PathOutsideProjectError}.
 */
export async function assertWorkspaceRoot(workspacePath: string): Promise<string> {
  if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
    throw new PathOutsideProjectError('Доступ запрещён: путь к рабочему дереву не задан');
  }
  const projects = await projectRegistry.getProjects();
  const roots = projects.map((p) => p.path);
  if (isRegisteredProjectRoot(roots, workspacePath)) return path.resolve(workspacePath);

  const owner = findOwningProject(roots, workspacePath);
  if (owner && isProjectWorktreeRoot(owner, workspacePath)) return path.resolve(workspacePath);

  throw new PathOutsideProjectError(
    `Доступ запрещён: "${workspacePath}" не является ни корнем проекта, ни его worktree`
  );
}
