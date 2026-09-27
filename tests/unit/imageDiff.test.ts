import { describe, it, expect } from 'vitest';
import { buildDiffBitmap, compareBitmaps, parseMask } from '../../scripts/visual/imageDiff.mjs';

const solid = (width: number, height: number, rgba: [number, number, number, number]) => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
};

const paint = (bmp: { width: number; data: Uint8Array }, x: number, y: number, rgba: [number, number, number, number]) => {
  bmp.data.set(rgba, (y * bmp.width + x) * 4);
};

describe('compareBitmaps', () => {
  it('одинаковые кадры проходят', () => {
    const r = compareBitmaps(solid(10, 10, [10, 20, 30, 255]), solid(10, 10, [10, 20, 30, 255]));
    expect(r).toMatchObject({ sameSize: true, diffPixels: 0, comparedPixels: 100, ratio: 0, passed: true });
  });

  it('разница в пределах допуска канала не считается', () => {
    const r = compareBitmaps(solid(4, 4, [100, 100, 100, 255]), solid(4, 4, [120, 90, 132, 255]), { pixelTolerance: 32 });
    expect(r.diffPixels).toBe(0);
  });

  it('доля отличающихся пикселей против порога', () => {
    const base = solid(10, 10, [0, 0, 0, 255]);
    const actual = solid(10, 10, [0, 0, 0, 255]);
    paint(actual, 0, 0, [255, 255, 255, 255]);
    paint(actual, 5, 5, [255, 0, 0, 255]);
    const loose = compareBitmaps(base, actual, { maxDiffRatio: 0.02 });
    expect(loose).toMatchObject({ diffPixels: 2, ratio: 0.02, passed: true });
    const strict = compareBitmaps(base, actual, { maxDiffRatio: 0.01 });
    expect(strict.passed).toBe(false);
    expect(strict.reason).toMatch(/2\.00 %/);
    expect(strict.diffMask?.[0]).toBe(1);
    expect(strict.diffMask?.[55]).toBe(1);
    expect(strict.diffMask?.[1]).toBe(0);
  });

  it('маски исключают изменчивые зоны из сравнения и знаменателя', () => {
    const base = solid(10, 10, [0, 0, 0, 255]);
    const actual = solid(10, 10, [0, 0, 0, 255]);
    for (let x = 0; x < 10; x++) paint(actual, x, 0, [255, 255, 255, 255]);
    const r = compareBitmaps(base, actual, { maxDiffRatio: 0, masks: [{ x: 0, y: 0, width: 10, height: 1 }] });
    expect(r).toMatchObject({ diffPixels: 0, comparedPixels: 90, passed: true });
  });

  it('маска за краем кадра обрезается', () => {
    const r = compareBitmaps(solid(4, 4, [0, 0, 0, 255]), solid(4, 4, [0, 0, 0, 255]), { masks: [{ x: 2, y: 2, width: 100, height: 100 }] });
    expect(r.comparedPixels).toBe(12);
  });

  it('разный размер — провал без сравнения', () => {
    const r = compareBitmaps(solid(10, 10, [0, 0, 0, 255]), solid(12, 10, [0, 0, 0, 255]));
    expect(r).toMatchObject({ sameSize: false, passed: false, ratio: 1 });
    expect(r.reason).toMatch(/12×10/);
  });

  it('короткий буфер — ошибка', () => {
    expect(() => compareBitmaps({ width: 2, height: 2, data: new Uint8Array(4) }, solid(2, 2, [0, 0, 0, 255]))).toThrow();
  });
});

describe('parseMask', () => {
  it('разбирает «x,y,w,h» и отклоняет мусор', () => {
    expect(parseMask('0, 0, 1280, 40')).toEqual({ x: 0, y: 0, width: 1280, height: 40 });
    expect(parseMask('1,2,3')).toBeNull();
    expect(parseMask('a,b,c,d')).toBeNull();
    expect(parseMask('0,0,0,10')).toBeNull();
    expect(parseMask('-1,0,5,5')).toBeNull();
  });
});

describe('buildDiffBitmap', () => {
  it('отличия красным с учётом порядка каналов', () => {
    const base = solid(2, 1, [0, 0, 0, 255]);
    const mask = new Uint8Array([1, 0]);
    const rgba = buildDiffBitmap(base, mask, 'rgba');
    expect(Array.from(rgba.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(rgba.slice(4, 8))).toEqual([200, 200, 200, 255]);
    const bgra = buildDiffBitmap(base, mask, 'bgra');
    expect(Array.from(bgra.slice(0, 4))).toEqual([0, 0, 255, 255]);
  });
});
