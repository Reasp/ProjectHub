// Поддельный сайдкар Qwen3-TTS для unit-тестов `qwenTtsService` (TASK-104): говорит тем же
// протоколом, что `electron/workers/qwen/sidecar.py`, но без Python и видеокарты.
//
// Поведение задаётся переменной FAKE_QWEN_MODE:
//   ok            — обычная работа: три чанка на фрагмент;
//   no-ready      — молчит после старта (зависший импорт torch);
//   broken        — сообщает, что окружение не поднялось, и выходит;
//   load-fails    — отвечает ошибкой на загрузку модели;
//   crash-on-synth — аварийно завершается посреди синтеза;
//   hang-on-synth — отдаёт один чанк и замолкает.
import readline from 'node:readline';

const mode = process.env.FAKE_QWEN_MODE || 'ok';
const chunkDelayMs = Number(process.env.FAKE_QWEN_CHUNK_DELAY_MS || 5);
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 0.1 с «звука»: линейный подъём, чтобы в тесте была видна декодировка int16 → float. */
function pcm(samples = 2400) {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) buf.writeInt16LE(Math.round((i / samples) * 16000), i * 2);
  return buf.toString('base64');
}

const cancelled = new Set();
const queue = [];
let busy = false;

async function handle(cmd) {
  if (cmd.type === 'load') {
    if (mode === 'load-fails') {
      send({ type: 'error', id: cmd.id, code: 'qwen_out_of_memory', error: 'CUDA out of memory' });
      return;
    }
    send({ type: 'loaded', id: cmd.id, kind: cmd.kind, loadMs: 40, warmupMs: 10, sampleRate: 24000, vramMb: 4456, speakers: [] });
    return;
  }
  if (cmd.type === 'synthesize') {
    // Эхо параметров в stderr — тест проверяет, что до сайдкара дошли голос, инструкция и зерно
    process.stderr.write(
      `synth ${JSON.stringify({ speaker: cmd.speaker, instruct: cmd.instruct, refAudio: cmd.refAudio, seed: cmd.seed, language: cmd.language, text: cmd.text })}\n`
    );
    for (let index = 0; index < 3; index += 1) {
      await sleep(chunkDelayMs);
      if (cancelled.has(cmd.id)) {
        cancelled.delete(cmd.id);
        send({ type: 'cancelled', id: cmd.id });
        return;
      }
      send({ type: 'chunk', id: cmd.id, index, sampleRate: 24000, pcm: pcm() });
      if (mode === 'crash-on-synth') process.exit(7);
      if (mode === 'hang-on-synth') await new Promise(() => {});
    }
    send({ type: 'done', id: cmd.id, audioSec: 0.3, genMs: 15, firstChunkMs: 5, chunks: 3 });
    return;
  }
  if (cmd.type === 'unload') send({ type: 'unloaded', id: cmd.id });
}

async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length > 0) await handle(queue.shift());
  busy = false;
}

if (mode === 'broken') {
  send({ type: 'error', id: null, code: 'qwen_runtime_broken', error: 'No module named torch' });
  process.exit(3);
}
if (mode !== 'no-ready') {
  // Мусор в канале протокола сервис обязан пережить
  process.stdout.write('not a protocol line\n');
  send({ type: 'ready', python: '3.11.0', torch: 'fake', cuda: true, gpu: 'Fake GPU' });
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    return;
  }
  if (cmd.type === 'cancel') {
    cancelled.add(cmd.id);
    return;
  }
  if (cmd.type === 'shutdown') process.exit(0);
  queue.push(cmd);
  void drain();
});
process.stdin.on('end', () => process.exit(0));
