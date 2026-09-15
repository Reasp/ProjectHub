import type { CoordinateArgShape } from './computerToolCatalog.js';

/**
 * Масштабирование скриншотов и пересчёт координат (TASK-82, AC #6, decision-27 п. 5).
 *
 * Прокси запрашивает у рантайма скриншот, вписанный в baseline 1366×768 (JPEG), и запоминает
 * соответствие «пиксель изображения → логический пиксель экрана». Инструменты ввода рантайма
 * принимают экранные координаты, поэтому координаты, которые модель взяла со скриншота, прокси
 * пересчитывает обратно. Модуль чистый — без Electron и процессов.
 */

export const SCREENSHOT_BASELINE = { width: 1366, height: 768 } as const;
export const SCREENSHOT_JPEG_QUALITY = 70;

export type CoordinateSpace = 'screenshot' | 'screen';

/** Соответствие последнего скриншота экрану: `screen = offset + image * scale`. */
export interface ScreenshotMapping {
  imageWidth: number;
  imageHeight: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  /** Снимок экрана — точное соответствие; снимок окна (с тенью) — приблизительное. */
  exact: boolean;
}

/** Размер, вписанный в baseline с сохранением пропорций; меньшие размеры не увеличиваются. */
export function fitToBaseline(
  width: number,
  height: number,
  baseline: { width: number; height: number } = SCREENSHOT_BASELINE
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: baseline.width, height: baseline.height };
  if (width <= baseline.width && height <= baseline.height) return { width: Math.round(width), height: Math.round(height) };
  // 1920×1080 и 1366×768 различаются в пропорциях на доли пикселя: ограничение по ширине выбирается,
  // если высота при нём округляется в пределах baseline (так же считает рантайм по параметру width).
  const byWidth = Math.round(height * (baseline.width / width));
  if (byWidth <= baseline.height) return { width: baseline.width, height: Math.max(1, byWidth) };
  return { width: Math.max(1, Math.round(width * (baseline.height / height))), height: baseline.height };
}

const NUM = '(-?\\d+(?:\\.\\d+)?)';

/**
 * Разбирает текст, который рантайм возвращает вместе со скриншотом:
 * ```
 * 1366x768 | screen 1920x1080
 * screen_x = image_x * 1.4056
 * screen_y = image_y * 1.4056
 * ```
 * или для окна `800x433 | window 131714 at 0,0 sized 1920x1040` и `screen_x ≈ 0 + image_x * 2.4000`.
 * Масштаб считается по размерам (точнее округлённого коэффициента), коэффициент — запасной вариант.
 */
export function parseScreenshotMapping(text: string | undefined | null): ScreenshotMapping | null {
  if (!text) return null;
  const header = new RegExp(`(\\d+)x(\\d+)\\s*\\|`).exec(text);
  if (!header) return null;
  const imageWidth = Number(header[1]);
  const imageHeight = Number(header[2]);
  if (!(imageWidth > 0) || !(imageHeight > 0)) return null;

  const axis = (name: 'x' | 'y') => {
    const re = new RegExp(`screen_${name}\\s*([=≈])\\s*(?:${NUM}\\s*\\+\\s*)?image_${name}\\s*\\*\\s*${NUM}`);
    const m = re.exec(text);
    if (!m) return null;
    return { approx: m[1] === '≈', offset: m[2] !== undefined ? Number(m[2]) : 0, k: Number(m[3]) };
  };
  const ax = axis('x');
  const ay = axis('y');
  if (!ax || !ay || !(ax.k > 0) || !(ay.k > 0)) return null;

  let scaleX = ax.k;
  let scaleY = ay.k;
  const sized = /(?:screen|sized)\s+(\d+)x(\d+)/.exec(text);
  if (sized) {
    const sw = Number(sized[1]);
    const sh = Number(sized[2]);
    // Размер из заголовка точнее коэффициента, округлённого до 4 знаков; берём его, если он согласован.
    if (sw > 0 && Math.abs(sw / imageWidth - ax.k) < 0.01) scaleX = sw / imageWidth;
    if (sh > 0 && Math.abs(sh / imageHeight - ay.k) < 0.01) scaleY = sh / imageHeight;
  }

  return {
    imageWidth,
    imageHeight,
    scaleX,
    scaleY,
    offsetX: ax.offset,
    offsetY: ay.offset,
    exact: !ax.approx && !ay.approx && !/approximate/i.test(text)
  };
}

export function toScreenPoint(point: [number, number], mapping: ScreenshotMapping): [number, number] {
  return [Math.round(mapping.offsetX + point[0] * mapping.scaleX), Math.round(mapping.offsetY + point[1] * mapping.scaleY)];
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function mapPointArray(value: unknown, mapping: ScreenshotMapping): unknown {
  if (!Array.isArray(value) || value.length < 2 || !isNum(value[0]) || !isNum(value[1])) return value;
  const [x, y] = toScreenPoint([value[0], value[1]], mapping);
  return [x, y, ...value.slice(2)];
}

function mapShape(value: unknown, shape: CoordinateArgShape, mapping: ScreenshotMapping): unknown {
  switch (shape) {
    case 'point':
      return mapPointArray(value, mapping);
    case 'region': {
      if (!Array.isArray(value) || value.length !== 4 || !value.every(isNum)) return value;
      const [x1, y1] = toScreenPoint([value[0], value[1]], mapping);
      const [x2, y2] = toScreenPoint([value[2], value[3]], mapping);
      return [x1, y1, x2, y2];
    }
    case 'points':
    case 'locs':
      return Array.isArray(value) ? value.map((p) => mapPointArray(p, mapping)) : value;
    default:
      return value;
  }
}

/**
 * Пространство координат вызова. По умолчанию `screen` — как у рантайма, у `cursor_position` и у
 * `bounds` дерева доступности. `screenshot` — только явно: неявное переключение по «был ли
 * скриншот» давало бы двойной пересчёт, если модель умножила координаты сама.
 */
export function resolveCoordinateSpace(args: Record<string, unknown>): CoordinateSpace {
  return args.coordinate_space === 'screenshot' ? 'screenshot' : 'screen';
}

export interface MappedArgs {
  args: Record<string, unknown>;
  /** Координаты пересчитаны со скриншота. */
  mapped: boolean;
  space: CoordinateSpace;
  /** Запрошен пересчёт со скриншота, но в сессии не было скриншота через прокси. */
  error?: string;
}

/**
 * Пересчитывает аргументы с координатами по спецификации инструмента и убирает служебный
 * `coordinate_space`, которого нет в схеме рантайма.
 */
export function mapCoordinateArgs(
  args: Record<string, unknown>,
  coords: Record<string, CoordinateArgShape> | undefined,
  mapping: ScreenshotMapping | null
): MappedArgs {
  const { coordinate_space: _space, ...rest } = args;
  const space = resolveCoordinateSpace(args);
  if (!coords || space === 'screen') return { args: rest, mapped: false, space };
  if (!mapping) {
    return {
      args: rest,
      mapped: false,
      space,
      error: 'coordinate_space "screenshot": в этой сессии ещё не было computer_screenshot — сначала сделай скриншот или передай экранные координаты.'
    };
  }
  const out: Record<string, unknown> = { ...rest };
  let mapped = false;
  for (const [name, shape] of Object.entries(coords)) {
    if (out[name] === undefined) continue;
    const next = mapShape(out[name], shape, mapping);
    if (next !== out[name]) mapped = true;
    out[name] = next;
  }
  return { args: out, mapped, space };
}

/**
 * Текст к скриншоту для модели: вместо формулы рантайма (которую модель могла бы применить сама,
 * а прокси — второй раз) — размеры и явное правило передачи координат.
 */
export function describeScreenshotForModel(mapping: ScreenshotMapping): string {
  const screenW = Math.round(mapping.imageWidth * mapping.scaleX);
  const screenH = Math.round(mapping.imageHeight * mapping.scaleY);
  const lines = [
    `Скриншот ${mapping.imageWidth}×${mapping.imageHeight} (экран ${screenW}×${screenH}, масштабирован ProjectHub).`,
    'Координаты, взятые с этого изображения, передавай как есть с coordinate_space: "screenshot" — ProjectHub пересчитает их в экранные.',
    'Не пересчитывай координаты сам. Bounds из get_ui_tree/find_element уже экранные — для них coordinate_space не указывай.'
  ];
  if (!mapping.exact) lines.push('Снимок окна: соответствие приблизительное (тень окна) — после клика проверь результат новым скриншотом.');
  return lines.join('\n');
}

/** Первая точка из аргументов — чтобы определить окно под курсором для allowlist. */
export function firstPointFromArgs(args: Record<string, unknown>, coords: Record<string, CoordinateArgShape> | undefined): [number, number] | null {
  if (!coords) return null;
  for (const [name, shape] of Object.entries(coords)) {
    const value = args[name];
    if (shape === 'point' && Array.isArray(value) && isNum(value[0]) && isNum(value[1])) return [value[0], value[1]];
    if (shape === 'region' && Array.isArray(value) && isNum(value[0]) && isNum(value[1])) return [value[0], value[1]];
    if ((shape === 'points' || shape === 'locs') && Array.isArray(value) && Array.isArray(value[0]) && isNum(value[0][0]) && isNum(value[0][1])) {
      return [value[0][0], value[0][1]];
    }
  }
  return null;
}
