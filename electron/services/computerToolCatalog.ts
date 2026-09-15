/**
 * Каталог инструментов рантайма управления компьютером (TASK-82, decision-27 п. 3).
 *
 * Классификация — данные, а не ветвления в коде: каждому инструменту `@zavora-ai/computer-use-mcp`
 * сопоставлены класс действия (`observe` | `act` | `dangerous`), признак экспорта агентам под
 * префиксом `computer_` и аргументы с экранными координатами (для пересчёта со скриншота).
 *
 * Fail-closed: инструмент, которого нет в таблице (появился в новой версии рантайма), агентам не
 * экспортируется, пока его не классифицируют здесь. Модуль чистый — без Electron и процессов.
 */

export type ComputerActionClass = 'observe' | 'act' | 'dangerous';

/**
 * Форма аргумента с координатами:
 * - `point` — `[x, y]`;
 * - `region` — `[x1, y1, x2, y2]`;
 * - `points` — `[[x, y], …]`;
 * - `locs` — `[[x, y, text], …]` (первые два элемента — координаты).
 */
export type CoordinateArgShape = 'point' | 'region' | 'points' | 'locs';

export interface ComputerToolSpec {
  class: ComputerActionClass;
  /** Экспортируется агентам как `computer_<name>`. */
  exported: boolean;
  /** Аргументы с координатами экрана: имя аргумента → форма. */
  coords?: Record<string, CoordinateArgShape>;
  /** Инструмент без целевого окна/приложения (уведомление, скрипт, реестр): allowlist к нему неприменим. */
  targetless?: boolean;
  /** Двигает физический курсор — детектор перехвата мыши даёт агенту grace-окно. */
  movesCursor?: boolean;
  /** Почему инструмент не экспортируется или отнесён к своему классу. */
  note?: string;
}

/** Префикс, под которым прокси ProjectHub ре-экспортирует инструменты рантайма. */
export const COMPUTER_TOOL_PREFIX = 'computer_';

const POINT = { coordinate: 'point' } as const;

export const COMPUTER_TOOL_CATALOG: Readonly<Record<string, ComputerToolSpec>> = {
  // ─────────────── observe: чтение состояния экрана, автоматически ───────────────
  screenshot: { class: 'observe', exported: true },
  zoom: { class: 'observe', exported: true, coords: { region: 'region' } },
  snapshot: { class: 'observe', exported: true },
  cursor_position: { class: 'observe', exported: true },
  get_frontmost_app: { class: 'observe', exported: true },
  list_windows: { class: 'observe', exported: true },
  list_running_apps: { class: 'observe', exported: true },
  discover_applications: { class: 'observe', exported: true },
  get_display_size: { class: 'observe', exported: true },
  list_displays: { class: 'observe', exported: true },
  get_window: { class: 'observe', exported: true },
  get_cursor_window: { class: 'observe', exported: true },
  get_ui_tree: { class: 'observe', exported: true },
  get_focused_element: { class: 'observe', exported: true },
  find_element: { class: 'observe', exported: true },
  get_app_capabilities: { class: 'observe', exported: true },
  get_app_dictionary: { class: 'observe', exported: true },
  list_menu_bar: { class: 'observe', exported: true },
  list_spaces: { class: 'observe', exported: true },
  get_active_space: { class: 'observe', exported: true },
  get_tool_metadata: { class: 'observe', exported: true },
  wait: { class: 'observe', exported: true },

  // ─────────────── act: ввод и окна — авто только в allowlist ───────────────
  left_click: { class: 'act', exported: true, coords: POINT, movesCursor: true },
  right_click: { class: 'act', exported: true, coords: POINT, movesCursor: true },
  middle_click: { class: 'act', exported: true, coords: POINT, movesCursor: true },
  double_click: { class: 'act', exported: true, coords: POINT, movesCursor: true },
  triple_click: { class: 'act', exported: true, coords: POINT, movesCursor: true },
  mouse_move: { class: 'act', exported: true, coords: POINT, movesCursor: true },
  left_click_drag: { class: 'act', exported: true, coords: { start_coordinate: 'point', coordinate: 'point' }, movesCursor: true },
  mouse_drag: { class: 'act', exported: true, coords: { path: 'points' }, movesCursor: true },
  scroll: { class: 'act', exported: true, coords: POINT, movesCursor: true },
  multi_select: { class: 'act', exported: true, coords: { locs: 'points' }, movesCursor: true },
  multi_edit: { class: 'act', exported: true, coords: { locs: 'locs' }, movesCursor: true },
  type: { class: 'act', exported: true },
  key: { class: 'act', exported: true },
  read_clipboard: { class: 'act', exported: true, note: 'Буфер может содержать секреты — чтение приравнено к действию' },
  write_clipboard: { class: 'act', exported: true },
  open_application: { class: 'act', exported: true },
  activate_app: { class: 'act', exported: true },
  activate_window: { class: 'act', exported: true },
  resize_window: { class: 'act', exported: true },
  hide_app: { class: 'act', exported: true },
  unhide_app: { class: 'act', exported: true },
  click_element: { class: 'act', exported: true },
  set_value: { class: 'act', exported: true },
  press_button: { class: 'act', exported: true },
  fill_form: { class: 'act', exported: true },
  select_menu_item: { class: 'act', exported: true },
  agent_pointer: { class: 'act', exported: true, coords: POINT, targetless: true, note: 'Виртуальный указатель, физический курсор не двигает' },
  notification: { class: 'act', exported: true, targetless: true },
  create_agent_space: { class: 'act', exported: true, targetless: true },
  move_window_to_space: { class: 'act', exported: true },
  remove_window_from_space: { class: 'act', exported: true },

  // ─────────────── dangerous: всегда запрос человеку ───────────────
  hold_key: { class: 'dangerous', exported: true, note: 'Удержание клавиш оставляет ввод в изменённом состоянии' },
  left_mouse_down: { class: 'dangerous', exported: true, coords: POINT, movesCursor: true, note: 'Нажатие без отпускания' },
  left_mouse_up: { class: 'dangerous', exported: true, coords: POINT, movesCursor: true },
  run_script: { class: 'dangerous', exported: true, targetless: true, note: 'PowerShell/AppleScript — произвольный код' },
  filesystem: { class: 'dangerous', exported: true, targetless: true },
  process_kill: { class: 'dangerous', exported: true, targetless: true },
  registry: { class: 'dangerous', exported: true, targetless: true },
  destroy_space: { class: 'dangerous', exported: true, targetless: true },

  // ─────────────── не экспортируются ───────────────
  doctor: { class: 'observe', exported: false, note: 'Диагностика — только в настройках ProjectHub' },
  policy_status: { class: 'observe', exported: false, note: 'Политика рантайма не источник истины — политика в прокси' },
  get_tool_guide: { class: 'observe', exported: false, note: 'Советует скриптинг раньше дерева доступности — противоречит accessibility-first' },
  openai_computer: { class: 'act', exported: false, note: 'Пакет действий обходит поштучную классификацию и allowlist' },
  scrape: { class: 'observe', exported: false, note: 'Сеть, а не рабочий стол' },
  web_search: { class: 'observe', exported: false, note: 'Сеть, а не рабочий стол' },
  browser_tabs: { class: 'observe', exported: false, note: 'Браузер — TASK-78' },
  browser_page_text: { class: 'observe', exported: false, note: 'Браузер — TASK-78' },
  browser_find: { class: 'observe', exported: false, note: 'Браузер — TASK-78' }
};

export function getComputerToolSpec(runtimeName: string): ComputerToolSpec | undefined {
  return Object.prototype.hasOwnProperty.call(COMPUTER_TOOL_CATALOG, runtimeName) ? COMPUTER_TOOL_CATALOG[runtimeName] : undefined;
}

export function toProxyToolName(runtimeName: string): string {
  return `${COMPUTER_TOOL_PREFIX}${runtimeName}`;
}

/** `computer_left_click` → `left_click`; `null` — имя не из прокси. */
export function fromProxyToolName(proxyName: string): string | null {
  return proxyName.startsWith(COMPUTER_TOOL_PREFIX) ? proxyName.slice(COMPUTER_TOOL_PREFIX.length) : null;
}

const CLASS_LABEL: Record<ComputerActionClass, string> = {
  observe: '[observe — без подтверждения]',
  act: '[act — автоматически только в разрешённых приложениях, иначе подтверждение человека]',
  dangerous: '[dangerous — всегда подтверждение человека]'
};

/** Описание инструмента прокси: класс действия (модель заранее знает, что потребует подтверждения) + описание рантайма. */
export function buildProxyToolDescription(runtimeName: string, spec: ComputerToolSpec, runtimeDescription?: string): string {
  const parts = [CLASS_LABEL[spec.class], runtimeDescription?.trim() || runtimeName];
  if (runtimeName === 'screenshot') parts.push('ProjectHub вписывает скриншот в 1366×768 (JPEG).');
  return parts.join(' ');
}

/** Служебные аргументы рантайма, которые прокси не показывает модели. */
const HIDDEN_RUNTIME_ARGS = new Set(['approval_token']);

/**
 * Схема инструмента прокси: схема рантайма без служебных аргументов и `$schema`, плюс
 * `coordinate_space` у инструментов с координатами.
 */
export interface ProxyInputSchema {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  [key: string]: unknown;
}

export function buildProxyInputSchema(inputSchema: Record<string, unknown> | undefined, spec: ComputerToolSpec): ProxyInputSchema {
  const source = inputSchema && typeof inputSchema === 'object' ? inputSchema : {};
  const { $schema: _schema, properties, required, ...rest } = source;
  const props: Record<string, Record<string, unknown>> = {};
  const sourceProps = properties && typeof properties === 'object' ? (properties as Record<string, unknown>) : {};
  for (const [name, value] of Object.entries(sourceProps)) {
    if (!HIDDEN_RUNTIME_ARGS.has(name) && value && typeof value === 'object') props[name] = value as Record<string, unknown>;
  }
  if (spec.coords) {
    props.coordinate_space = {
      type: 'string',
      enum: ['screen', 'screenshot'],
      description:
        'Пространство координат: "screen" (по умолчанию) — логические пиксели экрана, как bounds из get_ui_tree; '
        + '"screenshot" — пиксели последнего computer_screenshot этой сессии, ProjectHub пересчитает их в экранные.'
    };
  }
  const req = Array.isArray(required) ? required.filter((r): r is string => typeof r === 'string' && !HIDDEN_RUNTIME_ARGS.has(r)) : [];
  return { ...rest, type: 'object', properties: props, ...(req.length > 0 ? { required: req } : {}) };
}

export interface CatalogReconciliation {
  /** Есть в рантайме и экспортируются. */
  exported: string[];
  /** Есть в рантайме, но намеренно скрыты (`exported: false`). */
  hidden: string[];
  /** Есть в рантайме, но не классифицированы — не экспортируются до обновления каталога. */
  unknown: string[];
  /** Экспортируемые по каталогу, но отсутствующие в рантайме (другая версия или ОС). */
  missing: string[];
}

/** Сверка набора инструментов рантайма с каталогом при старте (decision-27, «проверять набор при старте»). */
export function reconcileRuntimeTools(runtimeNames: string[]): CatalogReconciliation {
  const present = new Set(runtimeNames);
  const result: CatalogReconciliation = { exported: [], hidden: [], unknown: [], missing: [] };
  for (const name of runtimeNames) {
    const spec = getComputerToolSpec(name);
    if (!spec) result.unknown.push(name);
    else if (spec.exported) result.exported.push(name);
    else result.hidden.push(name);
  }
  for (const [name, spec] of Object.entries(COMPUTER_TOOL_CATALOG)) {
    if (spec.exported && !present.has(name)) result.missing.push(name);
  }
  return result;
}
