/**
 * Классификатор ошибок LLM-провайдера (TASK-70.6, decision-43) — чистый модуль без Electron.
 *
 * Вход: HTTP-статус и тело ответа, ошибка внутри SSE-потока, сетевая ошибка `fetch` или ошибка
 * конфигурации. Выход: сериализуемый снимок `ProviderErrorInfo` (вид, причина, статус, код,
 * retry-after, признак «повтор может помочь», провайдер, адрес, модель) и сообщение пользователю
 * «что случилось — где — что сделать — ответ сервера». Снимок пишется в слот Swarm, ревью Arena и
 * экспорт; по виду ошибки TASK-79 решает о fallback. Сам fallback здесь не делается.
 *
 * Ключи не попадают ни в сообщение, ни в снимок: адрес очищается от логина, пароля и query,
 * значения заголовков авторизации и шаблоны ключей вырезаются из ответа сервера.
 */

export type ProviderErrorKind =
  | 'auth'
  | 'quota'
  | 'model_not_found'
  | 'rate_limit'
  | 'unavailable'
  | 'bad_request'
  | 'config'
  | 'unknown';

/**
 * Уточнение вида: для `bad_request` — что отверг сервер, для `unavailable` — почему недоступен,
 * для `config` — что не настроено.
 */
export type ProviderErrorReason =
  // bad_request
  | 'tools'
  | 'reasoning'
  | 'context'
  | 'unsupported'
  | 'moderation'
  // unavailable
  | 'refused'
  | 'dns'
  | 'timeout'
  | 'tls'
  | 'network'
  | 'server'
  | 'overloaded'
  // auth
  | 'forbidden'
  // config
  | 'endpoint'
  | 'no_model'
  | 'no_key'
  | 'no_profile'
  | 'provider';

export const PROVIDER_ERROR_KINDS: readonly ProviderErrorKind[] = [
  'auth',
  'quota',
  'model_not_found',
  'rate_limit',
  'unavailable',
  'bad_request',
  'config',
  'unknown'
];

/** Сериализуемый снимок ошибки — уходит в renderer, слот Swarm, ревью Arena и экспорт. */
export interface ProviderErrorInfo {
  kind: ProviderErrorKind;
  reason?: ProviderErrorReason;
  /** HTTP-статус ответа или числовой код ошибки из потока. */
  status?: number;
  /** Код сервера (`invalid_api_key`, `not_found_error`) или сетевой код (`ECONNREFUSED`). */
  code?: string;
  /** Тот же запрос может пройти позже без изменения настроек (лимит, перегрузка, сервер не запущен). */
  retryable: boolean;
  /** Сколько ждать перед повтором: заголовок `retry-after` или «try again in N s» в тексте. */
  retryAfterMs?: number;
  /** Имя профиля или прежнего провайдера (`Ollama`, `openrouter`, `Anthropic`). */
  provider?: string;
  profileId?: string;
  /** Адрес без логина, пароля, query и fragment. */
  endpoint?: string;
  model?: string;
  local?: boolean;
  /** Усилие рассуждений, отправленное в запросе, — для совета при отказе модели. */
  reasoningEffort?: string;
  /** Сообщение сервера или сетевой ошибки: извлечено из тела, без ключей, до 500 символов. */
  serverMessage?: string;
  /** Итоговое сообщение для пользователя, логов и экспорта (ru, main-процесс). */
  message: string;
}

/** Контекст запроса: кто, куда и с какими настройками. */
export interface ProviderErrorContext {
  provider?: string;
  profileId?: string;
  endpoint?: string;
  model?: string;
  local?: boolean;
  /** В запросе были `tools` — отказ с упоминанием инструментов относится к ним. */
  toolsSent?: boolean;
  /** Отправленное усилие рассуждений (decision-41). */
  reasoningEffort?: string;
  /** Значения, которые нельзя показывать: ключи и заголовки авторизации. */
  secrets?: readonly string[];
}

export interface HttpErrorInput {
  status?: number;
  body?: string;
  /** Заголовки ответа: `Headers` или обычный объект. */
  headers?: { get(name: string): string | null } | Record<string, string | undefined>;
}

/** Ошибка провайдера со снимком: `message` — готовый текст для пользователя. */
export class ProviderError extends Error {
  readonly info: ProviderErrorInfo;

  constructor(info: ProviderErrorInfo, options?: { cause?: unknown }) {
    super(info.message, options);
    this.name = 'ProviderError';
    this.info = info;
  }
}

/** Снимок ошибки, если это ошибка провайдера (в том числе пересланная через IPC как объект). */
export function providerErrorInfoOf(err: unknown): ProviderErrorInfo | undefined {
  if (err instanceof ProviderError) return err.info;
  if (err && typeof err === 'object' && 'info' in err) {
    const info = (err as { info?: unknown }).info;
    if (isProviderErrorInfo(info)) return info;
  }
  return undefined;
}

export function isProviderErrorInfo(value: unknown): value is ProviderErrorInfo {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ProviderErrorInfo>;
  return typeof v.kind === 'string' && (PROVIDER_ERROR_KINDS as readonly string[]).includes(v.kind) && typeof v.message === 'string';
}

// ─────────────────────────────── Очистка ───────────────────────────────

const MAX_SERVER_MESSAGE = 500;
const MIN_SECRET_LENGTH = 6;

/** Адрес без логина, пароля, query и fragment; неразборчивый адрес — без изменений, но без `?…`. */
export function safeEndpoint(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return url.trim().replace(/[?#].*$/, '');
  }
}

/** Значения заголовков авторизации — чтобы вырезать их из ответа сервера. */
export function secretsFromHeaders(headers: Record<string, string> | undefined): string[] {
  if (!headers) return [];
  const out: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') continue;
    if (!/^(authorization|x-api-key|api-key|proxy-authorization)$/i.test(name) && !/(token|secret|key)/i.test(name)) continue;
    const raw = value.replace(/^\s*(Bearer|Basic|Token)\s+/i, '').trim();
    if (raw.length >= MIN_SECRET_LENGTH) out.push(raw);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Вырезает ключи из текста: известные значения, `Bearer …` и типовые префиксы ключей
 * (`sk-`, `sk-ant-`, `sk-or-`, `gsk_`, `xai-`). Замаскированные сервером ключи (`sk-inval****-key`)
 * не трогаются — в них нет длинного непрерывного хвоста.
 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= MIN_SECRET_LENGTH) out = out.replace(new RegExp(escapeRegExp(secret), 'g'), '***');
  }
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***');
  out = out.replace(/\b(sk-ant-|sk-or-v1-|sk-or-|sk-proj-|sk-|gsk_|xai-)[A-Za-z0-9_-]{12,}/g, '$1***');
  return out;
}

// ─────────────────────────────── Разбор тела ───────────────────────────────

interface ParsedBody {
  message?: string;
  /** `error.type` (OpenAI, Anthropic, Ollama) — `not_found_error`, `insufficient_quota`… */
  type?: string;
  /** `error.code` строкой — `invalid_api_key`, `context_length_exceeded`… */
  code?: string;
  /** Числовой `error.code` (OpenRouter дублирует HTTP-статус, в том числе внутри потока). */
  numericCode?: number;
}

function pickString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Ошибка из JSON: `{error: {message, type, code}}`, `{error: "…"}`, `{detail: …}`, `{message: …}`. */
export function parseErrorPayload(payload: unknown): ParsedBody {
  if (!payload || typeof payload !== 'object') return {};
  const root = payload as Record<string, unknown>;
  const err = root.error;
  if (typeof err === 'string') return { message: err.trim() };
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    // OpenRouter кладёт ответ апстрима в metadata.raw — он часто точнее общего сообщения.
    const raw = e.metadata && typeof e.metadata === 'object' ? pickString((e.metadata as Record<string, unknown>).raw) : undefined;
    const message = pickString(e.message) ?? raw;
    return {
      ...(message ? { message: raw && message !== raw && raw.length < 300 ? `${message} (${raw})` : message } : {}),
      ...(pickString(e.type) ? { type: pickString(e.type) } : {}),
      ...(typeof e.code === 'string' && e.code.trim() ? { code: e.code.trim() } : {}),
      ...(typeof e.code === 'number' && Number.isFinite(e.code) ? { numericCode: e.code } : {})
    };
  }
  const detail = root.detail;
  if (typeof detail === 'string') return { message: detail.trim() };
  if (Array.isArray(detail)) {
    const msgs = detail.map((d) => (d && typeof d === 'object' ? pickString((d as Record<string, unknown>).msg) : pickString(d))).filter(Boolean);
    if (msgs.length > 0) return { message: msgs.join('; ') };
  }
  const message = pickString(root.message);
  return message ? { message, ...(pickString(root.type) ? { type: pickString(root.type) } : {}) } : {};
}

/** Тело ответа: JSON → поля ошибки, HTML → `<title>`, иначе текст. */
export function parseErrorBody(body: string | undefined): ParsedBody {
  const text = (body ?? '').trim();
  if (!text) return {};
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = parseErrorPayload(JSON.parse(text));
      if (parsed.message || parsed.type || parsed.code) return parsed;
    } catch {
      // не JSON — ниже как текст
    }
  }
  if (/^<!doctype html|^<html/i.test(text)) {
    const title = /<title>([^<]*)<\/title>/i.exec(text)?.[1]?.trim();
    return { message: title || 'HTML-страница вместо ответа API' };
  }
  return { message: text.replace(/\s+/g, ' ') };
}

function clip(text: string, max = MAX_SERVER_MESSAGE): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ─────────────────────────────── Retry-After ───────────────────────────────

function headerValue(headers: HttpErrorInput['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  }
  const rec = headers as Record<string, string | undefined>;
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? rec[key] : undefined;
}

/** `Retry-After`: секунды или HTTP-дата. */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  if (Number.isFinite(at)) return Math.max(0, at - now);
  return undefined;
}

/** «Please try again in 7.66s / 120ms / 1m30s» (OpenAI, Groq) — если заголовка нет. */
export function retryAfterFromText(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = /try again in\s+(?:(\d+(?:\.\d+)?)m(?!s))?\s*(?:(\d+(?:\.\d+)?)(ms|s))?/i.exec(text);
  if (!m || (!m[1] && !m[2])) return undefined;
  const minutes = m[1] ? Number(m[1]) * 60_000 : 0;
  const rest = m[2] ? Number(m[2]) * (m[3]?.toLowerCase() === 'ms' ? 1 : 1000) : 0;
  const total = Math.round(minutes + rest);
  return total > 0 ? total : undefined;
}

// ─────────────────────────────── Классификация ───────────────────────────────

const MODEL_NOT_FOUND_RE =
  /model[^\n]{0,160}?\b(not found|does not exist|doesn't exist|not exist|is not available|not available|is not a valid model)|\b(invalid|unknown|no such) model\b|not a valid model|model_not_found/i;
const CONTEXT_RE =
  /context[_ ]length|maximum context|context window|context size|too many tokens|prompt is too long|input is too long|reduce the length|exceeds? the (model'?s? )?(max(imum)?|context)|token limit|request_too_large/i;
const TOOLS_RE = /does not support tools|tools? (use )?(is|are) not supported|tool_choice|function calling is not supported|does not support function/i;
const REASONING_RE = /reason|think|effort/i;
const UNSUPPORTED_RE = /does not support (chat|generate|completion|completions)|not a chat model|embedding model|only supports embeddings/i;
const MODERATION_RE = /moderat|flagged|content policy|safety system/i;
const QUOTA_RE = /insufficient[_ ]quota|exceeded your current quota|insufficient[_ ]balance|insufficient credits|requires more credits|billing|credit balance|out of credits|payment required/i;
const AUTH_TEXT_RE = /invalid[_ ]api[_ ]key|incorrect api key|api key is invalid|authentication fails|no auth credentials|missing authentication|unauthori[sz]ed|x-api-key header is required/i;

function classifyByServerType(type: string | undefined, code: string | undefined): { kind: ProviderErrorKind; reason?: ProviderErrorReason } | undefined {
  const t = `${type ?? ''} ${code ?? ''}`.toLowerCase();
  if (/insufficient_quota|billing_error|insufficient_balance/.test(t)) return { kind: 'quota' };
  if (/authentication_error|invalid_api_key|permission_error/.test(t)) {
    return /permission_error/.test(t) ? { kind: 'auth', reason: 'forbidden' } : { kind: 'auth' };
  }
  if (/rate_limit/.test(t)) return { kind: 'rate_limit' };
  if (/overloaded_error/.test(t)) return { kind: 'unavailable', reason: 'overloaded' };
  if (/context_length_exceeded|request_too_large/.test(t)) return { kind: 'bad_request', reason: 'context' };
  if (/model_not_found/.test(t)) return { kind: 'model_not_found' };
  if (/\bapi_error\b|server_error/.test(t)) return { kind: 'unavailable', reason: 'server' };
  return undefined;
}

/** Вид ошибки по статусу и тексту; статус может отсутствовать (ошибка внутри потока). */
function classifyHttp(
  status: number | undefined,
  parsed: ParsedBody,
  ctx: ProviderErrorContext
): { kind: ProviderErrorKind; reason?: ProviderErrorReason } {
  const text = [parsed.message, parsed.type, parsed.code].filter(Boolean).join(' ');

  // Отказы, которые у разных серверов приходят с разными статусами, — сначала по тексту.
  if (status === 402 || QUOTA_RE.test(text)) return { kind: 'quota' };
  if (status === 401 || AUTH_TEXT_RE.test(text)) return { kind: 'auth' };
  if (status === 403) return MODERATION_RE.test(text) ? { kind: 'bad_request', reason: 'moderation' } : { kind: 'auth', reason: 'forbidden' };
  if (status === 429) return { kind: 'rate_limit' };
  if (status === 413 || CONTEXT_RE.test(text)) return { kind: 'bad_request', reason: 'context' };

  const byType = classifyByServerType(parsed.type, parsed.code);
  if (byType && byType.kind !== 'model_not_found') return byType;

  if (status === 408) return { kind: 'unavailable', reason: 'timeout' };
  if (status === 529) return { kind: 'unavailable', reason: 'overloaded' };
  if (status !== undefined && status >= 500) return { kind: 'unavailable', reason: 'server' };

  // Anthropic: 404 not_found_error с сообщением «model: <id>».
  const anthropicModel = parsed.type === 'not_found_error' && /^model:/i.test(parsed.message ?? '');
  if (byType?.kind === 'model_not_found' || anthropicModel || MODEL_NOT_FOUND_RE.test(text)) return { kind: 'model_not_found' };

  if (ctx.toolsSent !== false && TOOLS_RE.test(text)) return { kind: 'bad_request', reason: 'tools' };
  if (ctx.reasoningEffort && REASONING_RE.test(text)) return { kind: 'bad_request', reason: 'reasoning' };
  if (UNSUPPORTED_RE.test(text)) return { kind: 'bad_request', reason: 'unsupported' };
  if (MODERATION_RE.test(text) && status !== undefined && status < 500) return { kind: 'bad_request', reason: 'moderation' };

  // 404 без упоминания модели — неверный адрес (обычно baseUrl без `/v1`).
  if (status === 404) return { kind: 'config', reason: 'endpoint' };
  if (status !== undefined && status >= 400) return { kind: 'bad_request' };
  return { kind: 'unknown' };
}

function isRetryable(kind: ProviderErrorKind, reason?: ProviderErrorReason): boolean {
  if (kind === 'rate_limit') return true;
  if (kind === 'unavailable') return reason !== 'dns' && reason !== 'tls';
  return false;
}

function baseInfo(ctx: ProviderErrorContext): Omit<ProviderErrorInfo, 'kind' | 'retryable' | 'message'> {
  return {
    ...(ctx.provider ? { provider: ctx.provider } : {}),
    ...(ctx.profileId ? { profileId: ctx.profileId } : {}),
    ...(safeEndpoint(ctx.endpoint) ? { endpoint: safeEndpoint(ctx.endpoint) } : {}),
    ...(ctx.model ? { model: ctx.model } : {}),
    ...(typeof ctx.local === 'boolean' ? { local: ctx.local } : {}),
    ...(ctx.reasoningEffort ? { reasoningEffort: ctx.reasoningEffort } : {})
  };
}

function finish(partial: Omit<ProviderErrorInfo, 'retryable' | 'message'>): ProviderErrorInfo {
  const info: ProviderErrorInfo = { ...partial, retryable: isRetryable(partial.kind, partial.reason), message: '' };
  info.message = formatProviderErrorMessage(info);
  return info;
}

/** Ответ с HTTP-статусом не 2xx. */
export function classifyHttpError(input: HttpErrorInput, ctx: ProviderErrorContext = {}): ProviderErrorInfo {
  const parsed = parseErrorBody(input.body);
  const { kind, reason } = classifyHttp(input.status, parsed, ctx);
  const serverMessage = parsed.message ? clip(redactSecrets(parsed.message, ctx.secrets)) : undefined;
  const retryAfterMs =
    kind === 'rate_limit' || kind === 'unavailable'
      ? parseRetryAfter(headerValue(input.headers, 'retry-after')) ?? retryAfterFromText(parsed.message)
      : undefined;
  return finish({
    kind,
    ...(reason ? { reason } : {}),
    ...(typeof input.status === 'number' ? { status: input.status } : {}),
    ...(parsed.code || parsed.type ? { code: parsed.code ?? parsed.type } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...baseInfo(ctx),
    ...(serverMessage ? { serverMessage } : {})
  });
}

/**
 * Ошибка внутри SSE-потока при статусе 200: `data: {"error": {...}}` (OpenRouter, Ollama) или событие
 * Anthropic `{"type":"error","error":{...}}`. `undefined` — в чанке ошибки нет.
 */
export function classifyStreamError(payload: unknown, ctx: ProviderErrorContext = {}): ProviderErrorInfo | undefined {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return undefined;
  const errField = (payload as { error?: unknown }).error;
  if (errField === null || errField === undefined || errField === false) return undefined;
  const parsed = parseErrorPayload(payload);
  const status = parsed.numericCode !== undefined && parsed.numericCode >= 400 && parsed.numericCode < 600 ? parsed.numericCode : undefined;
  return classifyHttpError({ status, body: JSON.stringify(payload) }, ctx);
}

const NETWORK_CODES: Array<[RegExp, ProviderErrorReason]> = [
  [/^ECONNREFUSED$/, 'refused'],
  [/^(ENOTFOUND|EAI_AGAIN|EAI_NONAME)$/, 'dns'],
  [/^(ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/, 'timeout'],
  [/CERT|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL|EPROTO/, 'tls'],
  [/^(ECONNRESET|EPIPE|EHOSTUNREACH|ENETUNREACH|ENETDOWN|UND_ERR_SOCKET|UND_ERR_CLOSED)$/, 'network']
];

function networkCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur && typeof cur === 'object'; depth++) {
    const c = cur as { code?: unknown; errors?: unknown; cause?: unknown };
    if (typeof c.code === 'string' && c.code) return c.code;
    // localhost резолвится в ::1 и 127.0.0.1 — undici отдаёт AggregateError с кодом у вложенных.
    if (Array.isArray(c.errors)) {
      const inner = c.errors.map((e) => (e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined)).find((x) => typeof x === 'string');
      if (typeof inner === 'string') return inner;
    }
    cur = c.cause;
  }
  return undefined;
}

/** Текст сетевой ошибки: причина (`connect ECONNREFUSED 127.0.0.1:11434`) вместо общего «fetch failed». */
function errorText(err: unknown, code: string | undefined): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause;
  if (cause instanceof Error) {
    if (cause.message) return cause.message;
    // AggregateError (localhost → ::1 и 127.0.0.1) без своего текста — тексты вложенных ошибок.
    const inner = (cause as { errors?: unknown }).errors;
    if (Array.isArray(inner)) {
      const msgs = [...new Set(inner.map((e) => (e instanceof Error ? e.message : '')).filter(Boolean))];
      if (msgs.length > 0) return msgs.join('; ');
    }
  }
  return code ? `${err.message} (${code})` : err.message;
}

/**
 * Сетевая ошибка `fetch` (`TypeError: fetch failed` с `cause.code`), таймаут (`TimeoutError`) или обрыв
 * потока (`terminated`). `undefined` — это не сетевая ошибка (отмена пользователем, ошибка кода).
 */
export function classifyNetworkError(err: unknown, ctx: ProviderErrorContext = {}): ProviderErrorInfo | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { name?: unknown; message?: unknown };
  if (e.name === 'AbortError') return undefined;
  const code = networkCode(err);
  let reason: ProviderErrorReason | undefined;
  if (e.name === 'TimeoutError') reason = 'timeout';
  if (code) reason = NETWORK_CODES.find(([re]) => re.test(code))?.[1] ?? reason;
  const isFetchFailure = e.name === 'TypeError' && typeof e.message === 'string' && /fetch failed|terminated|network/i.test(e.message);
  if (!reason && !isFetchFailure) return undefined;
  return finish({
    kind: 'unavailable',
    reason: reason ?? 'network',
    ...(code ? { code } : {}),
    ...baseInfo(ctx),
    serverMessage: clip(redactSecrets(errorText(err, code), ctx.secrets))
  });
}

/** Модель не ответила за отведённое время (таймаут `complete()`). */
export function timeoutError(timeoutMs: number, ctx: ProviderErrorContext = {}): ProviderErrorInfo {
  return finish({
    kind: 'unavailable',
    reason: 'timeout',
    ...baseInfo(ctx),
    serverMessage: `нет ответа за ${Math.round(timeoutMs / 100) / 10} с`
  });
}

/**
 * Ошибка настройки до запроса: модель не выбрана, нет профиля или ключа, неизвестный провайдер.
 * `message` остаётся текстом вызывающего кода — он уже говорит, что сделать.
 */
export function providerConfigError(message: string, reason?: ProviderErrorReason, ctx: ProviderErrorContext = {}): ProviderError {
  const info: ProviderErrorInfo = {
    kind: 'config',
    ...(reason ? { reason } : {}),
    retryable: false,
    ...baseInfo(ctx),
    message
  };
  return new ProviderError(info);
}

/**
 * Снимок для любой ошибки запроса к модели: ошибка провайдера как есть, сетевая — по коду, остальное —
 * `unknown` с текстом ошибки. `undefined` — отмена (AbortError): это не ошибка провайдера.
 */
export function toProviderErrorInfo(err: unknown, ctx: ProviderErrorContext = {}): ProviderErrorInfo | undefined {
  const known = providerErrorInfoOf(err);
  if (known) return known;
  if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError') return undefined;
  const network = classifyNetworkError(err, ctx);
  if (network) return network;
  const text = redactSecrets(err instanceof Error ? err.message : String(err), ctx.secrets);
  return { kind: 'unknown', retryable: false, ...baseInfo(ctx), message: text };
}

// ─────────────────────────────── Сообщение ───────────────────────────────

const WHAT_RU: Record<ProviderErrorKind, string> = {
  auth: 'нет доступа: ключ не принят',
  quota: 'исчерпан баланс или квота',
  model_not_found: 'модель не найдена',
  rate_limit: 'превышен лимит запросов',
  unavailable: 'сервер недоступен',
  bad_request: 'сервер отклонил запрос',
  config: 'ошибка настройки',
  unknown: 'ошибка запроса'
};

const REASON_WHAT_RU: Partial<Record<ProviderErrorReason, string>> = {
  forbidden: 'доступ запрещён',
  tools: 'модель не поддерживает вызов инструментов',
  reasoning: 'модель не приняла усилие рассуждений',
  context: 'запрос не помещается в контекст модели',
  unsupported: 'модель не поддерживает этот режим',
  moderation: 'запрос отклонён модерацией',
  refused: 'сервер не принимает подключения',
  dns: 'адрес сервера не найден',
  timeout: 'сервер не ответил вовремя',
  tls: 'ошибка TLS-сертификата',
  network: 'обрыв сетевого соединения',
  overloaded: 'сервис перегружен',
  endpoint: 'адрес API не найден'
};

function seconds(ms: number): string {
  const s = ms / 1000;
  return s >= 10 ? `${Math.round(s)} с` : `${Math.round(s * 10) / 10} с`;
}

/** Совет «что сделать» (ru) — тот же набор, что в i18n renderer (`providerErrors.advice`). */
export function providerErrorAdviceRu(info: ProviderErrorInfo): string {
  const profile = info.provider ? `«${info.provider}»` : '';
  const model = info.model ? `«${info.model}»` : '';
  switch (info.kind) {
    case 'auth':
      return info.reason === 'forbidden'
        ? `У ключа нет доступа к этой модели или сервису: проверьте права ключа и регион у провайдера ${profile}.`.replace(/\s+:/, ':')
        : info.profileId
          ? `Проверьте API-ключ профиля ${profile} в настройках AI Studio → «Профили провайдеров».`.replace(/\s{2,}/g, ' ')
          : `Проверьте API-ключ провайдера ${profile} в настройках AI Studio.`.replace(/\s{2,}/g, ' ');
    case 'quota':
      return 'Пополните баланс или проверьте лимиты тарифа у провайдера. Другая модель того же провайдера, скорее всего, не поможет.';
    case 'model_not_found':
      return info.local
        ? `Загрузите модель (\`ollama pull ${info.model ?? '<модель>'}\`) или выберите установленную; обновите каталог моделей профиля.`
        : `Обновите каталог моделей профиля и выберите модель из списка; проверьте id модели ${model}.`.replace(/\s+;/, ';').replace(/\s+\./, '.');
    case 'rate_limit':
      return `${info.retryAfterMs !== undefined ? `Подождите ${seconds(info.retryAfterMs)} и повторите` : 'Подождите и повторите'}; при частых отказах уменьшите число параллельных слотов или выберите другую модель.`;
    case 'unavailable':
      switch (info.reason) {
        case 'refused':
          return info.local
            ? 'Запустите локальный сервер (Ollama, LM Studio…) и проверьте порт в адресе профиля.'
            : 'Проверьте адрес и порт в профиле: сервер не принимает подключения.';
        case 'dns':
          return 'Проверьте адрес профиля и подключение к сети.';
        case 'timeout':
          return info.local
            ? 'Проверьте, что сервер запущен; большая модель может долго загружаться в память — повторите запрос.'
            : 'Проверьте подключение к сети и повторите запрос.';
        case 'tls':
          return 'Проверьте схему адреса (http/https) и сертификат сервера.';
        default:
          return 'Сервис временно недоступен — повторите позже или выберите другую модель.';
      }
    case 'bad_request':
      switch (info.reason) {
        case 'tools':
          return 'Для режима агента выберите модель с tool calling или выключите флаг tools в профиле.';
        case 'reasoning':
          return (
            `Выберите другой уровень${info.reasoningEffort ? ` вместо «${info.reasoningEffort}»` : ''} или «по умолчанию модели» в настройках ` +
            'AI Studio или слота, либо поменяйте формат усилия в профиле провайдера.'
          );
        case 'context':
          return 'Начните новый чат, сократите контекст задачи или выберите модель с большим окном контекста.';
        case 'unsupported':
          return 'Выберите модель для чата (например, не эмбеддинг-модель).';
        case 'moderation':
          return 'Переформулируйте запрос или выберите другую модель.';
        default:
          return 'Проверьте параметры запроса и флаги совместимости профиля.';
      }
    case 'config':
      return info.reason === 'endpoint'
        ? 'Проверьте адрес профиля: у OpenAI-совместимых серверов он обычно заканчивается на /v1.'
        : '';
    default:
      return '';
  }
}

/** Заголовок «что случилось» (ru). */
export function providerErrorWhatRu(info: ProviderErrorInfo): string {
  return (info.reason && REASON_WHAT_RU[info.reason]) || WHAT_RU[info.kind];
}

/**
 * Сообщение для пользователя, логов и экспорта: «Провайдер «X» (адрес), модель «m»: что случилось (HTTP s).
 * Что сделать: … Ответ сервера: …». Ошибка настройки — текст вызывающего кода как есть.
 */
export function formatProviderErrorMessage(info: ProviderErrorInfo): string {
  if (info.kind === 'config' && info.message && info.reason !== 'endpoint') return info.message;
  const where = [
    info.provider ? `Провайдер «${info.provider}»` : 'Провайдер',
    info.endpoint ? ` (${info.endpoint})` : '',
    info.model ? `, модель «${info.model}»` : ''
  ].join('');
  const tech = info.status !== undefined ? `HTTP ${info.status}` : info.code ?? '';
  const advice = providerErrorAdviceRu(info);
  return [
    `${where}: ${providerErrorWhatRu(info)}${tech ? ` (${tech})` : ''}.`,
    advice ? ` Что сделать: ${advice}` : '',
    info.serverMessage ? ` Ответ сервера: ${info.serverMessage}` : ''
  ].join('');
}

/** Короткая строка для экспорта и логов: `rate_limit (HTTP 429, повтор через 20 с, можно повторить)`. */
export function describeProviderErrorBrief(info: ProviderErrorInfo): string {
  const parts: string[] = [];
  if (info.status !== undefined) parts.push(`HTTP ${info.status}`);
  if (info.code) parts.push(`код ${info.code}`);
  if (info.retryAfterMs !== undefined) parts.push(`повтор через ${seconds(info.retryAfterMs)}`);
  parts.push(info.retryable ? 'можно повторить' : 'повтор без изменения настроек не поможет');
  return `${info.kind}${info.reason ? `/${info.reason}` : ''} (${parts.join(', ')})`;
}
