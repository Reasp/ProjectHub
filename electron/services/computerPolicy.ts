import type { ComputerActionClass, ComputerToolSpec } from './computerToolCatalog.js';

/**
 * Политика управления компьютером (TASK-82, decision-27 п. 3–4, п. 6): чистые функции без
 * Electron и процессов. Прокси ProjectHub вызывает `evaluateComputerAction` перед каждым вызовом
 * инструмента рантайма; вердикт `ask` превращается в карточку единой HITL-очереди (decision-10).
 */

/** Источник агента: HITL-источники плюс внешний MCP-клиент и автоматизации (TASK-74). */
export type ComputerOrigin = 'studio' | 'swarm' | 'handoff' | 'assigned' | 'external' | 'automation';

/** Цель действия: окно или приложение, к которому применяется allowlist. */
export interface ComputerTarget {
  /** Имя процесса на Windows (`notepad.exe`) или bundle ID на macOS. */
  app?: string;
  title?: string;
  windowId?: number;
  /** Откуда цель определена — для аудита и сообщений агенту. */
  source: 'window' | 'app' | 'point' | 'focused';
}

/** Запись allowlist: имя процесса и/или заголовок окна (`*` — шаблон, иначе подстрока заголовка). */
export interface ComputerAllowlistEntry {
  app?: string;
  title?: string;
}

export interface ComputerPolicySettings {
  allowlist: ComputerAllowlistEntry[];
  /** Что делать с `act` вне allowlist: спросить человека или отказать без карточки. */
  outsideAllowlist: 'ask' | 'deny';
  /**
   * Режим «только это окно»: `act`/`dangerous` отклоняются, если цель или активное окно не из
   * allowlist — даже с подтверждением человека.
   */
  onlyAllowlistedWindows: boolean;
  /** Заголовки файловых диалогов (точное совпадение без учёта регистра) — действия в них `dangerous`. */
  fileDialogTitles: string[];
}

export interface ComputerActionContext {
  /** Функция включена пользователем в настройках. */
  enabled: boolean;
  /** Kill-switch сработал и не снят вручную. */
  killSwitchEngaged: boolean;
  origin?: ComputerOrigin;
  /** Агент работает в цикле «до готовности» (TASK-75). */
  doneLoop?: boolean;
  /** Задача явно разрешила управление компьютером (label `computer-use`). */
  taskAllowsComputerUse?: boolean;
  /** `false` у роли без auto-approve: `act` всегда спрашивается (роль только сужает, decision-9). */
  autoApprove?: boolean;
}

export interface ComputerVerdict {
  verdict: 'allow' | 'ask' | 'deny';
  /** Имя правила для аудита. */
  rule: string;
  /** Итоговый класс (файловый диалог повышает `act` до `dangerous`). */
  actionClass?: ComputerActionClass;
  reason?: string;
}

export const DEFAULT_FILE_DIALOG_TITLES = [
  'Сохранить как',
  'Сохранение',
  'Открыть',
  'Открытие',
  'Выбор папки',
  'Обзор папок',
  'Save As',
  'Save',
  'Open',
  'Select Folder',
  'Browse For Folder'
];

export const DEFAULT_COMPUTER_POLICY: ComputerPolicySettings = {
  allowlist: [],
  outsideAllowlist: 'ask',
  onlyAllowlistedWindows: false,
  fileDialogTitles: DEFAULT_FILE_DIALOG_TITLES
};

/** Label задачи Backlog.md, которым задача явно разрешает управление компьютером в Done-loop. */
export const COMPUTER_USE_TASK_LABEL = 'computer-use';

/** Имя процесса без регистра и расширения `.exe`: `Notepad.exe` ≡ `notepad`. */
export function normalizeAppName(name: string | undefined | null): string {
  return String(name ?? '').trim().toLowerCase().replace(/\.exe$/, '');
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesApp(pattern: string, app: string | undefined): boolean {
  const p = normalizeAppName(pattern);
  if (!p) return true;
  const a = normalizeAppName(app);
  if (!a) return false;
  return p.includes('*') ? wildcardToRegExp(p).test(a) : p === a;
}

function matchesTitle(pattern: string, title: string | undefined): boolean {
  const p = pattern.trim();
  if (!p) return true;
  const t = String(title ?? '');
  return p.includes('*') ? wildcardToRegExp(p).test(t) : t.toLowerCase().includes(p.toLowerCase());
}

/** Цель входит в allowlist: совпали все заданные поля хотя бы одной записи. */
export function isTargetAllowlisted(target: ComputerTarget | null | undefined, allowlist: ComputerAllowlistEntry[]): boolean {
  if (!target || !Array.isArray(allowlist)) return false;
  return allowlist.some((entry) => {
    const hasApp = Boolean(entry?.app?.trim());
    const hasTitle = Boolean(entry?.title?.trim());
    if (!hasApp && !hasTitle) return false;
    return (!hasApp || matchesApp(entry.app!, target.app)) && (!hasTitle || matchesTitle(entry.title!, target.title));
  });
}

export function isFileDialog(target: ComputerTarget | null | undefined, titles: string[] = DEFAULT_FILE_DIALOG_TITLES): boolean {
  const title = target?.title?.trim().toLowerCase();
  if (!title) return false;
  return titles.some((t) => t.trim().toLowerCase() === title);
}

export function describeTarget(target: ComputerTarget | null | undefined): string {
  if (!target) return 'цель не определена';
  const parts = [target.app, target.title ? `«${target.title}»` : undefined].filter(Boolean);
  return parts.length ? parts.join(' ') : `окно ${target.windowId ?? '?'}`;
}

export interface EvaluateComputerActionInput {
  tool: string;
  spec: ComputerToolSpec | undefined;
  /** Цель действия (окно из аргументов, приложение, окно под точкой или активное окно). */
  target: ComputerTarget | null;
  /** Активное окно в момент вызова — для режима «только это окно». */
  focused: ComputerTarget | null;
  settings: ComputerPolicySettings;
  context: ComputerActionContext;
}

/**
 * Вердикт для одного вызова. Порядок правил важен: сначала жёсткие запреты (функция выключена,
 * инструмент не классифицирован, kill-switch, автономный запуск), затем класс действия.
 */
export function evaluateComputerAction(input: EvaluateComputerActionInput): ComputerVerdict {
  const { tool, spec, target, focused, settings, context } = input;

  if (!context.enabled) {
    return { verdict: 'deny', rule: 'computer-disabled', reason: 'Управление компьютером выключено в настройках ProjectHub.' };
  }
  if (!spec || !spec.exported) {
    return { verdict: 'deny', rule: 'computer-tool-unknown', reason: `Инструмент ${tool} не классифицирован и не экспортируется прокси.` };
  }
  if (context.killSwitchEngaged) {
    return {
      verdict: 'deny',
      rule: 'kill-switch',
      actionClass: spec.class,
      reason: 'Сработал kill-switch: управление компьютером заблокировано до ручного снятия пользователем.'
    };
  }
  if (context.origin === 'automation' || context.origin === 'assigned') {
    return {
      verdict: 'deny',
      rule: 'computer-autonomous-forbidden',
      actionClass: spec.class,
      reason: 'Управление компьютером недоступно в Automations и автозапуске назначенных задач (decision-27 п. 6).'
    };
  }
  if (context.doneLoop && !context.taskAllowsComputerUse) {
    return {
      verdict: 'deny',
      rule: 'computer-task-not-allowed',
      actionClass: spec.class,
      reason: `В цикле «до готовности» управление компьютером разрешено только задачам с label «${COMPUTER_USE_TASK_LABEL}».`
    };
  }

  if (spec.class === 'observe') {
    return { verdict: 'allow', rule: 'computer-observe', actionClass: 'observe' };
  }

  const allowlist = settings.allowlist ?? [];
  if (settings.onlyAllowlistedWindows && !spec.targetless) {
    const targetOk = isTargetAllowlisted(target, allowlist);
    const focusedOk = !focused || isTargetAllowlisted(focused, allowlist);
    if (!targetOk || !focusedOk) {
      const offender = !targetOk ? target : focused;
      return {
        verdict: 'deny',
        rule: 'computer-only-window',
        actionClass: spec.class,
        reason: `Режим «только разрешённые окна»: ${describeTarget(offender)} не входит в allowlist.`
      };
    }
  }

  const fileDialog = !spec.targetless && isFileDialog(target, settings.fileDialogTitles);
  if (spec.class === 'dangerous' || fileDialog) {
    return {
      verdict: 'ask',
      rule: fileDialog && spec.class !== 'dangerous' ? 'computer-file-dialog' : 'computer-dangerous',
      actionClass: 'dangerous'
    };
  }

  // act
  if (spec.targetless) {
    return { verdict: 'ask', rule: 'computer-no-target', actionClass: 'act' };
  }
  if (!target) {
    return { verdict: 'ask', rule: 'computer-no-target', actionClass: 'act', reason: 'Не удалось определить целевое окно.' };
  }
  if (isTargetAllowlisted(target, allowlist)) {
    if (context.autoApprove === false) return { verdict: 'ask', rule: 'computer-manual', actionClass: 'act' };
    return { verdict: 'allow', rule: 'computer-allowlist', actionClass: 'act' };
  }
  if (settings.outsideAllowlist === 'deny') {
    return {
      verdict: 'deny',
      rule: 'computer-outside-allowlist',
      actionClass: 'act',
      reason: `${describeTarget(target)} не входит в allowlist приложений, действия вне списка отклоняются.`
    };
  }
  return { verdict: 'ask', rule: 'computer-outside-allowlist', actionClass: 'act' };
}

/** Окно из ответа `list_windows` рантайма (windowId = HWND/CGWindowID, bundleId = процесс/bundle). */
export interface RuntimeWindowInfo {
  windowId: number;
  bundleId?: string | null;
  displayName?: string;
  title?: string | null;
  bounds?: { x: number; y: number; width: number; height: number };
  isOnScreen?: boolean;
  isFocused?: boolean;
}

/** Подсказки о цели из аргументов вызова. */
export interface TargetHints {
  windowId?: number;
  app?: string;
  /** Подстрока заголовка (`resize_window.window_name`). */
  windowName?: string;
  /** Первая точка действия в экранных координатах (после пересчёта со скриншота). */
  point?: [number, number] | null;
}

export function extractTargetHints(args: Record<string, unknown>, point: [number, number] | null): TargetHints {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    windowId: num(args.target_window_id) ?? num(args.window_id),
    app: str(args.target_app) ?? str(args.bundle_id),
    windowName: str(args.window_name),
    point
  };
}

function windowTarget(w: RuntimeWindowInfo, source: ComputerTarget['source']): ComputerTarget {
  return {
    app: w.bundleId || w.displayName || undefined,
    title: w.title ?? undefined,
    windowId: w.windowId,
    source
  };
}

function containsPoint(w: RuntimeWindowInfo, [x, y]: [number, number]): boolean {
  const b = w.bounds;
  return Boolean(b && x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height);
}

/**
 * Цель и активное окно по списку окон рантайма. Приоритет: окно из аргументов → приложение →
 * окно по заголовку → верхнее видимое окно под точкой → активное окно. Список `list_windows`
 * упорядочен сверху вниз по z-порядку, поэтому первое окно под точкой — верхнее.
 */
export function resolveComputerTarget(
  windows: RuntimeWindowInfo[],
  hints: TargetHints
): { target: ComputerTarget | null; focused: ComputerTarget | null } {
  const list = Array.isArray(windows) ? windows : [];
  const focusedWin = list.find((w) => w.isFocused);
  const focused = focusedWin ? windowTarget(focusedWin, 'focused') : null;

  if (hints.windowId !== undefined) {
    const w = list.find((x) => x.windowId === hints.windowId);
    return { target: w ? windowTarget(w, 'window') : { windowId: hints.windowId, source: 'window' }, focused };
  }
  if (hints.app) {
    const want = normalizeAppName(hints.app);
    const ofApp = list.filter((w) => normalizeAppName(w.bundleId || w.displayName) === want);
    const w = ofApp.find((x) => x.isFocused) ?? ofApp.find((x) => x.isOnScreen !== false);
    return { target: w ? windowTarget(w, 'app') : { app: hints.app, source: 'app' }, focused };
  }
  if (hints.windowName) {
    const needle = hints.windowName.toLowerCase();
    const w = list.find((x) => String(x.title ?? '').toLowerCase().includes(needle));
    if (w) return { target: windowTarget(w, 'window'), focused };
  }
  if (hints.point) {
    const w = list.find((x) => x.isOnScreen !== false && containsPoint(x, hints.point!));
    if (w) return { target: windowTarget(w, 'point'), focused };
  }
  return { target: focused, focused };
}

/** Приводит произвольный JSON настроек к валидному виду (для чтения файла настроек и IPC). */
export function sanitizeComputerPolicy(raw: unknown): ComputerPolicySettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const allowlist = Array.isArray(obj.allowlist)
    ? obj.allowlist
        .map((e) => (e && typeof e === 'object' ? (e as Record<string, unknown>) : {}))
        .map((e) => ({
          ...(typeof e.app === 'string' && e.app.trim() ? { app: e.app.trim() } : {}),
          ...(typeof e.title === 'string' && e.title.trim() ? { title: e.title.trim() } : {})
        }))
        .filter((e) => e.app || e.title)
        .slice(0, 100)
    : [];
  const titles = Array.isArray(obj.fileDialogTitles)
    ? obj.fileDialogTitles.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim())
    : DEFAULT_FILE_DIALOG_TITLES;
  return {
    allowlist,
    outsideAllowlist: obj.outsideAllowlist === 'deny' ? 'deny' : 'ask',
    onlyAllowlistedWindows: obj.onlyAllowlistedWindows === true,
    fileDialogTitles: titles.length > 0 ? titles : DEFAULT_FILE_DIALOG_TITLES
  };
}

/** Настройки функции управления компьютером (`<userData>/computer-use.json`). */
export interface ComputerUseSettings {
  /** По умолчанию выключено (decision-27 п. 6). */
  enabled: boolean;
  policy: ComputerPolicySettings;
  /** Accelerator Electron для kill-switch. */
  killSwitchHotkey: string;
  /** Kill-switch при перехвате мыши человеком. */
  takeoverDetection: boolean;
  takeoverThresholdPx: number;
  /** Скриншоты «до/после» `act`/`dangerous` в каталоге аудита. */
  auditScreenshots: boolean;
}

export const DEFAULT_KILL_SWITCH_HOTKEY = 'Control+Alt+Escape';

export function sanitizeComputerUseSettings(raw: unknown): ComputerUseSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const hotkey = typeof obj.killSwitchHotkey === 'string' ? obj.killSwitchHotkey.trim() : '';
  const threshold = typeof obj.takeoverThresholdPx === 'number' && Number.isFinite(obj.takeoverThresholdPx) ? Math.round(obj.takeoverThresholdPx) : 40;
  return {
    enabled: obj.enabled === true,
    policy: sanitizeComputerPolicy(obj.policy),
    killSwitchHotkey: /^[A-Za-z0-9]+(\+[A-Za-z0-9]+){1,4}$/.test(hotkey) ? hotkey : DEFAULT_KILL_SWITCH_HOTKEY,
    takeoverDetection: obj.takeoverDetection !== false,
    takeoverThresholdPx: Math.min(500, Math.max(10, threshold)),
    auditScreenshots: obj.auditScreenshots !== false
  };
}

/**
 * Нужно ли закрепить действие за конкретным окном. Модель часто указывает только `target_app`, и
 * рантайм активирует главное окно приложения — а действие должно попасть в то окно, которое прокси
 * посчитал целью (например, в открывшийся диалог «Сохранить как» того же процесса). Если окно указано
 * явно или цель не определена, аргументы не трогаем.
 */
export function shouldPinTargetWindow(args: Record<string, unknown>, target: ComputerTarget | null): target is ComputerTarget & { windowId: number } {
  if (!target || typeof target.windowId !== 'number') return false;
  if (args.target_window_id !== undefined || args.window_id !== undefined) return false;
  return typeof args.target_app === 'string' && args.target_app.trim().length > 0;
}

/** Строка действия для карточки HITL и аудита: инструмент, значимые аргументы, цель. */
export function summarizeComputerAction(tool: string, args: Record<string, unknown>, target: ComputerTarget | null, max = 300): string {
  const shown: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (k === 'focus_strategy' || k === 'approval_token') continue;
    shown[k] = typeof v === 'string' && v.length > 120 ? `${v.slice(0, 120)}…` : v;
  }
  const argsText = Object.keys(shown).length > 0 ? ` ${JSON.stringify(shown)}` : '';
  const text = `${tool}${argsText}${target ? ` → ${describeTarget(target)}` : ''}`;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Имя, которое прокси может запустить сам на Windows, когда рантайм не умеет запускать приложения
 * (`open_application` в 7.4 только активирует запущенное): голое имя исполняемого файла без пути,
 * аргументов и метасимволов оболочки — `notepad.exe`, `mspaint.exe`.
 */
export function isLaunchableAppName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.exe$/i.test(name.trim()) && !name.includes('..');
}

/** `open_application` рантайма: «Opened notepad.exe (activated: false)» → false; нераспознанный ответ → null. */
export function parseOpenApplicationActivated(text: string): boolean | null {
  const m = /\(activated:\s*(true|false)\)/i.exec(text ?? '');
  return m ? m[1].toLowerCase() === 'true' : null;
}

/** Задача разрешает управление компьютером: label `computer-use` (без учёта регистра). */
export function taskAllowsComputerUse(labels: unknown): boolean {
  if (!Array.isArray(labels)) return false;
  return labels.some((l) => String(l).trim().toLowerCase() === COMPUTER_USE_TASK_LABEL);
}
