// Сводка замера junction-bench.mjs: фрагменты, скорость, паузы на стыках и внутри фрагментов (TASK-116).
// Запуск: node scripts/qwen-tts/junction-summary.mjs <каталог результатов>
import { readFileSync } from 'node:fs';
import path from 'node:path';

const report = JSON.parse(readFileSync(path.join(path.resolve(process.argv[2] || 'qwen-bench-out'), 'report.json'), 'utf8'));
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
for (const r of report.runs) {
  const rates = r.fragStats.map((f) => f.rate).filter((x) => x !== null);
  const spc = r.fragStats.map((f) => f.secPerChar);
  const sil = r.audioJunctionSilence;
  console.log(
    `${r.text}/${r.variant}/r${r.round}: frag ${r.fragments}, chars ${r.fragStats.map((f) => f.chars).join(',')}` +
      `\n   chunk ${r.fragStats.map((f) => f.chunkSize).join(',')}; rate ${rates.map((x) => x.toFixed(2)).join(',')}; ` +
      `firstChunkMs ${r.fragStats.map((f) => f.firstChunkMs).join(',')}` +
      `\n   sched gaps: junction ${r.junctionGaps} (${r.junctionGapSec}s), mid ${r.midGaps} (${r.midGapSec}s); audio ${r.audioSec}s` +
      `\n   in-audio junction silence: n=${sil.length} avg ${avg(sil).toFixed(2)}s sum ${sil.reduce((s, x) => s + x, 0).toFixed(2)}s` +
      `\n   sec/char ${Math.min(...spc).toFixed(3)}..${Math.max(...spc).toFixed(3)} (avg ${avg(spc).toFixed(3)})`
  );
}
