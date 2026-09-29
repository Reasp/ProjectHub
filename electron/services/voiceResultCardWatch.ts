/**
 * Закрытие карточки результата push-to-talk кликом мимо и клавишей Esc (TASK-115, [[decision-65]]).
 *
 * Оверлей показывается через `showInactive` и фокус не берёт намеренно — иначе диктовка печатала бы
 * в него, а не в активное окно. Поэтому ни `blur`, ни `keydown` в самом окне не приходят, и
 * «клик мимо» ловится глобальным хуком мыши `nativeKeyHook` (тот же `uiohook-napi`, что у
 * push-to-talk, [[decision-63]]), а Esc — временной регистрацией `globalShortcut`.
 *
 * Обе подписки живут строго, пока карточка на экране: глобальный Esc отнимает клавишу у всех
 * программ, а хук мыши видит каждый клик в системе. `disarm` снимает их при любом закрытии.
 */
import { globalShortcut, screen } from 'electron';
import { logger } from './logger.js';
import { nativeKeyHook } from './nativeKeyHook.js';
import { isPointInBounds, physicalToDip, type Bounds, type Point } from '../../src/utils/voiceResultCard.js';

export type CardDismissReason = 'click-outside' | 'escape';

export interface CardWatchOptions {
  /** Текущие границы окна карточки в DIP; `null` — окна уже нет. */
  getBounds: () => Bounds | null;
  onDismiss: (reason: CardDismissReason) => void;
}

const ESCAPE_ACCELERATOR = 'Escape';

/**
 * Координаты хука → DIP Electron. На Windows хук отдаёт физические пиксели, и пересчёт с учётом
 * разных масштабов мониторов умеет только сам Electron; на macOS хук уже отдаёт точки (DIP); на
 * Linux делим на масштаб ближайшего дисплея.
 */
function hookPointToDip(point: Point): Point {
  if (process.platform === 'win32') return screen.screenToDipPoint(point);
  if (process.platform === 'darwin') return point;
  return physicalToDip(point, screen.getDisplayNearestPoint(point).scaleFactor);
}

class VoiceResultCardWatch {
  private options: CardWatchOptions | null = null;
  private generation = 0;
  private escapeRegistered = false;

  public get armed(): boolean {
    return this.options !== null;
  }

  /** Повторный вызов при уже взведённом наблюдении только обновляет обработчики. */
  public arm(options: CardWatchOptions): void {
    const wasArmed = this.armed;
    this.options = options;
    if (wasArmed) return;

    const generation = ++this.generation;
    this.registerEscape();

    void nativeKeyHook
      .startMouse({ onMouseDown: (point) => this.handleMouseDown(point, generation) })
      .then((result) => {
        if (generation !== this.generation) {
          // Карточку закрыли, пока хук поднимался: подписка не нужна, если новая её не заняла.
          if (!this.armed) nativeKeyHook.stopMouse();
          return;
        }
        if (!result.ok) {
          // Не фатально: остаются крестик, Esc и новое нажатие push-to-talk.
          logger.warn(`[VoiceCard] Хук мыши недоступен (${result.problem}: ${result.detail}), клик мимо не закроет карточку.`);
        }
      })
      .catch((err) => {
        logger.warn(`[VoiceCard] Хук мыши не поднялся: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  public disarm(): void {
    if (!this.armed) return;
    this.options = null;
    this.generation++;
    this.unregisterEscape();
    nativeKeyHook.stopMouse();
  }

  private registerEscape(): void {
    try {
      this.escapeRegistered = globalShortcut.register(ESCAPE_ACCELERATOR, () => this.dismiss('escape', this.generation));
      if (!this.escapeRegistered) logger.warn('[VoiceCard] Esc занят другим приложением, карточка закрывается без него.');
    } catch (err) {
      this.escapeRegistered = false;
      logger.warn(`[VoiceCard] Не удалось зарегистрировать Esc: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private unregisterEscape(): void {
    if (!this.escapeRegistered) return;
    this.escapeRegistered = false;
    try {
      globalShortcut.unregister(ESCAPE_ACCELERATOR);
    } catch {
      /* приложение закрывается */
    }
  }

  private handleMouseDown(point: Point, generation: number): void {
    if (generation !== this.generation || !this.options) return;
    const bounds = this.options.getBounds();
    if (!bounds) return;
    let dip: Point;
    try {
      dip = hookPointToDip(point);
    } catch {
      return;
    }
    if (isPointInBounds(dip, bounds)) return;
    this.dismiss('click-outside', generation);
  }

  /**
   * Закрытие откладывается за пределы обработчика события: `disarm` останавливает хук, а делать это
   * изнутри его же колбэка незачем.
   */
  private dismiss(reason: CardDismissReason, generation: number): void {
    setImmediate(() => {
      if (generation !== this.generation || !this.options) return;
      this.options.onDismiss(reason);
    });
  }
}

export const voiceResultCardWatch = new VoiceResultCardWatch();
