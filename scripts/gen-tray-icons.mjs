import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

/**
 * Генератор иконок системного трея (TASK-63): рисует три PNG 32x32 и перезаписывает
 * electron/services/trayIcons.ts, где они вшиты как base64. Запускается вручную при смене
 * палитры состояний (idle / working / attention), в сборку не входит.
 */

const SIZE = 32;

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(pixels) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  let o = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[o++] = 0;
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      raw[o++] = pixels[i];
      raw[o++] = pixels[i + 1];
      raw[o++] = pixels[i + 2];
      raw[o++] = pixels[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** Кольцо (обод) + заполненный центр: читаемо и в светлой, и в тёмной панели задач. */
function draw(ringColor, coreColor, dot) {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const [rr, rg, rb] = hex(ringColor);
  const [cr, cg, cb] = hex(coreColor);
  const cx = 15.5;
  const cy = 15.5;
  const outer = 14.5;
  const inner = 10.0;
  const core = 6.0;
  const put = (x, y, r, g, b, a) => {
    const i = (y * SIZE + x) * 4;
    const na = a / 255;
    const oa = px[i + 3] / 255;
    const out = na + oa * (1 - na);
    if (out <= 0) return;
    px[i] = Math.round((r * na + px[i] * oa * (1 - na)) / out);
    px[i + 1] = Math.round((g * na + px[i + 1] * oa * (1 - na)) / out);
    px[i + 2] = Math.round((b * na + px[i + 2] * oa * (1 - na)) / out);
    px[i + 3] = Math.round(out * 255);
  };
  const cov = (d, edge) => {
    const t = edge - d;
    if (t >= 0.5) return 1;
    if (t <= -0.5) return 0;
    return t + 0.5;
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const ring = Math.min(cov(d, outer), 1 - cov(d, inner));
      if (ring > 0) put(x, y, rr, rg, rb, Math.round(255 * ring));
      const c = cov(d, core);
      if (c > 0) put(x, y, cr, cg, cb, Math.round(255 * c));
    }
  }
  if (dot) {
    const [dr, dg, db] = hex(dot);
    const dx = 24.5;
    const dy = 7.5;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const d = Math.hypot(x - dx, y - dy);
        const a = cov(d, 6.5);
        if (a > 0) put(x, y, dr, dg, db, Math.round(255 * a));
      }
    }
  }
  return encodePng(px);
}

const map = {
  idle: draw('#94a3b8', '#64748b', null).toString('base64'),
  working: draw('#60a5fa', '#3b82f6', null).toString('base64'),
  attention: draw('#fbbf24', '#f59e0b', '#ef4444').toString('base64')
};

const wrap = (b) => {
  const chunks = [];
  for (let i = 0; i < b.length; i += 100) chunks.push('    ' + JSON.stringify(b.slice(i, i + 100)));
  return chunks.join(' +\n');
};

const BT = String.fromCharCode(96);
const out = `import { nativeImage, type NativeImage } from 'electron';
import type { TrayState } from './notificationTypes.js';

/**
 * Иконки системного трея (TASK-63, decision-13 п.2).
 *
 * PNG 32×32 вшиты в код как data URI, а не лежат файлами: трей поднимается до загрузки окна и
 * одинаково работает в dev и в упакованном приложении, где public/ уже внутри app.asar.
 * Кольцо с заливкой: idle — серый, working — синий, attention — жёлтый с красной точкой.
 * Генератор изображений — scripts/gen-tray-icons.mjs (запускается вручную при смене палитры).
 */

const PNG_BASE64: Record<TrayState, string> = {
  idle:
${wrap(map.idle)},
  working:
${wrap(map.working)},
  attention:
${wrap(map.attention)}
};

const cache = new Map<TrayState, NativeImage>();

/** Иконка состояния; результат кешируется — Tray.setImage вызывается на каждом событии шины. */
export function getTrayIcon(state: TrayState): NativeImage {
  const cached = cache.get(state);
  if (cached) return cached;
  const image = nativeImage.createFromDataURL(${BT}data:image/png;base64,\${PNG_BASE64[state]}${BT});
  cache.set(state, image);
  return image;
}
`;

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'services', 'trayIcons.ts');
fs.writeFileSync(target, out, 'utf8');
console.log('Иконки трея записаны в', target);

