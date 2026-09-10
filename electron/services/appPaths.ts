import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

/**
 * Единая точка вычисления путей приложения (TASK-43).
 *
 * В упакованном `ProjectHub.exe` `process.cwd()` произволен (или указывает в `Program Files`
 * без прав на запись), поэтому все служебные каталоги вычисляются от `app.getPath('userData')`,
 * домашнего каталога и `app.getAppPath()`. `process.cwd()` в `electron/` не используется.
 *
 * Все обращения к `app` защищены: модуль импортируется и из unit-тестов с частичным моком `electron`.
 */

function safeApp(): typeof app | null {
  return app && typeof app === 'object' ? app : null;
}

export function isPackagedApp(): boolean {
  const a = safeApp();
  return Boolean(a && (a as { isPackaged?: boolean }).isPackaged);
}

/** Каталог данных пользователя (Roaming/ProjectHub на Windows); при недоступности — ~/.projecthub. */
export function getUserDataDir(): string {
  const a = safeApp();
  try {
    if (a && typeof a.getPath === 'function') {
      const dir = a.getPath('userData');
      if (dir) return dir;
    }
  } catch {
    // ignore — ниже fallback
  }
  return path.join(os.homedir(), '.projecthub');
}

/** Домашний каталог пользователя. */
export function getHomeDir(): string {
  const a = safeApp();
  try {
    if (a && typeof a.getPath === 'function') {
      const dir = a.getPath('home');
      if (dir) return dir;
    }
  } catch {
    // ignore
  }
  return os.homedir();
}

/**
 * Корень приложения: в dev-режиме — корень репозитория ProjectHub (там лежит package.json),
 * в упакованном — каталог `app.asar`.
 */
export function getAppRootDir(): string {
  const a = safeApp();
  try {
    if (a && typeof a.getAppPath === 'function') {
      const dir = a.getAppPath();
      if (dir) return dir;
    }
  } catch {
    // ignore
  }
  // Fallback для окружений без electron.app: dist-electron/services -> корень репозитория
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/**
 * Корень репозитория ProjectHub в dev-режиме. В упакованном приложении возвращает null —
 * репозиторий разработчика не должен попадать в реестр или использоваться как источник шаблона.
 */
export function getDevRepoRoot(): string | null {
  if (isPackagedApp()) return null;
  const root = getAppRootDir();
  return existsSync(path.join(root, 'package.json')) ? root : null;
}

/** Единый кэш моделей (RAG-эмбеддинги и Whisper): userData/models. */
export function getModelsCacheDir(): string {
  return path.join(getUserDataDir(), 'models');
}

/** Глобальные роли агентов (decision-9, TASK-60): userData/roles/*.md. */
export function getRolesDir(): string {
  return path.join(getUserDataDir(), 'roles');
}

/** Проектные роли агентов (переопределяют глобальные по slug): <project>/.projecthub/roles/*.md. */
export function getProjectRolesDir(projectPath: string): string {
  return path.join(projectPath, '.projecthub', 'roles');
}

/** Каталог handoff-артефактов задачи (decision-9): <worktree>/.projecthub/handoff/*.md. */
export function getHandoffReportsDir(worktreePath: string): string {
  return path.join(worktreePath, '.projecthub', 'handoff');
}

/**
 * Устаревшие расположения кэша моделей (до TASK-43). При первом обращении содержимое
 * переносится в userData/models, чтобы не перекачивать сотни мегабайт.
 */
function getLegacyModelCacheDirs(): string[] {
  const dirs = [path.join(os.homedir(), '.cache', 'projecthub', 'whisper')];
  const devRoot = getDevRepoRoot();
  if (devRoot) dirs.push(path.join(devRoot, '.rag-cache'));
  return dirs;
}

let modelsDirReady: Promise<string> | null = null;

/**
 * Создаёт каталог кэша моделей и один раз (best-effort) переносит в него содержимое старых кэшей.
 * Ошибки переноса не критичны — модель просто будет скачана заново.
 */
export function ensureModelsCacheDir(): Promise<string> {
  if (!modelsDirReady) {
    modelsDirReady = (async () => {
      const target = getModelsCacheDir();
      await fs.mkdir(target, { recursive: true });
      for (const legacy of getLegacyModelCacheDirs()) {
        if (!existsSync(legacy) || path.resolve(legacy) === path.resolve(target)) continue;
        try {
          const entries = await fs.readdir(legacy);
          for (const entry of entries) {
            const from = path.join(legacy, entry);
            const to = path.join(target, entry);
            if (existsSync(to)) continue;
            try {
              await fs.rename(from, to);
            } catch {
              await fs.cp(from, to, { recursive: true, force: false, errorOnExist: false });
            }
          }
          console.log(`[AppPaths] Model cache migrated: ${legacy} -> ${target}`);
        } catch (err) {
          console.warn(`[AppPaths] Model cache migration from ${legacy} skipped:`, err);
        }
      }
      return target;
    })();
  }
  return modelsDirReady;
}

/** Каталог с фоновыми воркерами (whisperWorker.mjs) — кандидаты для dev и упакованной сборки. */
export function getWorkerScriptCandidates(fileName: string): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const appRoot = getAppRootDir();
  const candidates = [
    // dist-electron/main.js (бандл) -> dist-electron/workers/*
    path.join(here, 'workers', fileName),
    // dist-electron/services/*.js (если сборка без бандлинга) -> dist-electron/workers/*
    path.join(here, '..', 'workers', fileName),
    // от корня приложения (app.asar или репозиторий)
    path.join(appRoot, 'dist-electron', 'workers', fileName),
    path.join(appRoot, 'electron', 'workers', fileName)
  ];
  return Array.from(new Set(candidates.map((p) => path.normalize(p))));
}

/** Является ли путь корнем диска/файловой системы (`C:\`, `/`). */
export function isFilesystemRoot(p: string): boolean {
  const normalized = path.resolve(p);
  return path.parse(normalized).root === normalized;
}
