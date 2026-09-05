import path from 'node:path';
import { projectRegistry } from './projectRegistry';
import { findOwningProject, isRegisteredProjectRoot, PathOutsideProjectError } from './pathGuard';

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
