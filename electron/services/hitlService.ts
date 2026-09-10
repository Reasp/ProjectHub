import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { appEventBus } from './eventBus.js';
import { HitlAuditLog, commandPreview, hashCommand, truncateComment } from './hitlAudit.js';
import type {
  ApprovalResponse,
  HitlAuditEntry,
  HitlAuditQuery,
  HitlDecideResult,
  HitlDecisionSource,
  HitlEngine,
  HitlOrigin,
  HitlOutcome,
  HitlRequest
} from './hitlTypes.js';

/**
 * Единый HITL-контур (TASK-57, decision-10).
 *
 * Все агенты ProjectHub (AI Studio, Swarm, Handoff, назначенные задачи, API-движок) кладут
 * запросы на решение человека сюда. Очередь адресуется строго по `requestId`: локальный UI,
 * Remote Control, Telegram и внешние MCP-клиенты вызывают один и тот же `decide()`, первый
 * ответ выигрывает, остальные получают `already_decided`.
 *
 * - Персистентность: `<userData>/hitl/pending.json`. После перезапуска записи восстанавливаются
 *   как `orphaned` (агент уже не ждёт ответа): они видны в панели, истекают по таймауту и
 *   попадают в аудит, но ничего не выполняют.
 * - Таймаут: по умолчанию 24 часа (как MCP_TOOL_TIMEOUT для Claude CLI), решение `deny`.
 * - Отмена: `cancelSession()` при завершении/прерывании сессии, `shutdown()` при выходе.
 * - Аудит: `<userData>/audit/hitl-<yyyy-mm>.jsonl` через {@link HitlAuditLog}.
 * - События: `hitl:requested|decided|expired|cancelled|fallback` в {@link appEventBus} и
 *   те же имена на самом сервисе (EventEmitter).
 *
 * До `init()` сервис работает только в памяти (unit-тесты, окружения без userData).
 */

export const HITL_DEFAULT_TIMEOUT_MS = 24 * 60 * 60_000;
export const HITL_MIN_TIMEOUT_MS = 10_000;
/** Ограничение setTimeout в Node (2^31-1 мс ≈ 24.8 дня). */
const MAX_TIMER_MS = 2_147_483_647;
export const HITL_PENDING_FILE = 'pending.json';
export const HITL_PENDING_VERSION = 1;
/** Сколько последних решений держим в памяти, чтобы отличать «уже решено» от «не найдено». */
const DECIDED_MEMORY_LIMIT = 1000;
/** Лимит текста диффа при сохранении очереди на диск. */
const PERSIST_DIFF_LIMIT = 50_000;

/** Ожидание одобрения прервано (abortSession/clearSession/закрытие окна), а не отклонено пользователем. */
export class ApprovalCancelledError extends Error {
  constructor(message = 'Сессия прервана: ожидание одобрения отменено') {
    super(message);
    this.name = 'ApprovalCancelledError';
  }
}

interface PendingEntry {
  request: HitlRequest;
  resolve?: (response: ApprovalResponse) => void;
  reject?: (err: Error) => void;
  timer?: NodeJS.Timeout;
}

interface DecidedEntry {
  request: HitlRequest;
  approved: boolean;
  source: HitlDecisionSource;
  at: number;
}

export interface HitlServiceOptions {
  hostId?: string;
  defaultTimeoutMs?: number;
  now?: () => number;
}

export interface HitlInitOptions {
  /** Каталог очереди (`<userData>/hitl`). */
  dir: string;
  /** Каталог аудита (`<userData>/audit`). */
  auditDir: string;
}

export interface HitlRequestOptions {
  timeoutMs?: number;
}

/** Данные для аудита авто-решения или fallback — то же, что запрос, но без обязательного id. */
export type HitlAutoDecisionInfo = Omit<HitlRequest, 'id' | 'createdAt' | 'expiresAt' | 'orphaned'> & { id?: string };

export interface HitlFallbackInfo {
  sessionId: string;
  projectPath: string;
  origin: HitlOrigin;
  engine: HitlEngine;
  agentId?: string;
  agentName?: string;
  role?: string;
  reason: string;
}

interface PendingFile {
  version: number;
  savedAt: number;
  hostId: string;
  requests: HitlRequest[];
}

function truncateText(value: string | undefined, limit: number): string {
  if (typeof value !== 'string') return '';
  return value.length <= limit ? value : `${value.slice(0, limit)}\n…[усечено при сохранении]`;
}

function compactForDisk(request: HitlRequest): HitlRequest {
  const out: HitlRequest = { ...request };
  if (request.diff) {
    out.diff = {
      filePath: request.diff.filePath,
      oldContent: truncateText(request.diff.oldContent, PERSIST_DIFF_LIMIT),
      newContent: truncateText(request.diff.newContent, PERSIST_DIFF_LIMIT),
      patch: truncateText(request.diff.patch, PERSIST_DIFF_LIMIT)
    };
  }
  return out;
}

export class HitlService extends EventEmitter {
  private pending = new Map<string, PendingEntry>();
  private decided = new Map<string, DecidedEntry>();
  private dir: string | null = null;
  private audit: HitlAuditLog | null = null;
  private persistChain: Promise<void> = Promise.resolve();
  private hostId: string;
  private defaultTimeoutMs: number;
  private now: () => number;
  /** После shutdown() сервис инертен: очередь на диске не трогается, новые решения не принимаются. */
  private closed = false;

  constructor(options: HitlServiceOptions = {}) {
    super();
    this.setMaxListeners(30);
    this.hostId = options.hostId || os.hostname();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? HITL_DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
  }

  public configure(options: HitlServiceOptions): void {
    if (options.hostId) this.hostId = options.hostId;
    if (typeof options.defaultTimeoutMs === 'number' && options.defaultTimeoutMs > 0) {
      this.defaultTimeoutMs = options.defaultTimeoutMs;
    }
    if (options.now) this.now = options.now;
  }

  public get currentHostId(): string {
    return this.hostId;
  }

  public get auditDirectory(): string | null {
    return this.audit?.directory ?? null;
  }

  public get queueDirectory(): string | null {
    return this.dir;
  }

  public newRequestId(prefix = 'appr'): string {
    return `${prefix}-${this.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Включает персистентность и аудит, восстанавливает очередь с диска. Восстановленные запросы
   * помечаются `orphaned`; просроченные сразу закрываются как `timeout`.
   */
  public async init(options: HitlInitOptions): Promise<HitlRequest[]> {
    this.dir = options.dir;
    this.audit = new HitlAuditLog(options.auditDir);
    const restored: HitlRequest[] = [];
    let file: PendingFile | null = null;
    try {
      const raw = await fs.readFile(path.join(this.dir, HITL_PENDING_FILE), 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.requests)) file = parsed as PendingFile;
    } catch {
      file = null;
    }
    if (!file) return restored;

    for (const raw of file.requests) {
      if (!raw || typeof raw.id !== 'string' || typeof raw.sessionId !== 'string') continue;
      if (this.pending.has(raw.id)) continue;
      const request: HitlRequest = { ...raw, orphaned: true };
      if (typeof request.expiresAt === 'number' && request.expiresAt <= this.now()) {
        this.pending.set(request.id, { request });
        this.expire(request.id);
        continue;
      }
      const entry: PendingEntry = { request };
      this.pending.set(request.id, entry);
      this.armTimer(entry);
      restored.push(request);
    }
    if (restored.length > 0) {
      console.warn(`[HITL] Восстановлено ${restored.length} запросов без активного агента (после перезапуска).`);
    }
    this.schedulePersist();
    return restored;
  }

  // ─────────────────────────────── Очередь ───────────────────────────────

  /** Ставит запрос в очередь и ждёт решения. Отмена сессии → reject {@link ApprovalCancelledError}. */
  public request(input: HitlRequest, options: HitlRequestOptions = {}): Promise<ApprovalResponse> {
    const createdAt = typeof input.createdAt === 'number' ? input.createdAt : this.now();
    const timeoutMs = this.normalizeTimeout(options.timeoutMs);
    const request: HitlRequest = {
      ...input,
      id: input.id || this.newRequestId(),
      createdAt,
      hostId: input.hostId || this.hostId,
      expiresAt: input.expiresAt ?? createdAt + timeoutMs,
      orphaned: false
    };
    if (this.closed) {
      return Promise.reject(new ApprovalCancelledError('Приложение закрывается'));
    }
    if (this.pending.has(request.id)) {
      return Promise.reject(new Error(`HITL: запрос ${request.id} уже в очереди`));
    }
    return new Promise<ApprovalResponse>((resolve, reject) => {
      const entry: PendingEntry = { request, resolve, reject };
      this.pending.set(request.id, entry);
      this.armTimer(entry);
      this.schedulePersist();
      this.emit('requested', request);
      appEventBus.publish({ type: 'hitl:requested', request });
    });
  }

  /**
   * Единая точка решения для всех источников (UI, Remote Control, MCP-клиент). Первый ответ
   * выигрывает; повторный по тому же `requestId` получает `already_decided`.
   */
  public decide(requestId: string, response: ApprovalResponse, source: HitlDecisionSource): HitlDecideResult {
    const entry = this.closed ? undefined : this.pending.get(requestId);
    if (!entry) {
      return { ok: false, reason: this.decided.has(requestId) ? 'already_decided' : 'not_found' };
    }
    this.remove(requestId);
    const approved = Boolean(response.approved);
    this.rememberDecided(entry.request, approved, source);
    this.writeDecision(entry.request, approved ? 'allow' : 'deny', source, response.text, entry.request.orphaned ? 'session_gone' : undefined);
    entry.resolve?.(response);
    const comment = response.text;
    this.emit('decided', { request: entry.request, approved, source, comment });
    appEventBus.publish({ type: 'hitl:decided', request: entry.request, approved, source, comment });
    return { ok: true, request: entry.request };
  }

  /** Отменяет все ожидающие запросы сессии (агент завершён/прерван). Возвращает отменённые. */
  public cancelSession(sessionId: string, reason?: string): HitlRequest[] {
    return this.cancelWhere((req) => req.sessionId === sessionId, reason, 'cancelled');
  }

  /** Отменяет все ожидающие запросы (все сессии). */
  public cancelAll(reason?: string): HitlRequest[] {
    return this.cancelWhere(() => true, reason, 'cancelled');
  }

  /**
   * Завершение приложения: промисы отклоняются, но записи остаются на диске как `orphaned`,
   * чтобы после перезапуска попасть в панель и аудит.
   */
  public async shutdown(reason = 'Приложение закрывается'): Promise<void> {
    if (this.closed) return;
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.request.orphaned = true;
      const reject = entry.reject;
      entry.resolve = undefined;
      entry.reject = undefined;
      reject?.(new ApprovalCancelledError(reason));
    }
    await this.persistNow();
    await this.audit?.flush();
    this.closed = true;
  }

  public listPending(filter: { sessionId?: string; projectPath?: string } = {}): HitlRequest[] {
    const out: HitlRequest[] = [];
    for (const entry of this.pending.values()) {
      const r = entry.request;
      if (filter.sessionId && r.sessionId !== filter.sessionId) continue;
      if (filter.projectPath && r.projectPath !== filter.projectPath) continue;
      out.push(r);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  public getPending(requestId: string): HitlRequest | undefined {
    return this.pending.get(requestId)?.request;
  }

  public pendingCount(sessionId?: string): number {
    if (!sessionId) return this.pending.size;
    let n = 0;
    for (const entry of this.pending.values()) if (entry.request.sessionId === sessionId) n++;
    return n;
  }

  // ─────────────────────────────── Аудит ───────────────────────────────

  /** Записывает авто-решение политики (без карточки). Возвращает id для корреляции с результатом. */
  public recordAutoDecision(info: HitlAutoDecisionInfo, decision: 'allow' | 'deny', rule: string, detail?: string): string {
    const id = info.id || this.newRequestId('auto');
    const request: HitlRequest = { ...info, id, createdAt: this.now(), hostId: info.hostId || this.hostId };
    this.rememberDecided(request, decision === 'allow', { kind: 'auto', rule });
    this.writeDecision(request, decision, { kind: 'auto', rule }, undefined, undefined, detail);
    return id;
  }

  /** Результат выполнения одобренного действия (exit-код команды, ошибка записи и т.п.). */
  public recordOutcome(requestId: string, outcome: HitlOutcome, detail?: string): void {
    const known = this.decided.get(requestId);
    if (!known) return;
    const base = this.auditBase(known.request);
    void this.audit?.append({ ...base, ts: new Date(this.now()).toISOString(), kind: 'outcome', outcome, detail: detail ? truncateComment(detail, 300) : undefined });
  }

  /** Запуск агента без HITL (`--dangerously-skip-permissions`) — обязательно в аудит и в шину. */
  public recordFallback(info: HitlFallbackInfo): void {
    const at = this.now();
    const entry: HitlAuditEntry = {
      ts: new Date(at).toISOString(),
      kind: 'fallback',
      requestId: this.newRequestId('fallback'),
      sessionId: info.sessionId,
      projectPath: info.projectPath,
      hostId: this.hostId,
      origin: info.origin,
      engine: info.engine,
      agentId: info.agentId,
      agentName: info.agentName,
      role: info.role,
      detail: truncateComment(info.reason, 300)
    };
    void this.audit?.append(entry);
    console.warn(`[HITL] fallback без проверки разрешений: сессия ${info.sessionId} (${info.origin}/${info.engine}): ${info.reason}`);
    const event = { type: 'hitl:fallback' as const, ...info, at };
    this.emit('fallback', event);
    appEventBus.publish(event);
  }

  public listAudit(query: HitlAuditQuery = {}): Promise<HitlAuditEntry[]> {
    return this.audit ? this.audit.query(query) : Promise.resolve([]);
  }

  public listAuditMonths(): Promise<string[]> {
    return this.audit ? this.audit.listMonths() : Promise.resolve([]);
  }

  public exportAudit(query: HitlAuditQuery, format: 'jsonl' | 'json' | 'csv'): Promise<string> {
    return this.audit ? this.audit.export(query, format) : Promise.resolve('');
  }

  /** Дожидается записи очереди и аудита (тесты). */
  public async flush(): Promise<void> {
    await this.persistChain;
    await this.audit?.flush();
  }

  // ─────────────────────────────── Внутреннее ───────────────────────────────

  private normalizeTimeout(timeoutMs?: number): number {
    const ms = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : this.defaultTimeoutMs;
    return Math.min(Math.max(ms, HITL_MIN_TIMEOUT_MS), MAX_TIMER_MS);
  }

  private armTimer(entry: PendingEntry): void {
    const expiresAt = entry.request.expiresAt;
    if (typeof expiresAt !== 'number') return;
    const delay = Math.min(Math.max(expiresAt - this.now(), 0), MAX_TIMER_MS);
    entry.timer = setTimeout(() => this.expire(entry.request.id), delay);
    entry.timer.unref?.();
  }

  private expire(requestId: string): void {
    if (this.closed) return;
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.remove(requestId);
    const source: HitlDecisionSource = { kind: 'timeout' };
    this.rememberDecided(entry.request, false, source);
    this.writeDecision(entry.request, 'deny', source, undefined, entry.request.orphaned ? 'session_gone' : undefined);
    entry.resolve?.({ approved: false, text: 'Таймаут ожидания решения — запрос отклонён автоматически' });
    this.emit('expired', { request: entry.request });
    appEventBus.publish({ type: 'hitl:expired', request: entry.request });
  }

  private cancelWhere(predicate: (req: HitlRequest) => boolean, reason: string | undefined, kind: 'cancelled' | 'shutdown'): HitlRequest[] {
    const cancelled: HitlRequest[] = [];
    if (this.closed) return cancelled;
    for (const [id, entry] of Array.from(this.pending.entries())) {
      if (!predicate(entry.request)) continue;
      this.remove(id);
      const source: HitlDecisionSource = { kind };
      this.rememberDecided(entry.request, false, source);
      this.writeDecision(entry.request, 'deny', source, reason, entry.request.orphaned ? 'session_gone' : undefined);
      entry.reject?.(new ApprovalCancelledError(reason));
      cancelled.push(entry.request);
      this.emit('cancelled', { request: entry.request, reason });
      appEventBus.publish({ type: 'hitl:cancelled', request: entry.request, reason });
    }
    return cancelled;
  }

  private remove(requestId: string): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(requestId);
    this.schedulePersist();
  }

  private rememberDecided(request: HitlRequest, approved: boolean, source: HitlDecisionSource): void {
    this.decided.set(request.id, { request, approved, source, at: this.now() });
    if (this.decided.size > DECIDED_MEMORY_LIMIT) {
      const oldest = this.decided.keys().next().value;
      if (oldest) this.decided.delete(oldest);
    }
  }

  private auditBase(request: HitlRequest): Omit<HitlAuditEntry, 'ts' | 'kind'> {
    return {
      requestId: request.id,
      sessionId: request.sessionId,
      projectPath: request.projectPath,
      hostId: request.hostId || this.hostId,
      origin: request.origin,
      engine: request.engine,
      agentId: request.agentId,
      agentName: request.agentName,
      role: request.role,
      tool: request.tool,
      type: request.type,
      title: request.title ? truncateComment(request.title, 200) : undefined,
      filePath: request.filePath || request.diff?.filePath || undefined,
      commandHash: request.command ? hashCommand(request.command) : undefined,
      commandPreview: request.command ? commandPreview(request.command) : undefined
    };
  }

  private writeDecision(
    request: HitlRequest,
    decision: 'allow' | 'deny',
    source: HitlDecisionSource,
    comment?: string,
    outcome?: HitlOutcome,
    detail?: string
  ): void {
    const now = this.now();
    const entry: HitlAuditEntry = {
      ...this.auditBase(request),
      ts: new Date(now).toISOString(),
      kind: 'decision',
      decision,
      decidedBy: source.kind,
      deviceId: source.deviceId,
      deviceName: source.deviceName,
      rule: source.rule,
      comment: truncateComment(comment),
      waitedMs: typeof request.createdAt === 'number' ? Math.max(0, now - request.createdAt) : undefined,
      outcome,
      detail: detail ? truncateComment(detail, 300) : undefined
    };
    void this.audit?.append(entry);
  }

  private schedulePersist(): void {
    if (!this.dir || this.closed) return;
    this.persistChain = this.persistChain.then(() => this.writePendingFile()).catch((err) => {
      console.error('[HITL] Не удалось сохранить очередь:', err);
    });
  }

  private async persistNow(): Promise<void> {
    if (!this.dir || this.closed) return;
    this.schedulePersist();
    await this.persistChain;
  }

  private async writePendingFile(): Promise<void> {
    if (!this.dir) return;
    const file: PendingFile = {
      version: HITL_PENDING_VERSION,
      savedAt: this.now(),
      hostId: this.hostId,
      requests: Array.from(this.pending.values()).map((e) => compactForDisk(e.request))
    };
    await fs.mkdir(this.dir, { recursive: true });
    const target = path.join(this.dir, HITL_PENDING_FILE);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf-8');
    await fs.rename(tmp, target);
  }
}

export const hitlService = new HitlService();
