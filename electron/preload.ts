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

  // Milestones & Roadmap
  listMilestones: (projectPath: string) => ipcRenderer.invoke('milestones:list', projectPath),
  createMilestone: (projectPath: string, params: any) => ipcRenderer.invoke('milestones:create', projectPath, params),
  saveMilestone: (filePath: string, params: any) => ipcRenderer.invoke('milestones:save', filePath, params),
  deleteMilestone: (filePath: string) => ipcRenderer.invoke('milestones:delete', filePath),

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

  // Interactive PTY Terminals (Claude Code & Multi-tab Shell)
  createPtySession: (options: any) => ipcRenderer.invoke('pty:create', options),
  writePty: (sessionId: string, data: string) => ipcRenderer.invoke('pty:write', sessionId, data),
  resizePty: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('pty:resize', sessionId, cols, rows),
  killPty: (sessionId: string) => ipcRenderer.invoke('pty:kill', sessionId),
  listPtySessions: () => ipcRenderer.invoke('pty:list'),
  onPtyData: (callback: (data: { sessionId: string; data: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('pty:data', handler);
    return () => {
      ipcRenderer.removeListener('pty:data', handler);
    };
  },
  onPtyExit: (callback: (data: { sessionId: string; exitCode: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('pty:exit', handler);
    return () => {
      ipcRenderer.removeListener('pty:exit', handler);
    };
  },

  // AI Studio & Claude Bridge Engine
  getAIConfig: () => ipcRenderer.invoke('ai:getConfig'),
  saveAIConfig: (config: any) => ipcRenderer.invoke('ai:saveConfig', config),
  getClaudeAuthStatus: () => ipcRenderer.invoke('ai:getClaudeAuthStatus'),
  startClaudeLogin: () => ipcRenderer.invoke('ai:startClaudeLogin'),
  streamAIChat: (request: any) => ipcRenderer.invoke('ai:streamChat', request),
  abortAIStream: (sessionId: string) => ipcRenderer.invoke('ai:abortStream', sessionId),
  applyAIDiff: (projectPath: string, relativePath: string, newContent: string) =>
    ipcRenderer.invoke('ai:applyDiff', projectPath, relativePath, newContent),

  // Claude Bridge Approvals & Statuses
  getAllProjectStatuses: () => ipcRenderer.invoke('claudeBridge:getAllProjectStatuses'),
  getProjectAgentStatus: (projectPath: string) => ipcRenderer.invoke('claudeBridge:getProjectStatus', projectPath),
  sendApprovalResponse: (requestId: string, response: { approved: boolean; text?: string }) =>
    ipcRenderer.invoke('claudeBridge:sendApprovalResponse', requestId, response),
  getSubagents: (projectPath: string) => ipcRenderer.invoke('claudeBridge:getSubagents', projectPath),

  onProjectAgentStatusChanged: (callback: (status: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('claudeBridge:statusChanged', handler);
    return () => {
      ipcRenderer.removeListener('claudeBridge:statusChanged', handler);
    };
  },
  onSubagentUpdated: (callback: (subagent: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('claudeBridge:subagentUpdated', handler);
    return () => {
      ipcRenderer.removeListener('claudeBridge:subagentUpdated', handler);
    };
  },

  onAIChunk: (sessionId: string, callback: (chunk: any) => void) => {
    const channel = `ai:chunk:${sessionId}`;
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  onAIComplete: (sessionId: string, callback: (message: any) => void) => {
    const channel = `ai:complete:${sessionId}`;
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  onAIError: (sessionId: string, callback: (error: string) => void) => {
    const channel = `ai:error:${sessionId}`;
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  // File helpers
  readFile: (projectPath: string, relativePath: string) =>
    ipcRenderer.invoke('file:readFile', projectPath, relativePath),
  writeFile: (projectPath: string, relativePath: string, content: string) =>
    ipcRenderer.invoke('file:writeFile', projectPath, relativePath, content),
  listFiles: (projectPath: string, subDir?: string) =>
    ipcRenderer.invoke('file:listFiles', projectPath, subDir),

  // System
  getPlatform: () => ipcRenderer.invoke('system:getPlatform')
};

contextBridge.exposeInMainWorld('api', api);






