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
 * - Google Antigravity (agy 1.2.12, проверено вживую, decision-62): вход — `toolCall { name, args }`,
 *   `conversationId`, `stepIdx`, `workspacePaths`; имени события во входе нет — его передаёт скрипт. PreToolUse:
 *   пустой stdout с кодом 0 — без решения; `{ decision: deny | allow, reason }`. Любой ненулевой код, тайм-аут и даже
 *   `{}` движок считает отказом, поэтому код выхода всегда 0. Stop → `decision: continue`.
 */

export type HookEngine = 'claude' | 'codex' | 'antigravity';
export const HOOK_ENGINES: readonly HookEngine[] = ['claude', 'codex', 'antigravity'];

export type HookEventName = 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'Stop';
const HOOK_EVENT_NAMES: readonly HookEventName[] = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop'];

export interface NormalizedHookEvent {
  engine: HookEngine;
  event: HookEventName;
  /** Идентификатор сессии движка (`session_id`; у Antigravity — `conversationId`, у субагента свой). */
  sessionId: string;
  cwd?: string;
  toolName?: string;
  toolInput: Record<string, unknown>;
  toolUseId?: string;
  /** Имя субагента (Claude Code: `agent_type`), если вызов сделан из субагента. Antigravity его не передаёт. */
  agentType?: string;
  /** Stop: хук уже продолжал работу агента в этом ходе (защита от цикла). */
  stopHookActive: boolean;
  /** Stop Antigravity: `fullyIdle: false` — разговор ещё ждёт своих субагентов, работа не закончена. */
  stopIdle?: boolean;
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

/**
 * Вход хука Antigravity. Событие приходит отдельно (аргумент команды хука). `toolUseId` — `conversationId:stepIdx`:
 * у PreToolUse и PostToolUse одного вызова один `stepIdx`, так PostToolUse находит момент решения.
 */
function parseAntigravityPayload(p: Record<string, unknown>, eventHint: string | undefined): ParseHookResult {
  const eventName = str(eventHint);
  if (!eventName || eventName === 'PostToolUseFailure' || !(HOOK_EVENT_NAMES as readonly string[]).includes(eventName)) {
    return { ok: false, error: `неподдерживаемое событие хука Antigravity: ${eventName ?? 'не передано'}` };
  }
  const event = eventName as HookEventName;
  const sessionId = str(p.conversationId);
  if (!sessionId) return { ok: false, error: 'во входе хука нет conversationId' };
  const call = record(p.toolCall);
  const toolName = str(call.name);
  if ((event === 'PreToolUse' || event === 'PostToolUse') && !toolName) {
    return { ok: false, error: `во входе ${event} нет toolCall.name` };
  }
  const args = record(call.args);
  const workspace = Array.isArray(p.workspacePaths) ? str(p.workspacePaths[0]) : undefined;
  const cwd = str(args.Cwd) ?? workspace;
  const error = event === 'PostToolUse' ? str(p.error) : undefined;
  const stepIdx = typeof p.stepIdx === 'number' && Number.isFinite(p.stepIdx) ? p.stepIdx : undefined;
  return {
    ok: true,
    event: {
      engine: 'antigravity',
      event,
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(toolName ? { toolName } : {}),
      toolInput: args,
      ...(toolName && stepIdx !== undefined ? { toolUseId: `${sessionId}:${stepIdx}` } : {}),
      // Номер продолжения после Stop: больше нуля — ход уже продолжали (аналог stop_hook_active).
      stopHookActive: typeof p.executionNum === 'number' && p.executionNum > 0,
      ...(event === 'Stop' && typeof p.fullyIdle === 'boolean' ? { stopIdle: p.fullyIdle } : {}),
      toolFailed: Boolean(error),
      ...(error ? { errorDetail: error.slice(0, 200) } : {})
    }
  };
}

export function parseHookPayload(engine: HookEngine, raw: unknown, eventHint?: string): ParseHookResult {
  const p = record(raw);
  if (engine === 'antigravity') return parseAntigravityPayload(p, eventHint);
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

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Фрагменты `multi_replace_file_content` одним Edit: для карточки HITL достаточно склеенных «было/стало». */
function joinedChunks(chunks: unknown, key: 'TargetContent' | 'ReplacementContent'): string {
  if (!Array.isArray(chunks)) return '';
  return chunks.map((c) => text(record(c)[key])).join('\n…\n');
}

/**
 * Инструменты Antigravity → имена и вход в форме Claude Code, чтобы политика, дифф и карточка HITL были общими.
 * Служебные инструменты (`send_message`, `manage_task`, `schedule`, MCP) идут под своим именем — правило `auto-other`.
 */
function antigravityPolicyCall(tool: string, a: Record<string, unknown>): PolicyToolCall {
  switch (tool) {
    case 'run_command':
      return { tool: 'Bash', input: { command: text(a.CommandLine), ...(text(a.Cwd) ? { cwd: text(a.Cwd) } : {}) } };
    case 'write_to_file':
      return { tool: 'Write', input: { file_path: text(a.TargetFile), content: text(a.CodeContent) } };
    case 'replace_file_content':
      return { tool: 'Edit', input: { file_path: text(a.TargetFile), old_string: text(a.TargetContent), new_string: text(a.ReplacementContent) } };
    case 'multi_replace_file_content':
      return {
        tool: 'Edit',
        input: { file_path: text(a.TargetFile), old_string: joinedChunks(a.ReplacementChunks, 'TargetContent'), new_string: joinedChunks(a.ReplacementChunks, 'ReplacementContent') }
      };
    case 'view_file':
      return { tool: 'Read', input: { file_path: text(a.AbsolutePath) } };
    case 'list_dir':
      return { tool: 'Glob', input: { path: text(a.DirectoryPath) } };
    case 'find_by_name':
      return { tool: 'Glob', input: { path: text(a.SearchDirectory), pattern: text(a.Pattern) } };
    case 'grep_search':
      return { tool: 'Grep', input: { path: text(a.SearchPath), pattern: text(a.Query) } };
    case 'read_url_content':
      return { tool: 'WebFetch', input: { url: text(a.Url) } };
    case 'search_web':
      return { tool: 'WebSearch', input: { query: text(a.query) } };
    case 'invoke_subagent': {
      const names = Array.isArray(a.Subagents) ? a.Subagents.map((s) => text(record(s).TypeName)).filter(Boolean) : [];
      return { tool: 'Agent', input: { description: names.join(', ') } };
    }
    case 'ask_question':
      return { tool: 'AskUserQuestion', input: a };
    default:
      return { tool, input: a };
  }
}

/**
 * Вызов инструмента движка → вызовы для `evaluateToolRequest`. У Claude Code имена совпадают с политикой. Codex:
 * оболочка (`Bash`, `shell`, `exec_command`) → `Bash`, `apply_patch` → `Edit` на каждый файл патча. Antigravity —
 * `antigravityPolicyCall`.
 */
export function policyToolCalls(event: Pick<NormalizedHookEvent, 'engine' | 'toolName' | 'toolInput'>): PolicyToolCall[] {
  const tool = event.toolName ?? '';
  const input = event.toolInput;
  if (event.engine === 'claude') return [{ tool, input }];
  if (event.engine === 'antigravity') return [antigravityPolicyCall(tool, input)];
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

/**
 * Ответ Antigravity. Код выхода всегда 0: ненулевой код движок считает отказом. «Без решения» — пустой stdout
 * (даже `{}` у PreToolUse — отказ с пустой причиной).
 */
function formatAntigravityResponse(event: HookEventName, verdict: HookVerdict): HookProcessOutput {
  if (verdict.kind === 'none') return { ...NONE, ...(verdict.message ? { stderr: verdict.message } : {}) };
  if (event === 'Stop') {
    return verdict.kind === 'block' ? { ...NONE, stdout: JSON.stringify({ decision: 'continue', reason: verdict.reason }) } : NONE;
  }
  if (event !== 'PreToolUse') return NONE;
  if (verdict.kind === 'deny') return { ...NONE, stdout: JSON.stringify({ decision: 'deny', reason: verdict.reason }) };
  if (verdict.kind === 'allow') return { ...NONE, stdout: JSON.stringify({ decision: 'allow', reason: verdict.reason || 'Разрешено в ProjectHub' }) };
  return NONE;
}

export function formatHookResponse(engine: HookEngine, event: HookEventName, verdict: HookVerdict): HookProcessOutput {
  if (engine === 'antigravity') return formatAntigravityResponse(event, verdict);
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
