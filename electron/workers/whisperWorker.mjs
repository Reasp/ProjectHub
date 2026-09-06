import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

if (!parentPort) {
  throw new Error('whisperWorker.mjs must be run in a Worker thread');
}

// Модель и каталог кэша передаёт main-процесс (единый userData/models, TASK-43);
// fallback на старое расположение — только если воркер запущен без workerData.
const MODEL_NAME = workerData?.modelName || 'Xenova/whisper-base';
const CACHE_DIR = workerData?.cacheDir || path.join(os.homedir(), '.cache', 'projecthub', 'whisper');

let asrPipeline = null;
let isInitializing = false;

async function initPipeline() {
  if (asrPipeline) return asrPipeline;
  if (isInitializing) return null;

  isInitializing = true;
  const startTime = Date.now();

  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });

    const transformers = await import('@huggingface/transformers');
    if (transformers.env) {
      transformers.env.cacheDir = CACHE_DIR;
      transformers.env.allowLocalModels = true;
    }

    console.log(`[WhisperWorker] Loading model ${MODEL_NAME} in separate OS thread...`);
    asrPipeline = await transformers.pipeline('automatic-speech-recognition', MODEL_NAME, {
      dtype: 'fp32'
    });

    const loadTimeMs = Date.now() - startTime;
    console.log(`[WhisperWorker] Model loaded successfully in ${loadTimeMs}ms`);

    parentPort.postMessage({
      type: 'ready',
      model: MODEL_NAME,
      loadTimeMs
    });

    return asrPipeline;
  } catch (err) {
    console.error('[WhisperWorker] Error loading pipeline in worker thread:', err);
    parentPort.postMessage({
      type: 'init_error',
      error: err?.message || String(err)
    });
    throw err;
  } finally {
    isInitializing = false;
  }
}

// Auto-start initialization when worker starts
initPipeline().catch(() => {});

parentPort.on('message', async (msg) => {
  if (!msg) return;

  if (msg.type === 'init') {
    try {
      await initPipeline();
    } catch (err) {
      // handled
    }
    return;
  }

  if (msg.type === 'transcribe') {
    const { id, audioData, language = 'ru' } = msg;
    const startTime = Date.now();

    try {
      if (!asrPipeline) {
        await initPipeline();
      }

      if (!asrPipeline) {
        throw new Error('Whisper pipeline is not ready yet');
      }

      const floatArray = audioData instanceof Float32Array
        ? audioData
        : new Float32Array(audioData);

      if (floatArray.length < 1600) {
        parentPort.postMessage({
          type: 'result',
          id,
          text: '',
          timeMs: Date.now() - startTime
        });
        return;
      }

      const targetLang = language === 'en' ? 'english' : 'russian';
      const output = await asrPipeline(floatArray, {
        language: targetLang,
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
        initial_prompt: 'ProjectHub, project, tab, chat, session, switch, next, prev, back, close, new, проект, вкладка, чат, сессия, диалог, следующий, предыдущий, закрой, новый'
      });

      const text = (output?.text || '').trim();
      const timeMs = Date.now() - startTime;

      parentPort.postMessage({
        type: 'result',
        id,
        text,
        timeMs
      });
    } catch (err) {
      console.error(`[WhisperWorker] Task ${id} transcription error:`, err);
      parentPort.postMessage({
        type: 'error',
        id,
        error: err?.message || String(err),
        timeMs: Date.now() - startTime
      });
    }
  }
});
