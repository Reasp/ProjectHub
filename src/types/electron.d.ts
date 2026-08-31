export interface RagStatus {
  ready: boolean;
  chunksCount?: number;
  filesCount?: number;
  builtAt?: string;
  model?: string;
}

export interface RunningProcess {
  name: string;
  pid: number;
  command?: string;
  startedAt?: string;
}

export interface ProcessStatus {
  runningCount: number;
  processes: RunningProcess[];
}

export interface GitLastCommit {
  hash: string;
  message: string;
  date: string;
  author: string;
}

export interface ProjectInfo {
  name: string;
  path: string;
  description?: string;
  version?: string;
  favorite?: boolean;
  addedAt?: string;
  lastScannedAt?: string;
  hasBacklog: boolean;
  hasInfraConfig: boolean;
  hasGit: boolean;
  gitBranch?: string;
  gitClean?: boolean;
  gitAhead?: number;
  gitBehind?: number;
  uncommittedCount?: number;
  lastCommit?: GitLastCommit;
  taskCounts?: {
    total: number;
    todo: number;
    inProgress: number;
    review: number;
    done: number;
  };
  ragStatus?: RagStatus;
  processStatus?: ProcessStatus;
  features?: {
    docsRag?: boolean;
    envTools?: boolean;
    backlogMcp?: boolean;
    bootstrap?: boolean;
    lightrag?: boolean;
  };
}

export interface TaskCriterion {
  text: string;
  completed: boolean;
}

export interface Milestone {
  id: string;
  title: string;
  description?: string;
  targetDate?: string;
  status: 'Planning' | 'In Progress' | 'Completed' | 'Deferred';
  filePath: string;
  taskCounts?: {
    total: number;
    done: number;
    inProgress: number;
    review: number;
    todo: number;
  };
}

export interface CreateMilestoneParams {
  title: string;
  description?: string;
  targetDate?: string;
  status?: 'Planning' | 'In Progress' | 'Completed' | 'Deferred';
}

export interface BacklogTask {
  id: string;
  title: string;
  status: 'To Do' | 'In Progress' | 'Review' | 'Done';
  labels: string[];
  milestone?: string;
  created?: string;
  filePath: string;
  content: string;
  description?: string;
  acceptanceCriteria?: TaskCriterion[];
}

export interface GitCommit {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  author_email: string;
}

export interface ScanOptions {
  roots?: string[];
  depth?: number;
}

export interface RegistrySettings {
  autoScanOnStartup: boolean;
  scanDepth: number;
}

export interface CreateProjectOptions {
  name: string;
  targetDir: string;
  templateSource?: string;
  features: {
    docsRag?: boolean;
    envTools?: boolean;
    backlogMcp?: boolean;
    bootstrap?: boolean;
    lightrag?: boolean;
  };
  initGit?: boolean;
}

export interface ManagedProcess {
  id: string;
  name: string;
  command: string;
  cwd: string;
  pid?: number;
  startedAt: string;
  status: 'running' | 'stopped' | 'failed';
  exitCode?: number;
  source: 'hub' | 'env-tools';
}

export interface RagSearchOptions {
  projectPath?: string;
  query: string;
  mode?: 'vector' | 'text' | 'all';
  limit?: number;
  global?: boolean;
}

export interface RagSearchResult {
  projectName: string;
  projectPath: string;
  filePath: string;
  fileRelative: string;
  heading?: string;
  snippet: string;
  score: number;
  type: 'vector' | 'text';
  category: 'doc' | 'decision' | 'task';
}

export interface GitFileStatus {
  path: string;
  index: string; // 'M', 'A', 'D', '?'
  working_dir: string;
  staged: boolean;
}

export interface GitRepoDetails {
  currentBranch: string;
  branches: string[];
  remoteBranches: string[];
  commits: GitCommit[];
  files: GitFileStatus[];
  stashes: string[];
  tags: string[];
  isClean: boolean;
}

export interface PullRequest {
  id: number | string;
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  sourceBranch: string;
  targetBranch: string;
  body: string;
  labels: string[];
  checksStatus?: 'SUCCESS' | 'PENDING' | 'FAILURE' | 'NONE';
  provider: 'github' | 'gitlab' | 'custom';
  commentsCount?: number;
}

export interface PRCreateOptions {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch?: string;
  draft?: boolean;
}

export interface PRProviderInfo {
  provider: 'github' | 'gitlab' | 'none';
  repo?: string;
  remoteUrl?: string;
  hasCli: boolean;
  authenticated: boolean;
}

export interface DocItem {
  id: string;
  title: string;
  category: 'doc' | 'decision';
  filePath: string;
  fileRelative: string;
  tags: string[];
  status?: string;
  date?: string;
  updatedAt?: string;
  size: number;
}

export interface CreateDocParams {
  type: 'doc' | 'decision';
  title: string;
  status?: string;
  tags?: string[];
  content?: string;
}

export interface IElectronAPI {
  // Projects & Registry
  listProjects: () => Promise<ProjectInfo[]>;
  scanProjects: (options?: ScanOptions) => Promise<ProjectInfo[]>;
  addProject: (folderPath: string) => Promise<ProjectInfo | null>;
  removeProject: (projectPath: string) => Promise<boolean>;
  refreshProject: (projectPath: string) => Promise<ProjectInfo | null>;
  toggleFavorite: (projectPath: string) => Promise<boolean>;
  getScanRoots: () => Promise<string[]>;
  setScanRoots: (roots: string[]) => Promise<boolean>;
  getProjectDetails: (projectPath: string) => Promise<ProjectInfo | null>;

  // Documentation & ADR Decisions
  listDocs: (projectPath: string) => Promise<DocItem[]>;
  readDoc: (filePath: string) => Promise<string>;
  saveDoc: (filePath: string, content: string) => Promise<boolean>;
  createDoc: (projectPath: string, params: CreateDocParams) => Promise<DocItem>;

  // Project Template Wizard
  createProjectFromTemplate: (options: CreateProjectOptions) => Promise<ProjectInfo>;
  checkTemplateAvailable: (customSource?: string) => Promise<{ available: boolean; path: string }>;

  // Background Processes & Terminal
  startProcess: (projectPath: string, command: string, name: string) => Promise<ManagedProcess>;
  stopProcess: (processId: string) => Promise<boolean>;
  listProcesses: (projectPath: string) => Promise<ManagedProcess[]>;
  tailProcessLog: (projectPath: string, processName: string, lines?: number) => Promise<string>;
  onProcessLogChunk: (callback: (data: { processId: string; text: string }) => void) => () => void;
  onProcessStatusChanged: (callback: (process: ManagedProcess) => void) => () => void;

  // Vector RAG & Knowledge Search
  searchDocs: (options: RagSearchOptions) => Promise<RagSearchResult[]>;
  getRagStats: (projectPath: string) => Promise<{ hasIndex: boolean; chunksCount: number; lastModified?: string }>;

  // System Dialogs & Launchers
  selectDirectory: () => Promise<string | null>;
  openInExplorer: (targetPath: string) => Promise<void>;
  openInCode: (targetPath: string) => Promise<void>;
  openTerminal: (targetPath: string) => Promise<void>;

  // Backlog Tasks & Real-time Watcher
  getTasks: (projectPath: string) => Promise<BacklogTask[]>;
  updateTaskStatus: (filePath: string, newStatus: string) => Promise<boolean>;
  saveTask: (filePath: string, content: string) => Promise<boolean>;
  saveFullTask: (
    filePath: string,
    data: {
      title: string;
      status: BacklogTask['status'];
      labels: string[];
      milestone?: string;
      description: string;
      criteria?: TaskCriterion[];
    }
  ) => Promise<boolean>;
  toggleCriterion: (filePath: string, index: number, completed: boolean) => Promise<boolean>;
  createTask: (projectPath: string, task: { title: string; description: string; labels: string[] }) => Promise<BacklogTask | null>;
  deleteTask: (filePath: string) => Promise<boolean>;
  watchProjectTasks: (projectPath: string) => Promise<void>;
  onTasksChanged: (callback: (data: { projectPath: string; event: string; filePath: string }) => void) => () => void;

  // Milestones & Roadmap
  listMilestones: (projectPath: string) => Promise<Milestone[]>;
  createMilestone: (projectPath: string, params: CreateMilestoneParams) => Promise<Milestone | null>;
  saveMilestone: (filePath: string, params: Partial<CreateMilestoneParams>) => Promise<boolean>;
  deleteMilestone: (filePath: string) => Promise<boolean>;

  // Git Advanced
  getGitRepoDetails: (projectPath: string) => Promise<GitRepoDetails | null>;
  checkoutBranch: (projectPath: string, branchName: string, createNew?: boolean) => Promise<boolean>;
  createBranch: (projectPath: string, branchName: string) => Promise<boolean>;
  stageFile: (projectPath: string, filePath: string) => Promise<boolean>;
  unstageFile: (projectPath: string, filePath: string) => Promise<boolean>;
  stageAll: (projectPath: string) => Promise<boolean>;
  commitChanges: (projectPath: string, message: string, stageAll?: boolean) => Promise<boolean>;
  getFileDiff: (projectPath: string, filePath: string, staged?: boolean) => Promise<string>;
  onGitChanged: (callback: (data: { projectPath: string }) => void) => () => void;
  getGitLog: (projectPath: string, maxCount?: number) => Promise<GitCommit[]>;
  getGitStatus: (projectPath: string) => Promise<any>;

  // Pull & Merge Requests
  getPRProviderInfo: (projectPath: string) => Promise<PRProviderInfo>;
  listPullRequests: (projectPath: string, state?: 'all' | 'open' | 'closed' | 'merged') => Promise<PullRequest[]>;
  createPullRequest: (projectPath: string, options: PRCreateOptions) => Promise<PullRequest | null>;
  getPRDiff: (projectPath: string, prNumber: number) => Promise<string>;

  // Interactive PTY Terminals (Claude Code & Multi-tab Shell)
  createPtySession: (options: CreatePtyOptions) => Promise<PtySession>;
  writePty: (sessionId: string, data: string) => Promise<boolean>;
  resizePty: (sessionId: string, cols: number, rows: number) => Promise<boolean>;
  killPty: (sessionId: string) => Promise<boolean>;
  listPtySessions: () => Promise<PtySession[]>;
  onPtyData: (callback: (data: { sessionId: string; data: string }) => void) => () => void;
  onPtyExit: (callback: (data: { sessionId: string; exitCode: number }) => void) => () => void;

  // System
  getPlatform: () => Promise<string>;
}

export interface PtySession {
  id: string;
  projectPath: string;
  projectName: string;
  type: 'claude' | 'shell';
  title: string;
  createdAt: number;
  status: 'running' | 'exited';
  exitCode?: number;
}

export interface CreatePtyOptions {
  sessionId?: string;
  projectPath: string;
  projectName?: string;
  type: 'claude' | 'shell';
  title?: string;
  cols?: number;
  rows?: number;
}

declare global {
  interface Window {
    api: IElectronAPI;
  }
}







