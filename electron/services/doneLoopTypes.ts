/**
 * Типы цикла «до готовности» (Done-loop, TASK-75, decision-28).
 *
 * Модуль без зависимостей от Electron — импортируется чистым `doneLoop.ts`, сервисом и
 * unit-тестами. Зеркало для рендерера — `src/types/electron.d.ts`.
 */
import type { CheckDefinition, CheckRunResult } from './arenaTypes.js';

/** Что цикл делает прямо сейчас — для прогресса в UI. */
export type DoneLoopPhase = 'running_agent' | 'checking' | 'verifying' | 'finished' | 'failed' | 'stopped';

/** Чем закончился цикл. */
export type DoneLoopOutcome = 'success' | 'iteration_limit' | 'budget' | 'agent_error' | 'task_error' | 'stopped';

/** Статус критерия в отчёте агента. */
export type CriterionReportStatus = 'done' | 'not_done' | 'blocked';

/** Строка отчёта агента по одному критерию приёмки. */
export interface AgentCriterionReport {
  /** 1-based номер критерия в задаче. */
  index: number;
  status: CriterionReportStatus;
  evidence: string;
}

/** Структурированный отчёт агента в конце хода. */
export interface AgentReport {
  summary: string;
  criteria: AgentCriterionReport[];
}

/** Вердикт ProjectHub по критерию: отчёт агента, сверенный с правилами. */
export interface CriterionVerification {
  index: number;
  text: string;
  /** Что заявил агент; `undefined` — агент о критерии промолчал. */
  reported?: CriterionReportStatus;
  evidence?: string;
  /** Критерий засчитан ProjectHub. */
  accepted: boolean;
  /** Почему не засчитан (или пометка для уже закрытого). */
  reason?: string;
  /** Критерий был отмечен в задаче ещё до цикла — не пересматривается. */
  alreadyChecked?: boolean;
}

export type DoneLoopDecisionAction = 'finish' | 'retry' | 'fail';

export interface DoneLoopIteration {
  /** 1-based номер итерации. */
  index: number;
  startedAt: number;
  finishedAt?: number;
  /** Статус слота агента по завершении хода. */
  agentStatus?: string;
  checks: CheckRunResult[];
  reportFound: boolean;
  reportError?: string;
  reportSummary?: string;
  criteria: CriterionVerification[];
  /** Стоимость этого хода, если провайдер/таблица цен её дали. */
  costUsd?: number;
  commitHash?: string;
  /** Агент менял чекбоксы критериев в файле задачи — ProjectHub откатил правку. */
  tamperedCriteria?: boolean;
  decision?: DoneLoopDecisionAction;
  /** Сквозной номер запуска движка агента (`AgentSlotState.trace.runs`) — по нему откат помечает итерации. */
  run?: number;
  /**
   * Итерация отменена откатом (decision-48 п. 2.2): `full` — вся её работа, `partial` — часть ходов.
   * Пересчитывается на каждом откате, итерация из истории не удаляется.
   */
  rolledBack?: 'full' | 'partial';
  /** Номер отрезка цикла: 0 — исходный запуск, N — N-е продолжение после отката. */
  segment?: number;
}

/** Настройки конкретного запуска (итог слияния `.projecthub.json` и выбора в модалке). */
export interface DoneLoopSettings {
  maxIterations: number;
  /** Бюджет цикла в USD; при превышении цикл останавливается. */
  budgetUsd?: number;
  checks: CheckDefinition[];
  /** Переводить задачу в Review при успехе. */
  autoReview: boolean;
}

/** Секция `doneLoop` в `.projecthub.json`. */
export interface DoneLoopProjectSettings {
  maxIterations?: number;
  budgetUsd?: number;
  /** Подмножество проверок проекта (по `id`); без поля — все включённые. */
  checkIds?: string[];
  autoReview?: boolean;
  /** Добавлять скрипты `lint:docs`/`check-index`, если они есть в `package.json`. По умолчанию `true`. */
  docChecks?: boolean;
}

/** Состояние цикла внутри swarm-сессии режима `done_loop`. */
export interface DoneLoopState {
  settings: DoneLoopSettings;
  phase: DoneLoopPhase;
  currentIteration: number;
  iterations: DoneLoopIteration[];
  /** Системная инструкция цикла для агента (формат отчёта, правила) — одна для всех движков. */
  instructions?: string;
  /**
   * Критерии задачи на момент старта цикла. Отметки отсюда — эталон: агент не может закрыть
   * критерий правкой файла, ProjectHub откатывает такую правку.
   */
  criteriaBaseline?: Array<{ text: string; completed: boolean }>;
  outcome?: DoneLoopOutcome;
  reason?: string;
  totalCostUsd?: number;
  /** Что ProjectHub записал в файл задачи. */
  task?: {
    filePath?: string;
    criteriaChecked: number[];
    movedToReview?: boolean;
    reviewStatus?: string;
    /** Статус задачи до перевода в Review — вернуть его, если успех отменён откатом (decision-48 п. 2.5). */
    previousStatus?: string;
    finalSummaryWritten?: boolean;
    error?: string;
  };
}
