/**
 * Пробная загрузка импортированного голоса Piper в отдельном процессе (TASK-69, decision-34).
 *
 * Запускается через Electron `utilityProcess`. Получает пути модели одним сообщением, загружает
 * её в sherpa-onnx, синтезирует короткую фразу, отправляет итог и завершается.
 *
 * Зачем отдельный процесс, а не `ttsWorker.mjs`: на модели без metadata или на повреждённом файле
 * sherpa не бросает исключение, а аварийно завершает процесс. `worker_threads` делят процесс с main,
 * поэтому такая модель в воркере роняет всё приложение (проверено 2026-09-17, crash dump). Здесь
 * падение убивает только пробу, а main по коду выхода отклоняет импорт с понятной ошибкой.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const port = process.parentPort;

function finish(message, code) {
  try {
    port.postMessage(message);
  } finally {
    // Даём сообщению уйти по каналу до выхода процесса
    setTimeout(() => process.exit(code), 50);
  }
}

port.once('message', (event) => {
  const { voice, text } = event.data || {};
  try {
    const sherpa = require('sherpa-onnx-node');
    const startedAt = Date.now();
    const tts = new sherpa.OfflineTts({
      model: {
        vits: {
          model: voice.model,
          tokens: voice.tokens,
          dataDir: voice.dataDir,
          noiseScale: voice.noiseScale,
          noiseScaleW: voice.noiseScaleW,
          lengthScale: voice.lengthScale
        },
        numThreads: 1,
        debug: 0,
        provider: 'cpu'
      },
      maxNumSentences: 1
    });
    const loadTimeMs = Date.now() - startedAt;
    // enableExternalBuffer: false обязателен в Electron — см. комментарий в ttsWorker.mjs
    const audio = tts.generate({ text: text || 'test', sid: 0, speed: 1.0, enableExternalBuffer: false });
    const sampleRate = audio.sampleRate || tts.sampleRate || 0;
    const audioSec = sampleRate > 0 ? audio.samples.length / sampleRate : 0;
    finish({ type: 'ok', sampleRate, loadTimeMs, audioSec }, 0);
  } catch (err) {
    finish({ type: 'error', error: err && err.message ? err.message : String(err) }, 1);
  }
});
