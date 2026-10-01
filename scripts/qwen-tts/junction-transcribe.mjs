// Распознаёт записи фрагментов из junction-bench.mjs локальным Whisper и сравнивает с исходным
// текстом: доля ошибок, подряд повторённые слова (зацикливание модели), пропуски (TASK-116).
// Запуск: node scripts/qwen-tts/junction-transcribe.mjs <каталог результатов>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const loaded = await import('@huggingface/transformers');
const transformers = loaded.env ? loaded : loaded.default;
const USERDATA = process.env.QWEN_USERDATA || path.join(process.env.APPDATA || '', 'project-hub');
transformers.env.cacheDir = path.join(USERDATA, 'models');
transformers.env.allowLocalModels = true;
transformers.env.allowRemoteModels = false;

const OUT = path.resolve(process.argv[2] || 'qwen-bench-out');
const report = JSON.parse(readFileSync(path.join(OUT, 'report.json'), 'utf8'));
const asr = await transformers.pipeline('automatic-speech-recognition', 'Xenova/whisper-base', { dtype: 'fp32' });

function readWav16k(file) {
  const buf = readFileSync(file);
  const sr = buf.readUInt32LE(24);
  const n = (buf.length - 44) / 2;
  const src = new Float32Array(n);
  for (let i = 0; i < n; i += 1) src[i] = buf.readInt16LE(44 + i * 2) / 32768;
  const ratio = sr / 16000;
  const out = new Float32Array(Math.floor(n / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const x = i * ratio;
    const j = Math.floor(x);
    const t = x - j;
    out[i] = src[j] * (1 - t) + (src[j + 1] ?? src[j]) * t;
  }
  return out;
}

const words = (s) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Подряд повторённые n-граммы в распознанном, которых нет в исходном. */
function repeats(hyp, ref) {
  const found = [];
  for (const n of [1, 2, 3]) {
    for (let i = 0; i + 2 * n <= hyp.length; i += 1) {
      const a = hyp.slice(i, i + n).join(' ');
      const b = hyp.slice(i + n, i + 2 * n).join(' ');
      if (a === b && !ref.join(' ').includes(`${a} ${a}`)) found.push(a);
    }
  }
  return found;
}

const results = [];
for (const run of report.runs) {
  for (const frag of run.fragStats) {
    const audio = readWav16k(path.join(OUT, frag.wav));
    const res = await asr(audio, { language: 'russian', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    const ref = words(frag.text);
    const hyp = words(res.text);
    const wer = editDistance(ref, hyp) / Math.max(1, ref.length);
    const row = {
      run: `${run.text}/${run.variant}/r${run.round}`,
      wav: frag.wav,
      chars: frag.chars,
      refWords: ref.length,
      hypWords: hyp.length,
      wer: +wer.toFixed(3),
      repeats: repeats(hyp, ref),
      transcript: res.text.trim()
    };
    results.push(row);
    console.log(`${row.wav}: chars ${row.chars}, words ${row.refWords}→${row.hypWords}, WER ${row.wer}, repeats ${row.repeats.join('|') || '-'}`);
  }
}
writeFileSync(path.join(OUT, 'transcripts.json'), JSON.stringify(results, null, 2));
