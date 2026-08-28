import { create } from 'zustand';
import type { ProjectInfo, BacklogTask, GitCommit, ScanOptions } from '../types/electron';

interface ProjectState {
  projects: ProjectInfo[];
  selectedProject: ProjectInfo | null;
  tasks: BacklogTask[];
  gitLogs: GitCommit[];
  activeTab: 'kanban' | 'git' | 'prs' | 'docs' | 'processes';
  isLoading: boolean;
  isScanning: boolean;
  searchQuery: string;
  filterOnlyFavorites: boolean;
  scanRoots: string[];
  isTerminalOpen: boolean;
  terminalLogs: string[];

  // Actions
  setProjects: (projects: ProjectInfo[]) => void;
  selectProject: (project: ProjectInfo | null) => void;
  setTasks: (tasks: BacklogTask[]) => void;
  setGitLogs: (logs: GitCommit[]) => void;
  setActiveTab: (tab: 'kanban' | 'git' | 'prs' | 'docs' | 'processes') => void;
  setIsLoading: (loading: boolean) => void;
  setSearchQuery: (query: string) => void;
  setFilterOnlyFavorites: (onlyFavs: boolean) => void;
  toggleTerminal: () => void;
  addTerminalLog: (log: string) => void;

  // Async Thunks
  fetchProjects: () => Promise<void>;
  fetchScanRoots: () => Promise<void>;
  saveScanRoots: (roots: string[]) => Promise<void>;
  scanProjectsWithProgress: (options?: ScanOptions) => Promise<ProjectInfo[]>;
  addProjectByPath: (folderPath: string) => Promise<ProjectInfo | null>;
  removeProjectFromCatalog: (projectPath: string) => Promise<void>;
  toggleFavoriteProject: (projectPath: string) => Promise<void>;
  refreshSingleProject: (projectPath: string) => Promise<void>;
  loadProjectData: (project: ProjectInfo) => Promise<void>;
  updateTaskStatusLocal: (taskId: string, newStatus: BacklogTask['status']) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  selectedProject: null,
  tasks: [],
  gitLogs: [],
  activeTab: 'kanban',
  isLoading: false,
  isScanning: false,
  searchQuery: '',
  filterOnlyFavorites: false,
  scanRoots: [],
  isTerminalOpen: false,
  terminalLogs: ['[ProjectHub] Система инициализирована.', '[ProjectHub] Реестр проектов загружен.'],

  setProjects: (projects) => set({ projects }),
  selectProject: (selectedProject) => {
    set({ selectedProject });
    if (selectedProject) {
      get().loadProjectData(selectedProject);
    }
  },
  setTasks: (tasks) => set({ tasks }),
  setGitLogs: (gitLogs) => set({ gitLogs }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setFilterOnlyFavorites: (filterOnlyFavorites) => set({ filterOnlyFavorites }),
  toggleTerminal: () => set((s) => ({ isTerminalOpen: !s.isTerminalOpen })),
  addTerminalLog: (log) => set((s) => ({ terminalLogs: [...s.terminalLogs, log] })),

  fetchProjects: async () => {
    set({ isLoading: true });
    try {
      if (window.api) {
        let list = await window.api.listProjects();
        // If empty, auto-run first scan
        if (list.length === 0) {
          list = await window.api.scanProjects();
        }
        set({ projects: list });
        if (!get().selectedProject && list.length > 0) {
          get().selectProject(list[0]);
        }
      }
    } catch (e) {
      console.error('Failed to fetch projects from registry:', e);
    } finally {
      set({ isLoading: false });
    }
  },

  fetchScanRoots: async () => {
    if (window.api) {
      try {
        const roots = await window.api.getScanRoots();
        set({ scanRoots: roots });
      } catch (e) {
        console.error('Failed to fetch scan roots:', e);
      }
    }
  },

  saveScanRoots: async (roots: string[]) => {
    if (window.api) {
      try {
        await window.api.setScanRoots(roots);
        set({ scanRoots: roots });
      } catch (e) {
        console.error('Failed to save scan roots:', e);
      }
    }
  },

  scanProjectsWithProgress: async (options?: ScanOptions) => {
    set({ isScanning: true });
    try {
      if (window.api) {
        const discovered = await window.api.scanProjects(options);
        const list = await window.api.listProjects();
        set({ projects: list });
        if (!get().selectedProject && list.length > 0) {
          get().selectProject(list[0]);
        }
        get().addTerminalLog(`[ProjectHub] Сканирование завершено: найдено проектов ${discovered.length}.`);
        return discovered;
      }
      return [];
    } catch (e) {
      console.error('Failed to scan projects:', e);
      return [];
    } finally {
      set({ isScanning: false });
    }
  },

  addProjectByPath: async (folderPath: string) => {
    if (!window.api) return null;
    try {
      const added = await window.api.addProject(folderPath);
      if (added) {
        const list = await window.api.listProjects();
        set({ projects: list });
        get().selectProject(added);
        get().addTerminalLog(`[ProjectHub] Добавлен проект: ${added.name} (${added.path})`);
        return added;
      }
      return null;
    } catch (e) {
      console.error('Failed to add project:', e);
      return null;
    }
  },

  removeProjectFromCatalog: async (projectPath: string) => {
    if (!window.api) return;
    try {
      const ok = await window.api.removeProject(projectPath);
      if (ok) {
        const updated = get().projects.filter((p) => p.path !== projectPath);
        set({ projects: updated });
        if (get().selectedProject?.path === projectPath) {
          set({ selectedProject: updated.length > 0 ? updated[0] : null });
          if (updated.length > 0) {
            get().loadProjectData(updated[0]);
          }
        }
        get().addTerminalLog(`[ProjectHub] Проект удален из каталога: ${projectPath}`);
      }
    } catch (e) {
      console.error('Failed to remove project:', e);
    }
  },

  toggleFavoriteProject: async (projectPath: string) => {
    if (!window.api) return;
    try {
      const isFav = await window.api.toggleFavorite(projectPath);
      set((state) => ({
        projects: state.projects.map((p) =>
          p.path === projectPath ? { ...p, favorite: isFav } : p
        ),
        selectedProject:
          state.selectedProject?.path === projectPath
            ? { ...state.selectedProject, favorite: isFav }
            : state.selectedProject
      }));
    } catch (e) {
      console.error('Failed to toggle favorite:', e);
    }
  },

  refreshSingleProject: async (projectPath: string) => {
    if (!window.api) return;
    try {
      const fresh = await window.api.refreshProject(projectPath);
      if (fresh) {
        set((state) => ({
          projects: state.projects.map((p) => (p.path === projectPath ? fresh : p)),
          selectedProject:
            state.selectedProject?.path === projectPath ? fresh : state.selectedProject
        }));
        if (get().selectedProject?.path === projectPath) {
          get().loadProjectData(fresh);
        }
      }
    } catch (e) {
      console.error('Failed to refresh project:', e);
    }
  },

  loadProjectData: async (project: ProjectInfo) => {
    try {
      if (window.api) {
        const [tasks, logs] = await Promise.all([
          window.api.getTasks(project.path),
          window.api.getGitLog(project.path, 25)
        ]);
        set({ tasks, gitLogs: logs });
      }
    } catch (e) {
      console.error('Failed to load project data:', e);
    }
  },

  updateTaskStatusLocal: async (taskId: string, newStatus: BacklogTask['status']) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task || !window.api) return;

    // Optimistic UI update
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
    }));

    try {
      const ok = await window.api.updateTaskStatus(task.filePath, newStatus);
      if (!ok) {
        // Rollback if failed
        if (get().selectedProject) {
          get().loadProjectData(get().selectedProject!);
        }
      }
    } catch (e) {
      console.error('Failed to update task status:', e);
    }
  }
}));

