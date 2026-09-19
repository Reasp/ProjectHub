/**
 * Типы Swarm/Fleet (TASK-54, TASK-56). Вынесены из agentFleetService, чтобы хранилище,
 * экспорт и расчёт стоимости не тянули за собой сервис с процессами и git.
 * Зеркало для рендерера — `src/types/electron.d.ts`.
 */
import type { AIProviderConfig } from './aiAgentService.js';
import type { AgentUsage } from './agentCost.js';
import type { RolePermissions } from './hitlTypes.js';
import type { CandidateScore, CheckRunResult, JudgeState, ReviewerVerdict } from './arenaTypes.js';
import type { DoneLoopState } from './doneLoopTypes.js';
import type { ResolvedProviderInfo } from './slotProvider.js';
import type { ProviderErrorInfo } from './providerErrors.js';
import type { ModelRoutingInfo, ModelTier } from './modelTiers.js';

/** `done_loop` — одиночный слот «до готовности» (TASK-75, decision-28). */
export type SwarmMode = 'fan_out' | 'handoff' | 'done_loop';
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
  engine: 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'api';
  /** Отображаемая метка роли (для UI/логов/HITL-карточек). */
  role?: string;
  /** slug роли из реестра (decision-9, TASK-60) — если задан, применяется системный промпт,
   * модель, инструменты и лимиты роли через `roleEngineAdapter`. */
  roleSlug?: string;
  /**
   * Провайдер слота (decision-40): профиль (`provider: 'openai-compatible'` + `profileId`), прежний
   * провайдер или только модель. Без поля — настройки AI Studio. Разрешается в `slotProvider.ts`.
   */
  providerConfig?: Partial<AIProviderConfig>;
  /**
   * Тир модели (decision-44): цепочка моделей из таблицы тиров для движка слота. Явная модель
   * `providerConfig.model` важнее и становится первым звеном.
   */
  modelTier?: ModelTier;
  /** Доп. инструкции слота поверх системного промпта роли. */
  systemPromptAddon?: string;
  /** Бюджет роли/слота в USD; при превышении агент останавливается (decision-9, TASK-56). */
  budgetUsd?: number;
  /**
   * Права роли для HITL (decision-10, TASK-57): применяются поверх глобальных настроек
   * auto-approve и только сужают их. Без поля агент подчиняется глобальным настройкам.
   */
  permissions?: RolePermissions;
}

export interface AgentSlotDiffSummary {
  filesChanged: number;
  insertions: number;
  deletions: number;
  patch: string;
  /** Патч усечён при сохранении на диск. */
  truncated?: boolean;
  /** Затронутые модули (TASK-61): два первых сегмента пути каждого изменённого файла. */
  modules?: string[];
  /** Число задетых символов по GitNexus; отсутствует, если репозиторий не проиндексирован. */
  dependentSymbols?: number;
  /** Потоки выполнения, задетые диффом (GitNexus). */
  affectedProcesses?: number;
  /** Оценка риска GitNexus (`low`/`medium`/`high`). */
  riskLevel?: string;
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
  /** `session_id` Claude CLI из stream-json — для продолжения той же сессии (`--resume`, TASK-75). */
  cliSessionId?: string;
  /** Результаты проверок автосудьи в worktree кандидата (TASK-61, decision-12). */
  checks?: CheckRunResult[];
  /** Балл кандидата с разложением по компонентам. */
  score?: CandidateScore;
  /** Структурированный отзыв роли `reviewer`. */
  review?: ReviewerVerdict;
  /** Провайдер, с которым агент реально работал (API-движок, decision-40) — для экспорта и UI. */
  providerInfo?: ResolvedProviderInfo;
  /**
   * Снимок ошибки провайдера, если агент упал на запросе к модели или на настройке провайдера
   * (decision-43): вид, статус, код, retry-after, retryable. По нему TASK-79 решает о fallback.
   */
  providerError?: ProviderErrorInfo;
  /** Тир, фактическая модель и переключения модели по fallback-цепочке (decision-44 п. 8). */
  modelRouting?: ModelRoutingInfo;
}

export interface HandoffStageState {
  stageIndex: number;
  role: string;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  inputPrompt: string;
  /** Инструкции этапа из настроек запуска — нужны для возобновления после перезапуска. */
  instructions?: string;
  /** Сырой вывод агента (устаревшее; для новых сессий используйте summary+reportPath). */
  outputResult?: string;
  /** Артефакт этапа (decision-9 п.5): усечённое резюме для промпта следующего этапа. */
  summary?: string;
  /** Путь к полному отчёту этапа `.projecthub/handoff/<n>-<roleSlug>.md` в общем worktree. */
  reportPath?: string;
  /** Коммит, которым зафиксирован результат этапа (TASK-55 `materializeAgentResult`). */
  commitHash?: string;
  durationMs?: number;
}

export interface SwarmSession {
  id: string;
  projectPath: string;
  taskId?: string;
  taskTitle?: string;
  /** Источник запуска для HITL/аудита (decision-9/10, TASK-60): по умолчанию выводится из `mode`. */
  origin?: 'swarm' | 'assigned';
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
  /** Состояние автосудьи арены (TASK-61, decision-12). */
  judge?: JudgeState;
  /** Состояние цикла «до готовности» (режим `done_loop`, TASK-75). */
  doneLoop?: DoneLoopState;
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

/** Запуск цикла «до готовности» (TASK-75): один слот, задача Backlog.md обязательна. */
export interface StartDoneLoopOptions {
  projectPath: string;
  taskId: string;
  taskTitle?: string;
  prompt: string;
  agent: AgentSlotConfig;
  baseBranch?: string;
  useWorktrees?: boolean;
  autoCommitAgentResults?: boolean;
  /** Бюджет цикла в USD (переопределяет `doneLoop.budgetUsd` проекта). */
  budgetUsd?: number;
  maxIterations?: number;
  /** Подмножество проверок проекта по `id`. */
  checkIds?: string[];
  autoReview?: boolean;
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
