import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { pickWhisperLanguage, WHISPER_AUTO_LANGUAGES, whisperLanguageName } from './whisperLanguage.mjs';

if (!parentPort) {
  throw new Error('whisperWorker.mjs must be run in a Worker thread');
}

// Модель и каталог кэша передаёт main-процесс (единый userData/models, TASK-43);
// fallback на старое расположение — только если воркер запущен без workerData.
const MODEL_NAME = workerData?.modelName || 'Xenova/whisper-base';
const CACHE_DIR = workerData?.cacheDir || path.join(os.homedir(), '.cache', 'projecthub', 'whisper');

let asrPipeline = null;
let transformersModule = null;
let isInitializing = false;

/** Не длиннее окна Whisper: язык определяется по первым 30 секундам. */
const DETECT_WINDOW_SAMPLES = 16000 * 30;

/**
 * Автоопределение языка (TASK-117): один шаг декодера после `<|startoftranscript|>` и сравнение
 * логитов токенов языка. Стоит лишнего прохода энкодера — 0.6–0.9 с на whisper-base на CPU.
 */
async function detectLanguage(floatArray, fallback) {
  const { model, processor } = asrPipeline;
  const audio = floatArray.length > DETECT_WINDOW_SAMPLES ? floatArray.subarray(0, DETECT_WINDOW_SAMPLES) : floatArray;
  const inputs = await processor(audio);
  const sot = model.generation_config.decoder_start_token_id;
  const decoder_input_ids = new transformersModule.Tensor('int64', BigInt64Array.from([BigInt(sot)]), [1, 1]);
  const output = await model({ ...inputs, decoder_input_ids });
  const logits = output.logits.data;
  const scores = {};
  for (const language of WHISPER_AUTO_LANGUAGES) {
    const tokenId = model.generation_config.lang_to_id?.[`<|${language}|>`];
    if (typeof tokenId === 'number') scores[language] = logits[tokenId];
  }
  return pickWhisperLanguage(scores, fallback);
}

async function initPipeline() {
  if (asrPipeline) return asrPipeline;
  if (isInitializing) return null;

  isInitializing = true;
  const startTime = Date.now();

  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });

    const transformers = await import('@huggingface/transformers');
    transformersModule = transformers;
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
    // language: 'ru' | 'en' | 'auto'; fallbackLanguage — язык при неуверенном автоопределении
    const { id, audioData, language = 'ru', fallbackLanguage = 'ru' } = msg;
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

      let spokenLanguage = language === 'en' ? 'en' : 'ru';
      let detection = null;
      if (language === 'auto') {
        detection = await detectLanguage(floatArray, fallbackLanguage === 'en' ? 'en' : 'ru');
        spokenLanguage = detection.language;
      }

      const output = await asrPipeline(floatArray, {
        language: whisperLanguageName(spokenLanguage),
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
        initial_prompt: 'ProjectHub, project, tab, chat, session, switch, next, prev, back, close, new, проект, вкладка, чат, сессия, диалог, следующий, предыдущий, закрой, новый'
      });

      const text = (output?.text || '').trim();
      const timeMs = Date.now() - startTime;

      if (detection) {
        console.log(
          `[WhisperWorker] Auto language: ${detection.language} (margin ${detection.margin.toFixed(1)}${detection.confident ? '' : ', fallback'})`
        );
      }

      parentPort.postMessage({
        type: 'result',
        id,
        text,
        language: spokenLanguage,
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
