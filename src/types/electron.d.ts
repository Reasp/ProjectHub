export interface ActionDefinition {
  name: string;
  command: string;
  autoOpenUrl?: string;
  requiresConfirmation?: boolean;
  env?: Record<string, string>;
  cwd?: string;
}

export interface ProjectActionConfig {
  run: ActionDefinition;
  deploy: ActionDefinition;
  test: ActionDefinition;
  customActions?: Array<ActionDefinition & { id: string }>;
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
  abortAIStream: (sessionId: string) => Promise<boolean>;
  applyAIDiff: (projectPath: string, relativePath: string, newContent: string) => Promise<boolean>;

  // Claude Bridge Approvals & Statuses
  getAllProjectStatuses: () => Promise<ProjectAgentStatus[]>;
  getProjectAgentStatus: (projectPath: string) => Promise<ProjectAgentStatus>;
  sendApprovalResponse: (requestId: string, response: { approved: boolean; text?: string }) => Promise<boolean>;
  getSubagents: (projectPath: string) => Promise<SubagentInfo[]>;
  getAvailableModels: () => Promise<ClaudeModelOption[]>;
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

  // File Explorer & Helpers
  readDirectoryTree: (projectPath: string, subDir?: string, maxDepth?: number) => Promise<FileTreeNode[]>;
  readFileContent: (projectPath: string, relativePath: string) => Promise<string>;
  saveFileContent: (projectPath: string, relativePath: string, content: string) => Promise<boolean>;
  createFileOrFolder: (projectPath: string, relativePath: string, isDirectory?: boolean) => Promise<boolean>;
  deleteFileOrFolder: (projectPath: string, relativePath: string) => Promise<boolean>;
  readFile: (projectPath: string, relativePath: string) => Promise<string>;
  writeFile: (projectPath: string, relativePath: string, content: string) => Promise<boolean>;
  listFiles: (projectPath: string, subDir?: string) => Promise<Array<{ name: string; isDirectory: boolean; relativePath: string }>>;

  // Local Whisper STT Engine
  transcribeLocalWhisper: (audioData: number[] | Float32Array, language?: 'ru' | 'en') => Promise<{ text: string; timeMs: number }>;
  getLocalWhisperStatus: () => Promise<{ status: 'unloaded' | 'loading' | 'ready' | 'error'; model: string; error?: string; loadTimeMs?: number }>;

  // System
  getPlatform: () => Promise<string>;
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
  };
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thought?: string;
  toolCalls?: AIToolCall[];
  timestamp: string;
}

export interface AIStreamRequest {
  sessionId: string;
  projectPath: string;
  messages: AIMessage[];
  config: AIProviderConfig;
  mode: 'chat' | 'agent' | 'architect';
  claudeCliSessionId?: string;
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







