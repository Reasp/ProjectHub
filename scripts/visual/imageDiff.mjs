/**
 * Попиксельное сравнение кадров для самопроверки ProjectHub (TASK-78, decision-55 п. 8).
 *
 * Чистый модуль без зависимостей: вход — bitmap 4 байта на пиксель (RGBA или BGRA — порядок
 * каналов не важен, пока он одинаков у обоих кадров), выход — число и доля отличающихся
 * пикселей и вердикт. PNG декодирует и кодирует `nativeImage` запущенного Electron. Покрыт
 * unit-тестами (`tests/unit/imageDiff.test.ts`).
 */

/** Пиксель отличается, если разница хотя бы одного канала больше этого значения (0..255). */
export const DEFAULT_PIXEL_TOLERANCE = 32;
/** Кадр проходит, если доля отличающихся пикселей не больше этой (0..1). */
export const DEFAULT_MAX_DIFF_RATIO = 0.01;

/**
 * @typedef {{ width: number, height: number, data: Uint8Array }} Bitmap
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ pixelTolerance?: number, maxDiffRatio?: number, masks?: Rect[] }} CompareOptions
 * @typedef {{
 *   sameSize: boolean,
 *   width: number,
 *   height: number,
 *   diffPixels: number,
 *   comparedPixels: number,
 *   ratio: number,
 *   passed: boolean,
 *   reason?: string,
 *   diffMask?: Uint8Array
 * }} CompareResult
 */

/** «x,y,w,h» → прямоугольник; `null` — строка не разобралась. */
export function parseMask(text) {
  const parts = String(text ?? '')
    .split(',')
    .map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const [x, y, width, height] = parts.map((v) => Math.trunc(v));
  if (width === 0 || height === 0) return null;
  return { x, y, width, height };
}

/** Маска исключённых пикселей: 1 — не сравнивать. */
function buildIgnoreMask(width, height, masks) {
  const ignore = new Uint8Array(width * height);
  for (const m of masks ?? []) {
    const x0 = Math.max(0, m.x);
    const y0 = Math.max(0, m.y);
    const x1 = Math.min(width, m.x + m.width);
    const y1 = Math.min(height, m.y + m.height);
    for (let y = y0; y < y1; y++) ignore.fill(1, y * width + x0, y * width + Math.max(x0, x1));
  }
  return ignore;
}

/**
 * Сравнивает два кадра. Разный размер — провал без попиксельного сравнения (окно другого размера
 * или масштаб экрана — это уже не тот кадр). `diffMask[i] = 1` у отличающихся пикселей.
 * @param {Bitmap} baseline
 * @param {Bitmap} actual
 * @param {CompareOptions} [options]
 * @returns {CompareResult}
 */
export function compareBitmaps(baseline, actual, options = {}) {
  const tolerance = options.pixelTolerance ?? DEFAULT_PIXEL_TOLERANCE;
  const maxRatio = options.maxDiffRatio ?? DEFAULT_MAX_DIFF_RATIO;
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      sameSize: false,
      width: actual.width,
      height: actual.height,
      diffPixels: 0,
      comparedPixels: 0,
      ratio: 1,
      passed: false,
      reason: `размер кадра ${actual.width}×${actual.height} не совпадает с базой ${baseline.width}×${baseline.height}`
    };
  }
  const { width, height } = actual;
  const total = width * height;
  if (baseline.data.length < total * 4 || actual.data.length < total * 4) {
    throw new Error('bitmap короче width × height × 4');
  }
  const ignore = buildIgnoreMask(width, height, options.masks);
  const diffMask = new Uint8Array(total);
  let diffPixels = 0;
  let compared = 0;
  const a = baseline.data;
  const b = actual.data;
  for (let i = 0; i < total; i++) {
    if (ignore[i]) continue;
    compared++;
    const o = i * 4;
    if (
      Math.abs(a[o] - b[o]) > tolerance ||
      Math.abs(a[o + 1] - b[o + 1]) > tolerance ||
      Math.abs(a[o + 2] - b[o + 2]) > tolerance ||
      Math.abs(a[o + 3] - b[o + 3]) > tolerance
    ) {
      diffMask[i] = 1;
      diffPixels++;
    }
  }
  const ratio = compared === 0 ? 0 : diffPixels / compared;
  const passed = ratio <= maxRatio;
  return {
    sameSize: true,
    width,
    height,
    diffPixels,
    comparedPixels: compared,
    ratio,
    passed,
    ...(passed ? {} : { reason: `отличается ${(ratio * 100).toFixed(2)} % пикселей при допуске ${(maxRatio * 100).toFixed(2)} %` }),
    diffMask
  };
}

/**
 * Картинка различий: база бледно-серым, отличающиеся пиксели красным. `order` — порядок каналов
 * bitmap (`bgra` у `nativeImage.toBitmap()` на Windows), чтобы красный остался красным.
 * @param {Bitmap} baseline
 * @param {Uint8Array} diffMask
 * @param {'rgba' | 'bgra'} [order]
 * @returns {Uint8Array}
 */
export function buildDiffBitmap(baseline, diffMask, order = 'rgba') {
  const { width, height, data } = baseline;
  const out = new Uint8Array(width * height * 4);
  const r = order === 'bgra' ? 2 : 0;
  const bl = order === 'bgra' ? 0 : 2;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (diffMask[i]) {
      out[o + r] = 255;
      out[o + 1] = 0;
      out[o + bl] = 0;
    } else {
      const gray = Math.round((data[o] + data[o + 1] + data[o + 2]) / 3);
      const faded = Math.round(200 + gray * 0.2);
      out[o] = faded;
      out[o + 1] = faded;
      out[o + 2] = faded;
    }
    out[o + 3] = 255;
  }
  return out;
}
