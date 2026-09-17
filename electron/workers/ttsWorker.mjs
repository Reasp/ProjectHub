/**
 * Процесс локального синтеза речи (TASK-69, decision-25, decision-34).
 *
 * Внутри — `sherpa-onnx-node` с голосом Piper/VITS. Процесс намеренно «глупый»: разбиение текста на
 * предложения, выбор голоса и очередь заданий живут в `piperTtsService`, сюда приходит уже готовый
 * фрагмент текста. Так реестр голосов не дублируется в двух местах (decision-21, п. 3).
 *
 * Запускается через Electron `utilityProcess`, а не `worker_threads` (decision-34). Причины, обе
 * проверены на упакованном приложении 2026-09-17:
 *
 * - sherpa везёт свою `onnxruntime.dll` 1.28, а Whisper и RAG (`onnxruntime-node`) — 1.21. В одном
 *   процессе Windows отдаёт второму загрузчику уже загруженную библиотеку того же имени, и первый
 *   же синтез после распознавания речи ронял всё приложение.
 * - На модели без metadata или на повреждённом `.onnx` sherpa не бросает исключение, а аварийно
 *   завершает процесс. Поток делит процесс с main, отдельный процесс — нет.
 *
 * Особенность рантайма из спайка 2026-09-16: в Electron V8 запрещены external buffers, и `generate()`
 * падает с «External buffers are not allowed». Поэтому в каждом запросе передаётся
 * `enableExternalBuffer: false` (в обычном node ошибки нет, отсюда риск не заметить).
 */
import { createRequire } from 'node:module';

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error('ttsWorker.mjs must be run as an Electron utility process');
}

const require = createRequire(import.meta.url);

/** Загруженный движок и ключ голоса, для которого он собран. */
let sherpa = null;
let tts = null;
let loadedKey = null;

/** jobId заданий, отменённых во время генерации. */
const cancelledJobs = new Set();

/**
 * Сообщение в main. Канал utility process передаёт только MessagePort, буферы копируются
 * структурным клонированием — для фрагментов звука длиной в предложение это дёшево.
 */
function post(message) {
  try {
    parentPort.postMessage(message);
  } catch (err) {
    console.error('[TtsWorker] postMessage failed:', err);
  }
}

function loadSherpa() {
  if (!sherpa) sherpa = require('sherpa-onnx-node');
  return sherpa;
}

/** Ключ голоса: пересобираем движок только при реальной смене модели или её параметров. */
function voiceKey(voice) {
  return [voice.model, voice.tokens, voice.dataDir, voice.noiseScale, voice.noiseScaleW, voice.lengthScale].join('|');
}

function ensureVoice(voice) {
  const key = voiceKey(voice);
  if (tts && loadedKey === key) return { reused: true, loadTimeMs: 0 };

  const engine = loadSherpa();
  const startedAt = Date.now();
  tts = new engine.OfflineTts({
    model: {
      vits: {
        model: voice.model,
        tokens: voice.tokens,
        dataDir: voice.dataDir,
        noiseScale: voice.noiseScale,
        noiseScaleW: voice.noiseScaleW,
        lengthScale: voice.lengthScale
      },
      numThreads: voice.numThreads || 2,
      debug: 0,
      provider: 'cpu'
    },
    maxNumSentences: 1
  });
  loadedKey = key;
  return { reused: false, loadTimeMs: Date.now() - startedAt };
}

/** Копия сэмплов в собственный буфер: исходный принадлежит sherpa и может переиспользоваться. */
function copySamples(samples) {
  const copy = new Float32Array(samples.length);
  copy.set(samples);
  return copy;
}

/**
 * Синтез одного фрагмента. Сначала пробуем потоковый `generateAsync` с колбэком прогресса:
 * он отдаёт PCM по мере готовности и позволяет прервать генерацию (возврат 0). Если потоковый
 * путь недоступен в этой сборке — откатываемся на синхронный `generate`.
 */
async function synthesize(msg) {
  const { id, text, speed = 1.0, sid = 0 } = msg;
  const startedAt = Date.now();
  let chunkIndex = 0;
  let sampleRate = 0;

  const request = {
    text,
    sid,
    speed,
    enableExternalBuffer: false
  };

  try {
    const streamed = await tts.generateAsync({
      ...request,
      onProgress: (info) => {
        if (cancelledJobs.has(id)) return 0; // прерывает генерацию внутри sherpa
        if (info && info.samples && info.samples.length > 0) {
          const samples = copySamples(info.samples);
          sampleRate = info.sampleRate || tts.sampleRate;
          post({ type: 'chunk', id, samples, sampleRate, index: chunkIndex++ });
        }
        return 1;
      }
    });

    if (cancelledJobs.has(id)) {
      cancelledJobs.delete(id);
      post({ type: 'cancelled', id });
      return;
    }

    // Колбэк не вызывался (сборка без потокового прогресса) — отдаём результат одним чанком
    if (chunkIndex === 0 && streamed && streamed.samples && streamed.samples.length > 0) {
      const samples = copySamples(streamed.samples);
      sampleRate = streamed.sampleRate || tts.sampleRate;
      post({ type: 'chunk', id, samples, sampleRate, index: chunkIndex++ });
    }

    const audioSec = streamed && streamed.samples ? streamed.samples.length / (streamed.sampleRate || tts.sampleRate) : 0;
    post({ type: 'done', id, timeMs: Date.now() - startedAt, audioSec, chunks: chunkIndex, sampleRate });
    return;
  } catch (streamErr) {
    if (cancelledJobs.has(id)) {
      cancelledJobs.delete(id);
      post({ type: 'cancelled', id });
      return;
    }
    console.warn('[TtsWorker] Streaming synthesis failed, falling back to sync generate:', streamErr?.message || streamErr);
  }

  // Резервный путь: синхронная генерация целиком
  const audio = tts.generate(request);
  if (cancelledJobs.has(id)) {
    cancelledJobs.delete(id);
    post({ type: 'cancelled', id });
    return;
  }
  const samples = copySamples(audio.samples);
  sampleRate = audio.sampleRate || tts.sampleRate;
  post({ type: 'chunk', id, samples, sampleRate, index: 0 });
  post({
    type: 'done',
    id,
    timeMs: Date.now() - startedAt,
    audioSec: audio.samples.length / sampleRate,
    chunks: 1,
    sampleRate
  });
}

parentPort.on('message', async (event) => {
  const msg = event?.data;
  if (!msg || typeof msg !== 'object') return;
  const { type, id } = msg;

  if (type === 'cancel') {
    if (id) cancelledJobs.add(id);
    return;
  }

  if (type === 'unload') {
    tts = null;
    loadedKey = null;
    post({ type: 'unloaded', id });
    return;
  }

  if (type === 'load') {
    try {
      const { loadTimeMs, reused } = ensureVoice(msg.voice);
      post({
        type: 'loaded',
        id,
        loadTimeMs,
        reused,
        sampleRate: tts.sampleRate,
        numSpeakers: tts.numSpeakers
      });
    } catch (err) {
      post({ type: 'error', id, error: err?.message || String(err) });
    }
    return;
  }

  if (type === 'synthesize') {
    try {
      if (!tts || (msg.voice && voiceKey(msg.voice) !== loadedKey)) {
        ensureVoice(msg.voice);
      }
      await synthesize(msg);
    } catch (err) {
      cancelledJobs.delete(id);
      post({ type: 'error', id, error: err?.message || String(err) });
    }
  }
});

post({ type: 'ready' });
