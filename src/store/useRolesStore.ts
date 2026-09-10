import { create } from 'zustand';
import type { RoleDefinition } from '../types/electron';

interface RolesState {
  /** Роли по projectPath (''= без проекта, только global/builtin). */
  rolesByProject: Record<string, RoleDefinition[]>;
  isLoading: boolean;
  loadRolesAction: (projectPath?: string) => Promise<RoleDefinition[]>;
  saveRoleAction: (scope: 'global' | 'project', role: RoleDefinition, projectPath?: string) => Promise<{ success: boolean; error?: string }>;
  deleteRoleAction: (scope: 'global' | 'project', slug: string, projectPath?: string) => Promise<boolean>;
  copyRoleToProjectAction: (slug: string, projectPath: string) => Promise<RoleDefinition | null>;
}

function key(projectPath?: string): string {
  return projectPath || '';
}

export const useRolesStore = create<RolesState>((set, get) => ({
  rolesByProject: {},
  isLoading: false,

  loadRolesAction: async (projectPath?: string) => {
    if (!window.api?.listRoles) return [];
    try {
      set({ isLoading: true });
      const { roles } = await window.api.listRoles(projectPath);
      set((state) => ({
        rolesByProject: { ...state.rolesByProject, [key(projectPath)]: roles },
        isLoading: false
      }));
      return roles;
    } catch (err) {
      console.error('[RolesStore] Failed to load roles:', err);
      set({ isLoading: false });
      return get().rolesByProject[key(projectPath)] || [];
    }
  },

  saveRoleAction: async (scope, role, projectPath) => {
    if (!window.api?.saveRole) return { success: false, error: 'API not available' };
    try {
      const result = await window.api.saveRole(scope, role, projectPath);
      if (result.success) await get().loadRolesAction(projectPath);
      return result;
    } catch (err) {
      console.error('[RolesStore] Failed to save role:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  deleteRoleAction: async (scope, slug, projectPath) => {
    if (!window.api?.deleteRole) return false;
    try {
      const ok = await window.api.deleteRole(scope, slug, projectPath);
      if (ok) await get().loadRolesAction(projectPath);
      return ok;
    } catch (err) {
      console.error('[RolesStore] Failed to delete role:', err);
      return false;
    }
  },

  copyRoleToProjectAction: async (slug, projectPath) => {
    if (!window.api?.copyRoleToProject) return null;
    try {
      const role = await window.api.copyRoleToProject(slug, projectPath);
      if (role) await get().loadRolesAction(projectPath);
      return role;
    } catch (err) {
      console.error('[RolesStore] Failed to copy role to project:', err);
      return null;
    }
  }
}));
