import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/** Полезная нагрузка события pty:removed — автоудаление завершившейся сессии (TASK-50). */
type PtyRemovedPayload = { sessionId: string; title: string; reason: 'ttl' };
import type {
  ArenaSettings,
  ProviderErrorInfo,
  CheckDefinition,
  IElectronAPI,
  ScanOptions,
  BacklogTask,
  TaskCriterion,
  CreateProjectOptions,
  ManagedProcess,
  McpServerStatus,
  ComputerOverlayState,
  ComputerUseSettings,
  ComputerUseStatus,
  NotificationAction,
  NotificationDelivery,
  NotificationSettings,
  NotificationSeverity,
  PushToTalkEvent,
  PushToTalkSettings,
  PushToTalkStatus,
  RagSearchOptions,
  StartProcessOptions,
  VoiceClassifyRequest,
  VoiceComputerTaskRequest,
  VoiceDictateRequest,
  VoiceOverlayPayload,
  TtsChunkPayload,
  TtsDonePayload,
  TtsDownloadProgress,
  TtsErrorPayload
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
  listPortOwners: (port: number) =>
    ipcRenderer.invoke('process:listPortOwners', port),
  releasePort: (port: number) =>
    ipcRenderer.invoke('process:releasePort', port),
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
  getBacklogConfig: (projectPath: string) => ipcRenderer.invoke('backlog:getConfig', projectPath),
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
  // Завершившаяся сессия удалена по TTL — рендерер убирает вкладку (TASK-50)
  onPtyRemoved: (callback: (data: PtyRemovedPayload) => void) => {
    const handler = (_event: unknown, data: PtyRemovedPayload) => callback(data);
    ipcRenderer.on('pty:removed', handler);
    return () => {
      ipcRenderer.removeListener('pty:removed', handler);
    };
  },

  // AI Studio & Claude Bridge Engine
  getAIConfig: () => ipcRenderer.invoke('ai:getConfig'),
  saveAIConfig: (config: any) => ipcRenderer.invoke('ai:saveConfig', config),
  // Профили OpenAI-совместимых провайдеров (TASK-70.1, TASK-70.2)
  getLlmProviderPresets: () => ipcRenderer.invoke('llmProfiles:presets'),
  listLlmProfiles: () => ipcRenderer.invoke('llmProfiles:list'),
  saveLlmProfile: (profile: unknown, apiKey?: string | null) => ipcRenderer.invoke('llmProfiles:save', { profile, apiKey }),
  deleteLlmProfile: (id: string) => ipcRenderer.invoke('llmProfiles:delete', id),
  listLlmProfileModels: (id: string, refresh?: boolean) => ipcRenderer.invoke('llmProfiles:listModels', id, refresh),
  importLegacyLlmProfile: (provider: string) => ipcRenderer.invoke('llmProfiles:importLegacy', provider),
  getAgentPricing: () => ipcRenderer.invoke('pricing:get'),
  saveAgentPricing: (overrides: unknown) => ipcRenderer.invoke('pricing:save', overrides),
  fetchOpenRouterPrices: () => ipcRenderer.invoke('pricing:fetchOpenRouter'),
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
  // Цикл «до готовности» (TASK-75)
  startSwarmDoneLoop: (options: unknown) => ipcRenderer.invoke('swarm:startDoneLoop', options),
  getDoneLoopConfig: (projectPath: string) => ipcRenderer.invoke('doneLoop:getConfig', projectPath),
  // Запуск агента, назначенного на задачу через assignee (decision-9, TASK-60)
  runAssignedAgent: (options: { projectPath: string; taskId: string; taskTitle?: string; prompt: string; roleSlug: string; hostId?: string }) =>
    ipcRenderer.invoke('swarm:runAssigned', options),
  stopSwarm: (swarmId: string) => ipcRenderer.invoke('swarm:stop', swarmId),
  pickSwarmWinner: (swarmId: string, winnerAgentId: string, mergeIntoBase?: boolean) =>
    ipcRenderer.invoke('swarm:pickWinner', swarmId, winnerAgentId, mergeIntoBase),
  getSwarm: (swarmId: string) => ipcRenderer.invoke('swarm:get', swarmId),
  // Автосудья арены (TASK-61)
  runSwarmJudge: (swarmId: string, options?: { rerunChecks?: boolean; skipReview?: boolean }) =>
    ipcRenderer.invoke('swarm:runJudge', swarmId, options),
  cancelSwarmJudge: (swarmId: string) => ipcRenderer.invoke('swarm:cancelJudge', swarmId),
  composeSwarmResult: (swarmId: string, selections: Array<{ agentId: string; files: string[] }>) =>
    ipcRenderer.invoke('swarm:compose', swarmId, selections),
  getArenaConfig: (projectPath: string) => ipcRenderer.invoke('arena:getConfig', projectPath),
  saveArenaConfig: (projectPath: string, patch: { checks?: CheckDefinition[]; arena?: ArenaSettings }) =>
    ipcRenderer.invoke('arena:saveConfig', projectPath, patch),
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
  onAIError: (sessionId: string, callback: (error: string, info?: ProviderErrorInfo) => void) => {
    const channel = `ai:error:${sessionId}`;
    // Второй аргумент — снимок ошибки провайдера (decision-43), может отсутствовать.
    const handler = (_event: any, data: any, info?: ProviderErrorInfo) => callback(data, info);
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

  // Глобальный push-to-talk и LLM-классификатор свободных команд (TASK-83)
  getPushToTalkStatus: () => ipcRenderer.invoke('voice:getPushToTalkStatus'),
  savePushToTalkSettings: (patch: Partial<PushToTalkSettings>) =>
    ipcRenderer.invoke('voice:savePushToTalkSettings', patch),
  classifyVoiceCommand: (request: VoiceClassifyRequest) => ipcRenderer.invoke('voice:classifyCommand', request),
  // Голос → компьютер и системная диктовка: HITL и allowlist применяет прокси в main (TASK-82)
  runVoiceComputerTask: (request: VoiceComputerTaskRequest) => ipcRenderer.invoke('voice:runComputerTask', request),
  dictateVoiceText: (request: VoiceDictateRequest) => ipcRenderer.invoke('voice:dictateText', request),
  // Горячая клавиша живёт в main, поэтому работает и при свёрнутом окне: старт/стоп приходят событием
  onPushToTalk: (callback: (event: PushToTalkEvent) => void) => {
    const handler = (_event: IpcRendererEvent, payload: PushToTalkEvent) => callback(payload);
    ipcRenderer.on('voice:push-to-talk', handler);
    return () => {
      ipcRenderer.removeListener('voice:push-to-talk', handler);
    };
  },
  onPushToTalkStatus: (callback: (status: PushToTalkStatus) => void) => {
    const handler = (_event: IpcRendererEvent, status: PushToTalkStatus) => callback(status);
    ipcRenderer.on('voice:push-to-talk-status', handler);
    return () => {
      ipcRenderer.removeListener('voice:push-to-talk-status', handler);
    };
  },

  // Локальный TTS на голосах Piper (TASK-69): генерация в воркере main, воспроизведение в рендерере
  getTtsStatus: () => ipcRenderer.invoke('tts:getStatus'),
  listTtsVoices: () => ipcRenderer.invoke('tts:listVoices'),
  downloadTtsVoice: (voiceId: string) => ipcRenderer.invoke('tts:downloadVoice', voiceId),
  cancelTtsVoiceDownload: (voiceId: string) => ipcRenderer.invoke('tts:cancelDownload', voiceId),
  deleteTtsVoice: (voiceId: string) => ipcRenderer.invoke('tts:deleteVoice', voiceId),
  importTtsVoice: () => ipcRenderer.invoke('tts:importVoice'),
  warmupTts: (voiceId: string) => ipcRenderer.invoke('tts:warmup', voiceId),
  speakTts: (req: { jobId: string; text: string; voiceId: string; speed?: number; speakerId?: number }) =>
    ipcRenderer.invoke('tts:speak', req),
  cancelTts: (jobId: string) => ipcRenderer.invoke('tts:cancel', jobId),
  cancelAllTts: () => ipcRenderer.invoke('tts:cancelAll'),
  // PCM приходит чанками по мере готовности: Float32Array переживает structured clone как есть
  onTtsChunk: (callback: (chunk: TtsChunkPayload) => void) => {
    const handler = (_event: IpcRendererEvent, chunk: TtsChunkPayload) => callback(chunk);
    ipcRenderer.on('tts:chunk', handler);
    return () => {
      ipcRenderer.removeListener('tts:chunk', handler);
    };
  },
  onTtsDone: (callback: (info: TtsDonePayload) => void) => {
    const handler = (_event: IpcRendererEvent, info: TtsDonePayload) => callback(info);
    ipcRenderer.on('tts:done', handler);
    return () => {
      ipcRenderer.removeListener('tts:done', handler);
    };
  },
  onTtsError: (callback: (info: TtsErrorPayload) => void) => {
    const handler = (_event: IpcRendererEvent, info: TtsErrorPayload) => callback(info);
    ipcRenderer.on('tts:error', handler);
    return () => {
      ipcRenderer.removeListener('tts:error', handler);
    };
  },
  onTtsDownloadProgress: (callback: (progress: TtsDownloadProgress) => void) => {
    const handler = (_event: IpcRendererEvent, progress: TtsDownloadProgress) => callback(progress);
    ipcRenderer.on('tts:downloadProgress', handler);
    return () => {
      ipcRenderer.removeListener('tts:downloadProgress', handler);
    };
  },

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

  // Управление компьютером через MCP-прокси: настройки, kill-switch, диагностика (TASK-82)
  getComputerUseStatus: () => ipcRenderer.invoke('computerUse:getStatus'),
  getComputerUseSettings: () => ipcRenderer.invoke('computerUse:getSettings'),
  saveComputerUseSettings: (patch: Partial<ComputerUseSettings>) => ipcRenderer.invoke('computerUse:saveSettings', patch),
  engageComputerKillSwitch: (reason?: 'overlay' | 'manual') => ipcRenderer.invoke('computerUse:engageKillSwitch', reason),
  releaseComputerKillSwitch: () => ipcRenderer.invoke('computerUse:releaseKillSwitch'),
  startComputerUseRuntime: () => ipcRenderer.invoke('computerUse:startRuntime'),
  runComputerUseDiagnostics: () => ipcRenderer.invoke('computerUse:diagnostics'),
  takeComputerTestScreenshot: () => ipcRenderer.invoke('computerUse:testScreenshot'),
  onComputerUseStatusChanged: (callback: (status: ComputerUseStatus) => void) => {
    const handler = (_event: IpcRendererEvent, status: ComputerUseStatus) => callback(status);
    ipcRenderer.on('computerUse:statusChanged', handler);
    return () => {
      ipcRenderer.removeListener('computerUse:statusChanged', handler);
    };
  },
  onComputerOverlayState: (callback: (state: ComputerOverlayState) => void) => {
    const handler = (_event: IpcRendererEvent, state: ComputerOverlayState) => callback(state);
    ipcRenderer.on('computerUse:overlay', handler);
    return () => {
      ipcRenderer.removeListener('computerUse:overlay', handler);
    };
  },

  // System Voice Overlay
  syncVoiceOverlay: (state: VoiceOverlayPayload) => ipcRenderer.send('voice:overlay-sync', state),
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

  // Федерация компьютеров, hub-режим (TASK-66)
  listFederationPeers: () => ipcRenderer.invoke('federation:listPeers'),
  addFederationPeer: (options: {
    hostId: string;
    machineName?: string;
    transport: 'lan' | 'relay';
    address: string;
    secretKey?: string;
    pin?: string;
    autoConnect?: boolean;
  }) => ipcRenderer.invoke('federation:addPeer', options),
  removeFederationPeer: (hostId: string) => ipcRenderer.invoke('federation:removePeer', hostId),
  connectFederationPeer: (hostId: string) => ipcRenderer.invoke('federation:connectPeer', hostId),
  disconnectFederationPeer: (hostId: string) => ipcRenderer.invoke('federation:disconnectPeer', hostId),
  federationCall: (hostId: string, method: string, params?: Record<string, unknown>) =>
    ipcRenderer.invoke('federation:call', hostId, method, params),
  getFederationHosts: () => ipcRenderer.invoke('federation:getHosts'),
  onFederationPeersChanged: (callback: (peers: unknown[]) => void) => {
    const handler = (_event: unknown, peers: unknown[]) => callback(peers);
    ipcRenderer.on('federation:peersChanged', handler);
    return () => {
      ipcRenderer.removeListener('federation:peersChanged', handler);
    };
  },
  onFederationEvent: (
    callback: (payload: { hostId: string; machineName: string; event: string; data: unknown }) => void
  ) => {
    const handler = (_event: unknown, payload: { hostId: string; machineName: string; event: string; data: unknown }) =>
      callback(payload);
    ipcRenderer.on('federation:event', handler);
    return () => {
      ipcRenderer.removeListener('federation:event', handler);
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

  // Уведомления: трей, ОС, звук, Telegram (TASK-63)
  getNotificationSettings: () => ipcRenderer.invoke('notifications:getSettings'),
  updateNotificationSettings: (patch: Partial<NotificationSettings>) =>
    ipcRenderer.invoke('notifications:updateSettings', patch),
  testNotification: () => ipcRenderer.invoke('notifications:test'),
  notificationNavigate: (action: NotificationAction) => ipcRenderer.invoke('notifications:navigate', action),
  startTelegramBot: () => ipcRenderer.invoke('notifications:startBot'),
  stopTelegramBot: () => ipcRenderer.invoke('notifications:stopBot'),
  listServiceProcesses: () => ipcRenderer.invoke('process:listService'),
  onNotificationDelivered: (callback: (delivery: NotificationDelivery) => void) => {
    const handler = (_event: unknown, data: NotificationDelivery) => callback(data);
    ipcRenderer.on('notify:delivered', handler);
    return () => {
      ipcRenderer.removeListener('notify:delivered', handler);
    };
  },
  onNotificationSound: (callback: (data: { severity: NotificationSeverity; volume: number }) => void) => {
    const handler = (_event: unknown, data: { severity: NotificationSeverity; volume: number }) => callback(data);
    ipcRenderer.on('notify:sound', handler);
    return () => {
      ipcRenderer.removeListener('notify:sound', handler);
    };
  },
  onNotificationNavigate: (callback: (action: NotificationAction) => void) => {
    const handler = (_event: unknown, data: NotificationAction) => callback(data);
    ipcRenderer.on('notify:navigate', handler);
    return () => {
      ipcRenderer.removeListener('notify:navigate', handler);
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






