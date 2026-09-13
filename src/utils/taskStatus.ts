/**
 * Статусы задач Backlog.md (TASK-68).
 *
 * Источник истины по составу статусов — ключ `statuses` в `backlog/config.yml` открытого
 * проекта, а не код ProjectHub (см. decision-24). Здесь лежит только чистая логика:
 * нормализация, сопоставление статуса задачи со списком из конфига, палитра и подписи.
 * Чтение файла конфига — в `electron/services/backlogConfigService.ts`.
 *
 * Модуль общий для main и renderer (как `src/utils/assignee.ts`): никаких зависимостей
 * от Electron, React и файловой системы.
 */

/** Набор статусов, который используется, если конфиг проекта недоступен или пуст. */
export const DEFAULT_TASK_STATUSES: readonly string[] = ['To Do', 'In Progress', 'Review', 'Done'];

/** Статус новой задачи и колонка-приёмник для задач с неизвестным статусом по умолчанию. */
export const DEFAULT_TASK_STATUS = 'To Do';

export interface BacklogStatusConfig {
  /** Состав и порядок колонок доски: как в `statuses` конфига проекта. */
  statuses: string[];
  /** `default_status` конфига; всегда один из `statuses`. */
  defaultStatus: string;
  /** true, если `statuses` действительно прочитаны из `backlog/config.yml`, а не подставлены. */
  fromConfig: boolean;
}

export interface BacklogProjectConfig extends BacklogStatusConfig {
  projectName?: string;
  taskPrefix?: string;
}

/** Значение по умолчанию для стора и для проектов без `backlog/config.yml`. */
export const FALLBACK_STATUS_CONFIG: BacklogProjectConfig = {
  statuses: [...DEFAULT_TASK_STATUSES],
  defaultStatus: DEFAULT_TASK_STATUS,
  fromConfig: false
};

/** Новая копия fallback-конфига: списки не должны шариться между проектами. */
export function fallbackStatusConfig(): BacklogProjectConfig {
  return { ...FALLBACK_STATUS_CONFIG, statuses: [...DEFAULT_TASK_STATUSES] };
}

/**
 * Ключ сравнения статусов: регистр и лишние пробелы не значимы, поэтому `done`, `Done`
 * и `Done ` — один и тот же статус. Строгое равенство (как было до TASK-68) приводило
 * к тому, что задача не попадала ни в одну колонку и пропадала с доски.
 */
export function normalizeStatusKey(status: string | null | undefined): string {
  return String(status ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Возвращает статус из `statuses` в том написании, что задано конфигом, если статус задачи
 * ему соответствует. Иначе — `undefined` (статус кастомный/устаревший, задачу показываем
 * в колонке по умолчанию с пометкой, но значение в файле не трогаем).
 */
export function matchStatus(statuses: readonly string[], status: string | null | undefined): string | undefined {
  const key = normalizeStatusKey(status);
  if (!key) return undefined;
  return statuses.find((s) => normalizeStatusKey(s) === key);
}

/** Статус известен набору проекта. */
export function isKnownStatus(statuses: readonly string[], status: string | null | undefined): boolean {
  return matchStatus(statuses, status) !== undefined;
}

/** Колонка, в которую попадают задачи с неизвестным статусом. */
export function fallbackColumnStatus(config: BacklogStatusConfig): string {
  return matchStatus(config.statuses, config.defaultStatus) || config.statuses[0] || DEFAULT_TASK_STATUS;
}

/**
 * Статус «задача завершена»: `Done`, если он есть в наборе, иначе последний статус
 * (Backlog.md держит колонки в порядке движения задачи слева направо).
 */
export function resolveDoneStatus(statuses: readonly string[]): string | undefined {
  return matchStatus(statuses, 'Done') || statuses[statuses.length - 1];
}

export interface StatusCounts {
  total: number;
  /** Счётчики по статусам конфига; ключ — статус в написании конфига. */
  byStatus: Record<string, number>;
  /** Задачи со статусом вне `statuses` — учитываются в `total`, но не в `byStatus`. */
  other: number;
}

/** Считает задачи по динамическому набору статусов; неизвестные попадают в `other`. */
export function countStatuses(
  statuses: readonly string[],
  taskStatuses: Iterable<string | null | undefined>
): StatusCounts {
  const byStatus: Record<string, number> = {};
  for (const s of statuses) byStatus[s] = 0;

  let total = 0;
  let other = 0;
  for (const raw of taskStatuses) {
    total++;
    const matched = matchStatus(statuses, raw ?? DEFAULT_TASK_STATUS);
    if (matched) byStatus[matched]++;
    else other++;
  }
  return { total, byStatus, other };
}

/**
 * Счётчики в форме карточки проекта: четыре исторических поля + агрегат «прочие».
 * Поля todo/inProgress/review/done заполняются, только если соответствующий статус есть
 * в наборе проекта; всё остальное уходит в `other`, поэтому сумма всегда равна `total`.
 */
export function toLegacyTaskCounts(counts: StatusCounts, statuses: readonly string[]) {
  const pick = (name: string): { value: number; status?: string } => {
    const matched = matchStatus(statuses, name);
    return { value: matched ? counts.byStatus[matched] : 0, status: matched };
  };

  const todo = pick('To Do');
  const inProgress = pick('In Progress');
  const review = pick('Review');
  const done = pick('Done');
  const named = [todo, inProgress, review, done].reduce((sum, c) => sum + c.value, 0);

  return {
    total: counts.total,
    todo: todo.value,
    inProgress: inProgress.value,
    review: review.value,
    done: done.value,
    other: counts.total - named
  };
}

export interface StatusVisual {
  /** Цвет точки в заголовке колонки. */
  dot: string;
  /** Цвет подписи колонки. */
  text: string;
  /** Рамка заголовка колонки. */
  border: string;
  /** Классы бейджа/селекта статуса в табличном виде. */
  badge: string;
  /** Цвет подписи в аналитике (палитра диаграмм отличается от палитры доски). */
  chartText: string;
  /** Цвет точки рядом с подписью в аналитике. */
  chartDot: string;
  /** Заливка полосы прогресса в аналитике. */
  chartBar: string;
}

/** Цвета четырёх стандартных статусов Backlog.md — те же, что были до TASK-68. */
const KNOWN_STATUS_VISUALS: Record<string, StatusVisual> = {
  'to do': {
    dot: 'bg-slate-400',
    text: 'text-slate-400',
    border: 'border-slate-700/60',
    badge: 'bg-slate-800 text-slate-300 border-slate-700/60',
    chartText: 'text-slate-400',
    chartDot: 'bg-slate-500',
    chartBar: 'bg-slate-600'
  },
  'in progress': {
    dot: 'bg-amber-400',
    text: 'text-amber-400',
    border: 'border-amber-500/40',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    chartText: 'text-cyan-400',
    chartDot: 'bg-cyan-400',
    chartBar: 'bg-cyan-500'
  },
  review: {
    dot: 'bg-indigo-400',
    text: 'text-indigo-400',
    border: 'border-indigo-500/40',
    badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    chartText: 'text-purple-400',
    chartDot: 'bg-purple-400',
    chartBar: 'bg-purple-500'
  },
  done: {
    dot: 'bg-emerald-400',
    text: 'text-emerald-400',
    border: 'border-emerald-500/40',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    chartText: 'text-emerald-400',
    chartDot: 'bg-emerald-400',
    chartBar: 'bg-emerald-500'
  }
};

/**
 * Палитра для кастомных статусов. Цвет выбирается по хэшу имени, а не по позиции в списке,
 * чтобы он не менялся при добавлении соседней колонки в конфиг.
 */
const CUSTOM_STATUS_VISUALS: StatusVisual[] = [
  {
    dot: 'bg-sky-400',
    text: 'text-sky-400',
    border: 'border-sky-500/40',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    chartText: 'text-sky-400',
    chartDot: 'bg-sky-400',
    chartBar: 'bg-sky-500'
  },
  {
    dot: 'bg-rose-400',
    text: 'text-rose-400',
    border: 'border-rose-500/40',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    chartText: 'text-rose-400',
    chartDot: 'bg-rose-400',
    chartBar: 'bg-rose-500'
  },
  {
    dot: 'bg-purple-400',
    text: 'text-purple-400',
    border: 'border-purple-500/40',
    badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    chartText: 'text-purple-400',
    chartDot: 'bg-purple-400',
    chartBar: 'bg-purple-500'
  },
  {
    dot: 'bg-teal-400',
    text: 'text-teal-400',
    border: 'border-teal-500/40',
    badge: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
    chartText: 'text-teal-400',
    chartDot: 'bg-teal-400',
    chartBar: 'bg-teal-500'
  },
  {
    dot: 'bg-orange-400',
    text: 'text-orange-400',
    border: 'border-orange-500/40',
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    chartText: 'text-orange-400',
    chartDot: 'bg-orange-400',
    chartBar: 'bg-orange-500'
  },
  {
    dot: 'bg-cyan-400',
    text: 'text-cyan-400',
    border: 'border-cyan-500/40',
    badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    chartText: 'text-cyan-400',
    chartDot: 'bg-cyan-400',
    chartBar: 'bg-cyan-500'
  }
];

/** Оформление агрегата «прочие статусы» — задач со статусом вне конфига проекта. */
export const OTHER_STATUS_VISUAL: StatusVisual = {
  dot: 'bg-amber-400',
  text: 'text-amber-400',
  border: 'border-amber-500/40',
  badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  chartText: 'text-amber-400',
  chartDot: 'bg-amber-400',
  chartBar: 'bg-amber-500'
};

function hashStatus(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Классы оформления статуса: стандартные — историческими цветами, кастомные — по хэшу имени. */
export function statusVisual(status: string): StatusVisual {
  const key = normalizeStatusKey(status);
  const known = KNOWN_STATUS_VISUALS[key];
  if (known) return known;
  return CUSTOM_STATUS_VISUALS[hashStatus(key) % CUSTOM_STATUS_VISUALS.length];
}

export interface StatusLabels {
  todo: string;
  inProgress: string;
  review: string;
  done: string;
}

/**
 * Подпись статуса: четыре стандартных переводятся (`t.kanban.*`), кастомные выводятся
 * как есть — переводить произвольные значения из чужого конфига некуда и незачем.
 */
export function statusLabel(status: string, labels: StatusLabels): string {
  switch (normalizeStatusKey(status)) {
    case 'to do':
      return labels.todo;
    case 'in progress':
      return labels.inProgress;
    case 'review':
      return labels.review;
    case 'done':
      return labels.done;
    default:
      return status;
  }
}

/** Значок статуса в выпадающих списках; для кастомных — нейтральный. */
export function statusGlyph(status: string): string {
  switch (normalizeStatusKey(status)) {
    case 'to do':
      return '○';
    case 'in progress':
      return '◒';
    case 'review':
      return '◆';
    case 'done':
      return '✔';
    default:
      return '•';
  }
}

/**
 * Варианты для `<select>` смены статуса: статусы конфига плюс текущий статус задачи,
 * если он им неизвестен — иначе первое же открытие списка перезаписало бы его (AC #3).
 */
export function statusOptions(statuses: readonly string[], currentStatus?: string | null): string[] {
  const list = [...statuses];
  const current = String(currentStatus ?? '').trim();
  if (current && !matchStatus(statuses, current)) list.unshift(current);
  return list;
}
