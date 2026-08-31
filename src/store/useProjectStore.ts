import { create } from 'zustand';
import type {
  ProjectInfo,
  BacklogTask,
  GitCommit,
  GitRepoDetails,
  ScanOptions,
  TaskCriterion,
  ManagedProcess,
  PullRequest,
  PRCreateOptions,
  PRProviderInfo,
  DocItem,
  CreateDocParams,
  Milestone,
  CreateMilestoneParams,
  PtySession
} from '../types/electron';

interface ProjectState {
  projects: ProjectInfo[];
  selectedProject: ProjectInfo | null;
  tasks: BacklogTask[];
  gitLogs: GitCommit[];
  gitRepoDetails: GitRepoDetails | null;
  gitSelectedFile: string | null;
  gitDiffContent: string;
  activeTab: 'kanban' | 'milestones' | 'git' | 'prs' | 'docs' | 'analytics' | 'processes';
  taskViewMode: 'kanban' | 'list';
  selectedLabelFilter: string | null;
  selectedMilestoneFilter: string | null;
  isLoading: boolean;
  isScanning: boolean;
  searchQuery: string;
  filterOnlyFavorites: boolean;
  scanRoots: string[];
  isTerminalOpen: boolean;
  terminalLogs: string[];
  processes: ManagedProcess[];
  activeProcessId: string | null;
  terminalHeight: number;
  isHotkeysHelpOpen: boolean;

  // Interactive PTY State (Claude Code & Multi-tab Terminals)
  ptySessions: PtySession[];
  activePtySessionId: string | null;
  terminalMode: 'pty' | 'process_logs';

  // PR State
  prs: PullRequest[];
  selectedPR: PullRequest | null;
  prDiffContent: string;
  prFilter: 'all' | 'open' | 'closed' | 'merged';
  isLoadingPRs: boolean;
  prProviderInfo: PRProviderInfo | null;

  // Docs & ADR State
  docsList: DocItem[];
  selectedDoc: DocItem | null;
  docContent: string;
  isDocLoading: boolean;
  isDocSaving: boolean;
  isDocDirty: boolean;

  // Docs & ADR Actions
  fetchDocs: (projectPath: string) => Promise<void>;
  selectDoc: (doc: DocItem | null) => Promise<void>;
  setDocContent: (content: string) => void;
  saveDocAction: () => Promise<boolean>;
  createDocAction: (params: CreateDocParams) => Promise<DocItem | null>;

  // Milestones State
  milestones: Milestone[];
  isLoadingMilestones: boolean;

  // Milestones Actions
  fetchMilestones: (projectPath: string) => Promise<void>;
  setSelectedMilestoneFilter: (milestoneId: string | null) => void;
  createMilestoneAction: (params: CreateMilestoneParams) => Promise<Milestone | null>;
  saveMilestoneAction: (filePath: string, params: Partial<CreateMilestoneParams>) => Promise<boolean>;
  deleteMilestoneAction: (filePath: string) => Promise<boolean>;

  // Actions
  setProjects: (projects: ProjectInfo[]) => void;
  selectProject: (project: ProjectInfo | null) => void;
  setTasks: (tasks: BacklogTask[]) => void;
  setGitLogs: (logs: GitCommit[]) => void;
  setActiveTab: (tab: 'kanban' | 'milestones' | 'git' | 'prs' | 'docs' | 'analytics' | 'processes') => void;
  setTaskViewMode: (mode: 'kanban' | 'list') => void;
  setSelectedLabelFilter: (label: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setSearchQuery: (query: string) => void;
  setFilterOnlyFavorites: (onlyFavs: boolean) => void;
  setTerminalOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setHotkeysHelpOpen: (open: boolean) => void;
  setActiveProcessId: (id: string | null) => void;
  setTerminalHeight: (h: number) => void;
  addTerminalLog: (log: string) => void;
  clearTerminalLogs: () => void;

  // PR Actions
  fetchPRs: (projectPath: string, state?: 'all' | 'open' | 'closed' | 'merged') => Promise<void>;
  fetchPRProviderInfo: (projectPath: string) => Promise<void>;
  selectPR: (pr: PullRequest | null) => Promise<void>;
  setPRFilter: (filter: 'all' | 'open' | 'closed' | 'merged') => void;
  createPRAction: (options: PRCreateOptions) => Promise<PullRequest | null>;

  // Process Actions
  fetchProcesses: (projectPath: string) => Promise<void>;
  startProcessAction: (command: string, name: string) => Promise<ManagedProcess | null>;
  stopProcessAction: (processId: string) => Promise<boolean>;

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
  saveFullTaskLocal: (updatedTask: BacklogTask) => Promise<void>;
  deleteTaskLocal: (filePath: string) => Promise<void>;
  toggleCriterionLocal: (filePath: string, index: number, completed: boolean) => Promise<void>;

  // PTY Terminal Actions
  fetchPtySessions: () => Promise<void>;
  createPtySessionAction: (projectPath: string, type: 'claude' | 'shell', title?: string) => Promise<PtySession | null>;
  closePtySessionAction: (sessionId: string) => Promise<boolean>;
  setActivePtySessionId: (id: string | null) => void;
  setTerminalMode: (mode: 'pty' | 'process_logs') => void;

  // Git Advanced Actions
  loadGitRepoDetails: (project: ProjectInfo) => Promise<void>;
  gitCheckoutBranch: (branchName: string, createNew?: boolean) => Promise<boolean>;
  gitCreateBranch: (branchName: string) => Promise<boolean>;
  gitStageFile: (filePath: string) => Promise<boolean>;
  gitUnstageFile: (filePath: string) => Promise<boolean>;
  gitStageAll: () => Promise<boolean>;
  gitCommit: (message: string, stageAll?: boolean) => Promise<boolean>;
  gitLoadFileDiff: (filePath: string, staged?: boolean) => Promise<void>;
  setGitSelectedFile: (filePath: string | null) => void;
}


let watcherCleanup: (() => void) | null = null;
let processStatusCleanup: (() => void) | null = null;
let gitChangedCleanup: (() => void) | null = null;
let ptyExitCleanup: (() => void) | null = null;

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  selectedProject: null,
  tasks: [],
  gitLogs: [],
  gitRepoDetails: null,
  gitSelectedFile: null,
  gitDiffContent: '',
  activeTab: 'kanban',
  taskViewMode: 'kanban',
  selectedLabelFilter: null,
  isLoading: false,
  isScanning: false,
  searchQuery: '',
  filterOnlyFavorites: false,
  scanRoots: [],
  isTerminalOpen: false,
  terminalLogs: ['[ProjectHub] Система инициализирована.', '[ProjectHub] Реестр проектов загружен.'],
  processes: [],
  activeProcessId: null,
  terminalHeight: 220,
  isHotkeysHelpOpen: false,

  prs: [],
  selectedPR: null,
  prDiffContent: '',
  prFilter: 'open',
  isLoadingPRs: false,
  prProviderInfo: null,

  docsList: [],
  selectedDoc: null,
  docContent: '',
  isDocLoading: false,
  isDocSaving: false,
  isDocDirty: false,

  milestones: [],
  selectedMilestoneFilter: null,
  isLoadingMilestones: false,

  setSelectedMilestoneFilter: (selectedMilestoneFilter) => set({ selectedMilestoneFilter }),

  setProjects: (projects) => set({ projects }),
  selectProject: (selectedProject) => {
    set({ selectedProject, selectedMilestoneFilter: null });
    if (selectedProject) {
      get().loadProjectData(selectedProject);
      get().fetchProcesses(selectedProject.path);
      get().fetchDocs(selectedProject.path);
      get().fetchMilestones(selectedProject.path);
    }
  },
  setTasks: (tasks) => set({ tasks }),
  setGitLogs: (gitLogs) => set({ gitLogs }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setTaskViewMode: (taskViewMode) => set({ taskViewMode }),
  setSelectedLabelFilter: (selectedLabelFilter) => set({ selectedLabelFilter }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setFilterOnlyFavorites: (filterOnlyFavorites) => set({ filterOnlyFavorites }),
  setTerminalOpen: (isTerminalOpen) => set({ isTerminalOpen }),
  toggleTerminal: () => set((s) => ({ isTerminalOpen: !s.isTerminalOpen })),
  setHotkeysHelpOpen: (isHotkeysHelpOpen) => set({ isHotkeysHelpOpen }),
  setActiveProcessId: (activeProcessId) => set({ activeProcessId }),
  setTerminalHeight: (terminalHeight) => set({ terminalHeight }),
  addTerminalLog: (log) => set((s) => ({ terminalLogs: [...s.terminalLogs, log] })),
  clearTerminalLogs: () => set({ terminalLogs: [] }),

  ptySessions: [],
  activePtySessionId: null,
  terminalMode: 'pty',

  setActivePtySessionId: (activePtySessionId) => set({ activePtySessionId }),
  setTerminalMode: (terminalMode) => set({ terminalMode }),

  fetchPtySessions: async () => {
    if (!window.api?.listPtySessions) return;
    try {
      const list = await window.api.listPtySessions();
      set({ ptySessions: list });
      if (!get().activePtySessionId && list.length > 0) {
        set({ activePtySessionId: list[0].id });
      }
    } catch (e) {
      console.error('Failed to fetch PTY sessions:', e);
    }
  },

  createPtySessionAction: async (projectPath: string, type: 'claude' | 'shell', title?: string) => {
    if (!window.api?.createPtySession) return null;
    try {
      set({ isTerminalOpen: true, terminalMode: 'pty' });
      const session = await window.api.createPtySession({
        projectPath,
        type,
        title
      });
      if (session) {
        set((state) => ({
          ptySessions: [...state.ptySessions.filter((s) => s.id !== session.id), session],
          activePtySessionId: session.id
        }));
        get().addTerminalLog(`[Terminal] Создана интерактивная сессия: ${session.title}`);

        // Setup onPtyExit listener once
        if (!ptyExitCleanup && window.api.onPtyExit) {
          ptyExitCleanup = window.api.onPtyExit(({ sessionId, exitCode }) => {
            set((state) => ({
              ptySessions: state.ptySessions.map((s) =>
                s.id === sessionId ? { ...s, status: 'exited', exitCode } : s
              )
            }));
          });
        }

        return session;
      }
      return null;
    } catch (err: any) {
      console.error('Failed to create PTY session:', err);
      get().addTerminalLog(`[Terminal Error] Ошибка запуска: ${err.message}`);
      return null;
    }
  },

  closePtySessionAction: async (sessionId: string) => {
    if (!window.api?.killPty) return false;
    try {
      const ok = await window.api.killPty(sessionId);
      set((state) => {
        const remaining = state.ptySessions.filter((s) => s.id !== sessionId);
        let nextActive = state.activePtySessionId;
        if (state.activePtySessionId === sessionId) {
          nextActive = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
        }
        return {
          ptySessions: remaining,
          activePtySessionId: nextActive
        };
      });
      return ok;
    } catch (e) {
      console.error('Failed to close PTY session:', e);
      return false;
    }
  },

  fetchProcesses: async (projectPath: string) => {
    if (window.api) {
      try {
        const procs = await window.api.listProcesses(projectPath);
        set({ processes: procs });
        if (!get().activeProcessId && procs.length > 0) {
          set({ activeProcessId: procs[0].id });
        }
      } catch (e) {
        console.error('Failed to fetch processes:', e);
      }
    }
  },

  startProcessAction: async (command: string, name: string) => {
    const curProject = get().selectedProject;
    if (!curProject || !window.api) return null;

    try {
      set({ isTerminalOpen: true });
      const proc = await window.api.startProcess(curProject.path, command, name);
      set((state) => ({
        processes: [...state.processes.filter((p) => p.id !== proc.id), proc],
        activeProcessId: proc.id
      }));
      get().addTerminalLog(`[Process] Запущен процесс: ${name} (${command})`);
      return proc;
    } catch (e: any) {
      console.error(`Failed to start process ${name}:`, e);
      get().addTerminalLog(`[Process Error] Не удалось запустить ${name}: ${e.message}`);
      return null;
    }
  },

  stopProcessAction: async (processId: string) => {
    if (!window.api) return false;
    try {
      const ok = await window.api.stopProcess(processId);
      if (ok) {
        set((state) => ({
          processes: state.processes.map((p) =>
            p.id === processId ? { ...p, status: 'stopped' } : p
          )
        }));
        get().addTerminalLog(`[Process] Процесс остановлен: ${processId}`);
      }
      return ok;
    } catch (e) {
      console.error('Failed to stop process:', e);
      return false;
    }
  },

  fetchProjects: async () => {
    set({ isLoading: true });
    try {
      if (window.api) {
        let list = await window.api.listProjects();
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
        // Setup chokidar watcher listener if not setup
        if (!watcherCleanup) {
          watcherCleanup = window.api.onTasksChanged(async (data) => {
            const curProject = get().selectedProject;
            if (curProject && curProject.path.toLowerCase() === data.projectPath.toLowerCase()) {
              const freshTasks = await window.api.getTasks(curProject.path);
              set({ tasks: freshTasks });
              get().addTerminalLog(`[Backlog] Автосинхронизация задач: событие ${data.event} (${data.filePath})`);
            }
          });
        }

        if (!processStatusCleanup) {
          processStatusCleanup = window.api.onProcessStatusChanged((proc) => {
            set((state) => ({
              processes: state.processes.map((p) => (p.id === proc.id ? proc : p))
            }));
          });
        }

        // Setup git:changed watcher for real-time updates
        if (gitChangedCleanup) {
          gitChangedCleanup();
          gitChangedCleanup = null;
        }
        if (window.api.onGitChanged) {
          gitChangedCleanup = window.api.onGitChanged(async (data) => {
            const curProject = get().selectedProject;
            if (curProject && curProject.path.toLowerCase() === data.projectPath.toLowerCase()) {
              await get().loadGitRepoDetails(curProject);
            }
          });
        }

        const [tasks, logs] = await Promise.all([
          window.api.getTasks(project.path),
          window.api.getGitLog(project.path, 25)
        ]);
        set({ tasks, gitLogs: logs });

        // Load milestones and git details
        get().fetchMilestones(project.path);
        if (project.hasGit) {
          get().loadGitRepoDetails(project);
        }
      }
    } catch (e) {
      console.error('Failed to load project data:', e);
    }
  },

  updateTaskStatusLocal: async (taskId: string, newStatus: BacklogTask['status']) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task || !window.api) return;

    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
    }));

    try {
      const ok = await window.api.updateTaskStatus(task.filePath, newStatus);
      if (!ok) {
        if (get().selectedProject) {
          get().loadProjectData(get().selectedProject!);
        }
      } else {
        get().addTerminalLog(`[Backlog] Статус задачи ${task.id} изменен на "${newStatus}"`);
        if (get().selectedProject) {
          get().fetchMilestones(get().selectedProject!.path);
        }
      }
    } catch (e) {
      console.error('Failed to update task status:', e);
    }
  },

  saveFullTaskLocal: async (updatedTask: BacklogTask) => {
    if (!window.api) return;
    try {
      const ok = await window.api.saveFullTask(updatedTask.filePath, {
        title: updatedTask.title,
        status: updatedTask.status,
        labels: updatedTask.labels,
        milestone: updatedTask.milestone,
        description: updatedTask.description || '',
        criteria: updatedTask.acceptanceCriteria
      });

      if (ok) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t))
        }));
        get().addTerminalLog(`[Backlog] Задача ${updatedTask.id} успешно сохранена.`);
        if (get().selectedProject) {
          get().fetchMilestones(get().selectedProject!.path);
        }
      }
    } catch (e) {
      console.error('Failed to save full task:', e);
    }
  },

  deleteTaskLocal: async (filePath: string) => {
    if (!window.api) return;
    try {
      const ok = await window.api.deleteTask(filePath);
      if (ok) {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.filePath !== filePath)
        }));
        get().addTerminalLog(`[Backlog] Задача удалена: ${filePath}`);
      }
    } catch (e) {
      console.error('Failed to delete task:', e);
    }
  },

  toggleCriterionLocal: async (filePath: string, index: number, completed: boolean) => {
    if (!window.api) return;
    try {
      await window.api.toggleCriterion(filePath, index, completed);
      set((state) => ({
        tasks: state.tasks.map((t) => {
          if (t.filePath === filePath && t.acceptanceCriteria) {
            const updatedCriteria = [...t.acceptanceCriteria];
            if (updatedCriteria[index]) {
              updatedCriteria[index] = { ...updatedCriteria[index], completed };
            }
            return { ...t, acceptanceCriteria: updatedCriteria };
          }
          return t;
        })
      }));
    } catch (e) {
      console.error('Failed to toggle criterion:', e);
    }
  },

  // ─── Git Advanced Actions ─────────────────────────────────────────────────

  loadGitRepoDetails: async (project: ProjectInfo) => {
    if (!window.api || !project.hasGit) return;
    try {
      const details = await window.api.getGitRepoDetails(project.path);
      set({ gitRepoDetails: details });
    } catch (e) {
      console.error('Failed to load git repo details:', e);
    }
  },

  gitCheckoutBranch: async (branchName: string, createNew = false) => {
    const project = get().selectedProject;
    if (!window.api || !project) return false;
    try {
      const ok = await window.api.checkoutBranch(project.path, branchName, createNew);
      if (ok) {
        get().addTerminalLog(`[Git] Переключено на ветку: ${branchName}`);
        await get().loadGitRepoDetails(project);
      }
      return ok;
    } catch (e) {
      console.error('Failed to checkout branch:', e);
      return false;
    }
  },

  gitCreateBranch: async (branchName: string) => {
    const project = get().selectedProject;
    if (!window.api || !project) return false;
    try {
      const ok = await window.api.createBranch(project.path, branchName);
      if (ok) {
        get().addTerminalLog(`[Git] Создана и переключена ветка: ${branchName}`);
        await get().loadGitRepoDetails(project);
      }
      return ok;
    } catch (e) {
      console.error('Failed to create branch:', e);
      return false;
    }
  },

  gitStageFile: async (filePath: string) => {
    const project = get().selectedProject;
    if (!window.api || !project) return false;
    try {
      const ok = await window.api.stageFile(project.path, filePath);
      if (ok) await get().loadGitRepoDetails(project);
      return ok;
    } catch (e) {
      console.error('Failed to stage file:', e);
      return false;
    }
  },

  gitUnstageFile: async (filePath: string) => {
    const project = get().selectedProject;
    if (!window.api || !project) return false;
    try {
      const ok = await window.api.unstageFile(project.path, filePath);
      if (ok) await get().loadGitRepoDetails(project);
      return ok;
    } catch (e) {
      console.error('Failed to unstage file:', e);
      return false;
    }
  },

  gitStageAll: async () => {
    const project = get().selectedProject;
    if (!window.api || !project) return false;
    try {
      const ok = await window.api.stageAll(project.path);
      if (ok) await get().loadGitRepoDetails(project);
      return ok;
    } catch (e) {
      console.error('Failed to stage all:', e);
      return false;
    }
  },

  gitCommit: async (message: string, stageAll = false) => {
    const project = get().selectedProject;
    if (!window.api || !project) return false;
    try {
      const ok = await window.api.commitChanges(project.path, message, stageAll);
      if (ok) {
        get().addTerminalLog(`[Git] Коммит создан: "${message}"`);
        const [logs, _] = await Promise.all([
          window.api.getGitLog(project.path, 25),
          get().loadGitRepoDetails(project)
        ]);
        set({ gitLogs: logs, gitDiffContent: '', gitSelectedFile: null });
      }
      return ok;
    } catch (e) {
      console.error('Failed to commit:', e);
      return false;
    }
  },

  gitLoadFileDiff: async (filePath: string, staged = false) => {
    const project = get().selectedProject;
    if (!window.api || !project) return;
    try {
      set({ gitSelectedFile: filePath });
      const diff = await window.api.getFileDiff(project.path, filePath, staged);
      set({ gitDiffContent: diff });
    } catch (e) {
      console.error('Failed to load file diff:', e);
      set({ gitDiffContent: '' });
    }
  },

  setGitSelectedFile: (filePath: string | null) => {
    set({ gitSelectedFile: filePath, gitDiffContent: '' });
  },

  // ─── PR Actions ───────────────────────────────────────────────────────────

  fetchPRProviderInfo: async (projectPath: string) => {
    if (!window.api) return;
    try {
      const info = await window.api.getPRProviderInfo(projectPath);
      set({ prProviderInfo: info });
    } catch (e) {
      console.error('Failed to get PR provider info:', e);
      set({ prProviderInfo: null });
    }
  },

  fetchPRs: async (projectPath: string, state?: 'all' | 'open' | 'closed' | 'merged') => {
    if (!window.api) return;
    const filter = state || get().prFilter;
    set({ isLoadingPRs: true });
    try {
      await get().fetchPRProviderInfo(projectPath);
      const prList = await window.api.listPullRequests(projectPath, filter);
      set({ prs: prList });
      if (!get().selectedPR && prList.length > 0) {
        get().selectPR(prList[0]);
      } else if (get().selectedPR) {
        const stillExists = prList.find((p) => p.number === get().selectedPR?.number);
        if (stillExists) {
          set({ selectedPR: stillExists });
        } else if (prList.length > 0) {
          get().selectPR(prList[0]);
        } else {
          set({ selectedPR: null, prDiffContent: '' });
        }
      }
    } catch (e) {
      console.error('Failed to fetch PRs:', e);
      set({ prs: [] });
    } finally {
      set({ isLoadingPRs: false });
    }
  },

  selectPR: async (pr: PullRequest | null) => {
    set({ selectedPR: pr, prDiffContent: '' });
    const project = get().selectedProject;
    if (!window.api || !project || !pr) return;
    try {
      const diff = await window.api.getPRDiff(project.path, pr.number);
      set({ prDiffContent: diff });
    } catch (e) {
      console.error(`Failed to load diff for PR #${pr.number}:`, e);
      set({ prDiffContent: '' });
    }
  },

  setPRFilter: (filter: 'all' | 'open' | 'closed' | 'merged') => {
    set({ prFilter: filter });
    const project = get().selectedProject;
    if (project) {
      get().fetchPRs(project.path, filter);
    }
  },

  createPRAction: async (options: PRCreateOptions) => {
    const project = get().selectedProject;
    if (!window.api || !project) return null;
    try {
      const created = await window.api.createPullRequest(project.path, options);
      if (created) {
        get().addTerminalLog(`[PR] Pull Request #${created.number} успешно создан: ${created.title}`);
        await get().fetchPRs(project.path, get().prFilter);
        get().selectPR(created);
        // Reload tasks in case Backlog task status was transitioned to Review
        await get().loadProjectData(project);
      }
      return created;
    } catch (err: any) {
      console.error('Failed to create PR:', err);
      get().addTerminalLog(`[PR Error] Ошибка создания PR: ${err.message}`);
      throw err;
    }
  },

  // ─── Docs & ADR Actions ───────────────────────────────────────────────────

  fetchDocs: async (projectPath: string) => {
    if (!window.api) return;
    set({ isDocLoading: true });
    try {
      const list = await window.api.listDocs(projectPath);
      set({ docsList: list });
      if (!get().selectedDoc && list.length > 0) {
        get().selectDoc(list[0]);
      } else if (get().selectedDoc) {
        const stillExists = list.find((d) => d.filePath === get().selectedDoc?.filePath);
        if (stillExists) {
          set({ selectedDoc: stillExists });
        } else if (list.length > 0) {
          get().selectDoc(list[0]);
        } else {
          set({ selectedDoc: null, docContent: '' });
        }
      }
    } catch (e) {
      console.error('Failed to fetch docs:', e);
      set({ docsList: [] });
    } finally {
      set({ isDocLoading: false });
    }
  },

  selectDoc: async (doc: DocItem | null) => {
    set({ selectedDoc: doc, isDocDirty: false });
    if (!doc || !window.api) {
      set({ docContent: '' });
      return;
    }
    set({ isDocLoading: true });
    try {
      const content = await window.api.readDoc(doc.filePath);
      set({ docContent: content, isDocDirty: false });
    } catch (e) {
      console.error('Failed to read doc content:', e);
      set({ docContent: 'Не удалось загрузить содержимое документа.' });
    } finally {
      set({ isDocLoading: false });
    }
  },

  setDocContent: (content: string) => {
    set({ docContent: content, isDocDirty: true });
  },

  saveDocAction: async () => {
    const doc = get().selectedDoc;
    if (!doc || !window.api) return false;
    set({ isDocSaving: true });
    try {
      const ok = await window.api.saveDoc(doc.filePath, get().docContent);
      if (ok) {
        set({ isDocDirty: false });
        get().addTerminalLog(`[Docs] Документ сохранен: ${doc.fileRelative}`);
        if (get().selectedProject) {
          await get().fetchDocs(get().selectedProject!.path);
        }
      }
      return ok;
    } catch (e) {
      console.error('Failed to save doc:', e);
      return false;
    } finally {
      set({ isDocSaving: false });
    }
  },

  createDocAction: async (params: CreateDocParams) => {
    const project = get().selectedProject;
    if (!project || !window.api) return null;
    try {
      const created = await window.api.createDoc(project.path, params);
      if (created) {
        get().addTerminalLog(`[Docs] Создан ${created.category === 'decision' ? 'ADR' : 'документ'}: ${created.fileRelative}`);
        await get().fetchDocs(project.path);
        await get().selectDoc(created);
      }
      return created;
    } catch (e: any) {
      console.error('Failed to create doc:', e);
      get().addTerminalLog(`[Docs Error] Ошибка создания: ${e.message}`);
      return null;
    }
  },

  // ─── Milestones Actions ───────────────────────────────────────────────────

  fetchMilestones: async (projectPath: string) => {
    if (!window.api) return;
    set({ isLoadingMilestones: true });
    try {
      const milestones = await window.api.listMilestones(projectPath);
      set({ milestones: milestones || [] });
    } catch (e) {
      console.error('Failed to fetch milestones:', e);
      set({ milestones: [] });
    } finally {
      set({ isLoadingMilestones: false });
    }
  },

  createMilestoneAction: async (params: CreateMilestoneParams) => {
    const project = get().selectedProject;
    if (!project || !window.api) return null;
    try {
      const created = await window.api.createMilestone(project.path, params);
      if (created) {
        get().addTerminalLog(`[Milestones] Создан майлстоун: ${created.title} (${created.id})`);
        await get().fetchMilestones(project.path);
      }
      return created;
    } catch (e: any) {
      console.error('Failed to create milestone:', e);
      get().addTerminalLog(`[Milestones Error] Ошибка создания: ${e.message}`);
      return null;
    }
  },

  saveMilestoneAction: async (filePath: string, params: Partial<CreateMilestoneParams>) => {
    const project = get().selectedProject;
    if (!project || !window.api) return false;
    try {
      const ok = await window.api.saveMilestone(filePath, params);
      if (ok) {
        get().addTerminalLog(`[Milestones] Майлстоун обновлен.`);
        await get().fetchMilestones(project.path);
      }
      return ok;
    } catch (e: any) {
      console.error('Failed to save milestone:', e);
      return false;
    }
  },

  deleteMilestoneAction: async (filePath: string) => {
    const project = get().selectedProject;
    if (!project || !window.api) return false;
    try {
      const ok = await window.api.deleteMilestone(filePath);
      if (ok) {
        get().addTerminalLog(`[Milestones] Майлстоун удален.`);
        await get().fetchMilestones(project.path);
      }
      return ok;
    } catch (e: any) {
      console.error('Failed to delete milestone:', e);
      return false;
    }
  }
}));



