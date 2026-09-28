/**
 * Глобальный push-to-talk (TASK-83, п. 1).
 *
 * Горячая клавиша регистрируется через `globalShortcut`, поэтому работает и при свёрнутом окне.
 * Отпускание клавиши Electron не сообщает, поэтому удержание восстанавливается по автоповтору
 * клавиатуры — вся арифметика вынесена в чистый `pushToTalkPolicy` и покрыта тестами, здесь
 * остаются только регистрация, таймер и персист настроек ([[decision-30]]).
 *
 * Клавиши-модификаторы (правый Ctrl, правый Command) акселератором не выражаются: их слушает
 * нативный хук `nativeKeyHook` с настоящими нажатием и отпусканием. Если хук недоступен,
 * push-to-talk откатывается на запасное сочетание `globalShortcut` ([[decision-63]]).
 *
 * Сервис ничего не знает ни о трее, ни об окнах: запись идёт в рендерере (микрофон доступен только
 * там), а побочные эффекты навешивает `main.ts` через {@link VoiceHotkeyHandlers} — как это уже
 * сделано для `computerUseService`.
 */
import { globalShortcut } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';
import { nativeKeyHook, type KeyHookProblem } from './nativeKeyHook.js';
import {
  DEFAULT_PTT_ACCELERATOR,
  abandonKeyHold,
  checkRelease,
  createHoldState,
  createModifierKeyState,
  defaultPushToTalkSettings,
  holdTimingFromSettings,
  isValidPushToTalkKey,
  nativeKeyFor,
  nativeKeysForPlatform,
  nextCheckDelayMs,
  registerFire,
  registerKeyDown,
  registerKeyUp,
  sanitizePushToTalkSettings,
  supportsHoldMode,
  type HoldState,
  type HoldTiming,
  type KeyHookEvent,
  type ModifierKeyAction,
  type ModifierKeyState,
  type NativeKeySpec,
  type PushToTalkMode,
  type PushToTalkSettings
} from './pushToTalkPolicy.js';

const SETTINGS_FILE = 'voice-hotkey.json';

/**
 * Дольше клавишу-модификатор зажатой не считаем: рендерер сам отправляет фразу на 60-й секунде, а
 * отпускание могло уйти мимо хука (экран блокировки, UAC).
 */
const MAX_KEY_HOLD_MS = 60_000;

/** `hook` — нативный хук клавиши-модификатора; `shortcut` — сочетание `globalShortcut`. */
export type PushToTalkSource = 'hook' | 'shortcut';

/** `taken` — сочетание занято другим приложением; `hook-*` — почему не заработал нативный хук. */
export type PushToTalkProblem = 'taken' | `hook-${KeyHookProblem}`;

export interface PushToTalkStatus {
  settings: PushToTalkSettings;
  /** Работает именно выбранная клавиша; `false` — она занята или заменена запасным сочетанием. */
  registered: boolean;
  /** Идёт ли запись прямо сейчас. */
  recording: boolean;
  /** Доступен ли режим удержания для выбранной клавиши на этой платформе. */
  supportsHold: boolean;
  /** Клавиша, которая работает на самом деле; `null` — не работает никакая. */
  activeKey: string | null;
  source: PushToTalkSource | null;
  /** Режим, в котором работает `activeKey`: запасное сочетание вне Windows умеет только toggle. */
  activeMode: PushToTalkMode;
  problem: PushToTalkProblem | null;
  /** Клавиши-модификаторы, которые можно назначить на этой платформе. */
  nativeKeys: string[];
}

export interface PushToTalkCaptureInfo {
  mode: PushToTalkMode;
  /** Заполняется на остановке в режиме удержания. */
  durationMs: number;
  /** Нажатие оказалось сочетанием клавиш: записанное выбрасывается, а не распознаётся. */
  cancelled?: boolean;
}

export interface VoiceHotkeyHandlers {
  /** Начать или закончить запись. */
  onCapture: (active: boolean, info: PushToTalkCaptureInfo) => void;
  onStatus: (status: PushToTalkStatus) => void;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class VoiceHotkeyService {
  private settings: PushToTalkSettings = defaultPushToTalkSettings(process.platform);
  private handlers: VoiceHotkeyHandlers | null = null;
  private settingsPath = '';
  private registeredAccelerator: string | null = null;
  private hookKey: NativeKeySpec | null = null;
  private problem: PushToTalkProblem | null = null;
  private applyChain: Promise<void> = Promise.resolve();
  private disposed = false;
  private hold: HoldState = createHoldState();
  private keyState: ModifierKeyState = createModifierKeyState();
  private timing: HoldTiming = holdTimingFromSettings(defaultPushToTalkSettings(process.platform));
  private releaseTimer: NodeJS.Timeout | null = null;
  private keyHoldTimer: NodeJS.Timeout | null = null;
  private recording = false;
  /** Источник, которым запись начата: к моменту остановки клавишу могли уже переназначить. */
  private recordingSource: PushToTalkSource | null = null;

  public configure(handlers: VoiceHotkeyHandlers): void {
    this.handlers = handlers;
  }

  public async init(options: { dir: string }): Promise<PushToTalkSettings> {
    this.settingsPath = path.join(options.dir, SETTINGS_FILE);
    this.settings = sanitizePushToTalkSettings(await this.readSettings(), process.platform);
    this.timing = holdTimingFromSettings(this.settings);
    await this.applyRegistration();
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

  private get activeKey(): string | null {
    return this.hookKey?.id ?? this.registeredAccelerator;
  }

  private get activeSource(): PushToTalkSource | null {
    if (this.hookKey) return 'hook';
    return this.registeredAccelerator ? 'shortcut' : null;
  }

  /** Сочетание `globalShortcut` вне Windows удержания не умеет, даже если в настройках стоит `hold`. */
  private get activeMode(): PushToTalkMode {
    if (this.activeSource === 'shortcut' && !supportsHoldMode(process.platform)) return 'toggle';
    return this.settings.mode;
  }

  public getStatus(): PushToTalkStatus {
    return {
      settings: this.getSettings(),
      registered: this.activeKey !== null && this.activeKey === this.settings.accelerator,
      recording: this.recording,
      supportsHold: supportsHoldMode(process.platform, this.settings.accelerator),
      activeKey: this.activeKey,
      source: this.activeSource,
      activeMode: this.activeMode,
      problem: this.problem,
      nativeKeys: nativeKeysForPlatform(process.platform)
    };
  }

  public async saveSettings(patch: Partial<PushToTalkSettings>): Promise<PushToTalkSettings> {
    // Негодная клавиша оставляет прежнюю, а не сбрасывает на дефолт: настройки так и обещают.
    const accepted = { ...patch };
    if ('accelerator' in accepted && !isValidPushToTalkKey(accepted.accelerator, process.platform)) {
      delete accepted.accelerator;
    }
    const next = sanitizePushToTalkSettings({ ...this.settings, ...accepted }, process.platform);
    const acceleratorChanged = next.accelerator !== this.settings.accelerator;
    const enabledChanged = next.enabled !== this.settings.enabled;

    this.settings = next;
    this.timing = holdTimingFromSettings(next);

    if (acceleratorChanged || enabledChanged) {
      // Идущую запись обрывать нельзя молча: клавиша поменялась, отпускания уже не будет.
      this.stopCapture();
      await this.applyRegistration();
    }

    try {
      await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      logger.warn(`[VoiceHotkey] Не удалось сохранить настройки: ${errorText(err)}`);
    }

    this.broadcastStatus();
    return this.getSettings();
  }

  /**
   * Запрашивает у macOS разрешение слушать клавиатуру и пробует поднять хук заново. Системный
   * диалог ответа не ждёт, поэтому после выдачи разрешения запрос повторяют — он уже пройдёт.
   */
  public async requestPermission(): Promise<PushToTalkStatus> {
    nativeKeyHook.requestPermission();
    await this.applyRegistration();
    this.broadcastStatus();
    return this.getStatus();
  }

  public shutdown(): void {
    this.disposed = true;
    this.clearTimer();
    this.stopCapture();
    this.unregister();
  }

  // ───────────────────────────── Регистрация ─────────────────────────────

  /** Регистрации идут строго по очереди: подъём хука асинхронный, и две подряд перепутали бы источник. */
  private applyRegistration(): Promise<void> {
    this.applyChain = this.applyChain
      .then(() => this.register())
      .catch((err) => {
        logger.warn(`[VoiceHotkey] Регистрация упала: ${errorText(err)}`);
      });
    return this.applyChain;
  }

  private async register(): Promise<void> {
    this.unregister();
    this.problem = null;
    if (this.disposed || !this.settings.enabled) return;

    const nativeKey = nativeKeyFor(this.settings.accelerator, process.platform);
    if (!nativeKey) {
      this.registerShortcut(this.settings.accelerator);
      return;
    }

    const started = await nativeKeyHook.start({
      onKeyDown: (event) => this.handleKeyDown(event),
      onKeyUp: (event) => this.handleKeyUp(event)
    });
    if (this.disposed) {
      nativeKeyHook.stop();
      return;
    }
    if (started.ok) {
      this.hookKey = nativeKey;
      logger.info(`[VoiceHotkey] Push-to-talk на ${nativeKey.id} через нативный хук (режим: ${this.activeMode})`);
      return;
    }

    logger.warn(
      `[VoiceHotkey] Нативный хук недоступен (${started.problem}: ${started.detail}), ` +
        `${nativeKey.id} заменён запасным сочетанием ${DEFAULT_PTT_ACCELERATOR}.`
    );
    this.registerShortcut(DEFAULT_PTT_ACCELERATOR);
    // Причина отката важнее занятости запасного сочетания: чинить надо хук.
    this.problem = `hook-${started.problem}`;
  }

  private registerShortcut(accelerator: string): void {
    try {
      const ok = globalShortcut.register(accelerator, () => this.handleFire(Date.now()));
      if (ok) {
        this.registeredAccelerator = accelerator;
        logger.info(`[VoiceHotkey] Push-to-talk на ${accelerator} (режим: ${this.activeMode})`);
      } else {
        this.problem = 'taken';
        logger.warn(`[VoiceHotkey] Сочетание ${accelerator} занято другим приложением.`);
      }
    } catch (err) {
      this.problem = 'taken';
      logger.warn(`[VoiceHotkey] Не удалось зарегистрировать ${accelerator}: ${errorText(err)}`);
    }
  }

  private unregister(): void {
    if (this.hookKey) {
      nativeKeyHook.stop();
      this.hookKey = null;
      this.keyState = createModifierKeyState();
      this.clearKeyHoldTimer();
    }
    if (!this.registeredAccelerator) return;
    try {
      globalShortcut.unregister(this.registeredAccelerator);
    } catch {
      /* приложение закрывается */
    }
    this.registeredAccelerator = null;
  }

  // ───────────────────────────── Клавиша-модификатор ─────────────────────────────

  private handleKeyDown(event: KeyHookEvent): void {
    if (!this.hookKey) return;
    this.applyKeyAction(registerKeyDown(this.keyState, event, this.hookKey, Date.now()));
  }

  private handleKeyUp(event: KeyHookEvent): void {
    if (!this.hookKey) return;
    this.applyKeyAction(registerKeyUp(this.keyState, event, this.hookKey));
  }

  private applyKeyAction(action: ModifierKeyAction | null): void {
    if (!action) return;

    if (this.activeMode === 'toggle') {
      // Переключает только чистое нажатие-отпускание: правый Ctrl+C записью не управляет.
      if (action !== 'release') return;
      if (this.recording) this.stopCapture();
      else this.startCapture();
      return;
    }

    if (action === 'press') {
      this.startCapture();
      this.armKeyHoldTimer();
      return;
    }
    this.stopCapture({ cancelled: action === 'cancel' });
  }

  private armKeyHoldTimer(): void {
    this.clearKeyHoldTimer();
    this.keyHoldTimer = setTimeout(() => {
      this.keyHoldTimer = null;
      abandonKeyHold(this.keyState);
      this.stopCapture();
    }, MAX_KEY_HOLD_MS);
    this.keyHoldTimer.unref?.();
  }

  private clearKeyHoldTimer(): void {
    if (!this.keyHoldTimer) return;
    clearTimeout(this.keyHoldTimer);
    this.keyHoldTimer = null;
  }

  // ───────────────────────────── Сочетание globalShortcut ─────────────────────────────

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

    if (this.activeMode === 'toggle') {
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
      if (this.activeMode === 'hold') this.stopCapture();
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
    this.recordingSource = this.activeSource;
    logger.info(`[VoiceHotkey] Старт записи (режим: ${this.activeMode})`);
    this.handlers?.onCapture(true, { mode: this.activeMode, durationMs: 0 });
    this.broadcastStatus();
  }

  private stopCapture(options: { cancelled?: boolean } = {}): void {
    this.clearKeyHoldTimer();
    if (!this.recording) return;
    this.recording = false;

    if (this.recordingSource === 'hook') {
      const durationMs = Math.max(0, Date.now() - this.keyState.downAt);
      logger.info(
        options.cancelled
          ? `[VoiceHotkey] Запись отменена: клавиша оказалась частью сочетания (${durationMs} мс)`
          : `[VoiceHotkey] Стоп записи: удержание ${durationMs} мс`
      );
      this.handlers?.onCapture(false, { mode: this.activeMode, durationMs, cancelled: options.cancelled === true });
    } else {
      const durationMs = Math.max(0, this.hold.lastFireAt - this.hold.firstFireAt);
      logger.info(`[VoiceHotkey] Стоп записи: удержание ${durationMs} мс, срабатываний ${this.hold.fireCount}`);
      this.handlers?.onCapture(false, { mode: this.activeMode, durationMs });
    }
    this.broadcastStatus();
  }

  private broadcastStatus(): void {
    try {
      this.handlers?.onStatus(this.getStatus());
    } catch (err) {
      logger.warn(`[VoiceHotkey] Обработчик статуса упал: ${errorText(err)}`);
    }
  }
}

export const voiceHotkeyService = new VoiceHotkeyService();
