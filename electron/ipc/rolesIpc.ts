import { ipcMain } from 'electron';
import { loadRoles, saveRole, deleteRole, copyRoleToProject } from '../services/roleService';
import { assertRegisteredProject } from '../services/projectPathGuard';
import { applyRoleSync, planRoleSync, type RoleSyncChoices, type RoleSyncOptions } from '../services/roleSyncService';
import { EXPORT_TARGETS, type ExportTarget } from '../services/roleExport';
import { terminalHookService } from '../services/terminalHookService';
import { mcpServerService } from '../services/mcpServerService';
import type { RoleDefinition } from '../services/roleTypes';

/** Опции синхронизации из рендерера: только известные движки, тайм-аут хука — из настроек (TASK-77). */
async function syncOptions(raw: unknown): Promise<RoleSyncOptions> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { targets?: unknown; hooks?: unknown };
  const targets = Array.isArray(r.targets) ? EXPORT_TARGETS.filter((t) => (r.targets as unknown[]).includes(t)) : ['claude' as ExportTarget];
  const settings = await terminalHookService.getSettings();
  return { targets, hooks: r.hooks === true, hookTimeoutSec: settings.hookTimeoutSec };
}

function syncChoices(raw: unknown): RoleSyncChoices {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { overwrite?: unknown; deleteOrphans?: unknown };
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { overwrite: list(r.overwrite), deleteOrphans: list(r.deleteOrphans) };
}

/** Реестр ролей агентов (decision-9, TASK-60): global/project роли поверх builtin. */
export function registerRolesIpc() {
  ipcMain.handle('roles:list', async (_event, projectPath?: string) => {
    const safeProject = projectPath ? await assertRegisteredProject(projectPath) : undefined;
    return await loadRoles(safeProject);
  });

  ipcMain.handle('roles:save', async (_event, scope: 'global' | 'project', role: RoleDefinition, projectPath?: string) => {
    const safeProject = scope === 'project' ? await assertRegisteredProject(projectPath || '') : undefined;
    try {
      const filePath = await saveRole(scope, role, safeProject);
      return { success: true, filePath };
    } catch (err) {
      console.error('[RolesIpc] Failed to save role:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('roles:delete', async (_event, scope: 'global' | 'project', slug: string, projectPath?: string) => {
    const safeProject = scope === 'project' ? await assertRegisteredProject(projectPath || '') : undefined;
    return await deleteRole(scope, slug, safeProject);
  });

  ipcMain.handle('roles:copyToProject', async (_event, slug: string, projectPath: string) => {
    const safeProject = await assertRegisteredProject(projectPath);
    return await copyRoleToProject(slug, safeProject);
  });

  // ── Экспорт ролей в нативные субагенты и хуки терминала (TASK-77, decision-54) ──

  ipcMain.handle('roles:syncPlan', async (_event, projectPath: string, options: unknown) => {
    const safeProject = await assertRegisteredProject(projectPath);
    return await planRoleSync(safeProject, await syncOptions(options));
  });

  ipcMain.handle('roles:syncApply', async (_event, projectPath: string, options: unknown, choices: unknown) => {
    const safeProject = await assertRegisteredProject(projectPath);
    try {
      return { success: true, result: await applyRoleSync(safeProject, await syncOptions(options), syncChoices(choices)) };
    } catch (err) {
      console.error('[RolesIpc] Failed to sync roles:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('terminalHooks:getSettings', async () => terminalHookService.getSettings());

  ipcMain.handle('terminalHooks:saveSettings', async (_event, raw: unknown) => terminalHookService.saveSettings(raw));

  /** Адрес и токен хуков для внешнего терминала; поднимает встроенный сервер, если он не запущен. */
  ipcMain.handle('terminalHooks:getConnection', async () => {
    await mcpServerService.ensurePermissionEndpoint();
    const settings = await terminalHookService.getSettings();
    return { url: mcpServerService.getHookBaseUrl(), token: await terminalHookService.getToken(), failMode: settings.failMode };
  });

  ipcMain.handle('terminalHooks:regenerateToken', async () => {
    await terminalHookService.regenerateToken();
    return true;
  });
}
