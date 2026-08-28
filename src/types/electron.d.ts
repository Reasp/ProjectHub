export interface ProjectInfo {
  name: string;
  path: string;
  hasBacklog: boolean;
  hasInfraConfig: boolean;
  hasGit: boolean;
  gitBranch?: string;
  gitClean?: boolean;
  gitAhead?: number;
  gitBehind?: number;
  uncommittedCount?: number;
  taskCounts?: {
    total: number;
    todo: number;
    inProgress: number;
    review: number;
    done: number;
  };
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

export interface IElectronAPI {
  // Projects
  scanProjects: (rootPaths?: string[]) => Promise<ProjectInfo[]>;
  getProjectDetails: (projectPath: string) => Promise<ProjectInfo | null>;
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
