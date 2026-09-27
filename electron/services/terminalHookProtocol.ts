/**
 * Протокол хуков терминальных сессий Claude Code и Codex (TASK-77, decision-54 п. 3, 5–7).
 *
 * Чистый модуль: разбирает вход хука (JSON из stdin движка, пересланный скриптом `projecthub-hook.mjs`),
 * приводит инструменты Codex к именам политики HITL и строит ответ в формате движка — `{ exitCode, stdout,
 * stderr }`, который скрипт печатает как есть. Логики политики в скрипте нет.
 *
 * Форматы (документация 2026-09-27):
 * - Claude Code: PreToolUse → `hookSpecificOutput.permissionDecision` `allow | deny`; Stop → `decision: block`.
 * - Codex: отказ — `exit 2` с причиной в stderr; `allow` и `ask` надёжно не поддержаны, поэтому одобрение — без
 *   решения (Codex применяет свою политику).
 */

export type HookEngine = 'claude' | 'codex';
export const HOOK_ENGINES: readonly HookEngine[] = ['claude', 'codex'];

export type HookEventName = 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'Stop';
const HOOK_EVENT_NAMES: readonly HookEventName[] = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop'];

export interface NormalizedHookEvent {
  engine: HookEngine;
  event: HookEventName;
  /** Идентификатор сессии движка (`session_id`). */
  sessionId: string;
  cwd?: string;
  toolName?: string;
  toolInput: Record<string, unknown>;
  toolUseId?: string;
  /** Имя субагента (Claude Code: `agent_type`), если вызов сделан из субагента. */
  agentType?: string;
  /** Stop: хук уже продолжал работу агента в этом ходе (защита от цикла). */
  stopHookActive: boolean;
  /** Инструмент завершился ошибкой (PostToolUseFailure или признак ошибки в ответе). */
  toolFailed: boolean;
  /** Короткое описание ошибки инструмента без содержимого файлов. */
  errorDetail?: string;
}

export function isHookEngine(value: unknown): value is HookEngine {
  return typeof value === 'string' && (HOOK_ENGINES as readonly string[]).includes(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Признак ошибки в `tool_response`: Codex и часть инструментов Claude сообщают код выхода или флаг. */
function responseFailed(response: unknown): { failed: boolean; detail?: string } {
  const r = record(response);
  const exit = r.exit_code ?? r.exitCode;
  if (typeof exit === 'number' && exit !== 0) return { failed: true, detail: `код выхода ${exit}` };
  if (r.is_error === true || r.isError === true || r.success === false) {
    return { failed: true, ...(str(r.error) ? { detail: str(r.error)!.slice(0, 200) } : {}) };
  }
  return { failed: false };
}

export type ParseHookResult = { ok: true; event: NormalizedHookEvent } | { ok: false; error: string };

export function parseHookPayload(engine: HookEngine, raw: unknown): ParseHookResult {
  const p = record(raw);
  const eventName = str(p.hook_event_name);
  if (!eventName || !(HOOK_EVENT_NAMES as readonly string[]).includes(eventName)) {
    return { ok: false, error: `неподдерживаемое событие хука: ${eventName ?? 'нет hook_event_name'}` };
  }
  const event = eventName as HookEventName;
  const sessionId = str(p.session_id);
  if (!sessionId) return { ok: false, error: 'во входе хука нет session_id' };
  const toolName = str(p.tool_name);
  if ((event === 'PreToolUse' || event === 'PostToolUse' || event === 'PostToolUseFailure') && !toolName) {
    return { ok: false, error: `во входе ${event} нет tool_name` };
  }
  const failure = event === 'PostToolUseFailure'
    ? { failed: true, ...(str(p.error) ? { detail: str(p.error)!.slice(0, 200) } : {}) }
    : event === 'PostToolUse' ? responseFailed(p.tool_response) : { failed: false };
  return {
    ok: true,
    event: {
      engine,
      event,
      sessionId,
      ...(str(p.cwd) ? { cwd: str(p.cwd) } : {}),
      ...(toolName ? { toolName } : {}),
      toolInput: record(p.tool_input),
      ...(str(p.tool_use_id) ? { toolUseId: str(p.tool_use_id) } : {}),
      ...(str(p.agent_type) ? { agentType: str(p.agent_type) } : {}),
      stopHookActive: p.stop_hook_active === true,
      toolFailed: failure.failed,
      ...(failure.detail ? { errorDetail: failure.detail } : {})
    }
  };
}

/** Пути файлов из патча `apply_patch` Codex (`*** Add|Update|Delete File: <path>`, `*** Move to: <path>`). */
export function patchFilePaths(patch: string): string[] {
  const out = new Set<string>();
  const re = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(patch))) {
    const p = match[1].trim();
    if (p) out.add(p);
  }
  return Array.from(out);
}

export interface PolicyToolCall {
  /** Имя инструмента в терминах политики HITL (`Bash`, `Write`, `Edit`, `Read`, …). */
  tool: string;
  input: Record<string, unknown>;
}

function commandText(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(' ');
  return typeof value === 'string' ? value : '';
}

/**
 * Вызов инструмента движка → вызовы для `evaluateToolRequest`. У Claude Code имена совпадают с политикой. Codex:
 * оболочка (`Bash`, `shell`, `exec_command`) → `Bash`, `apply_patch` → `Edit` на каждый файл патча.
 */
export function policyToolCalls(event: Pick<NormalizedHookEvent, 'engine' | 'toolName' | 'toolInput'>): PolicyToolCall[] {
  const tool = event.toolName ?? '';
  const input = event.toolInput;
  if (event.engine === 'claude') return [{ tool, input }];
  if (tool === 'apply_patch') {
    const patch = commandText(input.command ?? input.patch ?? input.input);
    const paths = patchFilePaths(patch);
    if (!paths.length) return [{ tool: 'Edit', input: { file_path: '' } }];
    return paths.map((file_path) => ({ tool: 'Edit', input: { file_path } }));
  }
  if (tool === 'Bash' || tool === 'shell' || tool === 'exec_command' || tool === 'local_shell') {
    return [{ tool: 'Bash', input: { command: commandText(input.command ?? input.cmd) } }];
  }
  return [{ tool, input }];
}

// ─────────────────────────────── Ответ ───────────────────────────────

export type HookVerdict =
  /** Без решения: движок применяет собственные правила. */
  | { kind: 'none'; message?: string }
  /** Разрешено человеком в ProjectHub. */
  | { kind: 'allow'; reason?: string }
  | { kind: 'deny'; reason: string }
  /** Stop: продолжить работу агента с причиной (проверки не прошли). */
  | { kind: 'block'; reason: string };

export interface HookProcessOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const NONE: HookProcessOutput = { exitCode: 0, stdout: '', stderr: '' };

export function formatHookResponse(engine: HookEngine, event: HookEventName, verdict: HookVerdict): HookProcessOutput {
  if (verdict.kind === 'none') return { ...NONE, ...(verdict.message ? { stderr: verdict.message } : {}) };

  if (event === 'Stop') {
    if (verdict.kind !== 'block') return NONE;
    // Codex: формат продолжения по Stop не проверен — только сообщение в stderr без блокировки.
    if (engine === 'codex') return { ...NONE, stderr: verdict.reason };
    return { exitCode: 0, stdout: JSON.stringify({ decision: 'block', reason: verdict.reason }), stderr: '' };
  }

  if (event !== 'PreToolUse') return NONE;

  if (verdict.kind === 'deny') {
    if (engine === 'codex') return { exitCode: 2, stdout: '', stderr: verdict.reason };
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason }
      }),
      stderr: ''
    };
  }

  if (verdict.kind === 'allow') {
    // Codex: `allow` документирован только вместе с updatedInput — одобрение передаётся без решения.
    if (engine === 'codex') return NONE;
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: verdict.reason || 'Разрешено в ProjectHub'
        }
      }),
      stderr: ''
    };
  }
  return NONE;
}

/** Ответ скрипта при недоступном ProjectHub (decision-54 п. 8): закрытый режим отказывает только PreToolUse. */
export function failModeResponse(engine: HookEngine, event: HookEventName, failMode: 'open' | 'closed', reason: string): HookProcessOutput {
  if (failMode === 'closed' && event === 'PreToolUse') {
    return formatHookResponse(engine, event, { kind: 'deny', reason: `ProjectHub недоступен (режим fail-closed): ${reason}` });
  }
  return NONE;
}

// ─────────────────────────────── Настройки ───────────────────────────────

export type HookFailMode = 'open' | 'closed';
export type StopChecksMode = 'off' | 'notify' | 'block';

/** `<userData>/terminal-hooks.json` (decision-54 п. 9). */
export interface TerminalHookSettings {
  version: 1;
  /** Для встроенного терминала (`PROJECTHUB_HOOK_FAIL_MODE`); внешний терминал задаёт переменную сам. */
  failMode: HookFailMode;
  /** Тайм-аут хука в настройках движков, 60…3600 с. */
  hookTimeoutSec: number;
  stopChecks: StopChecksMode;
}

export const DEFAULT_TERMINAL_HOOK_SETTINGS: TerminalHookSettings = {
  version: 1,
  failMode: 'open',
  hookTimeoutSec: 1800,
  stopChecks: 'off'
};

export function normalizeTerminalHookSettings(raw: unknown): TerminalHookSettings {
  const r = record(raw);
  const timeout = typeof r.hookTimeoutSec === 'number' && Number.isFinite(r.hookTimeoutSec) ? Math.round(r.hookTimeoutSec) : DEFAULT_TERMINAL_HOOK_SETTINGS.hookTimeoutSec;
  return {
    version: 1,
    failMode: r.failMode === 'closed' ? 'closed' : 'open',
    hookTimeoutSec: Math.min(Math.max(timeout, 60), 3600),
    stopChecks: r.stopChecks === 'notify' || r.stopChecks === 'block' ? r.stopChecks : 'off'
  };
}

/** Сколько ждать решения человека: бюджет скрипта минус запас, чтобы ответ успел раньше тайм-аута хука. */
export const HOOK_SERVER_MARGIN_MS = 10_000;
export const HOOK_MIN_APPROVAL_MS = 10_000;

export function approvalTimeoutFromBudget(budgetMs: unknown, configuredMs?: number): number {
  const budget = typeof budgetMs === 'number' && Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : 0;
  const fromBudget = budget ? Math.max(budget - HOOK_SERVER_MARGIN_MS, HOOK_MIN_APPROVAL_MS) : HOOK_MIN_APPROVAL_MS;
  return typeof configuredMs === 'number' && configuredMs > 0 ? Math.min(fromBudget, configuredMs) : fromBudget;
}
