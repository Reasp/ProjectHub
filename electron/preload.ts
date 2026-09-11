import { contextBridge, ipcRenderer } from 'electron';
import type {
  IElectronAPI,
  ScanOptions,
  BacklogTask,
  TaskCriterion,
  CreateProjectOptions,
  ManagedProcess,
  McpServerStatus,
  RagSearchOptions,
  StartProcessOptions
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
  setProjectVoiceAlias: (projectPath: string, alias: string) =>
    ipcRenderer.invoke('projects:setVoiceAlias', { projectPath, alias }),

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
  setTemplatePath: (templatePath: string | null) => ipcRenderer.invoke('template:setPath', templatePath),

  // Background Processes & Terminal
  startProcess: (projectPath: string, command: string, name: string, options?: StartProcessOptions) =>
    ipcRenderer.invoke('process:start', projectPath, command, name, options),
  stopProcess: (processId: string) =>
    ipcRenderer.invoke('process:stop', processId),
  restartProcess: (processId: string) =>
    ipcRenderer.invoke('process:restart', processId),
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

  // Action Runner & Script Config (.projecthub.json)
  getActionConfig: (projectPath: string) =>
    ipcRenderer.invoke('actions:getConfig', projectPath),
  saveActionConfig: (projectPath: string, config: any) =>
    ipcRenderer.invoke('actions:saveConfig', projectPath, config),

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
  getTaskContent: (filePath: string) => ipcRenderer.invoke('backlog:getTaskContent', filePath),
  updateTaskStatus: (filePath: string, newStatus: string) => ipcRenderer.invoke('backlog:updateTaskStatus', filePath, newStatus),
  saveTask: (filePath: string, content: string) => ipcRenderer.invoke('backlog:saveTask', filePath, content),
  saveFullTask: (
    filePath: string,
    data: {
      title: string;
      status: BacklogTask['status'];
      labels: string[];
      milestone?: string;
      assignee?: string[];
      description: string;
      criteria?: TaskCriterion[];
    }
  ) => ipcRenderer.invoke('backlog:saveFullTask', filePath, data),
  toggleCriterion: (filePath: string, index: number, completed: boolean) =>
    ipcRenderer.invoke('backlog:toggleCriterion', filePath, index, completed),
  createTask: (projectPath: string, task: { title: string; description: string; labels: string[]; type?: string; priority?: string; milestone?: string }) =>
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

  // Реестр ролей агентов (decision-9, TASK-60)
  listRoles: (projectPath?: string) => ipcRenderer.invoke('roles:list', projectPath),
  saveRole: (scope: 'global' | 'project', role: any, projectPath?: string) =>
    ipcRenderer.invoke('roles:save', scope, role, projectPath),
  deleteRole: (scope: 'global' | 'project', slug: string, projectPath?: string) =>
    ipcRenderer.invoke('roles:delete', scope, slug, projectPath),
  copyRoleToProject: (slug: string, projectPath: string) => ipcRenderer.invoke('roles:copyToProject', slug, projectPath),

  // Git
  getGitLog: (projectPath: string, maxCount?: number) => ipcRenderer.invoke('git:getLog', projectPath, maxCount),
  getGitStatus: (projectPath: string) => ipcRenderer.invoke('git:getStatus', projectPath),

  // Git Advanced
  getGitRepoDetails: (projectPath: string) => ipcRenderer.invoke('git:getRepoDetails', projectPath),
  unwatchGit: (projectPath: string) => ipcRenderer.invoke('git:unwatch', projectPath),
  checkoutBranch: (projectPath: string, branchName: string, createNew?: boolean) =>
    ipcRenderer.invoke('git:checkout', projectPath, branchName, createNew),
  createBranch: (projectPath: string, branchName: string) =>
    ipcRenderer.invoke('git:createBranch', projectPath, branchName),
  deleteBranch: (projectPath: string, branchName: string, force?: boolean) =>
    ipcRenderer.invoke('git:deleteBranch', projectPath, branchName, force),
  mergeBranch: (projectPath: string, branchName: string) =>
    ipcRenderer.invoke('git:mergeBranch', projectPath, branchName),
  fetchRemote: (projectPath: string) =>
    ipcRenderer.invoke('git:fetchRemote', projectPath),
  pullRemote: (projectPath: string) =>
    ipcRenderer.invoke('git:pullRemote', projectPath),
  pushRemote: (projectPath: string) =>
    ipcRenderer.invoke('git:pushRemote', projectPath),
  discardFileChanges: (projectPath: string, filePath: string) =>
    ipcRenderer.invoke('git:discardFileChanges', projectPath, filePath),
  getDiffBetween: (projectPath: string, targetA: string, targetB?: string, filePath?: string) =>
    ipcRenderer.invoke('git:getDiffBetween', projectPath, targetA, targetB, filePath),
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

  // Git Worktrees (TASK-53)
  listWorktrees: (projectPath: string) =>
    ipcRenderer.invoke('git:worktree:list', projectPath),
  addWorktree: (projectPath: string, options: any) =>
    ipcRenderer.invoke('git:worktree:add', projectPath, options),
  removeWorktree: (projectPath: string, worktreePath: string, force?: boolean) =>
    ipcRenderer.invoke('git:worktree:remove', projectPath, worktreePath, force),
  pruneWorktrees: (projectPath: string) =>
    ipcRenderer.invoke('git:worktree:prune', projectPath),
  getWorktreeDiff: (projectPath: string, worktreeBranch: string, baseBranch: string, worktreePath?: string) =>
    ipcRenderer.invoke('git:worktree:getDiff', projectPath, worktreeBranch, baseBranch, worktreePath),
  mergeWorktree: (projectPath: string, worktreeBranch: string, targetBranch: string) =>
    ipcRenderer.invoke('git:worktree:merge', projectPath, worktreeBranch, targetBranch),
  checkoutWorktreeFiles: (projectPath: string, branch: string, filePaths: string[]) =>
    ipcRenderer.invoke('git:worktree:checkoutFiles', projectPath, branch, filePaths),
  findOrphanedWorktrees: (projectPath: string, activeTaskIds: string[] = [], activeSwarmIds: string[] = []) =>
    ipcRenderer.invoke('git:worktree:findOrphaned', projectPath, activeTaskIds, activeSwarmIds),
  cleanOrphanedWorktrees: (projectPath: string, worktreePaths: string[], branches: string[]) =>
    ipcRenderer.invoke('git:worktree:cleanOrphaned', projectPath, worktreePaths, branches),

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
  claudeLogout: () => ipcRenderer.invoke('ai:claudeLogout'),
  streamAIChat: (request: any) => ipcRenderer.invoke('ai:streamChat', request),
  previewAgentContext: (projectPath: string, taskId: string, contextParts?: any) =>
    ipcRenderer.invoke('ai:previewContext', projectPath, taskId, contextParts),
  abortAIStream: (sessionId: string) => ipcRenderer.invoke('ai:abortStream', sessionId),
  clearAISession: (sessionId: string) => ipcRenderer.invoke('ai:clearSession', sessionId),
  applyAIDiff: (projectPath: string, relativePath: string, newContent: string) =>
    ipcRenderer.invoke('ai:applyDiff', projectPath, relativePath, newContent),
  // История диалогов AI Studio в файлах (TASK-35)
  listAISessions: (projectPath: string) => ipcRenderer.invoke('aiSessions:list', projectPath),
  saveAISession: (projectPath: string, session: any) => ipcRenderer.invoke('aiSessions:save', projectPath, session),
  deleteAISession: (projectPath: string, sessionId: string) =>
    ipcRenderer.invoke('aiSessions:delete', projectPath, sessionId),
  importAISessions: (sessionsByProject: any) => ipcRenderer.invoke('aiSessions:import', sessionsByProject),

  // Claude Bridge Approvals & Statuses
  getAllProjectStatuses: () => ipcRenderer.invoke('claudeBridge:getAllProjectStatuses'),
  getProjectAgentStatus: (projectPath: string) => ipcRenderer.invoke('claudeBridge:getProjectStatus', projectPath),
  sendApprovalResponse: (requestId: string, response: { approved: boolean; text?: string }) =>
    ipcRenderer.invoke('claudeBridge:sendApprovalResponse', requestId, response),
  getSubagents: (projectPath: string) => ipcRenderer.invoke('claudeBridge:getSubagents', projectPath),
  getAvailableModels: () => ipcRenderer.invoke('claudeBridge:getAvailableModels'),
  getClaudeUsage: (forceRefresh?: boolean) => ipcRenderer.invoke('claudeBridge:getUsage', forceRefresh),

  // Multi-Agent Swarm & Fleet Orchestration (TASK-54)
  startSwarmFanOut: (options: any) => ipcRenderer.invoke('swarm:startFanOut', options),
  startSwarmHandoff: (options: any) => ipcRenderer.invoke('swarm:startHandoff', options),
  // Запуск агента, назначенного на задачу через assignee (decision-9, TASK-60)
  runAssignedAgent: (options: { projectPath: string; taskId: string; taskTitle?: string; prompt: string; roleSlug: string; hostId?: string }) =>
    ipcRenderer.invoke('swarm:runAssigned', options),
  stopSwarm: (swarmId: string) => ipcRenderer.invoke('swarm:stop', swarmId),
  pickSwarmWinner: (swarmId: string, winnerAgentId: string, mergeIntoBase?: boolean) =>
    ipcRenderer.invoke('swarm:pickWinner', swarmId, winnerAgentId, mergeIntoBase),
  getSwarm: (swarmId: string) => ipcRenderer.invoke('swarm:get', swarmId),
  listSwarms: (projectPath?: string) => ipcRenderer.invoke('swarm:list', projectPath),
  resumeSwarm: (swarmId: string) => ipcRenderer.invoke('swarm:resume', swarmId),
  discardSwarm: (swarmId: string, cleanupWorktrees?: boolean) =>
    ipcRenderer.invoke('swarm:discard', swarmId, cleanupWorktrees),
  getSwarmTranscript: (swarmId: string, agentId: string) =>
    ipcRenderer.invoke('swarm:readTranscript', swarmId, agentId),
  exportSwarm: (swarmId: string, format: 'markdown' | 'json') => ipcRenderer.invoke('swarm:export', swarmId, format),
  exportSwarmToFile: (swarmId: string, format: 'markdown' | 'json') =>
    ipcRenderer.invoke('swarm:exportToFile', swarmId, format),
  onSwarmEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('swarm:event', handler);
    return () => {
      ipcRenderer.removeListener('swarm:event', handler);
    };
  },

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

  // File Explorer & Helpers
  readDirectoryTree: (projectPath: string, subDir?: string, maxDepth?: number) =>
    ipcRenderer.invoke('files:readTree', projectPath, subDir, maxDepth),
  readFileContent: (projectPath: string, relativePath: string) =>
    ipcRenderer.invoke('files:readContent', projectPath, relativePath),
  saveFileContent: (projectPath: string, relativePath: string, content: string) =>
    ipcRenderer.invoke('files:saveContent', projectPath, relativePath, content),
  createFileOrFolder: (projectPath: string, relativePath: string, isDirectory = false) =>
    ipcRenderer.invoke('files:create', projectPath, relativePath, isDirectory),
  deleteFileOrFolder: (projectPath: string, relativePath: string) =>
    ipcRenderer.invoke('files:delete', projectPath, relativePath),

  // Local Whisper STT Engine
  // Float32Array уходит через IPC как есть (structured clone сохраняет TypedArray) — без Array.from
  transcribeLocalWhisper: (audioData: number[] | Float32Array, language?: 'ru' | 'en') =>
    ipcRenderer.invoke('voice:transcribeLocal', {
      audioData: audioData instanceof Float32Array ? audioData : Float32Array.from(audioData),
      language
    }),
  getLocalWhisperStatus: () => ipcRenderer.invoke('voice:getLocalWhisperStatus'),
  // Ленивый прогрев модели: вызывается при первом включении hands-free или из настроек
  warmupLocalWhisper: () => ipcRenderer.invoke('voice:warmupLocalWhisper'),

  // System
  getPlatform: () => ipcRenderer.invoke('system:getPlatform'),

  // SafeStorage & Secret Encryption
  isEncryptionAvailable: () => ipcRenderer.invoke('secrets:isEncryptionAvailable'),
  encryptSecret: (text: string) => ipcRenderer.invoke('secrets:encrypt', text),
  decryptSecret: (cipherText: string) => ipcRenderer.invoke('secrets:decrypt', cipherText),
  saveEncryptedSecret: (key: string, value: string) => ipcRenderer.invoke('secrets:setSecret', { key, value }),
  getEncryptedSecret: (key: string) => ipcRenderer.invoke('secrets:getSecret', key),
  deleteEncryptedSecret: (key: string) => ipcRenderer.invoke('secrets:deleteSecret', key),

  // Внешние ссылки: только через системный браузер (main проверяет схему)
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // Remote MCP Server (External Agent Control)
  getMcpStatus: () => ipcRenderer.invoke('mcp:getStatus'),
  toggleMcpServer: (enable: boolean) => ipcRenderer.invoke('mcp:toggleServer', enable),
  regenerateMcpToken: () => ipcRenderer.invoke('mcp:regenerateToken'),
  setMcpAppState: (state: { activeProject?: any; activeTab?: string }) => ipcRenderer.invoke('mcp:setAppState', state),
  onMcpStatusChanged: (callback: (status: McpServerStatus) => void) => {
    const handler = (_event: any, status: McpServerStatus) => callback(status);
    ipcRenderer.on('mcp:statusChanged', handler);
    return () => {
      ipcRenderer.removeListener('mcp:statusChanged', handler);
    };
  },
  onRemoteAction: (callback: (action: { type: string; payload: any }) => void) => {
    const handler = (_event: any, action: any) => callback(action);
    ipcRenderer.on('mcp:remoteAction', handler);
    return () => {
      ipcRenderer.removeListener('mcp:remoteAction', handler);
    };
  },

  // System Voice Overlay
  syncVoiceOverlay: (state: {
    isListening: boolean;
    isPaused: boolean;
    state: string;
    transcript: string;
    audioLevel: number;
  }) => ipcRenderer.send('voice:overlay-sync', state),
  onVoiceOverlayUpdate: (callback: (state: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('voice:overlay-update', handler);
    return () => {
      ipcRenderer.removeListener('voice:overlay-update', handler);
    };
  },
  sendVoiceOverlayAction: (action: 'toggle-pause' | 'stop') =>
    ipcRenderer.send('voice:overlay-action', action),
  onVoiceExternalControl: (callback: (action: 'toggle-pause' | 'stop') => void) => {
    const handler = (_event: any, action: any) => callback(action);
    ipcRenderer.on('voice:external-control', handler);
    return () => {
      ipcRenderer.removeListener('voice:external-control', handler);
    };
  },

  // Remote Control (TASK-51)
  getRemoteStatus: () => ipcRenderer.invoke('remote:getStatus'),
  toggleRemoteControl: (enable?: boolean) => ipcRenderer.invoke('remote:toggle', enable),
  updateRemoteConfig: (config: any) => ipcRenderer.invoke('remote:updateConfig', config),
  regenerateRemoteToken: () => ipcRenderer.invoke('remote:regenerateToken'),
  disconnectRemoteDevice: (deviceId: string) => ipcRenderer.invoke('remote:disconnectDevice', deviceId),
  approveRemoteDevice: (deviceId: string) => ipcRenderer.invoke('remote:approveDevice', deviceId),
  setRemoteDeviceRights: (deviceId: string, rights: 'readOnly' | 'hitl' | 'full') =>
    ipcRenderer.invoke('remote:setDeviceRights', deviceId, rights),
  revokeRemoteDevice: (deviceId: string) => ipcRenderer.invoke('remote:revokeDevice', deviceId),
  testTelegramNotification: (text?: string) => ipcRenderer.invoke('remote:testTelegramNotification', text),
  startRemoteTunnel: () => ipcRenderer.invoke('remote:startTunnel'),
  stopRemoteTunnel: () => ipcRenderer.invoke('remote:stopTunnel'),
  onRemoteControlStatusChanged: (callback: (status: any) => void) => {
    const handler = (_event: any, status: any) => callback(status);
    ipcRenderer.on('remote:statusChanged', handler);
    return () => {
      ipcRenderer.removeListener('remote:statusChanged', handler);
    };
  },
  onRemoteHitlDecisionMade: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('remote:hitlDecisionMade', handler);
    return () => {
      ipcRenderer.removeListener('remote:hitlDecisionMade', handler);
    };
  },

  // Единый HITL-контур (TASK-57)
  listPendingApprovals: (filter?: { projectPath?: string; sessionId?: string }) => ipcRenderer.invoke('hitl:listPending', filter),
  decideApproval: (requestId: string, response: { approved: boolean; text?: string }) =>
    ipcRenderer.invoke('hitl:decide', requestId, response),
  listHitlAudit: (query?: any) => ipcRenderer.invoke('hitl:listAudit', query),
  listHitlAuditMonths: () => ipcRenderer.invoke('hitl:auditMonths'),
  getHitlInfo: () => ipcRenderer.invoke('hitl:auditInfo'),
  exportHitlAudit: (query?: any, format?: 'jsonl' | 'json' | 'csv') => ipcRenderer.invoke('hitl:exportAudit', query, format),
  onBusEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('bus:event', handler);
    return () => {
      ipcRenderer.removeListener('bus:event', handler);
    };
  },

  // Диагностика и автообновление (TASK-58)
  getDiagnosticsInfo: () => ipcRenderer.invoke('diagnostics:getInfo'),
  collectDiagnosticsArchive: () => ipcRenderer.invoke('diagnostics:collectArchive'),
  getUpdaterStatus: () => ipcRenderer.invoke('updater:getStatus'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdateNow: () => ipcRenderer.invoke('updater:installNow'),
  onUpdaterStatusChanged: (callback: (status: any) => void) => {
    const handler = (_event: any, status: any) => callback(status);
    ipcRenderer.on('updater:statusChanged', handler);
    return () => {
      ipcRenderer.removeListener('updater:statusChanged', handler);
    };
  }
};

contextBridge.exposeInMainWorld('api', api);






