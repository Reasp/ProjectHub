// Живой замер пауз на стыках фрагментов Qwen3-TTS (TASK-116, decision-71): старая нарезка по
// предложениям против нарезки по абзацам, на настоящем сайдкаре и установленной модели CustomVoice.
// Расписание воспроизведения считает функция плеера planChunkStart, размер чанка — qwenChunkPolicy.
//
// Запуск (Windows, Qwen3-TTS установлен в ProjectHub):
//   node --experimental-strip-types scripts/qwen-tts/junction-bench.mjs
// Под нагрузкой — параллельно python scripts/qwen-tts/gpu-load.py 0.35 из venv Qwen.
// Переменные: MEASURE_OUT — каталог результатов (по умолчанию qwen-bench-out в текущем каталоге),
// PLAN_ONLY=N — только первые N прогонов, QWEN_USERDATA — userData приложения.
// Результаты: report.json, WAV каждого фрагмента и *-heard.wav «как слышно» с паузами;
// junction-summary.mjs печатает сводку, junction-transcribe.mjs распознаёт записи Whisper.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const { splitTextForTts, splitTextForStreamingTts } = await load('electron/services/ttsTextSplit.ts');
const { DEFAULT_QWEN_CHUNK_SIZE, nextQwenChunkSize, steadyGenerationRate } = await load(
  'electron/services/qwenChunkPolicy.ts'
);
const { planChunkStart } = await load('src/services/ttsPlayer.ts');
const { summarizeForSpeech } = await load('src/services/ttsSummary.ts');

const USERDATA = process.env.QWEN_USERDATA || path.join(process.env.APPDATA || '', 'project-hub');
const PYTHON = path.join(USERDATA, 'qwen-tts', 'venv', 'Scripts', 'python.exe');
const SIDECAR = path.join(REPO, 'electron', 'workers', 'qwen', 'sidecar.py');
const MODEL_DIR = path.join(USERDATA, 'models', 'qwen-tts', 'CustomVoice');
const OUT = path.resolve(process.env.MEASURE_OUT || 'qwen-bench-out');
const REBUFFER_SEC = 0.25; // QWEN_REBUFFER_SEC из ttsEngineChain
mkdirSync(OUT, { recursive: true });

const ANSWER = `Готово, задача закрыта. Нарезка текста для Qwen теперь идёт по абзацам, а не по отдельным предложениям.

Что изменилось:
- первый фрагмент короткий, чтобы звук начался быстро;
- следующие фрагменты собирают предложения до конца абзаца;
- таймаут синтеза растёт вместе с длиной фрагмента.

\`\`\`ts
const fragments = splitTextForStreamingTts(text);
\`\`\`

Все тесты проходят, линтер чистый. Сборка распакованного приложения тоже прошла без ошибок. Осталось проверить звучание вживую на видеокарте и записать результат в задачу. Если паузы на стыках станут реже, оставим новые пороги.`;

const LONG = `Утром над рекой стоял густой туман, и лодки у причала казались серыми тенями. Рыбаки собирались молча, проверяли сети и поглядывали на небо. Старший из них сказал, что к полудню прояснится, и никто не стал спорить. Ветер почти не чувствовался, вода была тёмной и спокойной. Где-то на другом берегу лаяла собака, и звук разносился далеко над водой.

К девяти часам туман начал редеть. Сначала показались верхушки сосен, потом крыши домов на холме. Лодки одна за другой отходили от берега, и скрип вёсел смешивался с криками чаек. Молодой парень в последней лодке никак не мог завести мотор и в конце концов взялся за вёсла. Над ним посмеивались, но беззлобно: каждый когда-то начинал так же.

К полудню небо и правда очистилось. Солнце отражалось в воде так ярко, что приходилось щуриться. Улов оказался неплохим, хотя и не таким, как неделю назад. На обратном пути говорили о погоде, о ценах на рынке и о том, что скоро пора чинить причал. Вечером в посёлке пахло жареной рыбой и дымом, а над рекой снова поднимался лёгкий туман.`;

const TEXTS = {
  answer: summarizeForSpeech(ANSWER),
  long: summarizeForSpeech(LONG, { maxChars: 4000 })
};

const VARIANTS = {
  before: (text) => splitTextForTts(text),
  after: (text) => splitTextForStreamingTts(text)
};

const PLAN = [
  ['answer', 'before', 1],
  ['answer', 'after', 1],
  ['long', 'before', 1],
  ['long', 'after', 1],
  ['answer', 'after', 2],
  ['answer', 'before', 2],
  ['long', 'after', 2],
  ['long', 'before', 2]
];

// --- сайдкар ---
const child = spawn(PYTHON, ['-u', SIDECAR], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', HF_HUB_OFFLINE: '1' }
});
const waiters = new Map();
let onChunk = null;
const decoder = new StringDecoder('utf8');
let buffer = '';
child.stdout.on('data', (data) => {
  buffer += decoder.write(data);
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line.startsWith('{')) continue;
    const msg = JSON.parse(line);
    if (msg.type === 'chunk') {
      onChunk?.(msg, performance.now());
      continue;
    }
    const key = msg.type === 'ready' ? '@ready' : msg.id;
    const waiter = waiters.get(key);
    if (waiter) {
      waiters.delete(key);
      waiter(msg);
    } else {
      console.log('[unexpected]', line.slice(0, 200));
    }
  }
});
child.stderr.on('data', (d) => process.stderr.write(`[sidecar] ${d}`));
const wait = (key) => new Promise((resolve) => waiters.set(key, resolve));
const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);

const ready = await wait('@ready');
console.log('ready', ready);
const loadedP = wait('load-1');
send({ type: 'load', id: 'load-1', kind: 'custom', modelDir: MODEL_DIR });
console.log('loaded', await loadedP);

// --- анализ звука ---
function silenceEdges(samples, sr) {
  const frame = Math.round(sr * 0.02);
  const loud = (i) => {
    let sum = 0;
    for (let j = i; j < Math.min(i + frame, samples.length); j += 1) sum += samples[j] * samples[j];
    return Math.sqrt(sum / frame) > 0.01;
  };
  let lead = 0;
  while (lead < samples.length && !loud(lead)) lead += frame;
  let trail = samples.length;
  while (trail > 0 && !loud(Math.max(0, trail - frame))) trail -= frame;
  return { leadSec: Math.min(lead, samples.length) / sr, trailSec: Math.max(0, samples.length - trail) / sr };
}

function writeWav(file, parts, sr) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = Buffer.alloc(44 + total * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + total * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(total * 2, 40);
  let off = 44;
  for (const p of parts) {
    for (let i = 0; i < p.length; i += 1) {
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(p[i] * 32767))), off);
      off += 2;
    }
  }
  writeFileSync(file, buf);
}

function decode(pcm) {
  const raw = Buffer.from(pcm, 'base64');
  const out = new Float32Array(raw.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = raw.readInt16LE(i * 2) / 32768;
  return out;
}

// --- прогон ---
const report = { gpu: ready.gpu, startedAt: new Date().toISOString(), texts: TEXTS, runs: [] };
let jobCounter = 0;

const plan = process.env.PLAN_ONLY ? PLAN.slice(0, Number(process.env.PLAN_ONLY)) : PLAN;
for (const [textKey, variant, round] of plan) {
  const fragments = VARIANTS[variant](TEXTS[textKey]);
  let chunkSize = DEFAULT_QWEN_CHUNK_SIZE;
  const t0 = performance.now();
  let nextStart = 0;
  let played = 0;
  const gaps = [];
  const fragStats = [];
  const heard = [];
  let sr = 24000;

  for (let f = 0; f < fragments.length; f += 1) {
    const id = `job-${++jobCounter}`;
    const audio = [];
    let firstInFragment = true;
    onChunk = (msg, at) => {
      if (msg.id !== id) return;
      const samples = decode(msg.pcm);
      if (samples.length === 0) return;
      sr = msg.sampleRate;
      const now = (at - t0) / 1000;
      const start = planChunkStart(now, nextStart, played, REBUFFER_SEC);
      if (played > 0 && start > nextStart + 1e-6) {
        const gap = start - nextStart;
        gaps.push({ fragment: f, junction: firstInFragment, sec: +gap.toFixed(3) });
        heard.push(new Float32Array(Math.round(gap * sr)));
      }
      const firstSoundSec = played === 0 ? start : undefined;
      if (firstSoundSec !== undefined) report.lastFirstSound = firstSoundSec;
      nextStart = start + samples.length / sr;
      played += 1;
      firstInFragment = false;
      audio.push(samples);
      heard.push(samples);
    };
    const doneP = wait(id);
    const sentAt = (performance.now() - t0) / 1000;
    send({ type: 'synthesize', id, text: fragments[f], language: 'Russian', speaker: 'serena', chunkSize });
    const done = await doneP;
    if (done.type !== 'done') throw new Error(`fragment failed: ${JSON.stringify(done)}`);
    const rate = steadyGenerationRate(done, chunkSize);
    const merged = new Float32Array(audio.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of audio) {
      merged.set(p, o);
      o += p.length;
    }
    const edges = silenceEdges(merged, sr);
    const wavName = `${textKey}-${variant}-r${round}-f${f}.wav`;
    writeWav(path.join(OUT, wavName), [merged], sr);
    fragStats.push({
      chars: fragments[f].length,
      sentAtSec: +sentAt.toFixed(3),
      chunkSize,
      firstChunkMs: done.firstChunkMs,
      genMs: done.genMs,
      audioSec: done.audioSec,
      secPerChar: +(done.audioSec / fragments[f].length).toFixed(4),
      rate: rate === null ? null : +rate.toFixed(3),
      leadSilenceSec: +edges.leadSec.toFixed(2),
      trailSilenceSec: +edges.trailSec.toFixed(2),
      wav: wavName,
      text: fragments[f]
    });
    chunkSize = nextQwenChunkSize(chunkSize, rate);
  }

  writeWav(path.join(OUT, `${textKey}-${variant}-r${round}-heard.wav`), heard, sr);
  const junctionGaps = gaps.filter((g) => g.junction);
  const midGaps = gaps.filter((g) => !g.junction);
  const sum = (list) => +list.reduce((s, g) => s + g.sec, 0).toFixed(3);
  // Тишина в самом звуке на стыке: хвост фрагмента + начало следующего
  const audioJunctionSilence = fragStats.slice(1).map((fs, i) => +(fragStats[i].trailSilenceSec + fs.leadSilenceSec).toFixed(2));
  const run = {
    text: textKey,
    variant,
    round,
    fragments: fragments.length,
    junctions: fragments.length - 1,
    firstSoundSec: +report.lastFirstSound.toFixed(3),
    audioSec: +fragStats.reduce((s, f) => s + f.audioSec, 0).toFixed(2),
    junctionGaps: junctionGaps.length,
    junctionGapSec: sum(junctionGaps),
    midGaps: midGaps.length,
    midGapSec: sum(midGaps),
    audioJunctionSilence,
    gaps,
    fragStats
  };
  report.runs.push(run);
  console.log(
    `${textKey}/${variant}/r${round}: ${run.fragments} fragments, first sound ${run.firstSoundSec}s, ` +
      `junction gaps ${run.junctionGaps} (${run.junctionGapSec}s), mid gaps ${run.midGaps} (${run.midGapSec}s), audio ${run.audioSec}s`
  );
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
}

delete report.lastFirstSound;
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
send({ type: 'shutdown' });
child.stdin.end();
setTimeout(() => process.exit(0), 3000);
