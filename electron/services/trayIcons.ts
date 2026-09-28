import { nativeImage, type NativeImage } from 'electron';
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
  {
    scaleFactor: 1,
    size: 16,
    png:
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMA" +
      "AA7DAcdvqGQAAAN6SURBVDhPPZNLUNtVGMWzkRASwiMhCQkkRVIkhIR/HhAHQpKWhsqjQRCwlDedDiOgpVJrhQ4VqbVTYEZMxxZo" +
      "S2XQaasFB+1GaFk4Ou7qq7bTBbpzxsV/Y13/vAnaxTf3znfPd+49c89RaPI8O5o8r6y2eGTN/2WW5BRTmWyo7ZWNtT1yirFM9ERZ" +
      "JIFLlMDszuwIAulputWHaJCe7yXVUEqKwUV+TR/R7YfUbP8m9r0oc72ozBLPsFa/WD1PFQm2dItEmtGJ0uhCf7Cf4NtLVPXOEjrz" +
      "GcEL6wRPLBI6dRVL3RDqXB+qHAfaPE+CQBYEkqx6vhJtZTuu+jGq3vyEppuPiLy/IYZuEZz6kpaZ+3TfeEh4+Drl0XGyq7tQF4VI" +
      "yFUodcWyue04/b//Tdtb23gPx/GPrSIdiRP5/g9C278SHb5JV/9XvNS3TO+57xh7/A8FnSdR6hyyQmV0ytni9tozmwQ6L+PpmKFm" +
      "Yp2G0Q0qT28gnb/Dgam7NJzbItw6T6xtiSPj9zAGu0kVs0kJmbYgxdYR3MXvsGckTsPaY8KdcfYOXcN+ehlX30Walx4QmFzD0XUB" +
      "R8UJDNYa0ixuQSC+LMNVj6/lCvs9czjb4xQMxslrnyb0y1/s++lP9samCL+8QNnIMo7RJUKjX2AqiaEyiRckJGilRvwX71HVukrj" +
      "q2uY3riMaWIR6e6PlK8/wBmbI1J9ibrmFaKHV2g+vkV2cT1qU6msSBMG0Vqr0UeGMfd+xIs3fsa99YiswVk0wUHM3pOEwx9zqucH" +
      "Blu+IRCapbRgGH3uPjT5XkFgcstabxOGo7OYZ25jm/uayPgm/p4VCl9borhpnqq6qzRGb/FK7ac0h69QK31I4Z4O4YkyWZGqd8j6" +
      "5iF895+Q0X+enEOTtLbewdU4g3Pic9zjt7HXf0B5ywIuaZJK21nmjz3BL42iFLNJJ6rsQdICrWikDoqGF9nft479wDRZRQPofIOY" +
      "uqYpeX2VwME49uwOrHkdZAkJWrOQoBahEJZM2vO5LCeZkaPYD72HJbebF6Iz6FvOorXGKGx4F0NggLRMSWBdaC3eXScmApFu85Nu" +
      "K0djq0ApDpW6MjJsDbgXvsVxaVPcFEWVJQYNbpEBH5nWCkHqR/1fmJ7FWTR211y3nJJTIutix2Rd3YCszHHIarM7GfXEeTLySaxn" +
      "51+PFdKHawK8TgAAAABJRU5ErkJggg=="
  },
  {
    scaleFactor: 2,
    size: 32,
    png:
      "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"
  },
  {
    scaleFactor: 3,
    size: 48,
    png:
      "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"
  }
];

const cache = new Map<TrayState, NativeImage>();

/** Иконка состояния; результат кешируется — Tray.setImage вызывается на каждом событии шины. */
export function getTrayIcon(state: TrayState): NativeImage {
  const cached = cache.get(state);
  if (cached) return cached;

  const badge = TRAY_BADGE_COLORS[state];
  const image = nativeImage.createEmpty();
  for (const { scaleFactor, size, png } of BASE_ICONS) {
    const base = nativeImage.createFromDataURL(`data:image/png;base64,${png}`);
    const pixels = base.toBitmap();
    if (badge) drawBadge(pixels, size, badge);
    image.addRepresentation({ scaleFactor, width: size, height: size, buffer: pixels });
  }

  cache.set(state, image);
  return image;
}
