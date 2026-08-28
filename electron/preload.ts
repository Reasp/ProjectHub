import { contextBridge, ipcRenderer } from 'electron';
import type { IElectronAPI } from '../src/types/electron';

const api: IElectronAPI = {
  // Projects
  scanProjects: (rootPaths) => ipcRenderer.invoke('projects:scan', rootPaths),
  getProjectDetails: (projectPath) => ipcRenderer.invoke('projects:getDetails', projectPath),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  openInExplorer: (targetPath) => ipcRenderer.invoke('system:openInExplorer', targetPath),
  openInCode: (targetPath) => ipcRenderer.invoke('system:openInCode', targetPath),
  openTerminal: (targetPath) => ipcRenderer.invoke('system:openTerminal', targetPath),

  // Backlog Tasks
  getTasks: (projectPath) => ipcRenderer.invoke('backlog:getTasks', projectPath),
  updateTaskStatus: (filePath, newStatus) => ipcRenderer.invoke('backlog:updateTaskStatus', filePath, newStatus),
  saveTask: (filePath, content) => ipcRenderer.invoke('backlog:saveTask', filePath, content),
  createTask: (projectPath, task) => ipcRenderer.invoke('backlog:createTask', projectPath, task),

  // Git
  getGitLog: (projectPath, maxCount) => ipcRenderer.invoke('git:getLog', projectPath, maxCount),
  getGitStatus: (projectPath) => ipcRenderer.invoke('git:getStatus', projectPath),

  // System
  getPlatform: () => ipcRenderer.invoke('system:getPlatform')
};

contextBridge.exposeInMainWorld('api', api);
