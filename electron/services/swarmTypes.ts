/**
 * Типы Swarm/Fleet (TASK-54, TASK-56). Вынесены из agentFleetService, чтобы хранилище,
 * экспорт и расчёт стоимости не тянули за собой сервис с процессами и git.
 * Зеркало для рендерера — `src/types/electron.d.ts`.
 */
import type { AIProviderConfig } from './aiAgentService.js';
import type { AgentUsage } from './agentCost.js';

export type SwarmMode = 'fan_out' | 'handoff';
export type SwarmStatus =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  /** Приложение перезапустилось во время прогона; сессию можно возобновить или закрыть (TASK-56). */
  | 'interrupted';
export type AgentSlotStatus =
  | 'pending'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'interrupted'
  /** Остановлен по превышению бюджета `budgetUsd` (TASK-56). */
  | 'budget_exceeded';

export interface AgentSlotConfig {
  id: string;
  name: string;
  engine: 'claude-cli' | 'codex-cli' | 'api';
  role?: string;
  providerConfig?: AIProviderConfig;
  systemPromptAddon?: string;
  cliCommand?: string;
  /** Бюджет роли/слота в USD; при превышении агент останавливается (decision-9, TASK-56). */
  budgetUsd?: number;
}

export interface AgentSlotDiffSummary {
  filesChanged: number;
  insertions: number;
  deletions: number;
  patch: string;
  /** Патч усечён при сохранении на диск. */
  truncated?: boolean;
}

export interface AgentSlotMetrics {
  startTime: number;
  endTime?: number;
  durationMs?: number;
  charsGenerated?: number;
  /** Грубая оценка chars/4 — только когда реального usage нет. */
  tokensEstimated?: number;
  speedCharsPerSec?: number;
  /** Реальный usage и стоимость (stream-json Claude CLI, usage API-провайдера, итоговые строки CLI). */
  usage?: AgentUsage;
  costUsd?: number;
}

export interface AgentSlotState {
  id: string;
  config: AgentSlotConfig;
  status: AgentSlotStatus;
  worktreePath?: string;
  worktreeBranch?: string;
  /** Worktree не найден на диске/в `git worktree list` при восстановлении сессии. */
  worktreeMissing?: boolean;
  commitHash?: string;
  stashHash?: string;
  lastCommitHash?: string;
  commitStatus?: 'committed' | 'stashed' | 'no_changes' | 'pending';
  /** Хвост логов (кольцевой буфер); полный транскрипт — в файле. */
  logs: string[];
  logsDropped?: number;
  liveOutput: string;
  liveOutputTruncated?: boolean;
  finalOutput?: string;
  diffSummary?: AgentSlotDiffSummary;
  metrics: AgentSlotMetrics;
  winner?: boolean;
  error?: string;
  /** Сколько раз агент перезапускался после прерывания. */
  resumeCount?: number;
}

export interface HandoffStageState {
  stageIndex: number;
  role: string;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  inputPrompt: string;
  /** Инструкции этапа из настроек запуска — нужны для возобновления после перезапуска. */
  instructions?: string;
  outputResult?: string;
  durationMs?: number;
}

export interface SwarmSession {
  id: string;
  projectPath: string;
  taskId?: string;
  taskTitle?: string;
  mode: SwarmMode;
  prompt: string;
  baseBranch: string;
  useWorktrees: boolean;
  autoCommitAgentResults?: boolean;
  status: SwarmStatus;
  createdAt: number;
  completedAt?: number;
  /** Момент, когда сессия была помечена прерванной при восстановлении. */
  interruptedAt?: number;
  agents: AgentSlotState[];
  handoffStages?: HandoffStageState[];
  currentHandoffStageIndex?: number;
  winnerAgentId?: string;
  error?: string;
  /** Бюджет всей сессии в USD (сумма по всем агентам). */
  budgetUsd?: number;
  /** Суммарная стоимость по всем агентам (пересчитывается при каждом обновлении usage). */
  totalCostUsd?: number;
  /** Сессия загружена с диска после перезапуска приложения. */
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
  /** Файл больше лимита чтения — возвращён только хвост. */
  truncated: boolean;
  sizeBytes: number;
}

export type SwarmExportFormat = 'markdown' | 'json';
