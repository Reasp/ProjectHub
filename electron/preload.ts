import { contextBridge, ipcRenderer } from 'electron';
import type {
  IElectronAPI,
  ScanOptions,
  BacklogTask,
  TaskCriterion,
  CreateProjectOptions,
  ManagedProcess,
  RagSearchOptions
} from '../src/types/electron';

const api: IElectronAPI = {
  // Projects & Registry
  listProjects: () => ipcRenderer.invoke('projects:list'),
  scanProjects: (options?: ScanOptions) => ipcRenderer.invoke('projects:scan', options),
  addProject: (folderPath: string) => ipcRenderer.invoke('projects:add', folderPath),
  removeProject: (projectPath: string) => ipcRenderer.invoke('projects:remove', projectPath),
  refreshProject: (projectPath: string) => ipcRenderer.invoke('projects:refresh', projectPath),
  toggleFavorite: (projectPath: string) => ipcRenderer.invoke('projects:toggleFavorite', projectPath),
  getScanRoots: () => ipcRenderer.invoke('projects:getScanRoots'),
  setScanRoots: (roots: string[]) => ipcRenderer.invoke('projects:setScanRoots', roots),
  getProjectDetails: (projectPath: string) => ipcRenderer.invoke('projects:getDetails', projectPath),

  // Documentation & ADR Decisions
  listDocs: (projectPath: string) => ipcRenderer.invoke('docs:list', projectPath),
  readDoc: (filePath: string) => ipcRenderer.invoke('docs:read', filePath),
  saveDoc: (filePath: string, content: string) => ipcRenderer.invoke('docs:save', filePath, content),
  createDoc: (projectPath: string, params: any) => ipcRenderer.invoke('docs:create', projectPath, params),

  // Project Template Wizard
  createProjectFromTemplate: (options: CreateProjectOptions) =>
    ipcRenderer.invoke('template:createProject', options),
  checkTemplateAvailable: (customSource?: string) =>
    ipcRenderer.invoke('template:checkAvailable', customSource),

  // Background Processes & Terminal
  startProcess: (projectPath: string, command: string, name: string) =>
    ipcRenderer.invoke('process:start', projectPath, command, name),
  stopProcess: (processId: string) =>
    ipcRenderer.invoke('process:stop', processId),
  listProcesses: (projectPath: string) =>
    ipcRenderer.invoke('process:list', projectPath),
  tailProcessLog: (projectPath: string, processName: string, lines?: number) =>
    ipcRenderer.invoke('process:tailLog', projectPath, processName, lines),
  onProcessLogChunk: (callback: (data: { processId: string; text: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('process:logChunk', handler);
    return () => {
      ipcRenderer.removeListener('process:logChunk', handler);
    };
  },
  onProcessStatusChanged: (callback: (process: ManagedProcess) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('process:statusChanged', handler);
    return () => {
      ipcRenderer.removeListener('process:statusChanged', handler);
    };
  },

  // Vector RAG & Knowledge Search
  searchDocs: (options: RagSearchOptions) =>
    ipcRenderer.invoke('rag:search', options),
  getRagStats: (projectPath: string) =>
    ipcRenderer.invoke('rag:getStats', projectPath),

  // System Dialogs & Launchers
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  openInExplorer: (targetPath: string) => ipcRenderer.invoke('system:openInExplorer', targetPath),
  openInCode: (targetPath: string) => ipcRenderer.invoke('system:openInCode', targetPath),
  openTerminal: (targetPath: string) => ipcRenderer.invoke('system:openTerminal', targetPath),

  // Backlog Tasks & Real-time Watcher
  getTasks: (projectPath: string) => ipcRenderer.invoke('backlog:getTasks', projectPath),
  updateTaskStatus: (filePath: string, newStatus: string) => ipcRenderer.invoke('backlog:updateTaskStatus', filePath, newStatus),
  saveTask: (filePath: string, content: string) => ipcRenderer.invoke('backlog:saveTask', filePath, content),
  saveFullTask: (
    filePath: string,
    data: {
      title: string;
      status: BacklogTask['status'];
      labels: string[];
      description: string;
      criteria?: TaskCriterion[];
    }
  ) => ipcRenderer.invoke('backlog:saveFullTask', filePath, data),
  toggleCriterion: (filePath: string, index: number, completed: boolean) =>
    ipcRenderer.invoke('backlog:toggleCriterion', filePath, index, completed),
  createTask: (projectPath: string, task: { title: string; description: string; labels: string[] }) =>
    ipcRenderer.invoke('backlog:createTask', projectPath, task),
  deleteTask: (filePath: string) => ipcRenderer.invoke('backlog:deleteTask', filePath),
  watchProjectTasks: (projectPath: string) => ipcRenderer.invoke('backlog:watchProject', projectPath),
  onTasksChanged: (callback: (data: { projectPath: string; event: string; filePath: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('backlog:tasksChanged', handler);
    return () => {
      ipcRenderer.removeListener('backlog:tasksChanged', handler);
    };
  },

  // Git
  getGitLog: (projectPath: string, maxCount?: number) => ipcRenderer.invoke('git:getLog', projectPath, maxCount),
  getGitStatus: (projectPath: string) => ipcRenderer.invoke('git:getStatus', projectPath),

  // Git Advanced
  getGitRepoDetails: (projectPath: string) => ipcRenderer.invoke('git:getRepoDetails', projectPath),
  checkoutBranch: (projectPath: string, branchName: string, createNew?: boolean) =>
    ipcRenderer.invoke('git:checkout', projectPath, branchName, createNew),
  createBranch: (projectPath: string, branchName: string) =>
    ipcRenderer.invoke('git:createBranch', projectPath, branchName),
  stageFile: (projectPath: string, filePath: string) =>
    ipcRenderer.invoke('git:stageFile', projectPath, filePath),
  unstageFile: (projectPath: string, filePath: string) =>
    ipcRenderer.invoke('git:unstageFile', projectPath, filePath),
  stageAll: (projectPath: string) =>
    ipcRenderer.invoke('git:stageAll', projectPath),
  commitChanges: (projectPath: string, message: string, stageAll?: boolean) =>
    ipcRenderer.invoke('git:commit', projectPath, message, stageAll),
  getFileDiff: (projectPath: string, filePath: string, staged?: boolean) =>
    ipcRenderer.invoke('git:getFileDiff', projectPath, filePath, staged),
  onGitChanged: (callback: (data: { projectPath: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('git:changed', handler);
    return () => {
      ipcRenderer.removeListener('git:changed', handler);
    };
  },

  // Pull & Merge Requests
  getPRProviderInfo: (projectPath: string) => ipcRenderer.invoke('pr:getProviderInfo', projectPath),
  listPullRequests: (projectPath: string, state?: 'all' | 'open' | 'closed' | 'merged') =>
    ipcRenderer.invoke('pr:list', projectPath, state),
  createPullRequest: (projectPath: string, options: any) =>
    ipcRenderer.invoke('pr:create', projectPath, options),
  getPRDiff: (projectPath: string, prNumber: number) =>
    ipcRenderer.invoke('pr:getDiff', projectPath, prNumber),

  // System
  getPlatform: () => ipcRenderer.invoke('system:getPlatform')
};

contextBridge.exposeInMainWorld('api', api);






