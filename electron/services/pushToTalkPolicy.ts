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
 * Клавиши-модификаторы (правый Ctrl, правый Command) в `globalShortcut` невыразимы вовсе, их
 * обслуживает нативный хук с настоящими нажатием и отпусканием — см. {@link NATIVE_KEYS} и
 * [[decision-63]]. Автоповтор и дедлайны к ним не относятся.
 *
 * Чистый модуль без Electron и IO — покрыт unit-тестами (см. [[decision-30]]).
 */

export type PushToTalkMode = 'hold' | 'toggle';

export interface PushToTalkSettings {
  /** Регистрировать ли глобальную горячую клавишу. */
  enabled: boolean;
  /**
   * Accelerator Electron, например `Control+Shift+Space`, либо клавиша-модификатор из
   * {@link NATIVE_KEYS} — `RightControl`, `RightCommand`.
   */
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

/**
 * Сочетание `globalShortcut`, на которое push-to-talk откатывается, когда нативный хук недоступен
 * (нет модуля, нет разрешения macOS, Wayland).
 */
export const DEFAULT_PTT_ACCELERATOR = 'Control+Shift+Space';

export type NativePushToTalkKey = 'RightControl' | 'RightCommand';

export interface NativeKeySpec {
  id: NativePushToTalkKey;
  /** Виртуальный код libuiohook (`VC_CONTROL_R`, `VC_META_R`). */
  keycode: number;
  /** Каким флагом модификатора клавиша отмечает сама себя в событии. */
  modifier: 'ctrl' | 'meta';
  /** Платформы, где клавиша предлагается; `null` — на всех. */
  platforms: readonly string[] | null;
  aliases: readonly string[];
}

/**
 * Клавиши-модификаторы, которые слушает нативный хук. Правый Command вне macOS не предлагается:
 * на Windows это правая Win, и её отпускание открывает меню «Пуск». Правый Alt не входит
 * намеренно — в раскладках с AltGr он приходит парой «левый Ctrl + правый Alt».
 */
export const NATIVE_KEYS: readonly NativeKeySpec[] = [
  { id: 'RightControl', keycode: 0x0e1d, modifier: 'ctrl', platforms: null, aliases: ['rightcontrol', 'rightctrl'] },
  {
    id: 'RightCommand',
    keycode: 0x0e5c,
    modifier: 'meta',
    platforms: ['darwin'],
    aliases: ['rightcommand', 'rightcmd']
  }
];

/** Клавиша-модификатор по значению из настроек; `null` — значение не про нативный хук или не про эту платформу. */
export function nativeKeyFor(value: unknown, platform: string): NativeKeySpec | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  const spec = NATIVE_KEYS.find((key) => key.aliases.includes(normalized));
  if (!spec) return null;
  if (spec.platforms && !spec.platforms.includes(platform)) return null;
  return spec;
}

export function nativeKeysForPlatform(platform: string): NativePushToTalkKey[] {
  return NATIVE_KEYS.filter((key) => !key.platforms || key.platforms.includes(platform)).map((key) => key.id);
}

export function defaultPushToTalkKey(platform: string): NativePushToTalkKey {
  return platform === 'darwin' ? 'RightCommand' : 'RightControl';
}

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
 * Одиночные клавиши, которые допустимо занять под глобальный хоткей целиком: ими не набирают
 * текст, поэтому перехват их во всей системе ничего не ломает. Буквы и цифры сюда не входят —
 * глобально перехваченная «A» сделала бы невозможным ввод этой буквы в любом приложении.
 *
 * Правый Ctrl через акселератор назначить нельзя: акселераторы Electron не различают левый и
 * правый модификатор, а чистый модификатор не является допустимым акселератором вовсе
 * ([[decision-30]]). Для него есть отдельный путь — {@link NATIVE_KEYS}.
 */
const STANDALONE_KEYS = new Set(['capslock', 'scrolllock', 'pause', 'insert']);

function isStandaloneKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (FORBIDDEN_KEYS.has(normalized)) return false;
  if (STANDALONE_KEYS.has(normalized)) return true;
  return /^f([1-9]|1[0-9]|2[0-4])$/.test(normalized);
}

/**
 * Accelerator пригоден, если это либо одиночная «безопасная» клавиша (см. {@link STANDALONE_KEYS}),
 * либо минимум один модификатор плюс ровно одна обычная клавиша. Чистый модификатор
 * («держи правый Ctrl») в globalShortcut невыразим.
 */
export function isValidAccelerator(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  const segments = trimmed.split('+');
  if (segments.length < 1 || segments.length > 5) return false;
  // Пустой сегмент («Control++A», «Control+») делает accelerator невалидным.
  if (segments.some((segment) => segment.trim().length === 0)) return false;

  const parts = segments.map((segment) => segment.trim());
  if (parts.length === 1) return isStandaloneKey(parts[0]);

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

/** Значение настроек пригодно: клавиша-модификатор этой платформы либо accelerator `globalShortcut`. */
export function isValidPushToTalkKey(value: unknown, platform: string): boolean {
  return nativeKeyFor(value, platform) !== null || isValidAccelerator(value);
}

/**
 * Удержание доступно там, где отпускание клавиши можно узнать: у клавиши-модификатора его сообщает
 * нативный хук, у сочетания `globalShortcut` оно восстанавливается по автоповтору — только Windows.
 * Без `accelerator` отвечает за сочетания `globalShortcut`.
 */
export function supportsHoldMode(platform: string, accelerator?: string): boolean {
  if (accelerator !== undefined && nativeKeyFor(accelerator, platform)) return true;
  return platform === 'win32';
}

export function defaultPushToTalkSettings(platform: string): PushToTalkSettings {
  return {
    enabled: true,
    accelerator: defaultPushToTalkKey(platform),
    mode: 'hold',
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
 * Приводит содержимое `<userData>/voice-hotkey.json` к рабочему виду. Для сочетаний
 * `globalShortcut` режим `hold` вне Windows понижается до `toggle`: там автоповтора нет, и запись,
 * начавшись, никогда бы не остановилась. Клавиша-модификатор записывается каноническим именем.
 */
export function sanitizePushToTalkSettings(raw: unknown, platform: string): PushToTalkSettings {
  const defaults = defaultPushToTalkSettings(platform);
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const requestedMode: PushToTalkMode = obj.mode === 'hold' || obj.mode === 'toggle' ? obj.mode : defaults.mode;
  const nativeKey = nativeKeyFor(obj.accelerator, platform);
  const accelerator = nativeKey
    ? nativeKey.id
    : isValidAccelerator(obj.accelerator)
      ? (obj.accelerator as string).trim()
      : defaults.accelerator;

  return {
    enabled: obj.enabled !== false,
    accelerator,
    mode: supportsHoldMode(platform, accelerator) ? requestedMode : 'toggle',
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

// ───────────────────────────── Клавиша-модификатор (нативный хук) ─────────────────────────────

/** Событие клавиатуры от нативного хука — только то, что нужно политике. */
export interface KeyHookEvent {
  keycode: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface ModifierKeyState {
  /** Клавиша push-to-talk сейчас зажата. */
  down: boolean;
  /**
   * Нажатие оказалось частью сочетания (правый Ctrl+C) либо снято сторожевым таймером: до
   * отпускания клавиши оно больше ничего не запускает и не останавливает.
   */
  spent: boolean;
  downAt: number;
}

/**
 * `press` — клавиша нажата одна; `release` — отпущена после чистого нажатия; `cancel` — к зажатой
 * клавише добавилась другая, то есть это было сочетание, а не push-to-talk.
 */
export type ModifierKeyAction = 'press' | 'release' | 'cancel';

export function createModifierKeyState(): ModifierKeyState {
  return { down: false, spent: false, downAt: 0 };
}

function otherModifierHeld(event: KeyHookEvent, key: NativeKeySpec): boolean {
  const own = key.modifier === 'ctrl' ? event.ctrlKey : event.metaKey;
  const held = [event.ctrlKey, event.metaKey, event.altKey, event.shiftKey].filter(Boolean).length;
  return held > (own ? 1 : 0);
}

export function registerKeyDown(
  state: ModifierKeyState,
  event: KeyHookEvent,
  key: NativeKeySpec,
  now: number
): ModifierKeyAction | null {
  if (event.keycode !== key.keycode) {
    if (!state.down || state.spent) return null;
    state.spent = true;
    return 'cancel';
  }

  // Зажатая клавиша шлёт автоповтор нажатия — это то же самое нажатие.
  if (state.down) return null;

  state.down = true;
  state.downAt = now;
  // Shift уже зажат, и к нему добавили правый Ctrl — это набор сочетания, запись не начинаем.
  state.spent = otherModifierHeld(event, key);
  return state.spent ? null : 'press';
}

export function registerKeyUp(state: ModifierKeyState, event: KeyHookEvent, key: NativeKeySpec): ModifierKeyAction | null {
  if (event.keycode !== key.keycode || !state.down) return null;
  const spent = state.spent;
  state.down = false;
  state.spent = false;
  return spent ? null : 'release';
}

/**
 * Снимает текущее нажатие без отпускания: отпускание могло уйти мимо хука (экран блокировки, UAC),
 * и запоздавшее не должно ничего переключить.
 */
export function abandonKeyHold(state: ModifierKeyState): void {
  if (state.down) state.spent = true;
}
