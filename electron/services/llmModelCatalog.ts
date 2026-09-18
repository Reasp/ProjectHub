/**
 * Каталог моделей OpenAI-совместимого профиля (TASK-70.2, [[decision-39]]).
 *
 * Разбор ответа `GET {baseUrl}/models` и правила свежести кэша. Каталог — подсказка для поля
 * модели, а не выбор: дефолтной модели здесь нет (decision-26 п. 0), ручной ввод id остаётся.
 *
 * Чистый модуль без Electron и сети — покрыт unit-тестами.
 */

/** Сколько каталог считается свежим без ручного обновления. */
export const MODEL_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

export interface ModelCatalogEntry {
  /** Адрес, для которого получен список: смена адреса профиля делает кэш недействительным. */
  baseUrl: string;
  models: string[];
  fetchedAt: number;
}

export interface ModelCatalogResult {
  models: string[];
  /** Когда список получен; `null` — ни разу. */
  fetchedAt: number | null;
  /** Список взят из кэша, а не с сервера. */
  cached: boolean;
  /** Почему не удалось обновить список (при этом `models` может содержать прежний кэш). */
  error?: string;
}

/**
 * Идентификаторы моделей из ответа сервера: OpenAI-формат `{ data: [{ id }] }`; на всякий случай
 * и нативный формат Ollama `{ models: [{ name }] }`. Без дублей, по алфавиту.
 */
export function parseModelList(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as { data?: unknown; models?: unknown };
  const items = Array.isArray(p.data) ? p.data : Array.isArray(p.models) ? p.models : [];
  const ids = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const raw = (item as { id?: unknown; name?: unknown }).id ?? (item as { name?: unknown }).name;
    if (typeof raw === 'string' && raw.trim()) ids.add(raw.trim());
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

export function isCatalogFresh(
  entry: ModelCatalogEntry | undefined,
  baseUrl: string,
  now: number,
  ttlMs = MODEL_CATALOG_TTL_MS
): entry is ModelCatalogEntry {
  return Boolean(entry && entry.baseUrl === baseUrl && now - entry.fetchedAt >= 0 && now - entry.fetchedAt < ttlMs);
}
