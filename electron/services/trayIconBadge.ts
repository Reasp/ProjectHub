/**
 * Метка состояния поверх иконки трея (TASK-113).
 *
 * В трее показан куб ProjectHub, а состояние приложения — цветной кружок в правом нижнем углу.
 * Рисование идёт по сырым пикселям BGRA, которые отдаёт `nativeImage.toBitmap()`.
 *
 * Чистый модуль без Electron — покрыт unit-тестами.
 */
import type { TrayState } from './notificationTypes.js';

export type Rgb = readonly [number, number, number];

/** Цвет метки; у `idle` метки нет — в покое виден только куб. */
export const TRAY_BADGE_COLORS: Record<TrayState, Rgb | null> = {
  idle: null,
  working: [0x3b, 0x82, 0xf6],
  attention: [0xf5, 0x9e, 0x0b],
  // Запись голоса (TASK-83): красный, как привычная индикация записи.
  recording: [0xef, 0x44, 0x44]
};

/** Тёмный обод отделяет метку от куба, который сам светлый и пёстрый. */
const OUTLINE: Rgb = [0x0f, 0x11, 0x17];

/** Доля площади пикселя, попавшая в круг: сглаживает край на границе в один пиксель. */
function coverage(distance: number, radius: number): number {
  const inside = radius - distance;
  if (inside >= 0.5) return 1;
  if (inside <= -0.5) return 0;
  return inside + 0.5;
}

function blend(pixels: Uint8Array, offset: number, color: Rgb, alpha: number): void {
  if (alpha <= 0) return;
  const keep = 1 - alpha;
  pixels[offset] = Math.round(color[2] * alpha + pixels[offset] * keep);
  pixels[offset + 1] = Math.round(color[1] * alpha + pixels[offset + 1] * keep);
  pixels[offset + 2] = Math.round(color[0] * alpha + pixels[offset + 2] * keep);
  pixels[offset + 3] = Math.round(255 * alpha + pixels[offset + 3] * keep);
}

/**
 * Рисует метку в правом нижнем углу квадратной иконки `size`×`size`. Размеры заданы долями
 * стороны, поэтому метка одинаково читается на 16, 32 и 48 пикселях.
 */
export function drawBadge(pixels: Uint8Array, size: number, color: Rgb): void {
  if (!Number.isInteger(size) || size <= 0 || pixels.length !== size * size * 4) {
    throw new Error(`Иконка ${size}×${size} не соответствует буферу из ${pixels.length} байт`);
  }

  const radius = size * 0.25;
  const outline = radius + Math.max(1, size / 16);
  // Центр стоит так, чтобы обод касался края иконки и не обрезался.
  const center = size - outline - 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - center, y - center);
      const offset = (y * size + x) * 4;
      blend(pixels, offset, OUTLINE, coverage(distance, outline));
      blend(pixels, offset, color, coverage(distance, radius));
    }
  }
}
