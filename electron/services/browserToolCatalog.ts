/**
 * Инструменты Playwright MCP (`browser_*`) в политике HITL (TASK-78, decision-55 п. 3).
 *
 * Playwright MCP подключается напрямую, без прокси ProjectHub: браузер headless и изолирован, у
 * каждого клиента свой. Поэтому действия внутри браузера (`page`) идут без карточки, а выход за
 * его пределы (`host`) — только через человека, в автономных запусках — отказ.
 *
 * Классификация — данные: список известных имён и общие правила по аргументам (`filename`,
 * `paths`, `url`), а не ветвления по каждому инструменту. Чистый модуль без Electron.
 */
import { isInsideProject } from './pathGuard.js';

/** `page` — внутри изолированного браузера; `host` — файлы машины или код в процессе сервера. */
export type BrowserToolClass = 'page' | 'host';

/**
 * Имена инструментов `@playwright/mcp` 0.0.82: ядро и группы `--caps` (network, storage, config,
 * vision, pdf, devtools). Новые имена не классифицируются — для них действует общая политика.
 */
export const KNOWN_BROWSER_TOOLS: ReadonlySet<string> = new Set([
  // ядро
  'browser_click', 'browser_close', 'browser_console_messages', 'browser_drag', 'browser_drop',
  'browser_emulate_media', 'browser_evaluate', 'browser_file_upload', 'browser_fill_form', 'browser_find',
  'browser_handle_dialog', 'browser_hover', 'browser_navigate', 'browser_navigate_back',
  'browser_network_request', 'browser_network_requests', 'browser_press_key', 'browser_resize',
  'browser_run_code_unsafe', 'browser_select_option', 'browser_snapshot', 'browser_take_screenshot',
  'browser_type', 'browser_wait_for', 'browser_tabs',
  // --caps=config, network, storage
  'browser_get_config', 'browser_network_state_set', 'browser_route', 'browser_route_list', 'browser_unroute',
  'browser_cookie_clear', 'browser_cookie_delete', 'browser_cookie_get', 'browser_cookie_list', 'browser_cookie_set',
  'browser_localstorage_clear', 'browser_localstorage_delete', 'browser_localstorage_get', 'browser_localstorage_list',
  'browser_localstorage_set', 'browser_sessionstorage_clear', 'browser_sessionstorage_delete',
  'browser_sessionstorage_get', 'browser_sessionstorage_list', 'browser_sessionstorage_set',
  'browser_set_storage_state', 'browser_storage_state',
  // --caps=vision, pdf, devtools
  'browser_mouse_click_xy', 'browser_mouse_down', 'browser_mouse_drag_xy', 'browser_mouse_move_xy',
  'browser_mouse_up', 'browser_mouse_wheel', 'browser_pdf_save', 'browser_annotate', 'browser_generate_locator',
  'browser_highlight', 'browser_hide_highlight', 'browser_resume', 'browser_start_recording', 'browser_stop_recording',
  'browser_start_tracing', 'browser_stop_tracing', 'browser_start_video', 'browser_stop_video', 'browser_video_chapter',
  'browser_video_hide_actions', 'browser_video_show_actions', 'browser_verify_element_visible',
  'browser_verify_list_visible', 'browser_verify_text_visible', 'browser_verify_value'
]);

/** Инструменты, которые выходят за браузер при любых аргументах. */
const ALWAYS_HOST: Record<string, string> = {
  browser_run_code_unsafe: 'выполняет произвольный код в процессе Playwright MCP на этой машине'
};

/** Имя инструмента MCP вида `mcp__<сервер>__browser_<действие>` (Claude Code). */
const MCP_BROWSER_TOOL_RE = /^mcp__(.+?)__(browser_[a-z0-9_]+)$/;

export function parseBrowserToolName(tool: string): { server: string; action: string } | null {
  const m = MCP_BROWSER_TOOL_RE.exec(tool ?? '');
  return m ? { server: m[1], action: m[2] } : null;
}

export interface BrowserToolClassification {
  cls: BrowserToolClass;
  /** Почему `host` — для карточки HITL и аудита. */
  reason?: string;
}

function isFileUrl(value: unknown): boolean {
  return typeof value === 'string' && /^\s*file:/i.test(value);
}

/**
 * Класс вызова по имени действия и аргументам. `null` — инструмент неизвестен (новая версия
 * пакета): пусть решает общая политика. `workDir` — рабочий каталог сессии (worktree агента).
 */
export function classifyBrowserTool(
  action: string,
  input: Record<string, unknown>,
  workDir: string
): BrowserToolClassification | null {
  if (!KNOWN_BROWSER_TOOLS.has(action)) return null;
  const always = ALWAYS_HOST[action];
  if (always) return { cls: 'host', reason: `${action} ${always}` };

  const args = input && typeof input === 'object' ? input : {};
  const filename = args.filename;
  if (typeof filename === 'string' && filename.trim() && !isInsideProject(workDir, filename)) {
    return { cls: 'host', reason: `${action}: файл «${filename}» вне рабочего каталога` };
  }
  if (Array.isArray(args.paths)) {
    const outside = args.paths.find((p) => typeof p !== 'string' || !isInsideProject(workDir, p));
    if (outside !== undefined) {
      return { cls: 'host', reason: `${action}: файл «${String(outside)}» вне рабочего каталога` };
    }
  }
  if (isFileUrl(args.url)) {
    return { cls: 'host', reason: `${action}: адрес file: открывает файлы машины` };
  }
  return { cls: 'page' };
}

export interface BrowserPolicyContext {
  /** Запуск без человека: Automations или автозапуск назначенной задачи (decision-52 п. 6). */
  autonomous?: boolean;
  /** Рабочий каталог сессии; по умолчанию корень проекта. */
  workDir: string;
}

export interface BrowserPolicyVerdict {
  verdict: 'allow' | 'deny' | 'ask';
  rule: 'browser-page' | 'browser-host' | 'browser-host-autonomous';
  reason?: string;
}

/**
 * Вердикт для `mcp__*__browser_*`; `null` — это не известный инструмент браузера. Allow-список
 * роли проверяет вызывающий код раньше: запрет роли сильнее `browser-page`.
 */
export function evaluateBrowserTool(
  tool: string,
  input: Record<string, unknown>,
  ctx: BrowserPolicyContext
): BrowserPolicyVerdict | null {
  const parsed = parseBrowserToolName(tool);
  if (!parsed) return null;
  const cls = classifyBrowserTool(parsed.action, input, ctx.workDir);
  if (!cls) return null;
  if (cls.cls === 'page') return { verdict: 'allow', rule: 'browser-page' };
  if (ctx.autonomous) {
    return {
      verdict: 'deny',
      rule: 'browser-host-autonomous',
      reason: `Отклонено: ${cls.reason}. В автономном запуске действия вне браузера проекта запрещены.`
    };
  }
  return { verdict: 'ask', rule: 'browser-host', reason: cls.reason };
}
