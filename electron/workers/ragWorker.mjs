import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

/**
 * Изолированный воркер векторного поиска по документации (TASK-50).
 *
 * Раньше `@huggingface/transformers` и `@lancedb/lancedb` грузились прямо в main-процесс, и
 * кодирование запроса блокировало event loop (весь UI замирал на время эмбеддинга). Здесь
 * обе библиотеки живут в отдельном OS-потоке: main получает только готовые строки результата.
 *
 * Модель эмбеддингов выбирает main (`ragEmbeddingModel.ts`) и передаёт её описание в каждом
 * запросе, чтобы реестр моделей не дублировался в двух местах.
 */

if (!parentPort) {
  throw new Error('ragWorker.mjs must be run in a Worker thread');
}

const CACHE_DIR = workerData?.cacheDir || path.join(os.homedir(), '.cache', 'projecthub', 'models');

let transformersModule = null;
let lancedbModule = null;
/** id модели → Promise<pipeline>. */
const embedders = new Map();
/** indexDir → Promise<{ db, table }>. */
const tables = new Map();

async function getTransformers() {
  if (!transformersModule) {
    await fs.mkdir(CACHE_DIR, { recursive: true }).catch(() => {});
    transformersModule = await import('@huggingface/transformers');
    if (transformersModule.env) {
      transformersModule.env.cacheDir = CACHE_DIR;
      transformersModule.env.allowLocalModels = true;
    }
  }
  return transformersModule;
}

async function getLanceDb() {
  if (!lancedbModule) {
    lancedbModule = await import('@lancedb/lancedb');
  }
  return lancedbModule;
}

async function getEmbedder(model) {
  const cached = embedders.get(model.id);
  if (cached) return cached;

  const promise = getTransformers().then((tf) =>
    tf.pipeline('feature-extraction', model.id, { dtype: model.dtype })
  );
  embedders.set(model.id, promise);
  promise.catch(() => embedders.delete(model.id));
  return promise;
}

async function embedQuery(query, model) {
  const embedder = await getEmbedder(model);
  const output = await embedder([(model.queryPrefix || '') + query], { pooling: 'mean', normalize: true });
  const dim = output.dims[output.dims.length - 1];
  return Array.from(output.data.slice(0, dim));
}

/**
 * Открытая таблица кэшируется по каталогу индекса: переподключение к LanceDB на каждый
 * запрос стоит дороже самого поиска. `null` — индекса нет или он пуст.
 */
async function openTable(indexDir) {
  const cached = tables.get(indexDir);
  if (cached) return cached;

  const promise = (async () => {
    const lancedb = await getLanceDb();
    const db = await lancedb.connect(indexDir);
    const names = await db.tableNames();
    const target = names.includes('docs') ? 'docs' : names[0];
    if (!target) return null;
    return { db, table: await db.openTable(target) };
  })();

  tables.set(indexDir, promise);
  promise.catch(() => tables.delete(indexDir));
  return promise;
}

/** Строки LanceDB содержат тензоры/BigInt — оставляем только сериализуемые поля. */
function toPlainRow(row) {
  return {
    file: typeof row.file === 'string' ? row.file : '',
    heading: typeof row.heading === 'string' ? row.heading : '',
    text: typeof row.text === 'string' ? row.text : '',
    distance: typeof row._distance === 'number' ? row._distance : null
  };
}

async function handleVectorSearch({ indexDir, query, model, limit }) {
  const opened = await openTable(indexDir);
  if (!opened) return { rows: [] };

  const vector = await embedQuery(query, model);
  const found = await opened.table.search(vector).limit(limit).toArray();
  return { rows: found.map(toPlainRow) };
}

async function handleStats({ indexDir }) {
  const opened = await openTable(indexDir);
  if (!opened) return { chunksCount: 0, hasTable: false };
  return { chunksCount: await opened.table.countRows(), hasTable: true };
}

parentPort.on('message', async (msg) => {
  if (!msg || typeof msg.id !== 'string') return;

  try {
    let data;
    if (msg.type === 'vector_search') {
      data = await handleVectorSearch(msg);
    } else if (msg.type === 'stats') {
      data = await handleStats(msg);
    } else {
      throw new Error(`Unknown RAG worker message type: ${msg.type}`);
    }
    parentPort.postMessage({ type: 'result', id: msg.id, ok: true, data });
  } catch (err) {
    parentPort.postMessage({
      type: 'result',
      id: msg.id,
      ok: false,
      error: err?.message || String(err)
    });
  }
});

parentPort.postMessage({ type: 'ready' });
