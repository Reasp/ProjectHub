/**
 * Глобальный push-to-talk (TASK-83, п. 1).
 *
 * Горячая клавиша регистрируется через `globalShortcut`, поэтому работает и при свёрнутом окне.
 * Отпускание клавиши Electron не сообщает, поэтому удержание восстанавливается по автоповтору
 * клавиатуры — вся арифметика вынесена в чистый `pushToTalkPolicy` и покрыта тестами, здесь
 * остаются только регистрация, таймер и персист настроек ([[decision-30]]).
 *
 * Сервис ничего не знает ни о трее, ни об окнах: запись идёт в рендерере (микрофон доступен только
 * там), а побочные эффекты навешивает `main.ts` через {@link VoiceHotkeyHandlers} — как это уже
 * сделано для `computerUseService`.
 */
import { globalShortcut } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';
import {
  checkRelease,
  createHoldState,
  defaultPushToTalkSettings,
  holdTimingFromSettings,
  nextCheckDelayMs,
  registerFire,
  sanitizePushToTalkSettings,
  supportsHoldMode,
  type HoldState,
  type HoldTiming,
  type PushToTalkSettings
} from './pushToTalkPolicy.js';

const SETTINGS_FILE = 'voice-hotkey.json';

export interface PushToTalkStatus {
  settings: PushToTalkSettings;
  /** Горячая клавиша принята системой; `false` — сочетание занято другим приложением. */
  registered: boolean;
  /** Идёт ли запись прямо сейчас. */
  recording: boolean;
  /** Доступен ли режим удержания на этой платформе. */
  supportsHold: boolean;
}

export interface VoiceHotkeyHandlers {
  /** Начать или закончить запись; `durationMs` заполняется на остановке в режиме удержания. */
  onCapture: (active: boolean, info: { mode: PushToTalkSettings['mode']; durationMs: number }) => void;
  onStatus: (status: PushToTalkStatus) => void;
}

class VoiceHotkeyService {
  private settings: PushToTalkSettings = defaultPushToTalkSettings(process.platform);
  private handlers: VoiceHotkeyHandlers | null = null;
  private settingsPath = '';
  private registeredAccelerator: string | null = null;
  private hold: HoldState = createHoldState();
  private timing: HoldTiming = holdTimingFromSettings(defaultPushToTalkSettings(process.platform));
  private releaseTimer: NodeJS.Timeout | null = null;
  private recording = false;

  public configure(handlers: VoiceHotkeyHandlers): void {
    this.handlers = handlers;
  }

  public async init(options: { dir: string }): Promise<PushToTalkSettings> {
    this.settingsPath = path.join(options.dir, SETTINGS_FILE);
    this.settings = sanitizePushToTalkSettings(await this.readSettings(), process.platform);
    this.timing = holdTimingFromSettings(this.settings);
    this.applyRegistration();
    this.broadcastStatus();
    return this.getSettings();
  }

  private async readSettings(): Promise<unknown> {
    try {
      const raw = await fs.readFile(this.settingsPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      // Файла нет или он повреждён — работаем на значениях по умолчанию.
      return null;
    }
  }

  public getSettings(): PushToTalkSettings {
    return { ...this.settings };
  }

  public getStatus(): PushToTalkStatus {
    return {
      settings: this.getSettings(),
      registered: this.registeredAccelerator !== null && this.registeredAccelerator === this.settings.accelerator,
      recording: this.recording,
      supportsHold: supportsHoldMode(process.platform)
    };
  }

  public async saveSettings(patch: Partial<PushToTalkSettings>): Promise<PushToTalkSettings> {
    const next = sanitizePushToTalkSettings({ ...this.settings, ...patch }, process.platform);
    const acceleratorChanged = next.accelerator !== this.settings.accelerator;
    const enabledChanged = next.enabled !== this.settings.enabled;

    this.settings = next;
    this.timing = holdTimingFromSettings(next);

    if (acceleratorChanged || enabledChanged) {
      // Идущую запись обрывать нельзя молча: клавиша поменялась, отпускания уже не будет.
      this.stopCapture();
      this.applyRegistration();
    }

    try {
      await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      logger.warn(`[VoiceHotkey] Не удалось сохранить настройки: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.broadcastStatus();
    return this.getSettings();
  }

  public shutdown(): void {
    this.clearTimer();
    this.stopCapture();
    this.unregister();
  }

  // ───────────────────────────── Горячая клавиша ─────────────────────────────

  private applyRegistration(): void {
    this.unregister();
    if (!this.settings.enabled) return;

    const accelerator = this.settings.accelerator;
    try {
      const ok = globalShortcut.register(accelerator, () => this.handleFire(Date.now()));
      if (ok) {
        this.registeredAccelerator = accelerator;
        logger.info(`[VoiceHotkey] Push-to-talk на ${accelerator} (режим: ${this.settings.mode})`);
      } else {
        logger.warn(`[VoiceHotkey] Сочетание ${accelerator} занято другим приложением.`);
      }
    } catch (err) {
      logger.warn(
        `[VoiceHotkey] Не удалось зарегистрировать ${accelerator}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private unregister(): void {
    if (!this.registeredAccelerator) return;
    try {
      globalShortcut.unregister(this.registeredAccelerator);
    } catch {
      /* приложение закрывается */
    }
    this.registeredAccelerator = null;
  }

  /**
   * Срабатывание горячей клавиши. В режиме удержания серия автоповторов — это одно нажатие;
   * в режиме toggle те же автоповторы отбрасываются, иначе зажатая клавиша переключала бы
   * запись десятки раз в секунду.
   */
  private handleFire(now: number): void {
    const sinceLast = this.hold.lastFireAt > 0 ? now - this.hold.lastFireAt : -1;
    const isNewPress = registerFire(this.hold, now, this.timing);
    // Уровень debug: при работающем автоповторе это десятки строк в секунду на каждое удержание.
    // Для разбора детекта удержания приложение запускают с PROJECTHUB_LOG_LEVEL=debug.
    logger.debug(
      `[VoiceHotkey] Срабатывание: ${isNewPress ? 'новое нажатие' : 'автоповтор'}, ` +
        `интервал ${sinceLast} мс, дедлайн ${this.hold.deadlineMs} мс, в серии ${this.hold.fireCount}`
    );
    this.scheduleReleaseCheck(now);
    if (!isNewPress) return;

    if (this.settings.mode === 'toggle') {
      if (this.recording) this.stopCapture();
      else this.startCapture();
      return;
    }

    if (!this.recording) this.startCapture();
  }

  private scheduleReleaseCheck(now: number): void {
    this.clearTimer();
    const delay = nextCheckDelayMs(this.hold, now);
    if (delay <= 0) return;
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null;
      const at = Date.now();
      if (!checkRelease(this.hold, at)) {
        this.scheduleReleaseCheck(at);
        return;
      }
      // В toggle-режиме отпускание лишь закрывает серию автоповторов: запись останавливает
      // следующее нажатие, а не тишина.
      if (this.settings.mode === 'hold') this.stopCapture();
    }, delay);
    this.releaseTimer.unref?.();
  }

  private clearTimer(): void {
    if (!this.releaseTimer) return;
    clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
  }

  // ───────────────────────────── Запись ─────────────────────────────

  private startCapture(): void {
    if (this.recording) return;
    this.recording = true;
    logger.info(`[VoiceHotkey] Старт записи (режим: ${this.settings.mode})`);
    this.handlers?.onCapture(true, { mode: this.settings.mode, durationMs: 0 });
    this.broadcastStatus();
  }

  private stopCapture(): void {
    if (!this.recording) return;
    this.recording = false;
    const durationMs = Math.max(0, this.hold.lastFireAt - this.hold.firstFireAt);
    logger.info(`[VoiceHotkey] Стоп записи: удержание ${durationMs} мс, срабатываний ${this.hold.fireCount}`);
    this.handlers?.onCapture(false, { mode: this.settings.mode, durationMs });
    this.broadcastStatus();
  }

  private broadcastStatus(): void {
    try {
      this.handlers?.onStatus(this.getStatus());
    } catch (err) {
      logger.warn(`[VoiceHotkey] Обработчик статуса упал: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const voiceHotkeyService = new VoiceHotkeyService();
