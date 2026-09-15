import { describe, expect, it } from 'vitest';
import {
  describeScreenshotForModel,
  firstPointFromArgs,
  fitToBaseline,
  mapCoordinateArgs,
  parseScreenshotMapping,
  resolveCoordinateSpace,
  toScreenPoint
} from '../../electron/services/computerCoords';

// Тексты — дословно из ответов screenshot рантайма 7.4.0 на Windows (2026-09-15).
const SCREEN_1366 = `1366x768 | screen 1920x1080
screen_x = image_x * 1.4056
screen_y = image_y * 1.4056
a screen capture scales uniformly with no offset, so this mapping is exact.`;
const WINDOW_800 = `800x433 | window 131714 at 0,0 sized 1920x1040
screen_x ≈ 0 + image_x * 2.4000
screen_y ≈ 0 + image_y * 2.4000
the capture includes the window shadow, so this mapping is approximate: click, then capture again to confirm before typing.`;

describe('fitToBaseline: baseline 1366×768 с сохранением пропорций (AC #6)', () => {
  it('Full HD → ровно baseline', () => {
    expect(fitToBaseline(1920, 1080)).toEqual({ width: 1366, height: 768 });
  });
  it('16:10 ограничивается высотой', () => {
    expect(fitToBaseline(1920, 1200)).toEqual({ width: 1229, height: 768 });
  });
  it('4K и узкие окна; меньшие размеры не увеличиваются', () => {
    expect(fitToBaseline(3840, 2160)).toEqual({ width: 1366, height: 768 });
    expect(fitToBaseline(800, 1000)).toEqual({ width: 614, height: 768 });
    expect(fitToBaseline(1024, 600)).toEqual({ width: 1024, height: 600 });
    expect(fitToBaseline(0, 0)).toEqual({ width: 1366, height: 768 });
  });
});

describe('parseScreenshotMapping: формула из ответа рантайма', () => {
  it('снимок экрана: точное соответствие, масштаб по размерам', () => {
    const m = parseScreenshotMapping(SCREEN_1366)!;
    expect(m).toMatchObject({ imageWidth: 1366, imageHeight: 768, offsetX: 0, offsetY: 0, exact: true });
    expect(m.scaleX).toBeCloseTo(1920 / 1366, 10);
    expect(m.scaleY).toBeCloseTo(1080 / 768, 10);
  });
  it('снимок окна: смещение и пометка approximate', () => {
    const m = parseScreenshotMapping(WINDOW_800)!;
    expect(m).toMatchObject({ imageWidth: 800, imageHeight: 433, offsetX: 0, offsetY: 0, exact: false, scaleX: 2.4 });
  });
  it('смещение окна на втором мониторе', () => {
    const m = parseScreenshotMapping('640x360 | window 5 at -1920,40 sized 1280x720\nscreen_x ≈ -1920 + image_x * 2.0000\nscreen_y ≈ 40 + image_y * 2.0000')!;
    expect(toScreenPoint([100, 50], m)).toEqual([-1720, 140]);
  });
  it('мусор → null', () => {
    expect(parseScreenshotMapping('')).toBeNull();
    expect(parseScreenshotMapping('Screenshot failed')).toBeNull();
    expect(parseScreenshotMapping('1366x768 | screen 1920x1080')).toBeNull();
  });
});

describe('mapCoordinateArgs: пересчёт «скриншот → экран»', () => {
  const m = parseScreenshotMapping(SCREEN_1366)!;

  const shot = (args: Record<string, unknown>) => ({ ...args, coordinate_space: 'screenshot' });

  it('точка: центр изображения → центр экрана; служебный аргумент не уходит в рантайм', () => {
    const r = mapCoordinateArgs(shot({ coordinate: [683, 384], target_app: 'notepad.exe' }), { coordinate: 'point' }, m);
    expect(r).toEqual({ args: { coordinate: [960, 540], target_app: 'notepad.exe' }, mapped: true, space: 'screenshot' });
  });

  it('углы изображения → углы экрана', () => {
    expect(mapCoordinateArgs(shot({ coordinate: [1366, 768] }), { coordinate: 'point' }, m).args.coordinate).toEqual([1920, 1080]);
    expect(mapCoordinateArgs(shot({ coordinate: [0, 0] }), { coordinate: 'point' }, m).args.coordinate).toEqual([0, 0]);
  });

  it('drag, регион, путь, locs с текстом', () => {
    expect(mapCoordinateArgs(shot({ start_coordinate: [100, 100], coordinate: [200, 200] }), { start_coordinate: 'point', coordinate: 'point' }, m).args)
      .toEqual({ start_coordinate: [141, 141], coordinate: [281, 281] });
    expect(mapCoordinateArgs(shot({ region: [0, 0, 683, 384] }), { region: 'region' }, m).args.region).toEqual([0, 0, 960, 540]);
    expect(mapCoordinateArgs(shot({ path: [[0, 0], [683, 384]] }), { path: 'points' }, m).args.path).toEqual([[0, 0], [960, 540]]);
    expect(mapCoordinateArgs(shot({ locs: [[683, 384, 'привет']] }), { locs: 'locs' }, m).args.locs).toEqual([[960, 540, 'привет']]);
  });

  it('по умолчанию координаты экранные — даже если скриншот уже был (без двойного пересчёта)', () => {
    expect(resolveCoordinateSpace({})).toBe('screen');
    expect(resolveCoordinateSpace({ coordinate_space: 'screenshot' })).toBe('screenshot');
    expect(mapCoordinateArgs({ coordinate: [683, 384] }, { coordinate: 'point' }, m)).toEqual({ args: { coordinate: [683, 384] }, mapped: false, space: 'screen' });
    expect(mapCoordinateArgs({ coordinate: [683, 384], coordinate_space: 'screen' }, { coordinate: 'point' }, m).args).toEqual({ coordinate: [683, 384] });
  });

  it('coordinate_space: screenshot без скриншота в сессии — ошибка для модели', () => {
    const r = mapCoordinateArgs(shot({ coordinate: [10, 10] }), { coordinate: 'point' }, null);
    expect(r.mapped).toBe(false);
    expect(r.error).toContain('computer_screenshot');
    expect(r.args).toEqual({ coordinate: [10, 10] });
  });

  it('некорректные значения не трогаются', () => {
    expect(mapCoordinateArgs(shot({ coordinate: ['a', 1] }), { coordinate: 'point' }, m).args.coordinate).toEqual(['a', 1]);
    expect(mapCoordinateArgs(shot({ text: 'x' }), { coordinate: 'point' }, m)).toMatchObject({ mapped: false });
  });

  it('текст к скриншоту для модели не содержит формулы рантайма', () => {
    const text = describeScreenshotForModel(m);
    expect(text).toContain('1366×768');
    expect(text).toContain('1920×1080');
    expect(text).toContain('coordinate_space: "screenshot"');
    expect(text).not.toContain('image_x');
    expect(describeScreenshotForModel(parseScreenshotMapping(WINDOW_800)!)).toContain('приблизительное');
  });

  it('firstPointFromArgs — для определения окна под точкой', () => {
    expect(firstPointFromArgs({ coordinate: [5, 6] }, { coordinate: 'point' })).toEqual([5, 6]);
    expect(firstPointFromArgs({ path: [[1, 2], [3, 4]] }, { path: 'points' })).toEqual([1, 2]);
    expect(firstPointFromArgs({ text: 'x' }, undefined)).toBeNull();
  });
});
