/**
 * Выбор модели эмбеддингов для поиска по документации (TASK-47, TASK-50).
 *
 * Запрос должен кодироваться той же моделью и с тем же префиксом, что и индекс конкретного
 * проекта, поэтому модель берётся из `.rag-index/meta.json`, а реестр ниже — лишь fallback
 * для `dtype`/префикса, если в meta.json их нет.
 *
 * Чистый модуль без Electron и тяжёлых зависимостей: main-процесс решает, какой моделью
 * кодировать запрос, и передаёт решение в воркер (`electron/workers/ragWorker.mjs`),
 * чтобы реестр не дублировался в двух местах.
 */
export interface EmbeddingModel {
  id: string;
  dtype: 'q8' | 'fp32';
  queryPrefix: string;
}

/** Реестр моделей — зеркало `scripts/rag/embed.mjs`. */
export const KNOWN_EMBEDDING_MODELS: Record<string, Omit<EmbeddingModel, 'id'>> = {
  'Xenova/multilingual-e5-small': { dtype: 'q8', queryPrefix: 'query: ' },
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2': { dtype: 'q8', queryPrefix: '' },
  'Xenova/all-MiniLM-L6-v2': { dtype: 'fp32', queryPrefix: '' }
};

export const DEFAULT_EMBEDDING_MODEL_ID = 'Xenova/multilingual-e5-small';

/** Незнакомая модель: считаем её несжатой и без префикса запроса. */
const UNKNOWN_MODEL_DEFAULTS: Omit<EmbeddingModel, 'id'> = { dtype: 'fp32', queryPrefix: '' };

/**
 * Разбирает содержимое `.rag-index/meta.json` в описание модели.
 * Битый/отсутствующий meta.json (`null`, `undefined`, не объект) даёт модель по умолчанию.
 */
export function resolveEmbeddingModel(meta: unknown): EmbeddingModel {
  const record = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};

  const rawModel = record.model;
  const modelId = typeof rawModel === 'string' && rawModel.trim() ? rawModel.trim() : DEFAULT_EMBEDDING_MODEL_ID;

  const known = KNOWN_EMBEDDING_MODELS[modelId] ?? UNKNOWN_MODEL_DEFAULTS;
  const rawPrefix = record.queryPrefix;

  return {
    id: modelId,
    dtype: known.dtype,
    queryPrefix: typeof rawPrefix === 'string' ? rawPrefix : known.queryPrefix
  };
}
