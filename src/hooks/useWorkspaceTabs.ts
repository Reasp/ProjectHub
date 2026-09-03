import { useState, useEffect, useCallback } from 'react';

export type WorkspaceTabId =
  | 'kanban'
  | 'milestones'
  | 'git'
  | 'files'
  | 'prs'
  | 'docs'
  | 'analytics'
  | 'ai'
  | 'claude-cli'
  | 'processes';

export interface TabConfigItem {
  id: WorkspaceTabId;
  visible: boolean;
}

export const ALL_WORKSPACE_TAB_IDS: WorkspaceTabId[] = [
  'kanban',
  'milestones',
  'git',
  'files',
  'prs',
  'docs',
  'analytics',
  'ai',
  'claude-cli',
  'processes'
];

export const DEFAULT_TABS_CONFIG: TabConfigItem[] = ALL_WORKSPACE_TAB_IDS.map((id) => ({
  id,
  visible: true
}));

const STORAGE_KEY = 'projecthub:workspace-tabs-config';

function loadStoredConfig(): TabConfigItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TABS_CONFIG;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_TABS_CONFIG;

    // Filter valid items from storage
    const validStored: TabConfigItem[] = [];
    const seen = new Set<WorkspaceTabId>();

    for (const item of parsed) {
      if (item && typeof item.id === 'string' && ALL_WORKSPACE_TAB_IDS.includes(item.id as WorkspaceTabId)) {
        const id = item.id as WorkspaceTabId;
        if (!seen.has(id)) {
          seen.add(id);
          validStored.push({
            id,
            visible: item.visible !== false
          });
        }
      }
    }

    // Append any newly added tabs that were not in stored config
    for (const defaultId of ALL_WORKSPACE_TAB_IDS) {
      if (!seen.has(defaultId)) {
        validStored.push({ id: defaultId, visible: true });
      }
    }

    // Ensure at least one tab is visible
    if (!validStored.some((t) => t.visible)) {
      validStored[0].visible = true;
    }

    return validStored;
  } catch {
    return DEFAULT_TABS_CONFIG;
  }
}

export function useWorkspaceTabs() {
  const [tabsConfig, setTabsConfig] = useState<TabConfigItem[]>(loadStoredConfig);

  const saveConfig = useCallback((newConfig: TabConfigItem[]) => {
    // Ensure at least one tab remains visible
    if (!newConfig.some((t) => t.visible)) {
      newConfig[0].visible = true;
    }
    setTabsConfig(newConfig);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
    } catch (e) {
      console.error('Failed to save tabs config:', e);
    }
  }, []);

  const toggleTabVisibility = useCallback(
    (id: WorkspaceTabId) => {
      const visibleCount = tabsConfig.filter((t) => t.visible).length;
      const target = tabsConfig.find((t) => t.id === id);

      // Cannot hide the only remaining visible tab
      if (target?.visible && visibleCount <= 1) {
        return;
      }

      const updated = tabsConfig.map((tab) =>
        tab.id === id ? { ...tab, visible: !tab.visible } : tab
      );
      saveConfig(updated);
    },
    [tabsConfig, saveConfig]
  );

  const reorderTabs = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= tabsConfig.length || toIndex >= tabsConfig.length) {
        return;
      }

      const updated = [...tabsConfig];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      saveConfig(updated);
    },
    [tabsConfig, saveConfig]
  );

  const moveTab = useCallback(
    (id: WorkspaceTabId, direction: 'up' | 'down') => {
      const idx = tabsConfig.findIndex((t) => t.id === id);
      if (idx === -1) return;

      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= tabsConfig.length) return;

      reorderTabs(idx, targetIdx);
    },
    [tabsConfig, reorderTabs]
  );

  const resetToDefault = useCallback(() => {
    saveConfig(DEFAULT_TABS_CONFIG);
  }, [saveConfig]);

  const showAllTabs = useCallback(() => {
    const updated = tabsConfig.map((tab) => ({ ...tab, visible: true }));
    saveConfig(updated);
  }, [tabsConfig, saveConfig]);

  const visibleTabs = tabsConfig.filter((t) => t.visible);
  const hiddenTabs = tabsConfig.filter((t) => !t.visible);

  return {
    tabsConfig,
    visibleTabs,
    hiddenTabs,
    toggleTabVisibility,
    reorderTabs,
    moveTab,
    resetToDefault,
    showAllTabs
  };
}
