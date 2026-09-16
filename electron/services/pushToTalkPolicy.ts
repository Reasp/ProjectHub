/**
 * Политика push-to-talk: настройки глобальной горячей клавиши и детект удержания (TASK-83).
 *
 * Electron `globalShortcut` не сообщает об отпускании клавиши — события keyup у него нет
 * (electron#26301 закрыт как «не будет реализовано»), и опросить состояние клавиши тоже нечем.
 * На Windows под globalShortcut лежит `RegisterHotKey`, а Chromium не передаёт ему флаг
 * `MOD_NOREPEAT`, поэтому при удержании клавиши автоповтор клавиатуры присылает повторные
 * срабатывания. Отсюда механика: серия срабатываний — это одно нажатие, а тишина дольше
 * дедлайна — отпускание.
 *
 * Дедлайн адаптивный, потому что интервалы автоповтора задаёт сам пользователь в системных
 * настройках (`HKCU\Control Panel\Keyboard`: задержка 250–1000 мс, скорость ≈33–400 мс). Первый
 * дедлайн берётся по худшему случаю, а после первого же повтора уточняется по фактическому
 * интервалу — так лаг отпускания получается минимальным на быстром автоповторе и при этом не
 * возникает ложных отпусканий на медленном.
 *
 * На macOS и Linux автоповтора у горячих клавиш нет (Carbon `RegisterEventHotKey` и X11-grab
 * шлют одно срабатывание), поэтому режим удержания там недоступен и вырождается в toggle.
 *
 * Чистый модуль без Electron и IO — покрыт unit-тестами (см. [[decision-30]]).
 */

export type PushToTalkMode = 'hold' | 'toggle';

export interface PushToTalkSettings {
  /** Регистрировать ли глобальную горячую клавишу. */
  enabled: boolean;
  /** Accelerator Electron, например `Control+Shift+Space`. */
  accelerator: string;
  /** `hold` — запись, пока клавиша удерживается; `toggle` — нажатие включает, следующее выключает. */
  mode: PushToTalkMode;
  /** Показывать запись иконкой в трее. */
  trayIndicator: boolean;
  /** Сколько ждать первого автоповтора, прежде чем счесть клавишу отпущенной. */
  firstRepeatMs: number;
  /** Нижняя граница дедлайна после того, как автоповтор пошёл. */
  repeatGraceMs: number;
}

export const DEFAULT_PTT_ACCELERATOR = 'Control+Shift+Space';

/** Модификаторы Electron accelerator: сами по себе горячей клавишей быть не могут. */
const MODIFIERS = new Set([
  'command',
  'cmd',
  'control',
  'ctrl',
  'commandorcontrol',
  'cmdorctrl',
  'alt',
  'option',
  'altgr',
  'shift',
  'super',
  'meta'
]);

/**
 * F12 зарезервирована отладчиком Windows, а в ProjectHub ещё и перехвачена для DevTools
 * (`main.ts`, `before-input-event`) — регистрация глобально приведёт к конфликту.
 */
const FORBIDDEN_KEYS = new Set(['f12']);

/**
 * Accelerator пригоден, если это минимум один модификатор плюс ровно одна обычная клавиша.
 * Чистый модификатор (например, «держи правый Alt») в globalShortcut невыразим.
 */
export function isValidAccelerator(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  const segments = trimmed.split('+');
  if (segments.length < 2 || segments.length > 5) return false;
  // Пустой сегмент («Control++A», «Control+») делает accelerator невалидным.
  if (segments.some((segment) => segment.trim().length === 0)) return false;

  const parts = segments.map((segment) => segment.trim());
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);

  if (!mods.every((mod) => MODIFIERS.has(mod.toLowerCase()))) return false;
  const unique = new Set(mods.map((mod) => mod.toLowerCase()));
  if (unique.size !== mods.length) return false;

  const normalizedKey = key.toLowerCase();
  if (MODIFIERS.has(normalizedKey)) return false;
  if (FORBIDDEN_KEYS.has(normalizedKey)) return false;
  return /^[A-Za-z0-9]+$/.test(key);
}

/** Удержание доступно только там, где у горячих клавиш есть автоповтор. */
export function supportsHoldMode(platform: string): boolean {
  return platform === 'win32';
}

export function defaultPushToTalkSettings(platform: string): PushToTalkSettings {
  return {
    enabled: true,
    accelerator: DEFAULT_PTT_ACCELERATOR,
    mode: supportsHoldMode(platform) ? 'hold' : 'toggle',
    trayIndicator: true,
    firstRepeatMs: 1200,
    repeatGraceMs: 300
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Приводит содержимое `<userData>/voice-hotkey.json` к рабочему виду. Режим `hold` вне Windows
 * понижается до `toggle`: там автоповтора нет, и запись, начавшись, никогда бы не остановилась.
 */
export function sanitizePushToTalkSettings(raw: unknown, platform: string): PushToTalkSettings {
  const defaults = defaultPushToTalkSettings(platform);
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const requestedMode: PushToTalkMode = obj.mode === 'hold' || obj.mode === 'toggle' ? obj.mode : defaults.mode;

  return {
    enabled: obj.enabled !== false,
    accelerator: isValidAccelerator(obj.accelerator) ? (obj.accelerator as string).trim() : defaults.accelerator,
    mode: supportsHoldMode(platform) ? requestedMode : 'toggle',
    trayIndicator: obj.trayIndicator !== false,
    firstRepeatMs: clampNumber(obj.firstRepeatMs, 400, 3000, defaults.firstRepeatMs),
    repeatGraceMs: clampNumber(obj.repeatGraceMs, 150, 1500, defaults.repeatGraceMs)
  };
}

export interface HoldTiming {
  /** Дедлайн до первого автоповтора (системная задержка автоповтора — до 1000 мс). */
  firstRepeatMs: number;
  /** Нижняя граница дедлайна, когда интервал автоповтора уже измерен. */
  repeatGraceMs: number;
  /** Во сколько раз дедлайн больше наблюдаемого интервала автоповтора. */
  repeatFactor: number;
  /** Верхняя граница дедлайна: дольше ждать отпускания бессмысленно. */
  maxDeadlineMs: number;
}

export const DEFAULT_HOLD_TIMING: HoldTiming = {
  firstRepeatMs: 1200,
  repeatGraceMs: 300,
  repeatFactor: 2.5,
  maxDeadlineMs: 1500
};

/** Собирает тайминги детектора из пользовательских настроек. */
export function holdTimingFromSettings(settings: PushToTalkSettings): HoldTiming {
  return {
    ...DEFAULT_HOLD_TIMING,
    firstRepeatMs: settings.firstRepeatMs,
    repeatGraceMs: settings.repeatGraceMs
  };
}

export interface HoldState {
  /** Клавиша считается зажатой (для toggle — «серия срабатываний ещё идёт»). */
  pressed: boolean;
  firstFireAt: number;
  lastFireAt: number;
  /** Сколько срабатываний пришло в текущей серии, включая первое. */
  fireCount: number;
  /** Текущий дедлайн тишины, после которого клавиша считается отпущенной. */
  deadlineMs: number;
}

export function createHoldState(): HoldState {
  return { pressed: false, firstFireAt: 0, lastFireAt: 0, fireCount: 0, deadlineMs: 0 };
}

/**
 * Обрабатывает срабатывание горячей клавиши.
 *
 * @returns `true`, если это новое нажатие; `false` — если это автоповтор той же зажатой клавиши.
 */
export function registerFire(state: HoldState, now: number, timing: HoldTiming = DEFAULT_HOLD_TIMING): boolean {
  const withinSeries = state.pressed && now - state.lastFireAt <= state.deadlineMs;

  if (withinSeries) {
    const interval = now - state.lastFireAt;
    state.fireCount += 1;
    state.lastFireAt = now;
    if (interval > 0) {
      // Дедлайн подстраивается под фактический автоповтор пользователя, а не под константу.
      const adaptive = Math.round(interval * timing.repeatFactor);
      state.deadlineMs = Math.min(timing.maxDeadlineMs, Math.max(timing.repeatGraceMs, adaptive));
    }
    return false;
  }

  state.pressed = true;
  state.firstFireAt = now;
  state.lastFireAt = now;
  state.fireCount = 1;
  state.deadlineMs = timing.firstRepeatMs;
  return true;
}

/**
 * Проверка дедлайна по таймеру.
 *
 * @returns `true`, если тишина затянулась и клавишу следует считать отпущенной.
 */
export function checkRelease(state: HoldState, now: number): boolean {
  if (!state.pressed) return false;
  if (now - state.lastFireAt <= state.deadlineMs) return false;
  state.pressed = false;
  return true;
}

/** Сколько длилось (или длится) текущее нажатие. */
export function holdDurationMs(state: HoldState, now: number): number {
  if (state.firstFireAt === 0) return 0;
  const end = state.pressed ? now : state.lastFireAt;
  return Math.max(0, end - state.firstFireAt);
}

/** Через сколько миллисекунд имеет смысл следующая проверка дедлайна. */
export function nextCheckDelayMs(state: HoldState, now: number): number {
  if (!state.pressed) return 0;
  return Math.max(1, state.lastFireAt + state.deadlineMs - now);
}
