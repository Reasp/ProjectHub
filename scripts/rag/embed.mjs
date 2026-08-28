import { pipeline, env } from '@huggingface/transformers';
import path from 'node:path';
import { INFRA_ROOT } from '../config.mjs';

// Модель весит ~90MB и скачивается один раз при первом запуске — храним кэш
// рядом со скриптами инфраструктуры (.rag-cache/, в .gitignore), а не в системном
// каталоге и не в целевом проекте (при подключении инфры как подпапки).
env.cacheDir = path.join(INFRA_ROOT, '.rag-cache');

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

let embedderPromise;

function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32' });
  }
  return embedderPromise;
}

export async function embed(texts) {
  const embedder = await getEmbedder();
  const output = await embedder(texts, { pooling: 'mean', normalize: true });
  const dim = output.dims[output.dims.length - 1];
  const data = output.data;
  const vectors = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
  }
  return vectors;
}

export const EMBEDDING_MODEL = MODEL_ID;
