/**
 * Детектор «человек взял управление мышью» для kill-switch (TASK-82, AC #4, decision-27 п. 4).
 *
 * Сервис опрашивает позицию системного курсора, пока агент управляет компьютером, и передаёт
 * выборки сюда. Если курсор сместился больше чем на `thresholdPx` за `windowMs` и это не движение
 * самого агента (grace-окно после его действия с мышью), детектор сообщает о перехвате.
 * Модуль чистый: время и позиции приходят снаружи.
 */

export interface TakeoverConfig {
  /** Минимальное смещение курсора, считающееся движением человека. */
  thresholdPx: number;
  /** Окно, за которое измеряется смещение. */
  windowMs: number;
  /** Сколько после действия агента с мышью движения курсора не считаются перехватом. */
  graceMs: number;
}

export const DEFAULT_TAKEOVER_CONFIG: TakeoverConfig = {
  thresholdPx: 40,
  windowMs: 200,
  graceMs: 800
};

interface Sample {
  at: number;
  x: number;
  y: number;
}

export class HumanTakeoverDetector {
  private samples: Sample[] = [];
  private graceUntil = 0;
  private readonly config: TakeoverConfig;

  constructor(config: Partial<TakeoverConfig> = {}) {
    this.config = { ...DEFAULT_TAKEOVER_CONFIG, ...config };
  }

  /** Агент начинает или закончил действие с курсором: движение в grace-окне — его собственное. */
  public noteAgentInput(now: number): void {
    this.graceUntil = Math.max(this.graceUntil, now + this.config.graceMs);
    this.samples = [];
  }

  public reset(): void {
    this.samples = [];
    this.graceUntil = 0;
  }

  /** Новая выборка позиции курсора; `true` — человек взял мышь. */
  public sample(now: number, x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (now < this.graceUntil) {
      // Во время действия агента базовой считается последняя позиция, историю не накапливаем.
      this.samples = [{ at: now, x, y }];
      return false;
    }
    this.samples.push({ at: now, x, y });
    const since = now - this.config.windowMs;
    while (this.samples.length > 1 && this.samples[0].at < since) this.samples.shift();
    const threshold2 = this.config.thresholdPx * this.config.thresholdPx;
    return this.samples.some((s) => {
      const dx = x - s.x;
      const dy = y - s.y;
      return dx * dx + dy * dy > threshold2;
    });
  }
}
