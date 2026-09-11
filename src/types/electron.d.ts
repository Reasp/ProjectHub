export interface ActionDefinition {
  name: string;
  command: string;
  autoOpenUrl?: string;
  /** Задержка автооткрытия URL (мс), если сервер не напечатал адрес в лог; 0 — только по логу. */
  autoOpenDelayMs?: number;
  requiresConfirmation?: boolean;
  env?: Record<string, string>;
  cwd?: string;
  /**
   * Стратегия порта (TASK-62): `fixed` — как записано в команде; `auto` — ProjectHub
   * подбирает свободный порт, кладёт в `PORT` и подставляет вместо `${port}` в команде
   * и `autoOpenUrl`. Позволяет держать dev-серверы нескольких worktree одновременно.
   */
  portStrategy?: 'fixed' | 'auto';
  /** Порт, с которого начинать поиск при `portStrategy: 'auto'` (по умолчанию 5173). */
  port?: number;
}

/** Политика инициализации нового worktree (`.projecthub.json`, TASK-62). */
export interface WorktreeInitPolicy {
  /** Команды, выполняемые в новом worktree после его создания (например `npm ci`). */
  commands?: string[];
  /** Связать `node_modules` worktree с основным деревом (symlink/junction) вместо установки. */
  linkNodeModules?: boolean;
}

export interface ProjectActionConfig {
  run: ActionDefinition;
  deploy: ActionDefinition;
  test: ActionDefinition;
  customActions?: Array<ActionDefinition & { id: string }>;
  /** Что выполнить в новом worktree после создания (TASK-62). */
  worktreeInit?: WorktreeInitPolicy;
}

/** Стандартные действия из .projecthub.json. */
export type ProjectActionKind = 'run' | 'deploy' | 'test';

/** Параметры запуска процесса, берутся из `ActionDefinition` (env, cwd). */
export interface StartProcessOptions {
  env?: Record<string, string>;
  cwd?: string;
  autoOpenUrl?: string;
  autoOpenDelayMs?: number;
  /** Активное рабочее дерево (worktree или корень проекта) — входит в id процесса (TASK-62). */
  workspaceRoot?: string;
  portStrategy?: 'fixed' | 'auto';
  port?: number;
}

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
  voiceAlias?: string;
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
  /** Человек (свободный текст) или агент/роль: `agent:<roleSlug>` / `agent:<roleSlug>@<hostId>` (TASK-60). */
  assignee?: string[];
  created?: string;
  filePath: string;
  /** Сырой markdown-текст файла. В списке задач НЕ заполняется (TASK-38) — грузится по требованию через getTaskContent. */
  content?: string;
  description?: string;
  acceptanceCriteria?: TaskCriterion[];
  /** Ветка/worktree/PR, записанные автоматически при создании worktree и PR (TASK-64). */
  branch?: string;
  worktree?: string;
  pr?: string;
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
  /** Путь к шаблону ProjectTemplate для мастера создания проектов. */
  templatePath?: string;
}

export type TemplateSource = 'custom' | 'registry' | 'env' | 'dev-default' | 'none';

export interface TemplateAvailability {
  available: boolean;
  path: string;
  source: TemplateSource;
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

/** Статус встроенного MCP HTTP/SSE-сервера (main → renderer через getMcpStatus/onMcpStatusChanged). */
export interface McpServerStatus {
  isRunning: boolean;
  port: number;
  activeSessions: number;
  token: string;
  url: string;
  lastError: string | null;
}

/** Сведения экрана «Диагностика» (TASK-58): версии, пути, уровень логирования. */
export interface DiagnosticsInfo {
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  userDataDir: string;
  logsDir: string;
  crashDumpsDir: string;
  logLevel: string;
}

export type UpdaterState = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

/** Статус проверки обновлений (TASK-58, decision-14 п.2): push из main через onUpdaterStatusChanged. */
export interface UpdaterStatus {
  state: UpdaterState;
  currentVersion: string;
  latestVersion?: string;
  percent?: number;
  releaseUrl?: string;
  error?: string;
  supportsAutoInstall: boolean;
}

// Remote Control (TASK-51, TASK-65): единственный источник истины для этих типов — `./remote`
// (используется и рендерером, и main-процессом/remoteControlService). Раньше здесь были
// собственные, разошедшиеся с рантаймом определения (`relayUrl`, `qrPayload`, `clientType`,
// `connectionMode`, ...) — IPC фактически всегда отдавал форму из `./remote`, из-за чего
// `RemoteControlBadge.tsx` читал несуществующие поля (decision-11, TASK-65 п.7).
export type { FederationHost, RemoteDevice, RemoteControlStatus, PairedDevice, DeviceRights } from './remote';
export type { RemoteControlConfig as RemoteConfig } from './remote';

export interface ManagedProcess {
  id: string;
  name: string;
  command: string;
  /** Корень проекта, к которому привязан процесс (ключ для поиска в UI). */
  cwd: string;
  /** Рабочее дерево процесса (worktree), если он запущен не в основном дереве проекта. */
  workspaceRoot?: string;
  /** Фактический рабочий каталог, если `ActionDefinition.cwd` отличается от рабочего дерева. */
  workingDir?: string;
  /** Порт, выданный процессу при `portStrategy: 'auto'` (или заданный явно). */
  port?: number;
  pid?: number;
  startedAt: string;
  status: 'running' | 'stopped' | 'failed';
  exitCode?: number;
  source: 'hub' | 'env-tools';
  /** URL, который открывается после старта (только для hub-процессов из ActionDefinition). */
  autoOpenUrl?: string;
}

/** Результат политики `worktreeInit` для только что созданного worktree (TASK-62). */
export interface WorktreeInitOutcome {
  ran: boolean;
  linkedNodeModules?: boolean;
  commands?: string[];
  process?: ManagedProcess;
  error?: string;
}

/** Владелец порта (TASK-62). */
export interface PortOwner {
  pid: number;
  processId?: string;
  name?: string;
  workspaceRoot?: string;
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

export interface LocalWhisperStatusInfo {
  status: 'unloaded' | 'loading' | 'ready' | 'error';
  model: string;
  cacheDir?: string;
  workerActive?: boolean;
  queueLength?: number;
  error?: string;
  loadTimeMs?: number;
  respawnAttempts?: number;
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

/** Тип документа во frontmatter Backlog.md (`type:`), правило 13 CLAUDE.md. */
export type DocFileType = 'guide' | 'readme' | 'specification' | 'other';
/** Статус ADR во frontmatter Backlog.md (`status:`), правило 13 CLAUDE.md. */
export type DecisionStatus = 'accepted' | 'proposed' | 'rejected' | 'deprecated';

export interface CreateDocParams {
  type: 'doc' | 'decision';
  title: string;
  /** Для decision: accepted | proposed | rejected | deprecated (регистр не важен). */
  status?: string;
  /** Для doc: guide | readme | specification | other. По умолчанию other. */
  docType?: DocFileType;
  tags?: string[];
  /** Тело документа. Если содержит свой frontmatter — берётся только тело, frontmatter генерируется по стандарту. */
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
  setProjectVoiceAlias: (projectPath: string, alias: string) => Promise<boolean>;

  // Documentation & ADR Decisions
  listDocs: (projectPath: string) => Promise<DocItem[]>;
  readDoc: (filePath: string) => Promise<string>;
  saveDoc: (filePath: string, content: string) => Promise<boolean>;
  createDoc: (projectPath: string, params: CreateDocParams) => Promise<DocItem>;

  // Project Template Wizard
  createProjectFromTemplate: (options: CreateProjectOptions) => Promise<ProjectInfo>;
  checkTemplateAvailable: (customSource?: string) => Promise<TemplateAvailability>;
  setTemplatePath: (templatePath: string | null) => Promise<boolean>;

  // Background Processes & Terminal
  startProcess: (
    projectPath: string,
    command: string,
    name: string,
    options?: StartProcessOptions
  ) => Promise<ManagedProcess>;
  stopProcess: (processId: string) => Promise<boolean>;
  /** Кто слушает порт: pid и, если это процесс Hub, его id/имя/рабочее дерево (TASK-62). */
  listPortOwners: (port: number) => Promise<PortOwner[]>;
  /** Освободить порт: hub-процессы останавливаются штатно, посторонние pid'ы снимаются. */
  releasePort: (port: number) => Promise<{ killed: number[]; failed: number[] }>;
  restartProcess: (processId: string) => Promise<ManagedProcess>;
  listProcesses: (projectPath: string) => Promise<ManagedProcess[]>;
  tailProcessLog: (projectPath: string, processName: string, lines?: number) => Promise<string>;
  onProcessLogChunk: (callback: (data: { processId: string; text: string }) => void) => () => void;
  onProcessStatusChanged: (callback: (process: ManagedProcess) => void) => () => void;

  // Action Runner & Script Config (.projecthub.json)
  getActionConfig: (projectPath: string) => Promise<ProjectActionConfig>;
  saveActionConfig: (projectPath: string, config: ProjectActionConfig) => Promise<boolean>;

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
  /** Сырой markdown задачи (frontmatter + тело) по абсолютному пути файла; null, если файл не прочитан. */
  getTaskContent: (filePath: string) => Promise<string | null>;
  updateTaskStatus: (filePath: string, newStatus: string) => Promise<boolean>;
  saveTask: (filePath: string, content: string) => Promise<boolean>;
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
  ) => Promise<boolean>;
  toggleCriterion: (filePath: string, index: number, completed: boolean) => Promise<boolean>;
  createTask: (projectPath: string, task: { title: string; description: string; labels: string[]; type?: string; priority?: string; milestone?: string }) => Promise<BacklogTask | null>;
  deleteTask: (filePath: string) => Promise<boolean>;
  watchProjectTasks: (projectPath: string) => Promise<void>;
  onTasksChanged: (callback: (data: { projectPath: string; event: string; filePath: string }) => void) => () => void;

  // Milestones & Roadmap
  listMilestones: (projectPath: string) => Promise<Milestone[]>;
  createMilestone: (projectPath: string, params: CreateMilestoneParams) => Promise<Milestone | null>;
  saveMilestone: (filePath: string, params: Partial<CreateMilestoneParams>) => Promise<boolean>;
  deleteMilestone: (filePath: string) => Promise<boolean>;

  // Реестр ролей агентов (decision-9, TASK-60)
  listRoles: (projectPath?: string) => Promise<{ roles: RoleDefinition[]; errors: { error: string; filePath: string }[] }>;
  saveRole: (scope: 'global' | 'project', role: RoleDefinition, projectPath?: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  deleteRole: (scope: 'global' | 'project', slug: string, projectPath?: string) => Promise<boolean>;
  copyRoleToProject: (slug: string, projectPath: string) => Promise<RoleDefinition | null>;

  // Git Advanced
  getGitRepoDetails: (projectPath: string) => Promise<GitRepoDetails | null>;
  unwatchGit: (projectPath: string) => Promise<boolean>;
  checkoutBranch: (projectPath: string, branchName: string, createNew?: boolean) => Promise<boolean>;
  createBranch: (projectPath: string, branchName: string) => Promise<boolean>;
  deleteBranch: (projectPath: string, branchName: string, force?: boolean) => Promise<boolean>;
  mergeBranch: (projectPath: string, branchName: string) => Promise<{ success: boolean; error?: string }>;
  fetchRemote: (projectPath: string) => Promise<boolean>;
  pullRemote: (projectPath: string) => Promise<{ success: boolean; error?: string }>;
  pushRemote: (projectPath: string) => Promise<{ success: boolean; error?: string }>;
  discardFileChanges: (projectPath: string, filePath: string) => Promise<boolean>;
  getDiffBetween: (projectPath: string, targetA: string, targetB?: string, filePath?: string) => Promise<string>;
  stageFile: (projectPath: string, filePath: string) => Promise<boolean>;
  unstageFile: (projectPath: string, filePath: string) => Promise<boolean>;
  stageAll: (projectPath: string) => Promise<boolean>;
  commitChanges: (projectPath: string, message: string, stageAll?: boolean) => Promise<boolean>;
  getFileDiff: (projectPath: string, filePath: string, staged?: boolean) => Promise<string>;
  onGitChanged: (callback: (data: { projectPath: string }) => void) => () => void;
  getGitLog: (projectPath: string, maxCount?: number) => Promise<GitCommit[]>;
  getGitStatus: (projectPath: string) => Promise<any>;

  // Git Worktrees (TASK-53, TASK-55)
  listWorktrees: (projectPath: string) => Promise<GitWorktreeInfo[]>;
  addWorktree: (projectPath: string, options: AddWorktreeOptions) => Promise<GitWorktreeInfo>;
  removeWorktree: (projectPath: string, worktreePath: string, force?: boolean) => Promise<boolean>;
  pruneWorktrees: (projectPath: string) => Promise<boolean>;
  getWorktreeDiff: (projectPath: string, worktreeBranch: string, baseBranch: string, worktreePath?: string) => Promise<string>;
  mergeWorktree: (projectPath: string, worktreeBranch: string, targetBranch: string) => Promise<MergeWorktreeResult>;
  checkoutWorktreeFiles: (projectPath: string, branch: string, filePaths: string[]) => Promise<{ success: boolean; error?: string; files?: string[] }>;
  findOrphanedWorktrees: (projectPath: string, activeTaskIds: string[], activeSwarmIds: string[]) => Promise<OrphanedWorktreeScan>;
  cleanOrphanedWorktrees: (projectPath: string, worktreePaths: string[], branches: string[]) => Promise<CleanOrphanedResult>;

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

  // AI Studio & Claude Bridge Engine
  getAIConfig: () => Promise<AIProviderConfig>;
  saveAIConfig: (config: AIProviderConfig) => Promise<void>;
  getClaudeAuthStatus: () => Promise<ClaudeAuthStatus>;
  startClaudeLogin: () => Promise<boolean>;
  claudeLogout: () => Promise<boolean>;
  streamAIChat: (request: AIStreamRequest) => Promise<boolean>;
  /** Предпросмотр контекста агента для карточки в AI Studio (TASK-64), без запуска стрима. */
  previewAgentContext: (
    projectPath: string,
    taskId: string,
    contextParts?: Partial<Record<ContextPartKey, boolean>>
  ) => Promise<AgentContextPreview>;
  abortAIStream: (sessionId: string) => Promise<boolean>;
  /** Полная очистка сессии в main: одобрения, процессы, resume-id Claude CLI, подагенты (TASK-33). */
  clearAISession: (sessionId: string) => Promise<boolean>;
  applyAIDiff: (projectPath: string, relativePath: string, newContent: string) => Promise<boolean>;
  /** История диалогов AI Studio в файлах через main (TASK-35). */
  listAISessions: (projectPath: string) => Promise<AISession[]>;
  saveAISession: (projectPath: string, session: AISession) => Promise<boolean>;
  deleteAISession: (projectPath: string, sessionId: string) => Promise<boolean>;
  /** Одноразовая миграция сессий из localStorage; возвращает число импортированных. */
  importAISessions: (sessionsByProject: Record<string, AISession[]>) => Promise<number>;

  // Claude Bridge Approvals & Statuses
  getAllProjectStatuses: () => Promise<ProjectAgentStatus[]>;
  getProjectAgentStatus: (projectPath: string) => Promise<ProjectAgentStatus>;
  sendApprovalResponse: (requestId: string, response: { approved: boolean; text?: string }) => Promise<boolean>;
  getSubagents: (projectPath: string) => Promise<SubagentInfo[]>;
  getAvailableModels: () => Promise<ClaudeModelOption[]>;
  getClaudeUsage: (forceRefresh?: boolean) => Promise<ClaudeUsageData>;
  onProjectAgentStatusChanged: (callback: (status: ProjectAgentStatus) => void) => () => void;
  onSubagentUpdated: (callback: (subagent: SubagentInfo) => void) => () => void;

  onAIChunk: (
    sessionId: string,
    callback: (chunk: {
      text?: string;
      thought?: string;
      toolCall?: AIToolCall;
      approvalRequest?: ApprovalRequest;
      subagent?: SubagentInfo;
      status?: AgentStatusType;
      claudeCliSessionId?: string;
      rateLimitWarning?: RateLimitWarning;
    }) => void
  ) => () => void;
  onAIComplete: (sessionId: string, callback: (message: AIMessage) => void) => () => void;
  onAIError: (sessionId: string, callback: (error: string) => void) => () => void;

  // Multi-Agent Swarm & Fleet Orchestration (TASK-54)
  startSwarmFanOut: (options: StartFanOutOptions) => Promise<SwarmSession>;
  startSwarmHandoff: (options: StartHandoffOptions) => Promise<SwarmSession>;
  runAssignedAgent: (options: {
    projectPath: string;
    taskId: string;
    taskTitle?: string;
    prompt: string;
    roleSlug: string;
    hostId?: string;
  }) => Promise<SwarmSession | { error: string }>;
  stopSwarm: (swarmId: string) => Promise<boolean>;
  pickSwarmWinner: (swarmId: string, winnerAgentId: string, mergeIntoBase?: boolean) => Promise<{ success: boolean; error?: string; mergedBranch?: string }>;
  getSwarm: (swarmId: string) => Promise<SwarmSession | undefined>;
  listSwarms: (projectPath?: string) => Promise<SwarmSession[]>;
  onSwarmEvent: (callback: (event: SwarmEventPayload) => void) => () => void;
  // Персистентность, транскрипты и экспорт swarm-сессий (TASK-56)
  resumeSwarm: (swarmId: string) => Promise<{ success: boolean; error?: string }>;
  discardSwarm: (swarmId: string, cleanupWorktrees?: boolean) => Promise<{ success: boolean; error?: string }>;
  getSwarmTranscript: (swarmId: string, agentId: string) => Promise<SwarmTranscript | null>;
  exportSwarm: (swarmId: string, format: SwarmExportFormat) => Promise<string | null>;
  exportSwarmToFile: (swarmId: string, format: SwarmExportFormat) => Promise<{ success: boolean; path?: string; error?: string; canceled?: boolean }>;

  // File Explorer & Helpers
  readDirectoryTree: (projectPath: string, subDir?: string, maxDepth?: number) => Promise<FileTreeNode[]>;
  readFileContent: (projectPath: string, relativePath: string) => Promise<string>;
  saveFileContent: (projectPath: string, relativePath: string, content: string) => Promise<boolean>;
  createFileOrFolder: (projectPath: string, relativePath: string, isDirectory?: boolean) => Promise<boolean>;
  deleteFileOrFolder: (projectPath: string, relativePath: string) => Promise<boolean>;

  // Local Whisper STT Engine
  transcribeLocalWhisper: (audioData: number[] | Float32Array, language?: 'ru' | 'en') => Promise<{ text: string; timeMs: number }>;
  getLocalWhisperStatus: () => Promise<LocalWhisperStatusInfo>;
  warmupLocalWhisper: () => Promise<LocalWhisperStatusInfo>;

  // System
  getPlatform: () => Promise<string>;

  // SafeStorage & Secret Encryption
  isEncryptionAvailable: () => Promise<boolean>;
  encryptSecret: (text: string) => Promise<string>;
  decryptSecret: (cipherText: string) => Promise<string>;
  saveEncryptedSecret: (key: string, value: string) => Promise<boolean>;
  getEncryptedSecret: (key: string) => Promise<string | null>;
  deleteEncryptedSecret: (key: string) => Promise<boolean>;

  // Remote MCP Server
  getMcpStatus: () => Promise<McpServerStatus>;
  toggleMcpServer: (enable: boolean) => Promise<McpServerStatus>;
  regenerateMcpToken: () => Promise<string>;
  setMcpAppState: (state: { activeProject?: any; activeTab?: string }) => Promise<boolean>;
  /** Push-статус MCP-сервера из main (старт/стоп, токен, SSE-сессии) — вместо опроса по таймеру. */
  onMcpStatusChanged: (callback: (status: McpServerStatus) => void) => () => void;
  onRemoteAction: (callback: (action: { type: string; payload: any }) => void) => () => void;

  // System Voice Overlay
  syncVoiceOverlay: (state: {
    isListening: boolean;
    isPaused: boolean;
    state: string;
    transcript: string;
    audioLevel: number;
  }) => void;
  onVoiceOverlayUpdate: (callback: (state: {
    isListening: boolean;
    isPaused: boolean;
    state: string;
    transcript: string;
    audioLevel: number;
  }) => void) => () => void;
  sendVoiceOverlayAction: (action: 'toggle-pause' | 'stop') => void;
  onVoiceExternalControl: (callback: (action: 'toggle-pause' | 'stop') => void) => () => void;

  // Внешние ссылки (http/https/mailto) — открываются в системном браузере, а не в окне Electron
  openExternal: (url: string) => Promise<boolean>;

  // Remote Control (TASK-51)
  getRemoteStatus: () => Promise<RemoteControlStatus>;
  toggleRemoteControl: (enable?: boolean) => Promise<RemoteControlStatus>;
  updateRemoteConfig: (config: Partial<RemoteConfig>) => Promise<RemoteControlStatus>;
  regenerateRemoteToken: () => Promise<RemoteControlStatus>;
  disconnectRemoteDevice: (deviceId: string) => Promise<boolean>;
  approveRemoteDevice: (deviceId: string) => Promise<boolean>;
  setRemoteDeviceRights: (deviceId: string, rights: DeviceRights) => Promise<RemoteControlStatus>;
  revokeRemoteDevice: (deviceId: string) => Promise<RemoteControlStatus>;
  testTelegramNotification: (text?: string) => Promise<boolean>;
  startRemoteTunnel: () => Promise<string>;
  stopRemoteTunnel: () => Promise<RemoteControlStatus>;
  onRemoteControlStatusChanged: (callback: (status: RemoteControlStatus) => void) => () => void;
  onRemoteHitlDecisionMade: (callback: (data: { requestId: string; sessionId: string; approved: boolean; byDevice: string }) => void) => () => void;

  // Федерация компьютеров: hub-режим, ПК как клиент другого ПК (TASK-66, decision-11 п.4)
  listFederationPeers: () => Promise<FederationPeerState[]>;
  addFederationPeer: (options: {
    hostId: string;
    machineName?: string;
    transport: FederationTransport;
    address: string;
    secretKey?: string;
    pin?: string;
    autoConnect?: boolean;
  }) => Promise<FederationPeerState>;
  removeFederationPeer: (hostId: string) => Promise<FederationPeerState[]>;
  connectFederationPeer: (hostId: string) => Promise<FederationPeerState>;
  disconnectFederationPeer: (hostId: string) => Promise<FederationPeerState>;
  federationCall: <T = unknown>(hostId: string, method: RemoteRpcMethod | string, params?: Record<string, unknown>) => Promise<T>;
  getFederationHosts: () => Promise<FederationHost[]>;
  onFederationPeersChanged: (callback: (peers: FederationPeerState[]) => void) => () => void;
  onFederationEvent: (
    callback: (payload: { hostId: string; machineName: string; event: string; data: unknown }) => void
  ) => () => void;

  // Единый HITL-контур: очередь, решения по requestId, аудит, шина событий (TASK-57)
  listPendingApprovals: (filter?: { projectPath?: string; sessionId?: string }) => Promise<ApprovalRequest[]>;
  decideApproval: (requestId: string, response: { approved: boolean; text?: string }) => Promise<HitlDecideResult>;
  listHitlAudit: (query?: HitlAuditQuery) => Promise<HitlAuditEntry[]>;
  listHitlAuditMonths: () => Promise<string[]>;
  getHitlInfo: () => Promise<{ auditDir: string | null; queueDir: string | null; hostId: string }>;
  exportHitlAudit: (query?: HitlAuditQuery, format?: 'jsonl' | 'json' | 'csv') => Promise<{ success: boolean; path?: string; error?: string; canceled?: boolean }>;
  onBusEvent: (callback: (event: AppBusEvent) => void) => () => void;

  // Уведомления: трей, ОС, звук, Telegram (TASK-63)
  getNotificationSettings: () => Promise<NotificationSettingsState>;
  updateNotificationSettings: (patch: Partial<NotificationSettings>) => Promise<NotificationSettings>;
  testNotification: () => Promise<NotificationDelivery>;
  notificationNavigate: (action: NotificationAction) => Promise<boolean>;
  startTelegramBot: () => Promise<{ ok: boolean; error?: string; running: boolean; processId: string | null }>;
  stopTelegramBot: () => Promise<{ ok: boolean; running: boolean; processId: string | null }>;
  listServiceProcesses: () => Promise<ManagedProcess[]>;
  onNotificationDelivered: (callback: (delivery: NotificationDelivery) => void) => () => void;
  onNotificationSound: (callback: (data: { severity: NotificationSeverity; volume: number }) => void) => () => void;
  onNotificationNavigate: (callback: (action: NotificationAction) => void) => () => void;

  // Диагностика и автообновление (TASK-58)
  getDiagnosticsInfo: () => Promise<DiagnosticsInfo>;
  collectDiagnosticsArchive: () => Promise<{ success: boolean; path?: string; error?: string; canceled?: boolean }>;
  getUpdaterStatus: () => Promise<UpdaterStatus>;
  checkForUpdates: () => Promise<UpdaterStatus>;
  installUpdateNow: () => Promise<boolean>;
  onUpdaterStatusChanged: (callback: (status: UpdaterStatus) => void) => () => void;
}

export interface FileTreeNode {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  size?: number;
  extension?: string;
  children?: FileTreeNode[];
}

export type AgentStatusType = 'idle' | 'running' | 'waiting_approval' | 'done' | 'error';

export interface ProjectAgentStatus {
  projectPath: string;
  projectName: string;
  status: AgentStatusType;
  lastMessage?: string;
  pendingApproval?: ApprovalRequest;
  activeSubagentsCount?: number;
  updatedAt: number;
}

export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface QuestionData {
  title: string;
  subtitle?: string;
  options: QuestionOption[];
  isMultiSelect?: boolean;
  allowOther?: boolean;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  projectPath: string;
  type: 'command' | 'file_write' | 'question' | 'subagent_dispatch';
  title: string;
  details?: string;
  command?: string;
  filePath?: string;
  diff?: {
    filePath: string;
    oldContent: string;
    newContent: string;
    patch: string;
  };
  questionData?: QuestionData;
  createdAt: number;
  /** Метаданные единого HITL-контура (TASK-57). */
  origin?: HitlOrigin;
  engine?: HitlEngine;
  agentId?: string;
  agentName?: string;
  role?: string;
  hostId?: string;
  tool?: string;
  expiresAt?: number;
  /** Восстановлен после перезапуска: агент уже не ждёт ответа, решение попадёт только в аудит. */
  orphaned?: boolean;
}

export interface SubagentInfo {
  id: string;
  parentSessionId: string;
  projectPath: string;
  name: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  progress?: string;
  output?: string;
  startedAt: number;
  completedAt?: number;
}

export interface ClaudeModelOption {
  id: string;
  name: string;
  description: string;
  badge?: string;
  family: 'default' | 'sonnet' | 'opus' | 'haiku' | 'fable';
}

export interface RateLimitWarning {
  id: string;
  type: 'rate_limit' | 'context_window' | 'quota_warning' | 'throttled';
  title: string;
  message: string;
  utilization?: number;
  resetsAt?: string;
  tier?: string;
  timestamp: number;
}

export interface ClaudeAuthStatus {
  isLoggedIn: boolean;
  email?: string;
  displayName?: string;
  seatTier?: string;
  organizationName?: string;
}

export interface AutoApproveRules {
  enabled: boolean;
  allowCommands: boolean;
  allowFileWrite: boolean;
  allowFileRead: boolean;
  allowSubagents: boolean;
  writeExcludePatterns: string[];
  readExcludePatterns: string[];
  commandDenyList: string[];
  /** Таймаут команд агента (run_command) в секундах; по умолчанию 5 минут (TASK-33). */
  commandTimeoutSec?: number;
  /** Таймаут ожидания решения человека в минутах; по умолчанию 24 часа (TASK-57). */
  approvalTimeoutMin?: number;
  /** Allow-список инструментов (права роли, decision-9); пустой — без ограничений. */
  allowedTools?: string[];
}

// ─────────────────── Единый HITL-контур (TASK-57), зеркало electron/services/hitlTypes.ts ───────────────────

export type HitlOrigin = 'studio' | 'swarm' | 'handoff' | 'assigned';
export type HitlEngine = 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'api';
export type HitlDecisionSourceKind = 'local' | 'remote' | 'mcp' | 'auto' | 'timeout' | 'cancelled' | 'shutdown';
export type HitlOutcome = 'executed' | 'failed' | 'not_executed' | 'session_gone';

export interface HitlDecisionSource {
  kind: HitlDecisionSourceKind;
  deviceId?: string;
  deviceName?: string;
  rule?: string;
}

export interface RolePermissions {
  autoApprove?: boolean;
  allowCommands?: boolean;
  allowFileWrite?: boolean;
  allowFileRead?: boolean;
  allowSubagents?: boolean;
  writeExcludePatterns?: string[];
  readExcludePatterns?: string[];
  commandDenyList?: string[];
  commandTimeoutSec?: number;
  allowedTools?: string[];
  approvalTimeoutMin?: number;
}

// Реестр ролей агентов (decision-9, TASK-60). Зеркало `electron/services/roleTypes.ts`.
export type RoleEngine = 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'api';
export type RoleSource = 'builtin' | 'global' | 'project';
export type ToolCategory = 'read' | 'write' | 'command' | 'search' | 'subagent' | 'question';

export interface RoleDefinition {
  slug: string;
  name: string;
  engine?: RoleEngine;
  provider?: string;
  model?: string;
  tools?: ToolCategory[];
  permissions?: RolePermissions;
  dod?: string[];
  handoffTo?: string[];
  maxTurns?: number;
  budgetUsd?: number;
  systemPrompt: string;
  source: RoleSource;
  filePath?: string;
}

export interface HitlAuditEntry {
  ts: string;
  kind: 'decision' | 'outcome' | 'fallback';
  requestId: string;
  sessionId: string;
  projectPath: string;
  hostId?: string;
  origin?: HitlOrigin;
  engine?: HitlEngine;
  agentId?: string;
  agentName?: string;
  role?: string;
  tool?: string;
  type?: ApprovalRequest['type'];
  title?: string;
  filePath?: string;
  commandHash?: string;
  commandPreview?: string;
  decision?: 'allow' | 'deny';
  decidedBy?: HitlDecisionSourceKind;
  deviceId?: string;
  deviceName?: string;
  rule?: string;
  comment?: string;
  waitedMs?: number;
  outcome?: HitlOutcome;
  detail?: string;
}

export interface HitlAuditQuery {
  month?: string;
  sessionId?: string;
  projectPath?: string;
  decidedBy?: HitlDecisionSourceKind;
  decision?: 'allow' | 'deny';
  kind?: HitlAuditEntry['kind'];
  origin?: HitlOrigin;
  search?: string;
  limit?: number;
}

export type HitlDecideResult =
  | { ok: true; sessionId: string; projectPath: string }
  | { ok: false; reason: 'not_found' | 'already_decided' };

export interface AgentEventBase {
  sessionId: string;
  projectPath: string;
  origin: HitlOrigin;
  engine?: HitlEngine;
  agentId?: string;
  agentName?: string;
  role?: string;
  hostId?: string;
  at: number;
}

export type AppBusEvent =
  | { type: 'hitl:requested'; request: ApprovalRequest }
  | { type: 'hitl:decided'; request: ApprovalRequest; approved: boolean; source: HitlDecisionSource; comment?: string }
  | { type: 'hitl:expired'; request: ApprovalRequest }
  | { type: 'hitl:cancelled'; request: ApprovalRequest; reason?: string }
  | {
      type: 'hitl:fallback';
      sessionId: string;
      projectPath: string;
      origin: HitlOrigin;
      engine: HitlEngine;
      agentId?: string;
      agentName?: string;
      role?: string;
      reason: string;
      at: number;
    }
  | ({ type: 'agent:started' } & AgentEventBase)
  | ({ type: 'agent:finished'; outcome: 'done' | 'aborted'; durationMs?: number } & AgentEventBase)
  | ({ type: 'agent:failed'; error: string; durationMs?: number } & AgentEventBase)
  // События уведомлений (TASK-63, decision-13 п.1)
  | {
      type: 'swarm:finished';
      swarmId: string;
      projectPath: string;
      name: string;
      mode: 'fan-out' | 'handoff';
      outcome: 'completed' | 'failed' | 'stopped';
      agentsTotal: number;
      agentsFailed: number;
      totalCostUsd?: number;
      durationMs?: number;
      hostId?: string;
      at: number;
    }
  | { type: 'process:crashed'; processId: string; name: string; projectPath: string; exitCode?: number; hostId?: string; at: number }
  | { type: 'pr:created'; projectPath: string; number: number; title: string; url: string; hostId?: string; at: number }
  | { type: 'pr:checksFailed'; projectPath: string; number: number; title: string; url: string; hostId?: string; at: number }
  | {
      type: 'remote:deviceConnected';
      deviceId: string;
      deviceName: string;
      mode: string;
      isApproved: boolean;
      hostId?: string;
      at: number;
    };

// ─────────────────── Уведомления (TASK-63, decision-13) — зеркало electron/services/notificationTypes.ts ───────────────────

export type NotificationChannel = 'tray' | 'os' | 'sound' | 'telegram' | 'remote';

export type NotificationKind =
  | 'hitl'
  | 'agentFinished'
  | 'agentFailed'
  | 'swarmFinished'
  | 'processCrashed'
  | 'prCreated'
  | 'prChecksFailed'
  | 'deviceConnected';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

export type NotificationAction =
  | { type: 'openHitl'; requestId?: string }
  | { type: 'openSwarm'; projectPath?: string; sessionId?: string }
  | { type: 'openProcesses'; projectPath?: string }
  | { type: 'openPrs'; projectPath?: string; url?: string }
  | { type: 'openRemote' }
  | { type: 'openApp' };

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  at: number;
  dedupKey: string;
  projectPath?: string;
  projectName?: string;
  hostId?: string;
  requestId?: string;
  sessionId?: string;
  action?: NotificationAction;
}

export interface QuietHoursSettings {
  enabled: boolean;
  from: string;
  to: string;
  allowCritical: boolean;
}

export interface NotificationSettings {
  enabled: boolean;
  channels: Record<NotificationKind, NotificationChannel[]>;
  quietHours: QuietHoursSettings;
  soundVolume: number;
  dedupWindowMs: number;
  minimizeToTray: boolean;
  telegramBotAutoStart: boolean;
}

export interface NotificationCapabilities {
  osNotifications: boolean;
  /** Кнопки «Разрешить/Отклонить» прямо в системном уведомлении (только macOS). */
  osActions: boolean;
  tray: boolean;
  telegram: boolean;
}

export interface NotificationDelivery {
  notification: AppNotification;
  channels: NotificationChannel[];
}

export interface NotificationSettingsState {
  settings: NotificationSettings;
  capabilities: NotificationCapabilities;
  bot: { running: boolean; processId: string | null; configured: boolean };
}

export interface AIProviderConfig {
  provider: 'anthropic' | 'openrouter' | 'deepseek' | 'ollama' | 'custom';
  apiKey?: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  thinkingBudget?: number;
  autoApprove?: boolean;
  autoApproveRules?: AutoApproveRules;
}

export interface AIToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  status?: 'pending' | 'accepted' | 'rejected' | 'running' | 'done' | 'error';
  result?: any;
  diff?: {
    filePath: string;
    oldContent: string;
    newContent: string;
    patch: string;
    /** Содержимое усечено при сохранении на диск (TASK-35); полный текст был доступен только в живой сессии. */
    truncated?: boolean;
  };
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thought?: string;
  toolCalls?: AIToolCall[];
  timestamp: string;
  /** Токены и стоимость ответа модели, если провайдер их сообщил (TASK-56). */
  usage?: AgentUsage;
}

/** Диалог AI Studio; хранится файлом `~/.projecthub/sessions/<hash(projectPath)>/<id>.json` (TASK-35). */
/** Части контекста агента (TASK-64) — что показывает `ContextAppliedCard` и что можно отключить на сессию. */
export type ContextPartKey = 'task' | 'rag' | 'gitnexus' | 'git';

/** Результат `contextBuilder.buildAgentContext` (main) — зеркало `AgentContextResult` для превью в AI Studio. */
export interface AgentContextPreview {
  combined: string;
  parts: Array<{ key: ContextPartKey; label: string; text: string }>;
  includedKeys: ContextPartKey[];
  truncatedKeys: ContextPartKey[];
}

export interface AISession {
  id: string;
  title: string;
  createdAt: number;
  messages: AIMessage[];
  claudeCliSessionId?: string;
  /** Задача, привязанная к сессии (TASK-64) — по ней contextBuilder собирает контекст на каждое сообщение. */
  activeTaskId?: string;
  /** Какие части контекста включены; по умолчанию (без поля) — все. */
  contextParts?: Partial<Record<ContextPartKey, boolean>>;
}

export interface AIStreamRequest {
  sessionId: string;
  projectPath: string;
  messages: AIMessage[];
  config: AIProviderConfig;
  mode: 'chat' | 'agent' | 'architect';
  claudeCliSessionId?: string;
  taskId?: string;
  contextParts?: Partial<Record<ContextPartKey, boolean>>;
  /** Активное рабочее дерево (worktree) — рабочий каталог агента; backlog общий (TASK-62). */
  workspaceRoot?: string;
}

export interface GitWorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
  isDetached: boolean;
  isLocked: boolean;
  lockReason?: string;
  isPrunable: boolean;
  pruneReason?: string;
  isMain: boolean;
  taskId?: string;
  /** Что отработала политика `worktreeInit` сразу после создания дерева (TASK-62). */
  init?: WorktreeInitOutcome;
}

export interface AddWorktreeOptions {
  branch: string;
  newBranch?: boolean;
  baseCommitOrBranch?: string;
  customPath?: string;
}

export interface MergeWorktreeResult {
  success: boolean;
  error?: string;
  conflictedFiles?: string[];
  wasAborted?: boolean;
  uncleanWorkingTree?: boolean;
}

export interface OrphanedWorktreeScan {
  orphanedWorktrees: GitWorktreeInfo[];
  orphanedPaths: string[];
  orphanedBranches: string[];
}

export interface CleanOrphanedResult {
  removedWorktrees: string[];
  removedBranches: string[];
  deletedBranches?: string[];
  errors: string[];
}

export interface PtySession {
  id: string;
  projectPath: string;
  cwd?: string;
  worktreeBranch?: string;
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
  cwd?: string;
  worktreeBranch?: string;
  projectName?: string;
  type: 'claude' | 'shell';
  title?: string;
  cols?: number;
  rows?: number;
}

export interface ClaudeUsageLimitWindow {
  percent: number;
  resetsAt?: string;
}

export interface ClaudeUsageBreakdownItem {
  name: string;
  percent: number;
}

export interface ClaudeUsageBreakdown {
  requests?: number;
  sessions?: number;
  contextAbove150kPercent?: number;
  subagentHeavyPercent?: number;
  sessionsOver8hPercent?: number;
  topSkills?: ClaudeUsageBreakdownItem[];
  topSubagents?: ClaudeUsageBreakdownItem[];
  topMcpServers?: ClaudeUsageBreakdownItem[];
}

export interface ClaudeModelTokenStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD?: number;
}

export interface ClaudeUsageData {
  planType: string;
  sessionLimit?: ClaudeUsageLimitWindow;
  weeklyLimit?: ClaudeUsageLimitWindow;
  fableLimit?: ClaudeUsageLimitWindow;
  last24h?: ClaudeUsageBreakdown;
  last7d?: ClaudeUsageBreakdown;
  totalSessions?: number;
  totalMessages?: number;
  modelUsage?: Record<string, ClaudeModelTokenStats>;
  dailyActivity?: {
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }[];
  rawText?: string;
  updatedAt: number;
  isFallback?: boolean;
}

declare global {
  interface Window {
    api: IElectronAPI;
  }
}

// Multi-Agent Swarm & Fleet Orchestration Types (TASK-54, TASK-56)
// Зеркало `electron/services/swarmTypes.ts` и `agentCost.ts`.
export type SwarmMode = 'fan_out' | 'handoff';
export type SwarmStatus = 'idle' | 'preparing' | 'running' | 'completed' | 'failed' | 'stopped' | 'interrupted';
export type AgentSlotStatus =
  | 'pending'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'interrupted'
  | 'budget_exceeded';

export type AgentCostSource = 'provider' | 'price-table' | 'unknown';

/** Реальный usage и стоимость ответа модели/прогона агента (TASK-56). */
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd?: number;
  costSource: AgentCostSource;
  model?: string;
  turns?: number;
}

export interface AgentSlotConfig {
  id: string;
  name: string;
  engine: 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'api';
  /** Отображаемая метка роли (для UI/логов/HITL-карточек). */
  role?: string;
  /** slug роли из реестра (decision-9, TASK-60) — предзаполняет engine/model/permissions в UI. */
  roleSlug?: string;
  providerConfig?: AIProviderConfig;
  /** Доп. инструкции слота поверх системного промпта роли. */
  systemPromptAddon?: string;
  /** Бюджет слота/роли в USD; при превышении агент останавливается. */
  budgetUsd?: number;
  /** Права роли для HITL: сужают глобальные настройки auto-approve (TASK-57). */
  permissions?: RolePermissions;
}

export interface AgentSlotDiffSummary {
  filesChanged: number;
  insertions: number;
  deletions: number;
  patch: string;
  truncated?: boolean;
}

export interface AgentSlotMetrics {
  startTime: number;
  endTime?: number;
  durationMs?: number;
  charsGenerated?: number;
  tokensEstimated?: number;
  speedCharsPerSec?: number;
  usage?: AgentUsage;
  costUsd?: number;
}

export interface AgentSlotState {
  id: string;
  config: AgentSlotConfig;
  status: AgentSlotStatus;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeMissing?: boolean;
  /** Хвост логов (кольцевой буфер); полный транскрипт читается через getSwarmTranscript. */
  logs: string[];
  logsDropped?: number;
  liveOutput: string;
  liveOutputTruncated?: boolean;
  finalOutput?: string;
  diffSummary?: AgentSlotDiffSummary;
  metrics: AgentSlotMetrics;
  winner?: boolean;
  error?: string;
  commitHash?: string;
  stashHash?: string;
  commitStatus?: 'committed' | 'stashed' | 'no_changes' | 'pending';
  lastCommitHash?: string;
  resumeCount?: number;
}

export interface HandoffStageState {
  stageIndex: number;
  role: string;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  inputPrompt: string;
  instructions?: string;
  /** Сырой вывод агента (устаревшее; для новых сессий используйте summary+reportPath). */
  outputResult?: string;
  /** Артефакт этапа (decision-9 п.5): усечённое резюме для промпта следующего этапа. */
  summary?: string;
  /** Путь к полному отчёту этапа в общем worktree. */
  reportPath?: string;
  /** Коммит, которым зафиксирован результат этапа. */
  commitHash?: string;
  durationMs?: number;
}

export interface SwarmSession {
  id: string;
  projectPath: string;
  taskId?: string;
  taskTitle?: string;
  /** Источник запуска для HITL/аудита (TASK-60): по умолчанию выводится из `mode`. */
  origin?: 'swarm' | 'assigned';
  mode: SwarmMode;
  prompt: string;
  baseBranch: string;
  useWorktrees: boolean;
  autoCommitAgentResults?: boolean;
  status: SwarmStatus;
  createdAt: number;
  completedAt?: number;
  interruptedAt?: number;
  agents: AgentSlotState[];
  handoffStages?: HandoffStageState[];
  currentHandoffStageIndex?: number;
  winnerAgentId?: string;
  error?: string;
  budgetUsd?: number;
  totalCostUsd?: number;
  restored?: boolean;
}

export interface StartFanOutOptions {
  projectPath: string;
  prompt: string;
  taskId?: string;
  taskTitle?: string;
  baseBranch?: string;
  useWorktrees?: boolean;
  autoCommitAgentResults?: boolean;
  budgetUsd?: number;
  agents: AgentSlotConfig[];
  /** Источник запуска для HITL/аудита (TASK-60); по умолчанию 'swarm'. */
  origin?: 'swarm' | 'assigned';
}

export interface StartHandoffOptions {
  projectPath: string;
  prompt: string;
  taskId?: string;
  taskTitle?: string;
  baseBranch?: string;
  useWorktrees?: boolean;
  autoCommitAgentResults?: boolean;
  budgetUsd?: number;
  stages: {
    role: string;
    agent: AgentSlotConfig;
    instructions?: string;
  }[];
}

export interface SwarmEventPayload {
  type: 'swarm_updated' | 'agent_updated' | 'agent_chunk' | 'swarm_completed' | 'swarm_removed' | 'error';
  swarmId: string;
  agentId?: string;
  session?: SwarmSession;
  chunk?: string;
  error?: string;
}

export interface SwarmTranscript {
  swarmId: string;
  agentId: string;
  path: string;
  content: string;
  truncated: boolean;
  sizeBytes: number;
}

export type SwarmExportFormat = 'markdown' | 'json';








