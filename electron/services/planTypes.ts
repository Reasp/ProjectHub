/**
 * Типы планировщика подзадач (TASK-80, decision-49).
 *
 * Модуль без зависимостей от Electron — его импортируют чистые `planSchema.ts`/`planDispatcher.ts`,
 * сервис и unit-тесты. Зеркало для рендерера — `src/types/electron.d.ts`.
 *
 * Источник истины по составу плана — подзадачи Backlog.md (`parentTaskId`, `dependencies`).
 * Здесь хранится только то, чего в Backlog нет: состояние исполнения узла, ветки, слияния,
 * стоимость и решения человека.
 */
import type { AgentSlotConfig } from './swarmTypes.js';
import type { ModelTier } from './modelTiers.js';

/** Подзадача в ответе роли `architect` до создания в Backlog.md. */
export interface PlanSubtaskDraft {
  /** Ключ узла внутри ответа модели: по нему собираются зависимости. */
  key: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  /** Ключи узлов этого же плана, от которых зависит подзадача. */
  dependsOn: string[];
  modelTier?: ModelTier;
  labels?: string[];
  /** Оценка размера от модели — подсказка человеку, на логику не влияет. */
  size?: 'small' | 'medium' | 'large';
}

/** Разобранный и нормализованный план роли `architect`. */
export interface AgentPlan {
  summary: string;
  subtasks: PlanSubtaskDraft[];
}

/**
 * Состояние узла плана.
 * - `merged` — результат влит в интеграционную ветку, зависимые могут стартовать;
 * - `skipped` — узел исключён до старта (человеком или потому, что задача уже закрыта):
 *   зависимость считается удовлетворённой;
 * - `failed` — работа не влита (провал цикла, отказ слияния, пропуск после конфликта):
 *   зависимые блокируются;
 * - `missing` — подзадачи больше нет в `backlog/tasks` (удалена человеком).
 */
export type PlanNodeState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'merging'
  | 'merged'
  | 'conflict'
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'missing';

/** Что планировщик делает прямо сейчас. */
export type PlanPhase = 'planning' | 'awaiting_approval' | 'running' | 'finished' | 'failed';

/** Чем закончился план. */
export type PlanOutcome = 'success' | 'partial' | 'failed' | 'budget_exceeded' | 'stopped';

/** Узел плана: подзадача Backlog.md плюс состояние её исполнения. */
export interface PlanNode {
  /** Ключ из ответа `architect` — стабилен на весь план. */
  key: string;
  /** Идентификатор созданной подзадачи, например `TASK-80.1`. */
  taskId: string;
  title: string;
  state: PlanNodeState;
  /** Зависимости в `taskId` — пересчитываются из файлов задач перед каждым решением. */
  dependsOn: string[];
  /** Сессия «до готовности», выполняющая узел. */
  swarmId?: string;
  branch?: string;
  /** Коммит слияния в интеграционную ветку. */
  mergeCommit?: string;
  /** Файлы, на которых слияние встало (состояние `conflict`). */
  conflictFiles?: string[];
  costUsd?: number;
  iterations?: number;
  /** Почему узел провалился, заблокирован или пропущен. */
  reason?: string;
  startedAt?: number;
  finishedAt?: number;
}

/** Настройки запуска плана (итог слияния секции `plan` в `.projecthub.json` и выбора в UI). */
export interface PlanSettings {
  /** Сколько узлов выполняется одновременно. */
  maxParallel: number;
  /** Общий бюджет плана в USD (включая ход `architect`). */
  budgetUsd?: number;
  /** Лимит итераций цикла «до готовности» у каждого узла. */
  maxIterations?: number;
  /** Подмножество проверок проекта по `id` для узлов. */
  checkIds?: string[];
  /** Слот-исполнитель узлов (движок, роль, модель). */
  agent?: AgentSlotConfig;
  /** Слот роли `architect` для генерации плана. */
  architect?: AgentSlotConfig;
}

/** Секция `plan` в `.projecthub.json`. */
export interface PlanProjectSettings {
  maxParallel?: number;
  budgetUsd?: number;
  maxIterations?: number;
  checkIds?: string[];
}

/** Попытки получить валидный план от роли `architect`. */
export interface PlanArchitectState {
  attempts: number;
  costUsd?: number;
  /** Ошибки валидации последней попытки — их же получает модель в повторном запросе. */
  errors?: string[];
  /** Сырой ответ последней неудачной попытки — чтобы человек увидел, что пришло. */
  rawResponse?: string;
}

/** Состояние плана целиком (`<userData>/plans/<planId>.json`). */
export interface PlanState {
  id: string;
  projectPath: string;
  /** Родительская задача плана. */
  taskId: string;
  taskTitle?: string;
  phase: PlanPhase;
  outcome?: PlanOutcome;
  reason?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  settings: PlanSettings;
  summary?: string;
  nodes: PlanNode[];
  integrationBranch?: string;
  integrationWorktree?: string;
  /** Хэш графа на момент последнего утверждения человеком; без него узлы не стартуют. */
  approvedGraphHash?: string;
  approvedAt?: number;
  architect: PlanArchitectState;
  totalCostUsd?: number;
  /** План остановлен человеком. */
  stopped?: boolean;
}
