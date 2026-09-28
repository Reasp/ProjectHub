import { describe, expect, it } from 'vitest';
import { TRAY_BADGE_COLORS, drawBadge } from '../../electron/services/trayIconBadge';

/** Пиксель BGRA как [r, g, b, a]. */
function pixel(pixels: Uint8Array, size: number, x: number, y: number): number[] {
  const o = (y * size + x) * 4;
  return [pixels[o + 2], pixels[o + 1], pixels[o], pixels[o + 3]];
}

function filled(size: number, bgra: [number, number, number, number]): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(bgra, i);
  return pixels;
}

describe('метка состояния на иконке трея (TASK-113)', () => {
  it('у idle метки нет, у остальных состояний цвета разные', () => {
    expect(TRAY_BADGE_COLORS.idle).toBeNull();
    const colors = [TRAY_BADGE_COLORS.working, TRAY_BADGE_COLORS.attention, TRAY_BADGE_COLORS.recording];
    expect(colors.every((color) => color !== null)).toBe(true);
    expect(new Set(colors.map((color) => color!.join(','))).size).toBe(3);
  });

  it.each([16, 32, 48])('иконка %i px: метка в правом нижнем углу, остальное не тронуто', (size) => {
    const pixels = filled(size, [200, 150, 100, 255]);
    const color = TRAY_BADGE_COLORS.recording!;
    drawBadge(pixels, size, color);

    const centre = Math.round(size * 0.69);
    expect(pixel(pixels, size, centre, centre)).toEqual([...color, 255]);
    // Левый верхний угол и центр иконки — это куб, метка их не закрывает.
    expect(pixel(pixels, size, 0, 0)).toEqual([100, 150, 200, 255]);
    expect(pixel(pixels, size, Math.floor(size / 4), Math.floor(size / 4))).toEqual([100, 150, 200, 255]);
  });

  it('вокруг метки тёмный обод, он не обрезан краем иконки', () => {
    const size = 32;
    const pixels = filled(size, [255, 255, 255, 255]);
    drawBadge(pixels, size, TRAY_BADGE_COLORS.working!);

    // По строке через центр метки: фон → обод → метка → обод у самого края.
    const y = 21;
    const row = Array.from({ length: size }, (_, x) => pixel(pixels, size, x, y).slice(0, 3).join(','));
    expect(row[5]).toBe('255,255,255');
    expect(row[13]).toBe('15,17,23');
    expect(row[21]).toBe(TRAY_BADGE_COLORS.working!.join(','));
    expect(row[30]).toBe('15,17,23');
  });

  it('на прозрачном фоне метка непрозрачна', () => {
    const size = 16;
    const pixels = new Uint8Array(size * size * 4);
    drawBadge(pixels, size, TRAY_BADGE_COLORS.attention!);
    expect(pixel(pixels, size, 11, 11)).toEqual([...TRAY_BADGE_COLORS.attention!, 255]);
    expect(pixel(pixels, size, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('буфер не того размера отвергается, а не портится молча', () => {
    expect(() => drawBadge(new Uint8Array(10), 16, [0, 0, 0])).toThrow(/16×16/);
    expect(() => drawBadge(new Uint8Array(0), 0, [0, 0, 0])).toThrow();
  });
});
