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

export interface BacklogTask {
  id: string;
  title: string;
  status: 'To Do' | 'In Progress' | 'Review' | 'Done';
  labels: string[];
  created?: string;
  filePath: string;
  content: string;
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

  // System Dialogs & Launchers
  selectDirectory: () => Promise<string | null>;
  openInExplorer: (targetPath: string) => Promise<void>;
  openInCode: (targetPath: string) => Promise<void>;
  openTerminal: (targetPath: string) => Promise<void>;

  // Backlog Tasks
  getTasks: (projectPath: string) => Promise<BacklogTask[]>;
  updateTaskStatus: (filePath: string, newStatus: string) => Promise<boolean>;
  saveTask: (filePath: string, content: string) => Promise<boolean>;
  createTask: (projectPath: string, task: { title: string; description: string; labels: string[] }) => Promise<BacklogTask | null>;

  // Git
  getGitLog: (projectPath: string, maxCount?: number) => Promise<GitCommit[]>;
  getGitStatus: (projectPath: string) => Promise<any>;

  // System
  getPlatform: () => Promise<string>;
}

declare global {
  interface Window {
    api: IElectronAPI;
  }
}

