import { ipcMain } from 'electron';
import { loadRoles, saveRole, deleteRole, copyRoleToProject } from '../services/roleService';
import { assertRegisteredProject } from '../services/projectPathGuard';
import type { RoleDefinition } from '../services/roleTypes';

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
}
