import { contextBridge, ipcRenderer } from 'electron';
import type { IElectronAPI, ScanOptions } from '../src/types/electron';

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

  // System Dialogs & Launchers
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  openInExplorer: (targetPath: string) => ipcRenderer.invoke('system:openInExplorer', targetPath),
  openInCode: (targetPath: string) => ipcRenderer.invoke('system:openInCode', targetPath),
  openTerminal: (targetPath: string) => ipcRenderer.invoke('system:openTerminal', targetPath),

  // Backlog Tasks
  getTasks: (projectPath: string) => ipcRenderer.invoke('backlog:getTasks', projectPath),
  updateTaskStatus: (filePath: string, newStatus: string) => ipcRenderer.invoke('backlog:updateTaskStatus', filePath, newStatus),
  saveTask: (filePath: string, content: string) => ipcRenderer.invoke('backlog:saveTask', filePath, content),
  createTask: (projectPath: string, task: { title: string; description: string; labels: string[] }) => ipcRenderer.invoke('backlog:createTask', projectPath, task),

  // Git
  getGitLog: (projectPath: string, maxCount?: number) => ipcRenderer.invoke('git:getLog', projectPath, maxCount),
  getGitStatus: (projectPath: string) => ipcRenderer.invoke('git:getStatus', projectPath),

  // System
  getPlatform: () => ipcRenderer.invoke('system:getPlatform')
};

contextBridge.exposeInMainWorld('api', api);

