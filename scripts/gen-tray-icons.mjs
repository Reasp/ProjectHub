import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Генератор иконок системного трея (TASK-63, TASK-113): вшивает куб ProjectHub из build/sizes/
 * в electron/services/trayIcons.ts как base64 — по одному PNG на масштаб экрана. Метку состояния
 * поверх куба рисует само приложение (trayIconBadge.ts). Запускается вручную при смене логотипа,
 * в сборку не входит.
 */

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Сторона иконки трея в Windows — 16 пикселей на масштабе 100%. */
const SIZES = [
  { scaleFactor: 1, size: 16 },
  { scaleFactor: 2, size: 32 },
  { scaleFactor: 3, size: 48 }
];

const wrap = (b) => {
  const chunks = [];
  for (let i = 0; i < b.length; i += 100) chunks.push('      ' + JSON.stringify(b.slice(i, i + 100)));
  return chunks.join(' +\n');
};

const entries = SIZES.map(({ scaleFactor, size }) => {
  const file = path.join(rootDir, 'build', 'sizes', `icon-${size}.png`);
  const png = fs.readFileSync(file);
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) {
    throw new Error(`${file}: ожидался PNG ${size}×${size}`);
  }
  return `  {
    scaleFactor: ${scaleFactor},
    size: ${size},
    png:
${wrap(png.toString('base64'))}
  }`;
});

const BT = String.fromCharCode(96);
const out = `import { nativeImage, type NativeImage } from 'electron';
import type { TrayState } from './notificationTypes.js';
import { TRAY_BADGE_COLORS, drawBadge } from './trayIconBadge.js';

/**
 * Иконки системного трея (TASK-63, decision-13 п.5; TASK-113).
 *
 * Куб ProjectHub вшит в код как base64-PNG, а не лежит файлом: трей поднимается до загрузки окна и
 * одинаково работает в dev и в упакованном приложении, где public/ уже внутри app.asar.
 * Состояние показывает цветная метка в правом нижнем углу: working — синяя, attention — жёлтая,
 * recording — красная (идёт запись голоса, TASK-83), idle — без метки.
 * Файл пишет scripts/gen-tray-icons.mjs (запускается вручную при смене логотипа) — руками не править.
 */

const BASE_ICONS: ReadonlyArray<{ scaleFactor: number; size: number; png: string }> = [
${entries.join(',\n')}
];

const cache = new Map<TrayState, NativeImage>();

/** Иконка состояния; результат кешируется — Tray.setImage вызывается на каждом событии шины. */
export function getTrayIcon(state: TrayState): NativeImage {
  const cached = cache.get(state);
  if (cached) return cached;

  const badge = TRAY_BADGE_COLORS[state];
  const image = nativeImage.createEmpty();
  for (const { scaleFactor, size, png } of BASE_ICONS) {
    const base = nativeImage.createFromDataURL(${BT}data:image/png;base64,\${png}${BT});
    const pixels = base.toBitmap();
    if (badge) drawBadge(pixels, size, badge);
    image.addRepresentation({ scaleFactor, width: size, height: size, buffer: pixels });
  }

  cache.set(state, image);
  return image;
}
`;

const target = path.join(rootDir, 'electron', 'services', 'trayIcons.ts');
fs.writeFileSync(target, out, 'utf8');
console.log('Иконки трея записаны в', target);
