/**
 * Типы автосудьи Swarm Arena (decision-12, TASK-61).
 *
 * Автосудья прогоняет проверки проекта (`lint`/`test`/`build`/`typecheck`) в worktree каждого
 * кандидата, считает метрики диффа, просит роль `reviewer` дать структурированный отзыв и
 * складывает всё в прозрачный балл с разложением по компонентам. Финальное слияние остаётся за
 * человеком: судья только ранжирует и подсвечивает рекомендацию.
 *
 * Модуль без зависимостей от Electron — импортируется чистыми модулями и unit-тестами.
 * Зеркало для рендерера — `src/types/electron.d.ts`.
 */

export type CheckKind = 'lint' | 'test' | 'build' | 'typecheck' | 'custom';

export type CheckStatus =
  | 'pending'
  | 'running'
  /** Команда завершилась с кодом 0. */
  | 'passed'
  /** Ненулевой код возврата. */
  | 'failed'
  /** Превышен `timeoutMs`; процесс убит деревом. */
  | 'timeout'
  /** Проверка выключена или неприменима (нет worktree, нет команды). */
  | 'skipped'
  /** Не удалось даже запустить команду (нет оболочки, каталога и т.п.). */
  | 'error';

/** Проверка проекта из секции `checks` в `.projecthub.json`. */
export interface CheckDefinition {
  id: string;
  kind: CheckKind;
  name: string;
  command: string;
  /** Максимальное время выполнения; по истечении процесс убивается, статус `timeout`. */
  timeoutMs?: number;
  /** Проваленная блокирующая проверка запрещает рекомендацию и авто-мердж. По умолчанию `true`. */
  blocking?: boolean;
  /** Выключенная проверка не запускается и получает статус `skipped`. По умолчанию `true`. */
  enabled?: boolean;
  /**
   * `auto` — ProjectHub подбирает свободный порт и кладёт его в `PORT` и `${port}` команды,
   * чтобы проверки разных кандидатов не дрались за один порт. По умолчанию `fixed`.
   */
  portStrategy?: 'fixed' | 'auto';
  port?: number;
}

/** Результат одного прогона проверки в worktree кандидата. */
export interface CheckRunResult {
  id: string;
  kind: CheckKind;
  name: string;
  command: string;
  status: CheckStatus;
  blocking: boolean;
  exitCode?: number;
  startedAt?: number;
  durationMs?: number;
  /** Разобранные из вывода счётчики (см. `arenaChecks.parseCheckOutput`). */
  failedTests?: number;
  passedTests?: number;
  totalTests?: number;
  errorCount?: number;
  warningCount?: number;
  /** Хвост вывода команды (stdout+stderr), усечённый до `CHECK_OUTPUT_TAIL_CHARS`. */
  outputTail?: string;
  outputTruncated?: boolean;
  /** Человекочитаемая причина для `skipped`/`error`. */
  detail?: string;
}

export type ScoreComponentKey = 'checks' | 'acceptance' | 'review' | 'diffSize' | 'locality' | 'cost' | 'time';

/** Веса компонентов итогового балла. Хранятся в `.projecthub.json` (`arena.weights`). */
export type ScoreWeights = Record<ScoreComponentKey, number>;

/** Одна строка разложения балла — то, что показывается рядом с числом в арене. */
export interface ScoreComponent {
  key: ScoreComponentKey;
  weight: number;
  /** Нормализованная оценка 0..1 (больше — лучше). */
  normalized: number;
  /** Вклад в итоговый балл: `weight * normalized`. */
  points: number;
  /** Исходная величина до нормализации (строк диффа, USD, мс, доля AC) — для подсказки. */
  raw?: number;
  /** Короткое объяснение, почему получилось именно так. */
  detail: string;
  /** Данных не было — компонент получил нейтральную оценку и не влияет на сравнение. */
  unknown?: boolean;
}

export interface CandidateScore {
  agentId: string;
  /** Итоговый балл 0..100. */
  total: number;
  /** Провалена блокирующая проверка — кандидат не может быть рекомендован. */
  blocked: boolean;
  blockedReason?: string;
  components: ScoreComponent[];
  computedAt: number;
}

export type ReviewSeverity = 'info' | 'minor' | 'major' | 'critical';

export interface ReviewerFinding {
  file?: string;
  line?: number;
  severity: ReviewSeverity;
  message: string;
}

export type CriterionVerdict = 'met' | 'partial' | 'unmet' | 'unknown';

export interface ReviewerCriterionVerdict {
  /** 1-based номер критерия приёмки задачи. */
  index: number;
  text: string;
  verdict: CriterionVerdict;
  comment?: string;
}

export type ReviewerStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** Структурированный отзыв роли `reviewer` по одному кандидату. */
export interface ReviewerVerdict {
  agentId: string;
  status: ReviewerStatus;
  summary?: string;
  findings?: ReviewerFinding[];
  criteria?: ReviewerCriterionVerdict[];
  risks?: string[];
  /** Общая оценка ревьюера 0..1; если не вернул — считается из вердиктов по критериям. */
  overall?: number;
  /** Модель, на которой работал ревьюер (может отличаться от моделей кандидатов). */
  model?: string;
  costUsd?: number;
  durationMs?: number;
  error?: string;
  /** Сырой ответ модели — показывается, если распарсить структуру не удалось. */
  raw?: string;
}

export interface ArenaReviewerConfig {
  enabled: boolean;
  /** slug роли из реестра (decision-9); по умолчанию `reviewer`. */
  roleSlug: string;
  /** Переопределение провайдера/модели ревьюера; без них берётся модель роли или глобальная. */
  provider?: string;
  model?: string;
}

export interface ArenaAutoMergeConfig {
  /** Выключен по умолчанию (decision-12 п.4). */
  enabled: boolean;
  /** Порог итогового балла 0..100, ниже которого авто-мердж не срабатывает. */
  minScore: number;
}

/** Секция `arena` в `.projecthub.json` плюс список проверок `checks`. */
export interface ArenaConfig {
  checks: CheckDefinition[];
  weights: ScoreWeights;
  autoMerge: ArenaAutoMergeConfig;
  reviewer: ArenaReviewerConfig;
  /** Сколько проверок выполняется одновременно по всем кандидатам. */
  maxConcurrentChecks: number;
}

export type JudgeStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

/** Состояние автосудьи внутри swarm-сессии. */
export interface JudgeState {
  status: JudgeStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  /** Лучший незаблокированный кандидат; `undefined`, если рекомендовать некого. */
  recommendedAgentId?: string;
  /** Веса, которыми считался балл (могли поменяться в конфиге после прогона). */
  weights?: ScoreWeights;
  /** Что судья сейчас делает — для прогресса в UI. */
  stage?: 'checks' | 'diff' | 'review' | 'scoring';
  autoMerge?: {
    enabled: boolean;
    attempted: boolean;
    merged: boolean;
    agentId?: string;
    reason: string;
  };
}

/** Выбор файлов одного кандидата для частичной сборки результата (decision-12 п.5). */
export interface ComposeSelection {
  agentId: string;
  files: string[];
}

export interface ComposeResult {
  success: boolean;
  error?: string;
  /** Применённые файлы по агентам. */
  applied?: Array<{ agentId: string; branch: string; files: string[] }>;
}
