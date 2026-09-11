import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { actionConfigService } from './actionConfigService';
import { processManager } from './processManager';
import { logger } from './logger';
import type { ManagedProcess } from '../../src/types/electron';

/**
 * Политика `worktreeInit` из `.projecthub.json` (TASK-62, decision-15).
 *
 * Новый worktree — это чистая копия дерева без того, что не лежит в git: `node_modules`,
 * `.env`, собранных артефактов. Политика описывает, как это восстановить: связать
 * `node_modules` с основным деревом (symlink/junction) и/или выполнить команды вроде
 * `npm ci`. Команды запускаются через `processManager`, поэтому их логи видны во вкладке
 * Processes и в терминале, как у обычного действия.
 */

export interface WorktreeInitResult {
  /** Была ли политика вообще задана и что-то сделано. */
  ran: boolean;
  /** Удалось ли связать `node_modules` с основным деревом. */
  linkedNodeModules?: boolean;
  /** Запущенный процесс инициализации (если в политике есть команды). */
  process?: ManagedProcess;
  /** Выполняемые команды — для лога в UI. */
  commands?: string[];
  error?: string;
}

/** Имя процесса инициализации: одно на worktree, чтобы повторный запуск не плодил дубликаты. */
export function worktreeInitProcessName(worktreePath: string): string {
  return `worktree-init: ${path.basename(path.normalize(worktreePath))}`;
}

/**
 * Связывает `node_modules` worktree с основным деревом. На Windows используется `junction`
 * (не требует прав администратора), на остальных ОС — символическая ссылка на каталог.
 * Возвращает false, если связывать нечего или ссылка уже есть.
 */
export async function linkNodeModules(projectPath: string, worktreePath: string): Promise<boolean> {
  const source = path.join(projectPath, 'node_modules');
  const target = path.join(worktreePath, 'node_modules');
  if (!existsSync(source) || existsSync(target)) return false;
  try {
    await fs.symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (err) {
    logger.warn(`[WorktreeInit] Не удалось связать node_modules для ${worktreePath}:`, err);
    return false;
  }
}

/**
 * Выполняет политику инициализации для нового worktree.
 * Ошибки не роняют создание worktree — worktree уже существует и пригоден к работе.
 */
export async function runWorktreeInit(projectPath: string, worktreePath: string): Promise<WorktreeInitResult> {
  let policy;
  try {
    const config = await actionConfigService.getConfig(projectPath);
    policy = config.worktreeInit;
  } catch (err) {
    return { ran: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!policy) return { ran: false };

  const result: WorktreeInitResult = { ran: false };

  if (policy.linkNodeModules) {
    result.linkedNodeModules = await linkNodeModules(projectPath, worktreePath);
    result.ran = result.ran || result.linkedNodeModules;
  }

  const commands = (policy.commands ?? []).map((c) => String(c).trim()).filter(Boolean);
  if (commands.length > 0) {
    result.commands = commands;
    // Последовательная цепочка: `&&` понимают и cmd.exe, и /bin/sh (resolveShellSpawn).
    const command = commands.join(' && ');
    try {
      result.process = await processManager.startProcess(
        projectPath,
        command,
        worktreeInitProcessName(worktreePath),
        { workspaceRoot: worktreePath }
      );
      result.ran = true;
      logger.info(`[WorktreeInit] ${worktreePath}: ${command}`);
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      logger.error(`[WorktreeInit] Не удалось запустить инициализацию ${worktreePath}:`, err);
    }
  }

  return result;
}
