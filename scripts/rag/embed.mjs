import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs';
import path from 'node:path';
import { INFRA_ROOT } from '../config.mjs';

// Модель скачивается один раз при первом запуске — храним кэш рядом со скриптами
// инфраструктуры (.rag-cache/, в .gitignore), а не в системном каталоге и не в целевом
// проекте (при подключении инфры как подпапки).
env.cacheDir = path.join(INFRA_ROOT, '.rag-cache');

// Реестр поддерживаемых моделей. Документация проекта — на русском, поэтому по умолчанию
// многоязычная модель (TASK-47): англоязычная all-MiniLM-L6-v2 на русских запросах
// возвращала нерелевантные чанки. Для семейства E5 обязательны префиксы `query:` /
// `passage:` — без них качество заметно падает.
//
// Индекс и поисковые запросы ДОЛЖНЫ считаться одной и той же моделью, поэтому имя модели и
// её префиксы записываются в .rag-index/meta.json, а поиск (rag-server, search-cli,
// electron/services/ragSearch.ts) читает их оттуда, а не полагается на константу в коде.
export const MODELS = {
  'Xenova/multilingual-e5-small': {
    dtype: 'q8', // ~120MB вместо ~470MB fp32; для поиска потери качества незаметны
    queryPrefix: 'query: ',
    passagePrefix: 'passage: ',
  },
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2': {
    dtype: 'q8',
    queryPrefix: '',
    passagePrefix: '',
  },
  'Xenova/all-MiniLM-L6-v2': {
    dtype: 'fp32',
    queryPrefix: '',
    passagePrefix: '',
  },
};

export const DEFAULT_MODEL = process.env.RAG_EMBEDDING_MODEL || 'Xenova/multilingual-e5-small';

export function resolveModel(modelId = DEFAULT_MODEL) {
  const spec = MODELS[modelId];
  if (!spec) {
    throw new Error(
      `Неизвестная модель эмбеддингов "${modelId}". Поддерживаются: ${Object.keys(MODELS).join(', ')}`,
    );
  }
  return { id: modelId, ...spec };
}

/**
 * Модель, которой построен существующий индекс (из meta.json). Если индекса нет или meta.json
 * старого формата без префиксов — берём значения из реестра по имени модели.
 */
export function readIndexModel(indexDir) {
  const metaPath = path.join(indexDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  if (!meta.model) return null;
  const fromRegistry = MODELS[meta.model] ?? { dtype: 'fp32', queryPrefix: '', passagePrefix: '' };
  return {
    id: meta.model,
    dtype: fromRegistry.dtype,
    queryPrefix: meta.queryPrefix ?? fromRegistry.queryPrefix,
    passagePrefix: meta.passagePrefix ?? fromRegistry.passagePrefix,
  };
}

const embedders = new Map();

function getEmbedder(model) {
  if (!embedders.has(model.id)) {
    embedders.set(model.id, pipeline('feature-extraction', model.id, { dtype: model.dtype }));
  }
  return embedders.get(model.id);
}

async function embedRaw(texts, model) {
  const embedder = await getEmbedder(model);
  const output = await embedder(texts, { pooling: 'mean', normalize: true });
  const dim = output.dims[output.dims.length - 1];
  const data = output.data;
  const vectors = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
  }
  return vectors;
}

/** Эмбеддинги фрагментов документов (для построения индекса). */
export function embedPassages(texts, model = resolveModel()) {
  return embedRaw(texts.map((t) => model.passagePrefix + t), model);
}

/** Эмбеддинг поискового запроса — той же моделью, что и индекс. */
export function embedQuery(text, model) {
  return embedRaw([model.queryPrefix + text], model).then((v) => v[0]);
}
