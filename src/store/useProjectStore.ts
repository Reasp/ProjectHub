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
  PtySession,
  ProjectAgentStatus,
  ProjectActionConfig,
  ProjectActionKind,
  ActionDefinition,
  StartProcessOptions
} from '../types/electron';

/**
 * Процесс относится к действию из .projecthub.json, если он привязан к тому же проекту
 * и совпадает по имени действия либо по командной строке.
 */
export function isProcessOfAction(p: ManagedProcess, projectPath: string, def: ActionDefinition): boolean {
  return p.cwd === projectPath && (p.name === def.name || p.command === def.command);
}
import type { Language } from '../i18n';

export interface RunActionOptions {
  confirm?: (def: ActionDefinition) => boolean;
}

export interface ProjectCachedData {
  tasks: BacklogTask[];
  gitLogs: GitCommit[];
  gitRepoDetails: GitRepoDetails | null;
  docsList: DocItem[];
  milestones: Milestone[];
  processes: ManagedProcess[];
  lastLoadedAt: number;
}

/** Максимум строк системного лога в сторе (TASK-38): старые записи отбрасываются. */
export const MAX_TERMINAL_LOGS = 500;
/** Максимум проектов в in-memory кэше (TASK-38): при превышении вытесняется самый давно использованный. */
export const MAX_CACHED_PROJECTS = 10;

/**
 * Возвращает новый projectDataCache с записанным entry для projectPath и LRU-вытеснением
 * лишних проектов. В первую очередь вытесняются проекты, не открытые во вкладках; текущий
 * выбранный проект и только что записанный не вытесняются никогда.
 */
function putProjectCache(
  state: Pick<ProjectState, 'projectDataCache' | 'activeProjectPaths' | 'selectedProject'>,
  projectPath: string,
  entry: ProjectCachedData
): Record<string, ProjectCachedData> {
  const next: Record<string, ProjectCachedData> = { ...state.projectDataCache, [projectPath]: entry };
  const keys = Object.keys(next);
  if (keys.length <= MAX_CACHED_PROJECTS) return next;

  const active = new Set(state.activeProjectPaths);
  const protectedPaths = new Set([projectPath, state.selectedProject?.path].filter(Boolean) as string[]);
  const candidates = keys
    .filter((k) => !protectedPaths.has(k))
    .sort((a, b) => {
      const aActive = active.has(a) ? 1 : 0;
      const bActive = active.has(b) ? 1 : 0;
      if (aActive !== bActive) return aActive - bActive;
      return next[a].lastLoadedAt - next[b].lastLoadedAt;
    });
  let excess = keys.length - MAX_CACHED_PROJECTS;
  for (const k of candidates) {
    if (excess <= 0) break;
    delete next[k];
    excess--;
  }
  return next;
}

function dropProjectCache(cache: Record<string, ProjectCachedData>, projectPath: string): Record<string, ProjectCachedData> {
  if (!(projectPath in cache)) return cache;
  const { [projectPath]: _dropped, ...rest } = cache;
  return rest;
}

interface ProjectState {
  projects: ProjectInfo[];
  selectedProject: ProjectInfo | null;
  tasks: BacklogTask[];
  gitLogs: GitCommit[];
  gitRepoDetails: GitRepoDetails | null;
  gitSelectedFile: string | null;
  gitDiffContent: string;
  activeTab: 'kanban' | 'milestones' | 'git' | 'files' | 'prs' | 'docs' | 'analytics' | 'ai' | 'claude-cli' | 'processes';
  taskViewMode: 'kanban' | 'list';
  selectedLabelFilter: string | null;
  selectedMilestoneFilter: string | null;
  isLoading: boolean;
  isScanning: boolean;
  searchQuery: string;
  filterOnlyFavorites: boolean;

  // Multi-Project Session & In-Memory Cache
  projectDataCache: Record<string, ProjectCachedData>;
  activeProjectPaths: string[];
  lastSelectedProjectPath: string | null;
  filterOnlyActive: boolean;
  setFilterOnlyActive: (filterOnlyActive: boolean) => void;
  activateProject: (project: ProjectInfo) => void;
  deactivateProject: (projectPath: string) => void;
  toggleProjectActive: (project: ProjectInfo) => void;
  switchProjectByIndex: (index: number) => void;
  switchToNextProject: () => void;
  switchToPrevProject: () => void;
  switchToLastActiveProject: () => void;
  closeCurrentProject: () => void;
  setProjectVoiceAlias: (projectPath: string, alias: string) => Promise<boolean>;

  scanRoots: string[];
  isSidebarOpen: boolean;
  setSidebarOpen: (isSidebarOpen: boolean) => void;
  toggleSidebar: () => void;
  isTerminalOpen: boolean;
  terminalLogs: string[];
  processes: ManagedProcess[];
  activeProcessId: string | null;
  terminalHeight: number;
  isHotkeysHelpOpen: boolean;

  // Agent Statuses across all projects
  projectAgentStatuses: Record<string, ProjectAgentStatus>;
  fetchProjectAgentStatuses: () => Promise<void>;
  setProjectAgentStatus: (status: ProjectAgentStatus) => void;

  // Language & i18n Localization
  language: Language;
  setLanguage: (language: Language) => void;

  // Graceful fallback notice when a previously selected project was deleted or moved
  removedProjectNotice: string | null;
  clearRemovedProjectNotice: () => void;

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
  setActiveTab: (tab: 'kanban' | 'milestones' | 'git' | 'files' | 'prs' | 'docs' | 'analytics' | 'ai' | 'claude-cli' | 'processes') => void;
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
  startProcessAction: (command: string, name: string, options?: StartProcessOptions) => Promise<ManagedProcess | null>;
  stopProcessAction: (processId: string) => Promise<boolean>;
  /** Перезапуск процесса (hub или env-tools) с теми же параметрами. */
  restartProcessAction: (processId: string) => Promise<ManagedProcess | null>;

  // Action Runner (.projecthub.json): единый источник команд run/deploy/test для кнопок,
  // терминала и голосовых команд (аудит 5.9).
  actionConfig: ProjectActionConfig | null;
  loadActionConfig: (projectPath: string) => Promise<ProjectActionConfig | null>;
  /** Запустить произвольное действие с его env/cwd; `confirm` спрашивается, если действие требует подтверждения. */
  runActionDefinition: (def: ActionDefinition, options?: RunActionOptions) => Promise<ManagedProcess | null>;
  /** Запустить стандартное действие (run/deploy/test), перечитав конфиг проекта. */
  runProjectAction: (kind: ProjectActionKind, options?: RunActionOptions) => Promise<ManagedProcess | null>;
  /** Запущенный процесс стандартного действия текущего проекта, если есть. */
  findActionProcess: (kind: ProjectActionKind) => ManagedProcess | undefined;

  // Async Thunks
  fetchProjects: () => Promise<void>;
  fetchScanRoots: () => Promise<void>;
  saveScanRoots: (roots: string[]) => Promise<void>;
  scanProjectsWithProgress: (options?: ScanOptions) => Promise<ProjectInfo[]>;
  addProjectByPath: (folderPath: string) => Promise<ProjectInfo | null>;
  removeProjectFromCatalog: (projectPath: string) => Promise<void>;
  toggleFavoriteProject: (projectPath: string) => Promise<void>;
  refreshSingleProject: (projectPath: string) => Promise<void>;
  loadProjectData: (project: ProjectInfo, options?: { silent?: boolean }) => Promise<void>;
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
  gitDeleteBranch: (branchName: string, force?: boolean) => Promise<boolean>;
  gitMergeBranch: (branchName: string) => Promise<{ success: boolean; error?: string }>;
  gitFetchRemote: () => Promise<boolean>;
  gitPullRemote: () => Promise<{ success: boolean; error?: string }>;
  gitPushRemote: () => Promise<{ success: boolean; error?: string }>;
  gitDiscardFileChanges: (filePath: string) => Promise<boolean>;
  gitLoadDiffBetween: (targetA: string, targetB?: string, filePath?: string) => Promise<string>;
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

let agentStatusCleanup: (() => void) | null = null;

const ACTIVE_PROJECTS_STORAGE_KEY = 'projecthub_active_projects';
const SIDEBAR_STORAGE_KEY = 'projecthub_sidebar_open';
const ACTIVE_TAB_KEY = 'projecthub_active_tab';
const LABEL_FILTER_KEY = 'projecthub_filter_label';
const MILESTONE_FILTER_KEY = 'projecthub_filter_milestone';
const TASK_VIEW_MODE_KEY = 'projecthub_task_view_mode';
const FILTER_FAVORITES_KEY = 'projecthub_filter_favorites';
const FILTER_ACTIVE_KEY = 'projecthub_filter_active';
const PR_FILTER_KEY = 'projecthub_pr_filter';
const TERMINAL_MODE_KEY = 'projecthub_terminal_mode';
const SELECTED_PROJECT_KEY = 'projecthub_selected_project_path';

const VALID_TABS: Set<string> = new Set([
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
]);

const loadInitialActiveTab = (): ProjectState['activeTab'] => {
  if (typeof window === 'undefined') return 'kanban';
  try {
    const raw = localStorage.getItem(ACTIVE_TAB_KEY);
    if (raw && VALID_TABS.has(raw)) {
      return raw as ProjectState['activeTab'];
    }
  } catch {}
  return 'kanban';
};

const loadInitialTaskViewMode = (): 'kanban' | 'list' => {
  if (typeof window === 'undefined') return 'kanban';
  try {
    const raw = localStorage.getItem(TASK_VIEW_MODE_KEY);
    if (raw === 'list' || raw === 'kanban') return raw;
  } catch {}
  return 'kanban';
};

const loadInitialLabelFilter = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(LABEL_FILTER_KEY) || null;
  } catch {}
  return null;
};

const loadInitialMilestoneFilter = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(MILESTONE_FILTER_KEY) || null;
  } catch {}
  return null;
};

const loadInitialFilterFavorites = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(FILTER_FAVORITES_KEY) === 'true';
  } catch {}
  return false;
};

const loadInitialFilterActive = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(FILTER_ACTIVE_KEY) === 'true';
  } catch {}
  return false;
};

const loadInitialPRFilter = (): 'all' | 'open' | 'closed' | 'merged' => {
  if (typeof window === 'undefined') return 'open';
  try {
    const raw = localStorage.getItem(PR_FILTER_KEY);
    if (raw === 'all' || raw === 'open' || raw === 'closed' || raw === 'merged') return raw;
  } catch {}
  return 'open';
};

const loadInitialTerminalMode = (): 'pty' | 'process_logs' => {
  if (typeof window === 'undefined') return 'pty';
  try {
    const raw = localStorage.getItem(TERMINAL_MODE_KEY);
    if (raw === 'pty' || raw === 'process_logs') return raw;
  } catch {}
  return 'pty';
};

const loadInitialSidebarState = (): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (raw !== null) {
      return raw === 'true';
    }
  } catch {}
  return true;
};

const loadInitialActiveProjects = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ACTIVE_PROJECTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error('Failed to parse active projects from localStorage:', e);
  }
  return [];
};

const saveActiveProjects = (paths: string[]) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ACTIVE_PROJECTS_STORAGE_KEY, JSON.stringify(paths));
  } catch (e) {
    console.error('Failed to save active projects to localStorage:', e);
  }
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  selectedProject: null,
  tasks: [],
  gitLogs: [],
  gitRepoDetails: null,
  gitSelectedFile: null,
  gitDiffContent: '',
  activeTab: loadInitialActiveTab(),
  taskViewMode: loadInitialTaskViewMode(),
  selectedLabelFilter: loadInitialLabelFilter(),
  selectedMilestoneFilter: loadInitialMilestoneFilter(),
  isLoading: false,
  isScanning: false,
  searchQuery: '',
  filterOnlyFavorites: loadInitialFilterFavorites(),

  // Multi-Project Session & In-Memory Cache
  projectDataCache: {},
  activeProjectPaths: loadInitialActiveProjects(),
  lastSelectedProjectPath: null,
  filterOnlyActive: loadInitialFilterActive(),
  removedProjectNotice: null,
  clearRemovedProjectNotice: () => set({ removedProjectNotice: null }),

  scanRoots: [],
  isSidebarOpen: loadInitialSidebarState(),
  isTerminalOpen: false,
  terminalLogs: ['[ProjectHub] Система инициализирована.', '[ProjectHub] Реестр проектов загружен.'],
  processes: [],
  activeProcessId: null,
  actionConfig: null,
  terminalHeight: 220,
  isHotkeysHelpOpen: false,

  language: (typeof window !== 'undefined' && (localStorage.getItem('projecthub_lang') as Language)) || 'en',
  setLanguage: (language: Language) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('projecthub_lang', language);
    }
    set({ language });
  },

  prs: [],
  selectedPR: null,
  prDiffContent: '',
  prFilter: loadInitialPRFilter(),
  isLoadingPRs: false,
  prProviderInfo: null,

  docsList: [],
  selectedDoc: null,
  docContent: '',
  isDocLoading: false,
  isDocSaving: false,
  isDocDirty: false,

  milestones: [],
  isLoadingMilestones: false,

  projectAgentStatuses: {},

  fetchProjectAgentStatuses: async () => {
    if (window.api?.getAllProjectStatuses) {
      try {
        const statuses = await window.api.getAllProjectStatuses();
        const map: Record<string, ProjectAgentStatus> = {};
        for (const s of statuses) {
          map[s.projectPath] = s;
        }
        set({ projectAgentStatuses: map });
      } catch (e) {
        console.error('Failed to fetch project agent statuses:', e);
      }
    }
  },

  setProjectAgentStatus: (status) => {
    set((state) => ({
      projectAgentStatuses: {
        ...state.projectAgentStatuses,
        [status.projectPath]: status
      }
    }));
  },

  activateProject: (project: ProjectInfo) => {
    const activePaths = get().activeProjectPaths;
    if (!activePaths.includes(project.path)) {
      const next = [...activePaths, project.path];
      saveActiveProjects(next);
      set({ activeProjectPaths: next });
    }
    get().selectProject(project);
  },

  deactivateProject: (projectPath: string) => {
    const activePaths = get().activeProjectPaths;
    const next = activePaths.filter((p) => p !== projectPath);
    saveActiveProjects(next);
    // Закрытая вкладка не держит данные в памяти (TASK-38): при повторном открытии они загрузятся заново.
    set((state) => ({ activeProjectPaths: next, projectDataCache: dropProjectCache(state.projectDataCache, projectPath) }));

    // Закрытая вкладка больше не нуждается в git-вотчере в main (TASK-34).
    // При повторном выборе проекта getRepoDetails снова поднимет вотчер.
    window.api?.unwatchGit?.(projectPath).catch(() => {});

    // If deactivated project was currently active, switch to next available active project
    if (get().selectedProject?.path === projectPath) {
      const allProjects = get().projects;
      const nextActive = allProjects.find((p) => next.includes(p.path));
      if (nextActive) {
        get().selectProject(nextActive);
      } else if (allProjects.length > 0) {
        get().selectProject(allProjects[0]);
      } else {
        set({
          selectedProject: null,
          selectedMilestoneFilter: null,
          tasks: [],
          gitLogs: [],
          gitRepoDetails: null,
          docsList: [],
          milestones: [],
          processes: []
        });
      }
    }
  },

  toggleProjectActive: (project: ProjectInfo) => {
    if (get().activeProjectPaths.includes(project.path)) {
      get().deactivateProject(project.path);
    } else {
      get().activateProject(project);
    }
  },

  switchProjectByIndex: (index: number) => {
    const activePaths = get().activeProjectPaths;
    const allProjects = get().projects;
    const activeProjects = allProjects.filter((p) => activePaths.includes(p.path));

    if (index >= 0 && index < activeProjects.length) {
      get().selectProject(activeProjects[index]);
    }
  },

  switchToNextProject: () => {
    const activePaths = get().activeProjectPaths;
    const allProjects = get().projects;
    const activeProjects = allProjects.filter((p) => activePaths.includes(p.path));
    if (activeProjects.length <= 1) return;

    const curPath = get().selectedProject?.path;
    const curIdx = activeProjects.findIndex((p) => p.path === curPath);
    const nextIdx = (curIdx + 1) % activeProjects.length;
    get().selectProject(activeProjects[nextIdx]);
  },

  switchToPrevProject: () => {
    const activePaths = get().activeProjectPaths;
    const allProjects = get().projects;
    const activeProjects = allProjects.filter((p) => activePaths.includes(p.path));
    if (activeProjects.length <= 1) return;

    const curPath = get().selectedProject?.path;
    const curIdx = activeProjects.findIndex((p) => p.path === curPath);
    const prevIdx = (curIdx - 1 + activeProjects.length) % activeProjects.length;
    get().selectProject(activeProjects[prevIdx]);
  },

  switchToLastActiveProject: () => {
    const lastPath = get().lastSelectedProjectPath;
    if (!lastPath) {
      get().switchToPrevProject();
      return;
    }
    const allProjects = get().projects;
    const matched = allProjects.find((p) => p.path === lastPath);
    if (matched) {
      get().selectProject(matched);
    } else {
      get().switchToPrevProject();
    }
  },

  closeCurrentProject: () => {
    const curPath = get().selectedProject?.path;
    if (curPath) {
      get().deactivateProject(curPath);
    }
  },

  setProjectVoiceAlias: async (projectPath: string, alias: string) => {
    if (!window.api?.setProjectVoiceAlias) return false;
    try {
      const ok = await window.api.setProjectVoiceAlias(projectPath, alias);
      if (ok) {
        const cleanAlias = alias.trim() || undefined;
        set((state) => ({
          projects: state.projects.map((p) =>
            p.path === projectPath ? { ...p, voiceAlias: cleanAlias } : p
          ),
          selectedProject:
            state.selectedProject?.path === projectPath
              ? { ...state.selectedProject, voiceAlias: cleanAlias }
              : state.selectedProject
        }));
      }
      return ok;
    } catch (e) {
      console.error('Failed to set project voice alias:', e);
      return false;
    }
  },

  setProjects: (projects) => set({ projects }),
  selectProject: (selectedProject) => {
    if (!selectedProject) {
      if (typeof window !== 'undefined') {
        try { localStorage.removeItem(SELECTED_PROJECT_KEY); } catch {}
      }
      set({ selectedProject: null, selectedMilestoneFilter: null, actionConfig: null });
      return;
    }

    if (typeof window !== 'undefined') {
      try { localStorage.setItem(SELECTED_PROJECT_KEY, selectedProject.path); } catch {}
    }

    // Clear removed notice when a valid project is selected
    if (get().removedProjectNotice) {
      set({ removedProjectNotice: null });
    }

    const cur = get().selectedProject;
    if (cur && cur.path !== selectedProject.path) {
      // Конфиг действий принадлежит проекту — до загрузки нового не показывать чужой.
      set({ lastSelectedProjectPath: cur.path, actionConfig: null });
    }

    // Automatically make the selected project active in the session
    const activePaths = get().activeProjectPaths;
    if (!activePaths.includes(selectedProject.path)) {
      const next = [...activePaths, selectedProject.path];
      saveActiveProjects(next);
      set({ activeProjectPaths: next });
    }

    // 🚀 Check in-memory cache for INSTANT (0 ms) switch
    const cache = get().projectDataCache;
    const cached = cache[selectedProject.path];

    if (cached) {
      // Instant synchronous UI update without any lag or spinner!
      set((state) => ({
        selectedProject,
        tasks: cached.tasks,
        gitLogs: cached.gitLogs,
        gitRepoDetails: cached.gitRepoDetails,
        docsList: cached.docsList,
        milestones: cached.milestones,
        processes: cached.processes,
        // Отмечаем запись как недавно использованную для LRU-вытеснения (TASK-38).
        projectDataCache: { ...state.projectDataCache, [selectedProject.path]: { ...cached, lastLoadedAt: Date.now() } }
      }));

      // Background silent revalidation to keep data fresh without resetting UI
      get().loadProjectData(selectedProject, { silent: true });
      get().fetchProcesses(selectedProject.path);
      get().fetchDocs(selectedProject.path);
      get().fetchMilestones(selectedProject.path);
    } else {
      // Not yet in cache - standard load
      set({ selectedProject });
      get().loadProjectData(selectedProject);
      get().fetchProcesses(selectedProject.path);
      get().fetchDocs(selectedProject.path);
      get().fetchMilestones(selectedProject.path);
    }
  },
  setTasks: (tasks) => set({ tasks }),
  setGitLogs: (gitLogs) => set({ gitLogs }),
  setActiveTab: (activeTab) => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(ACTIVE_TAB_KEY, activeTab); } catch {}
    }
    set({ activeTab });
  },
  setTaskViewMode: (taskViewMode) => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(TASK_VIEW_MODE_KEY, taskViewMode); } catch {}
    }
    set({ taskViewMode });
  },
  setSelectedLabelFilter: (selectedLabelFilter) => {
    if (typeof window !== 'undefined') {
      try {
        if (selectedLabelFilter) {
          localStorage.setItem(LABEL_FILTER_KEY, selectedLabelFilter);
        } else {
          localStorage.removeItem(LABEL_FILTER_KEY);
        }
      } catch {}
    }
    set({ selectedLabelFilter });
  },
  setSelectedMilestoneFilter: (selectedMilestoneFilter) => {
    if (typeof window !== 'undefined') {
      try {
        if (selectedMilestoneFilter) {
          localStorage.setItem(MILESTONE_FILTER_KEY, selectedMilestoneFilter);
        } else {
          localStorage.removeItem(MILESTONE_FILTER_KEY);
        }
      } catch {}
    }
    set({ selectedMilestoneFilter });
  },
  setIsLoading: (isLoading) => set({ isLoading }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setFilterOnlyFavorites: (filterOnlyFavorites) => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(FILTER_FAVORITES_KEY, String(filterOnlyFavorites)); } catch {}
    }
    set({ filterOnlyFavorites });
  },
  setFilterOnlyActive: (filterOnlyActive) => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(FILTER_ACTIVE_KEY, String(filterOnlyActive)); } catch {}
    }
    set({ filterOnlyActive });
  },
  setTerminalOpen: (isTerminalOpen) => set({ isTerminalOpen }),
  toggleTerminal: () => set((s) => ({ isTerminalOpen: !s.isTerminalOpen })),
  setSidebarOpen: (isSidebarOpen: boolean) => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isSidebarOpen)); } catch {}
    }
    set({ isSidebarOpen });
  },
  toggleSidebar: () => {
    const next = !get().isSidebarOpen;
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next)); } catch {}
    }
    set({ isSidebarOpen: next });
  },
  setHotkeysHelpOpen: (isHotkeysHelpOpen) => set({ isHotkeysHelpOpen }),
  setActiveProcessId: (activeProcessId) => set({ activeProcessId }),
  setTerminalHeight: (terminalHeight) => set({ terminalHeight }),
  addTerminalLog: (log) =>
    set((s) => {
      const logs = s.terminalLogs.length >= MAX_TERMINAL_LOGS
        ? s.terminalLogs.slice(s.terminalLogs.length - MAX_TERMINAL_LOGS + 1)
        : s.terminalLogs;
      return { terminalLogs: [...logs, log] };
    }),
  clearTerminalLogs: () => set({ terminalLogs: [] }),

  ptySessions: [],
  activePtySessionId: null,
  terminalMode: 'pty',

  setActivePtySessionId: (activePtySessionId) => set({ activePtySessionId }),
  setTerminalMode: (terminalMode) => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(TERMINAL_MODE_KEY, terminalMode); } catch {}
    }
    set({ terminalMode });
  },

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

  startProcessAction: async (command: string, name: string, options?: StartProcessOptions) => {
    const curProject = get().selectedProject;
    if (!curProject || !window.api) return null;

    try {
      set({ isTerminalOpen: true });
      const proc = await window.api.startProcess(curProject.path, command, name, options);
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

  loadActionConfig: async (projectPath: string) => {
    if (!window.api?.getActionConfig) return null;
    try {
      const cfg = await window.api.getActionConfig(projectPath);
      // Пока конфиг читался, проект могли переключить — чужой конфиг в стор не кладём.
      if (get().selectedProject?.path === projectPath) set({ actionConfig: cfg });
      return cfg;
    } catch (e) {
      console.error('Failed to load action config:', e);
      return null;
    }
  },

  runActionDefinition: async (def: ActionDefinition, options?: RunActionOptions) => {
    if (def.requiresConfirmation && options?.confirm && !options.confirm(def)) return null;
    return get().startProcessAction(def.command, def.name, {
      env: def.env,
      cwd: def.cwd,
      autoOpenUrl: def.autoOpenUrl,
      autoOpenDelayMs: def.autoOpenDelayMs
    });
  },

  runProjectAction: async (kind: ProjectActionKind, options?: RunActionOptions) => {
    const curProject = get().selectedProject;
    if (!curProject) return null;
    // Перечитываем .projecthub.json при каждом запуске: файл могли поправить снаружи.
    const cfg = (await get().loadActionConfig(curProject.path)) ?? get().actionConfig;
    if (!cfg) {
      get().addTerminalLog(`[Process Error] Не удалось прочитать конфигурацию действий проекта (${kind})`);
      return null;
    }
    return get().runActionDefinition(cfg[kind], options);
  },

  findActionProcess: (kind: ProjectActionKind) => {
    const { selectedProject, actionConfig, processes } = get();
    if (!selectedProject || !actionConfig) return undefined;
    const def = actionConfig[kind];
    return processes.find((p) => p.status === 'running' && isProcessOfAction(p, selectedProject.path, def));
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

  restartProcessAction: async (processId: string) => {
    if (!window.api?.restartProcess) return null;
    try {
      const proc = await window.api.restartProcess(processId);
      set((state) => ({
        processes: [...state.processes.filter((p) => p.id !== proc.id), proc],
        activeProcessId: proc.id
      }));
      get().addTerminalLog(`[Process] Перезапущен процесс: ${proc.name} (${proc.command})`);
      return proc;
    } catch (e: any) {
      console.error('Failed to restart process:', e);
      get().addTerminalLog(`[Process Error] Не удалось перезапустить ${processId}: ${e.message}`);
      return null;
    }
  },

  fetchProjects: async () => {
    set({ isLoading: true });
    try {
      if (window.api) {
        // Setup agent status event listener
        if (!agentStatusCleanup && window.api.onProjectAgentStatusChanged) {
          agentStatusCleanup = window.api.onProjectAgentStatusChanged((status) => {
            get().setProjectAgentStatus(status);
          });
        }
        get().fetchProjectAgentStatuses();

        let list = await window.api.listProjects();
        if (list.length === 0) {
          list = await window.api.scanProjects();
        }
        set({ projects: list });

        if (!get().selectedProject && list.length > 0) {
          const storedPath = typeof window !== 'undefined' ? localStorage.getItem(SELECTED_PROJECT_KEY) : null;
          if (storedPath) {
            const matchedStored = list.find((p) => p.path === storedPath);
            if (matchedStored) {
              get().selectProject(matchedStored);
            } else {
              // The stored project is not in the list (was deleted or moved)
              if (typeof window !== 'undefined') {
                try { localStorage.removeItem(SELECTED_PROJECT_KEY); } catch {}
              }
              set({
                selectedProject: null,
                removedProjectNotice: storedPath
              });
            }
          } else {
            // No stored project: check active session or leave null for empty state
            const activePaths = get().activeProjectPaths;
            const matchedActive = list.find((p) => activePaths.includes(p.path));
            if (matchedActive) {
              get().selectProject(matchedActive);
            } else {
              set({ selectedProject: null });
            }
          }
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
          const storedPath = typeof window !== 'undefined' ? localStorage.getItem(SELECTED_PROJECT_KEY) : null;
          const matched = storedPath ? list.find((p) => p.path === storedPath) : null;
          if (matched) {
            get().selectProject(matched);
          }
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
        set((state) => ({ projects: updated, projectDataCache: dropProjectCache(state.projectDataCache, projectPath) }));
        if (get().selectedProject?.path === projectPath) {
          get().selectProject(null);
          set({ removedProjectNotice: projectPath });
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

  loadProjectData: async (project: ProjectInfo, options?: { silent?: boolean }) => {
    try {
      if (window.api) {
        void get().loadActionConfig(project.path);
        // Setup chokidar watcher listener if not setup
        if (!watcherCleanup) {
          watcherCleanup = window.api.onTasksChanged(async (data) => {
            const curProject = get().selectedProject;
            if (curProject && curProject.path.toLowerCase() === data.projectPath.toLowerCase()) {
              const freshTasks = await window.api.getTasks(curProject.path);
              set((state) => ({
                tasks: freshTasks,
                projectDataCache: putProjectCache(state, curProject.path, {
                  ...(state.projectDataCache[curProject.path] || {
                    gitLogs: state.gitLogs,
                    gitRepoDetails: state.gitRepoDetails,
                    docsList: state.docsList,
                    milestones: state.milestones,
                    processes: state.processes
                  }),
                  tasks: freshTasks,
                  lastLoadedAt: Date.now()
                })
              }));
              get().addTerminalLog(`[Backlog] Автосинхронизация задач: событие ${data.event} (${data.filePath})`);
            }
          });
        }

        if (!processStatusCleanup) {
          processStatusCleanup = window.api.onProcessStatusChanged((proc) => {
            set((state) => {
              // Процесс, запущенный из другого окна/перезапуском, в списке может отсутствовать —
              // добавляем, если он относится к выбранному проекту.
              const known = state.processes.some((p) => p.id === proc.id);
              if (known) {
                return { processes: state.processes.map((p) => (p.id === proc.id ? { ...p, ...proc } : p)) };
              }
              const cur = state.selectedProject?.path;
              if (cur && proc.cwd.toLowerCase() === cur.toLowerCase()) {
                return { processes: [...state.processes, proc] };
              }
              return {};
            });
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

        const isCurrent = get().selectedProject?.path === project.path;
        if (isCurrent) {
          set({ tasks, gitLogs: logs });
        }

        // Update in-memory cache for instant switching
        set((state) => {
          // Проект успели закрыть, пока шла загрузка — не воскрешаем его запись в кэше (TASK-38).
          const stillOpen = state.selectedProject?.path === project.path || state.activeProjectPaths.includes(project.path);
          if (!stillOpen) return state;
          const prevCached = state.projectDataCache[project.path];
          return {
            projectDataCache: putProjectCache(state, project.path, {
              tasks,
              gitLogs: logs,
              gitRepoDetails: isCurrent ? state.gitRepoDetails : (prevCached?.gitRepoDetails || null),
              docsList: isCurrent ? state.docsList : (prevCached?.docsList || []),
              milestones: isCurrent ? state.milestones : (prevCached?.milestones || []),
              processes: isCurrent ? state.processes : (prevCached?.processes || []),
              lastLoadedAt: Date.now()
            })
          };
        });

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
      const isCurrent = get().selectedProject?.path === project.path;
      if (isCurrent) {
        set({ gitRepoDetails: details });
      }
      set((state) => {
        const cached = state.projectDataCache[project.path];
        if (!cached) return state;
        return {
          projectDataCache: {
            ...state.projectDataCache,
            [project.path]: {
              ...cached,
              gitRepoDetails: details
            }
          }
        };
      });
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

  gitDeleteBranch: async (branchName: string, force = false) => {
    const project = get().selectedProject;
    if (!window.api || !project) return false;
    try {
      const ok = await window.api.deleteBranch(project.path, branchName, force);
      if (ok) {
        get().addTerminalLog(`[Git] Удалена ветка: ${branchName}`);
        await get().loadGitRepoDetails(project);
      }
      return ok;
    } catch (e) {
      console.error('Failed to delete branch:', e);
      return false;
    }
  },

  gitMergeBranch: async (branchName: string) => {
    const project = get().selectedProject;
    if (!window.api || !project) return { success: false, error: 'No active project' };
    try {
      const res = await window.api.mergeBranch(project.path, branchName);
      if (res.success) {
        get().addTerminalLog(`[Git] Ветка ${branchName} успешно объединена в текущую ветку`);
        await get().loadGitRepoDetails(project);
      } else {
        get().addTerminalLog(`[Git Ошибка] Слияние ветки ${branchName} завершилось ошибкой: ${res.error}`);
      }
      return res;
    } catch (e: any) {
      console.error('Failed to merge branch:', e);
      return { success: false, error: e?.message || String(e) };
    }
  },

  gitFetchRemote: async () => {
    const project = get().selectedProject;
    if (!window.api || !project) return false;
    try {
      const ok = await window.api.fetchRemote(project.path);
      if (ok) {
        get().addTerminalLog(`[Git] Выполнен git fetch`);
        await get().loadGitRepoDetails(project);
      }
      return ok;
    } catch (e) {
      console.error('Failed to fetch remotes:', e);
      return false;
    }
  },

  gitPullRemote: async () => {
    const project = get().selectedProject;
    if (!window.api || !project) return { success: false, error: 'No active project' };
    try {
      const res = await window.api.pullRemote(project.path);
      if (res.success) {
        get().addTerminalLog(`[Git] Выполнен git pull — изменения получены`);
        await get().loadGitRepoDetails(project);
      } else {
        get().addTerminalLog(`[Git Ошибка] pull завершился ошибкой: ${res.error}`);
      }
      return res;
    } catch (e: any) {
      console.error('Failed to pull:', e);
      return { success: false, error: e?.message || String(e) };
    }
  },

  gitPushRemote: async () => {
    const project = get().selectedProject;
    if (!window.api || !project) return { success: false, error: 'No active project' };
    try {
      const res = await window.api.pushRemote(project.path);
      if (res.success) {
        get().addTerminalLog(`[Git] Выполнен git push — коммиты отправлены в удаленный репозиторий`);
        await get().loadGitRepoDetails(project);
      } else {
        get().addTerminalLog(`[Git Ошибка] push завершился ошибкой: ${res.error}`);
      }
      return res;
    } catch (e: any) {
      console.error('Failed to push:', e);
      return { success: false, error: e?.message || String(e) };
    }
  },

  gitDiscardFileChanges: async (filePath: string) => {
    const project = get().selectedProject;
    if (!window.api || !project) return false;
    try {
      const ok = await window.api.discardFileChanges(project.path, filePath);
      if (ok) {
        get().addTerminalLog(`[Git] Отменены изменения в файле: ${filePath}`);
        await get().loadGitRepoDetails(project);
        if (get().gitSelectedFile === filePath) {
          set({ gitSelectedFile: null, gitDiffContent: '' });
        }
      }
      return ok;
    } catch (e) {
      console.error('Failed to discard changes:', e);
      return false;
    }
  },

  gitLoadDiffBetween: async (targetA: string, targetB?: string, filePath?: string) => {
    const project = get().selectedProject;
    if (!window.api || !project) return '';
    try {
      const diff = await window.api.getDiffBetween(project.path, targetA, targetB, filePath);
      set({ gitDiffContent: diff });
      return diff;
    } catch (e) {
      console.error('Failed to get diff between:', e);
      return '';
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
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(PR_FILTER_KEY, filter); } catch {}
    }
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



