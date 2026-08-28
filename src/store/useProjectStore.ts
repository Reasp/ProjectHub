import { create } from 'zustand';
import type { ProjectInfo, BacklogTask, GitCommit } from '../types/electron';

interface ProjectState {
  projects: ProjectInfo[];
  selectedProject: ProjectInfo | null;
  tasks: BacklogTask[];
  gitLogs: GitCommit[];
  activeTab: 'kanban' | 'git' | 'prs' | 'docs' | 'processes';
  isLoading: boolean;
  searchQuery: string;
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
  toggleTerminal: () => void;
  addTerminalLog: (log: string) => void;

  // Async Thunks
  fetchProjects: () => Promise<void>;
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
  searchQuery: '',
  isTerminalOpen: false,
  terminalLogs: ['[ProjectHub] Система инициализирована.', '[ProjectHub] Готов к работе.'],

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
  toggleTerminal: () => set((s) => ({ isTerminalOpen: !s.isTerminalOpen })),
  addTerminalLog: (log) => set((s) => ({ terminalLogs: [...s.terminalLogs, log] })),

  fetchProjects: async () => {
    set({ isLoading: true });
    try {
      if (window.api) {
        const list = await window.api.scanProjects();
        set({ projects: list });
        if (!get().selectedProject && list.length > 0) {
          get().selectProject(list[0]);
        }
      }
    } catch (e) {
      console.error('Failed to scan projects:', e);
    } finally {
      set({ isLoading: false });
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
