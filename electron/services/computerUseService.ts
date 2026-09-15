import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, globalShortcut, screen } from 'electron';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import treeKill from 'tree-kill';
import { ApprovalCancelledError, hitlService } from './hitlService.js';
import type { HitlEngine, HitlOrigin, HitlRequest } from './hitlTypes.js';
import {
  buildProxyInputSchema,
  buildProxyToolDescription,
  fromProxyToolName,
  getComputerToolSpec,
  reconcileRuntimeTools,
  toProxyToolName,
  type CatalogReconciliation,
  type ComputerActionClass
} from './computerToolCatalog.js';
import {
  describeTarget,
  evaluateComputerAction,
  extractTargetHints,
  isLaunchableAppName,
  normalizeAppName,
  parseOpenApplicationActivated,
  resolveComputerTarget,
  sanitizeComputerUseSettings,
  summarizeComputerAction,
  type ComputerOrigin,
  type ComputerUseSettings,
  type RuntimeWindowInfo
} from './computerPolicy.js';
import {
  SCREENSHOT_JPEG_QUALITY,
  describeScreenshotForModel,
  firstPointFromArgs,
  fitToBaseline,
  mapCoordinateArgs,
  parseScreenshotMapping,
  type ScreenshotMapping
} from './computerCoords.js';
import { HumanTakeoverDetector } from './humanTakeover.js';

/**
 * Управление компьютером через MCP-прокси ProjectHub (TASK-82, decision-27).
 *
 * Сервис держит рантайм `@zavora-ai/computer-use-mcp` дочерним stdio-процессом (MCP SDK Client) и
 * исполняет вызовы `computer_*` от любого движка: встроенного MCP-сервера (Claude CLI, внешние
 * клиенты) и API-агента. На каждый вызов — политика (`computerPolicy`), при `ask` — карточка
 * единой HITL-очереди, для `act`/`dangerous` — скриншоты «до/после» и запись в аудит.
 *
 * Kill-switch (глобальная горячая клавиша, перехват мыши человеком, кнопка Стоп) убивает рантайм,
 * отменяет ожидающие подтверждения и блокирует прокси до ручного снятия.
 *
 * Рантайм недоступен (нет Node/npx, сеть, ОС) — функция деградирует: инструменты возвращают
 * ошибку, приложение продолжает работать.
 */

export const COMPUTER_USE_RUNTIME_PACKAGE = '@zavora-ai/computer-use-mcp';
/** Версия зафиксирована: набор инструментов сверяется с каталогом, новый релиз — через обновление каталога. */
export const COMPUTER_USE_RUNTIME_VERSION = '7.4.0';

const SETTINGS_FILE = 'computer-use.json';
const TOOLS_CACHE_FILE = 'computer-use-tools.json';
/** Первый запуск npx может скачивать пакет. */
const RUNTIME_START_TIMEOUT_MS = 180_000;
const RUNTIME_CALL_TIMEOUT_MS = 120_000;
/** Сколько после последнего действия виден оверлей «Агент управляет компьютером». */
const OVERLAY_IDLE_MS = 30_000;
/** Сколько после действия агента движение мыши человеком считается перехватом. */
const TAKEOVER_ARMED_MS = 3_000;
const TAKEOVER_POLL_MS = 50;
const AUDIT_SCREENSHOT_WIDTH = 1024;
const AUDIT_SCREENSHOT_QUALITY = 50;
const DISPLAY_CACHE_MS = 30_000;
/** Сколько после open_application/activate_app ждать появления окна приложения. */
const APP_WINDOW_WAIT_MS = 8_000;

export type ComputerRuntimeState = 'stopped' | 'starting' | 'ready' | 'error';
export type KillSwitchReason = 'hotkey' | 'human-takeover' | 'overlay' | 'manual';

export interface ComputerUseStatus {
  enabled: boolean;
  runtimeState: ComputerRuntimeState;
  runtimeError: string | null;
  runtimePackage: string;
  tools: { exported: number; hidden: number; unknown: string[]; missing: string[] } | null;
  killSwitch: { engaged: boolean; reason?: KillSwitchReason; at?: number };
  hotkey: { accelerator: string; registered: boolean };
  activeSession: { sessionId: string; label: string; since: number; lastActionAt: number } | null;
}

export interface ProxyToolDefinition {
  /** Имя для агентов: `computer_<runtime>`. */
  name: string;
  runtimeName: string;
  actionClass: ComputerActionClass;
  description: string;
  /** JSON Schema входа (без служебных аргументов рантайма). */
  inputSchema: Record<string, unknown>;
}

export interface ComputerCallContext {
  sessionId: string;
  projectPath: string;
  origin: ComputerOrigin;
  engine?: HitlEngine;
  agentId?: string;
  agentName?: string;
  role?: string;
  doneLoop?: boolean;
  taskAllowsComputerUse?: boolean;
  autoApprove?: boolean;
  approvalTimeoutMs?: number;
  /** Дублирует карточку в чат сессии (AI Studio); очередь и Центр решений получают её в любом случае. */
  onApprovalRequest?: (request: HitlRequest) => void;
}

export type ComputerContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface ComputerToolResult {
  content: ComputerContent[];
  isError: boolean;
}

export interface ComputerOverlayState {
  active: boolean;
  label?: string;
  killSwitch: boolean;
  hotkey: string;
}

interface RuntimeTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface RuntimeCallResult {
  content: unknown[];
  isError?: boolean;
  structuredContent?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorResult(text: string): ComputerToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function firstText(res: { content: unknown[] }): string {
  for (const c of res.content ?? []) {
    if (isRecord(c) && c.type === 'text' && typeof c.text === 'string') return c.text;
  }
  return '';
}

function firstImage(res: RuntimeCallResult): { data: string; mimeType: string } | undefined {
  for (const c of res.content) {
    if (isRecord(c) && c.type === 'image' && typeof c.data === 'string') {
      return { data: c.data, mimeType: typeof c.mimeType === 'string' && c.mimeType ? c.mimeType : 'image/jpeg' };
    }
  }
  return undefined;
}

/** Структурированный ответ рантайма или JSON из первого текстового блока. */
function structuredOf(res: RuntimeCallResult): Record<string, unknown> | null {
  if (isRecord(res.structuredContent)) return res.structuredContent;
  try {
    const parsed: unknown = JSON.parse(firstText(res) || 'null');
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toHitlOrigin(origin: ComputerOrigin): HitlOrigin | undefined {
  return origin === 'automation' ? undefined : origin;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
      timer.unref?.();
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

class ComputerUseService extends EventEmitter {
  private settings: ComputerUseSettings = sanitizeComputerUseSettings({});
  private dir: string | null = null;
  private auditDir: string | null = null;

  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private startPromise: Promise<boolean> | null = null;
  private runtimeState: ComputerRuntimeState = 'stopped';
  private runtimeError: string | null = null;
  private runtimeTools: RuntimeTool[] = [];
  private reconciliation: CatalogReconciliation | null = null;

  private killSwitch: { engaged: boolean; reason?: KillSwitchReason; at?: number } = { engaged: false };
  private registeredHotkey: string | null = null;

  /** Соответствие последнего скриншота экрану по сессиям — для `coordinate_space: "screenshot"`. */
  private mappings = new Map<string, ScreenshotMapping>();
  private displayCache: { at: number; width: number; height: number } | null = null;

  private detector = new HumanTakeoverDetector();
  private pollTimer: NodeJS.Timeout | null = null;
  private activeSession: ComputerUseStatus['activeSession'] = null;
  private inflightActions = 0;
  /** Действия `act`/`dangerous` выполняются по одному: несколько агентов не толкаются мышью. */
  private actionChain: Promise<unknown> = Promise.resolve();

  private overlayHandler: ((state: ComputerOverlayState) => void) | null = null;
  private killSwitchHandler: ((info: { reason: KillSwitchReason; sessionIds: string[] }) => void) | null = null;
  /** Сессии, выполнявшие действия с момента последнего снятия kill-switch. */
  private recentSessions = new Set<string>();

  constructor() {
    super();
    this.setMaxListeners(20);
  }

  // ─────────────────────────────── Жизненный цикл ───────────────────────────────

  public async init(options: { dir: string; auditDir: string }): Promise<void> {
    this.dir = options.dir;
    this.auditDir = options.auditDir;
    try {
      const raw = await fs.readFile(path.join(this.dir, SETTINGS_FILE), 'utf-8');
      this.settings = sanitizeComputerUseSettings(JSON.parse(raw));
    } catch {
      this.settings = sanitizeComputerUseSettings({});
    }
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.dir, TOOLS_CACHE_FILE), 'utf-8'));
      if (raw?.version === COMPUTER_USE_RUNTIME_VERSION && Array.isArray(raw.tools)) {
        this.runtimeTools = raw.tools;
        this.reconciliation = reconcileRuntimeTools(this.runtimeTools.map((t) => t.name));
      }
    } catch {
      // Кэша нет — инструменты появятся после первого запуска рантайма.
    }
    if (this.settings.enabled) {
      this.registerHotkey();
      // Прогрев в фоне: первый npx может скачивать пакет, агенту не нужно ждать этого на первом вызове.
      void this.ensureRuntime();
    }
    this.broadcastStatus();
  }

  public configure(handlers: {
    onOverlay?: (state: ComputerOverlayState) => void;
    onKillSwitch?: (info: { reason: KillSwitchReason; sessionIds: string[] }) => void;
  }): void {
    if (handlers.onOverlay) this.overlayHandler = handlers.onOverlay;
    if (handlers.onKillSwitch) this.killSwitchHandler = handlers.onKillSwitch;
  }

  public async shutdown(): Promise<void> {
    this.unregisterHotkey();
    this.stopPolling();
    await this.stopRuntime();
  }

  public isEnabled(): boolean {
    return this.settings.enabled;
  }

  public getSettings(): ComputerUseSettings {
    return JSON.parse(JSON.stringify(this.settings));
  }

  public async saveSettings(patch: Partial<ComputerUseSettings>): Promise<ComputerUseSettings> {
    const wasEnabled = this.settings.enabled;
    const merged = {
      ...this.settings,
      ...(patch ?? {}),
      policy: { ...this.settings.policy, ...((patch?.policy as object) ?? {}) }
    };
    this.settings = sanitizeComputerUseSettings(merged);
    if (this.dir) {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(path.join(this.dir, SETTINGS_FILE), JSON.stringify(this.settings, null, 2), 'utf-8');
    }
    if (this.settings.enabled) {
      this.registerHotkey();
      if (!wasEnabled) void this.ensureRuntime();
    } else {
      this.unregisterHotkey();
      this.deactivate();
      if (wasEnabled) await this.stopRuntime();
    }
    this.emit('settingsChanged', this.getSettings());
    this.broadcastStatus();
    return this.getSettings();
  }

  public getStatus(): ComputerUseStatus {
    const r = this.reconciliation;
    return {
      enabled: this.settings.enabled,
      runtimeState: this.runtimeState,
      runtimeError: this.runtimeError,
      runtimePackage: `${COMPUTER_USE_RUNTIME_PACKAGE}@${COMPUTER_USE_RUNTIME_VERSION}`,
      tools: r ? { exported: r.exported.length, hidden: r.hidden.length, unknown: r.unknown, missing: r.missing } : null,
      killSwitch: { ...this.killSwitch },
      hotkey: { accelerator: this.settings.killSwitchHotkey, registered: this.registeredHotkey === this.settings.killSwitchHotkey },
      activeSession: this.activeSession ? { ...this.activeSession } : null
    };
  }

  private broadcastStatus(): void {
    const status = this.getStatus();
    this.emit('status', status);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('computerUse:statusChanged', status);
    }
  }

  // ─────────────────────────────── Рантайм ───────────────────────────────

  /** Запускает рантайм, если он не запущен; `false` — недоступен (см. `runtimeError`). */
  public ensureRuntime(): Promise<boolean> {
    if (this.runtimeState === 'ready' && this.client) return Promise.resolve(true);
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startRuntime().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async startRuntime(): Promise<boolean> {
    this.runtimeState = 'starting';
    this.runtimeError = null;
    this.broadcastStatus();

    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', `${COMPUTER_USE_RUNTIME_PACKAGE}@${COMPUTER_USE_RUNTIME_VERSION}`],
      env: { ...getDefaultEnvironment(), COMPUTER_USE_PROFILE: 'full', npm_config_yes: 'true' },
      stderr: 'pipe'
    });
    transport.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) console.log(`[ComputerUse] runtime: ${text.slice(0, 500)}`);
    });
    const client = new Client({ name: 'projecthub-computer-proxy', version: '1.0.0' });
    transport.onclose = () => {
      if (this.transport !== transport) return;
      this.transport = null;
      this.client = null;
      if (this.runtimeState === 'ready') {
        this.runtimeState = 'stopped';
        console.warn('[ComputerUse] Рантайм завершился; будет перезапущен при следующем вызове.');
        this.broadcastStatus();
      }
    };

    try {
      this.transport = transport;
      await withTimeout(client.connect(transport), RUNTIME_START_TIMEOUT_MS, 'Рантайм не ответил на initialize');
      this.client = client;
      const list = await withTimeout(client.listTools(), 30_000, 'Рантайм не вернул список инструментов');
      this.runtimeTools = (list.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>
      }));
      this.reconciliation = reconcileRuntimeTools(this.runtimeTools.map((t) => t.name));
      if (this.reconciliation.unknown.length > 0) {
        console.warn(`[ComputerUse] Неклассифицированные инструменты рантайма не экспортируются: ${this.reconciliation.unknown.join(', ')}`);
      }
      if (this.reconciliation.missing.length > 0) {
        console.warn(`[ComputerUse] Нет в рантайме (версия/ОС): ${this.reconciliation.missing.join(', ')}`);
      }
      void this.writeToolsCache();
      this.runtimeState = 'ready';
      console.log(`[ComputerUse] Рантайм готов: ${this.reconciliation.exported.length} инструментов экспортируется.`);
      this.broadcastStatus();
      this.emit('toolsChanged');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.runtimeState = 'error';
      this.runtimeError = /ENOENT|not recognized|не является/i.test(message)
        ? `Не найден npx (Node.js ≥ 20): ${message}`
        : message;
      console.error('[ComputerUse] Не удалось запустить рантайм:', message);
      await this.killTransport(transport);
      if (this.transport === transport) this.transport = null;
      this.client = null;
      this.broadcastStatus();
      return false;
    }
  }

  private async writeToolsCache(): Promise<void> {
    if (!this.dir) return;
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(
        path.join(this.dir, TOOLS_CACHE_FILE),
        JSON.stringify({ version: COMPUTER_USE_RUNTIME_VERSION, savedAt: Date.now(), tools: this.runtimeTools }),
        'utf-8'
      );
    } catch (err) {
      console.warn('[ComputerUse] Не удалось сохранить кэш инструментов:', err);
    }
  }

  private async killTransport(transport: StdioClientTransport | null): Promise<void> {
    if (!transport) return;
    const pid = transport.pid;
    // npx на Windows — цепочка cmd → node: без tree-kill дочерний node переживёт закрытие.
    if (pid) await new Promise<void>((resolve) => treeKill(pid, 'SIGKILL', () => resolve()));
    try {
      await transport.close();
    } catch {
      /* процесс уже завершён */
    }
  }

  private async stopRuntime(): Promise<void> {
    const transport = this.transport;
    const client = this.client;
    this.transport = null;
    this.client = null;
    if (this.runtimeState !== 'error') this.runtimeState = 'stopped';
    await this.killTransport(transport);
    try {
      await client?.close();
    } catch {
      /* уже закрыт */
    }
    this.broadcastStatus();
  }

  private async callRuntime(name: string, args: Record<string, unknown>): Promise<RuntimeCallResult> {
    const client = this.client;
    if (!client) throw new Error('Рантайм управления компьютером не запущен');
    const res = (await client.callTool({ name, arguments: args }, undefined, { timeout: RUNTIME_CALL_TIMEOUT_MS })) as RuntimeCallResult;
    return { content: Array.isArray(res.content) ? res.content : [], isError: Boolean(res.isError), structuredContent: res.structuredContent };
  }

  // ─────────────────────────────── Инструменты ───────────────────────────────

  /** Инструменты прокси для регистрации в MCP-сервере и API-агенте; пусто — функция выключена или рантайм ещё не отвечал. */
  public listProxyTools(): ProxyToolDefinition[] {
    if (!this.settings.enabled) return [];
    const out: ProxyToolDefinition[] = [];
    for (const tool of this.runtimeTools) {
      const spec = getComputerToolSpec(tool.name);
      if (!spec?.exported) continue;
      out.push({
        name: toProxyToolName(tool.name),
        runtimeName: tool.name,
        actionClass: spec.class,
        description: buildProxyToolDescription(tool.name, spec, tool.description),
        inputSchema: buildProxyInputSchema(tool.inputSchema, spec)
      });
    }
    return out;
  }

  /** Сессия закрылась — забыть соответствие скриншота. */
  public forgetSession(sessionId: string): void {
    this.mappings.delete(sessionId);
  }

  /** Исполняет инструмент `computer_*` с политикой, HITL и аудитом. Никогда не бросает — ошибки возвращаются модели. */
  public async callTool(proxyName: string, rawArgs: Record<string, unknown> | undefined, ctx: ComputerCallContext): Promise<ComputerToolResult> {
    try {
      return await this.callToolUnsafe(proxyName, rawArgs, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ComputerUse] ${proxyName} failed:`, message);
      return errorResult(`Ошибка инструмента ${proxyName}: ${message}`);
    }
  }

  private async callToolUnsafe(proxyName: string, rawArgs: Record<string, unknown> | undefined, ctx: ComputerCallContext): Promise<ComputerToolResult> {
    const runtimeName = fromProxyToolName(proxyName) ?? proxyName;
    const spec = getComputerToolSpec(runtimeName);
    const args: Record<string, unknown> = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};
    delete args.approval_token;

    const policyContext = () => ({
      enabled: this.settings.enabled,
      killSwitchEngaged: this.killSwitch.engaged,
      origin: ctx.origin,
      doneLoop: ctx.doneLoop,
      taskAllowsComputerUse: ctx.taskAllowsComputerUse,
      autoApprove: ctx.autoApprove
    });
    const meta = {
      sessionId: ctx.sessionId,
      projectPath: ctx.projectPath,
      origin: toHitlOrigin(ctx.origin),
      engine: ctx.engine,
      agentId: ctx.agentId,
      agentName: ctx.agentName,
      role: ctx.role,
      tool: toProxyToolName(runtimeName)
    };

    // Жёсткие запреты проверяются до запуска рантайма и без определения цели.
    const pre = evaluateComputerAction({ tool: runtimeName, spec, target: null, focused: null, settings: this.settings.policy, context: policyContext() });
    if (pre.verdict === 'deny') {
      hitlService.recordAutoDecision(
        { ...meta, type: 'computer_action', title: `${meta.tool}: ${pre.rule}`, command: summarizeComputerAction(runtimeName, args, null) },
        'deny',
        pre.rule,
        pre.reason
      );
      return errorResult(pre.reason || `Действие отклонено политикой ProjectHub (${pre.rule}).`);
    }

    if (!(await this.ensureRuntime())) {
      return errorResult(`Рантайм управления компьютером недоступен: ${this.runtimeError ?? 'неизвестная ошибка'}`);
    }
    if (!this.runtimeTools.some((t) => t.name === runtimeName)) {
      return errorResult(`Инструмента ${runtimeName} нет в рантайме ${COMPUTER_USE_RUNTIME_VERSION} на этой ОС.`);
    }

    const mapped = mapCoordinateArgs(args, spec!.coords, this.mappings.get(ctx.sessionId) ?? null);
    if (mapped.error) return errorResult(mapped.error);

    if (spec!.class === 'observe') {
      const callArgs = await this.withScreenshotDefaults(runtimeName, mapped.args);
      return this.postProcess(runtimeName, await this.callRuntime(runtimeName, callArgs), ctx.sessionId);
    }

    const run = () => this.executeAction(runtimeName, spec!.movesCursor === true, spec!.targetless === true, mapped, ctx, meta, policyContext);
    const next = this.actionChain.then(run, run);
    this.actionChain = next.catch(() => undefined);
    return next;
  }

  private async executeAction(
    runtimeName: string,
    movesCursor: boolean,
    targetless: boolean,
    mapped: ReturnType<typeof mapCoordinateArgs>,
    ctx: ComputerCallContext,
    meta: Omit<HitlRequest, 'id' | 'type' | 'title' | 'createdAt'>,
    policyContext: () => Parameters<typeof evaluateComputerAction>[0]['context']
  ): Promise<ComputerToolResult> {
    const spec = getComputerToolSpec(runtimeName)!;
    const callArgs = mapped.args;
    const windows = await this.listWindows();
    const hints = targetless ? {} : extractTargetHints(callArgs, firstPointFromArgs(callArgs, spec.coords));
    const resolved = resolveComputerTarget(windows, hints);
    const target = targetless ? null : resolved.target;
    const verdict = evaluateComputerAction({
      tool: runtimeName,
      spec,
      target,
      focused: resolved.focused,
      settings: this.settings.policy,
      context: policyContext()
    });
    const summary = summarizeComputerAction(runtimeName, callArgs, target);
    const classLabel = verdict.actionClass === 'dangerous' ? 'Опасное действие' : 'Действие';
    const info = {
      ...meta,
      type: 'computer_action' as const,
      title: `${classLabel} на компьютере: ${meta.tool}${target ? ` → ${describeTarget(target)}` : ''}`,
      command: summary
    };

    if (verdict.verdict === 'deny') {
      hitlService.recordAutoDecision(info, 'deny', verdict.rule, verdict.reason);
      return errorResult(verdict.reason || `Действие отклонено политикой ProjectHub (${verdict.rule}).`);
    }

    let requestId: string;
    if (verdict.verdict === 'allow') {
      requestId = hitlService.recordAutoDecision(info, 'allow', verdict.rule);
    } else {
      const reasons: string[] = [];
      if (verdict.rule === 'computer-dangerous') reasons.push('Инструмент отнесён к опасным — требуется подтверждение.');
      if (verdict.rule === 'computer-file-dialog') reasons.push('Действие в файловом диалоге.');
      if (verdict.rule === 'computer-outside-allowlist') reasons.push('Приложение не входит в allowlist.');
      if (verdict.rule === 'computer-no-target') reasons.push('Целевое окно не определено.');
      if (verdict.rule === 'computer-manual') reasons.push('Роль требует ручного подтверждения.');
      if (mapped.mapped) reasons.push('Координаты пересчитаны со скриншота.');
      const request: HitlRequest = {
        ...info,
        id: hitlService.newRequestId('comp'),
        details: reasons.join(' ') || undefined,
        createdAt: Date.now()
      };
      ctx.onApprovalRequest?.(request);
      let response;
      try {
        response = await hitlService.request(request, { timeoutMs: ctx.approvalTimeoutMs });
      } catch (err) {
        if (err instanceof ApprovalCancelledError) return errorResult(`Ожидание подтверждения отменено: ${err.message}`);
        throw err;
      }
      if (!response.approved) {
        return errorResult(`Пользователь отклонил действие${response.text ? `: ${response.text}` : ''}. Не повторяй его другим способом без согласия пользователя.`);
      }
      if (this.killSwitch.engaged) {
        hitlService.recordOutcome(request.id, 'not_executed', 'kill-switch');
        return errorResult('Сработал kill-switch: действие не выполнено, управление компьютером заблокировано.');
      }
      requestId = request.id;
    }

    this.markActive(ctx);
    this.inflightActions++;
    let before: string | undefined;
    let after: string | undefined;
    let result: RuntimeCallResult;
    try {
      before = await this.captureAuditScreenshot(requestId, 'before');
      if (movesCursor) this.detector.noteAgentInput(Date.now());
      try {
        result = await this.callRuntime(runtimeName, callArgs);
      } finally {
        if (movesCursor) this.detector.noteAgentInput(Date.now());
      }
      if (!result.isError && (runtimeName === 'open_application' || runtimeName === 'activate_app')) {
        const app = String(callArgs.bundle_id ?? '');
        // Рантайм 7.4 на Windows только активирует запущенное приложение и отвечает «Opened … (activated:
        // false)», даже если ничего не запустил. Действие уже прошло политику/HITL — запускаем сами, но
        // только голое имя исполняемого файла (без пути и аргументов).
        if (
          runtimeName === 'open_application'
          && process.platform === 'win32'
          && parseOpenApplicationActivated(firstText(result)) === false
          && isLaunchableAppName(app)
          && !(await this.listWindows()).some((w) => normalizeAppName(w.bundleId || w.displayName) === normalizeAppName(app))
        ) {
          const launched = this.launchWindowsApp(app);
          result.content = [{ type: 'text', text: launched ? `ProjectHub запустил ${app}.` : `Не удалось запустить ${app}.` }];
          if (!launched) result.isError = true;
        }
        // Модели часто выдают «открыть приложение → ввести текст» одним ответом: без ожидания окна ввод
        // уходит раньше, чем приложение запустилось, и получает focus_failed.
        if (!result.isError) result.content.push({ type: 'text', text: await this.waitForAppWindow(app) });
      }
      after = await this.captureAuditScreenshot(requestId, 'after');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      hitlService.recordOutcome(requestId, 'failed', message, { screenshots: { before, after } });
      return errorResult(
        this.killSwitch.engaged ? 'Сработал kill-switch: действие прервано, управление компьютером заблокировано.' : `Ошибка рантайма: ${message}`
      );
    } finally {
      this.inflightActions--;
      if (this.activeSession) this.activeSession.lastActionAt = Date.now();
    }

    hitlService.recordOutcome(requestId, result.isError ? 'failed' : 'executed', firstText(result).slice(0, 200) || undefined, {
      screenshots: { before, after }
    });
    const processed = this.postProcess(runtimeName, result, ctx.sessionId);
    if (mapped.mapped) {
      processed.content.unshift({ type: 'text', text: 'Координаты со скриншота пересчитаны в экранные ProjectHub.' });
    }
    return processed;
  }

  private async listWindows(): Promise<RuntimeWindowInfo[]> {
    try {
      const windows = structuredOf(await this.callRuntime('list_windows', {}))?.windows;
      return Array.isArray(windows) ? (windows as RuntimeWindowInfo[]) : [];
    } catch (err) {
      console.warn('[ComputerUse] list_windows failed:', err);
      return [];
    }
  }

  /** Запуск приложения по голому имени `*.exe` через `start` (PATH и App Paths), отдельно от дерева процессов рантайма. */
  private launchWindowsApp(app: string): boolean {
    if (!isLaunchableAppName(app)) return false;
    try {
      const child = spawn('cmd.exe', ['/d', '/c', 'start', '""', app], { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', (err) => console.warn(`[ComputerUse] Запуск ${app} не удался:`, err));
      child.unref();
      console.log(`[ComputerUse] Запущено приложение ${app} (рантайм не запускает приложения на Windows).`);
      return true;
    } catch (err) {
      console.warn(`[ComputerUse] Запуск ${app} не удался:`, err);
      return false;
    }
  }

  /** Ждёт видимое окно приложения после запуска и активирует его; текст для модели с window_id. */
  private async waitForAppWindow(app: string): Promise<string> {
    const want = normalizeAppName(app);
    if (!want) return '';
    const deadline = Date.now() + APP_WINDOW_WAIT_MS;
    while (Date.now() < deadline) {
      const win = (await this.listWindows()).find(
        (w) => w.isOnScreen !== false && normalizeAppName(w.bundleId || w.displayName) === want
      );
      if (win) {
        if (!win.isFocused) {
          try {
            await this.callRuntime('activate_window', { window_id: win.windowId });
          } catch {
            /* best effort: модель получит window_id и сможет активировать сама */
          }
        }
        return `Окно ${app} готово: window_id ${win.windowId}${win.title ? `, заголовок «${win.title}»` : ''}. Для ввода используй target_window_id ${win.windowId}.`;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return `Окно ${app} не появилось за ${Math.round(APP_WINDOW_WAIT_MS / 1000)} с — проверь computer_list_windows, прежде чем вводить текст.`;
  }

  private async displaySize(): Promise<{ width: number; height: number } | null> {
    if (this.displayCache && Date.now() - this.displayCache.at < DISPLAY_CACHE_MS) return this.displayCache;
    try {
      const data = structuredOf(await this.callRuntime('get_display_size', {}));
      const width = Number(data?.width);
      const height = Number(data?.height);
      if (width > 0 && height > 0) {
        this.displayCache = { at: Date.now(), width, height };
        return this.displayCache;
      }
    } catch (err) {
      console.warn('[ComputerUse] get_display_size failed:', err);
    }
    return null;
  }

  /** Скриншот вписывается в baseline 1366×768, JPEG (AC #6). Модель может запросить меньше, но не больше. */
  private async withScreenshotDefaults(runtimeName: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (runtimeName !== 'screenshot' && !(runtimeName === 'snapshot' && args.use_vision === true)) return args;
    const out: Record<string, unknown> = { ...args };
    let size: { width: number; height: number } | null = null;
    if (typeof args.target_window_id === 'number') {
      const w = (await this.listWindows()).find((x) => x.windowId === args.target_window_id);
      if (w?.bounds) size = { width: w.bounds.width, height: w.bounds.height };
    }
    size ??= await this.displaySize();
    const fitted = size ? fitToBaseline(size.width, size.height).width : 1366;
    const requested = typeof args.width === 'number' && args.width > 0 ? Math.round(args.width) : fitted;
    out.width = Math.min(requested, fitted);
    if (runtimeName === 'screenshot' && typeof args.quality !== 'number') out.quality = SCREENSHOT_JPEG_QUALITY;
    return out;
  }

  private postProcess(runtimeName: string, res: RuntimeCallResult, sessionId: string): ComputerToolResult {
    const content: ComputerContent[] = [];
    for (const item of res.content) {
      if (!isRecord(item)) continue;
      if (item.type === 'image' && typeof item.data === 'string') {
        content.push({ type: 'image', data: item.data, mimeType: typeof item.mimeType === 'string' && item.mimeType ? item.mimeType : 'image/jpeg' });
      } else if (item.type === 'text' && typeof item.text === 'string') {
        const mapping = runtimeName === 'screenshot' ? parseScreenshotMapping(item.text) : null;
        if (mapping) {
          this.mappings.set(sessionId, mapping);
          content.push({ type: 'text', text: describeScreenshotForModel(mapping) });
        } else {
          content.push({ type: 'text', text: item.text });
        }
      } else {
        content.push({ type: 'text', text: JSON.stringify(item).slice(0, 2000) });
      }
    }
    if (content.length === 0 && res.structuredContent) {
      content.push({ type: 'text', text: JSON.stringify(res.structuredContent) });
    }
    return { content, isError: Boolean(res.isError) };
  }

  private async captureAuditScreenshot(requestId: string, phase: 'before' | 'after'): Promise<string | undefined> {
    if (!this.settings.auditScreenshots || !this.auditDir || !this.client) return undefined;
    try {
      const res = await this.callRuntime('screenshot', { width: AUDIT_SCREENSHOT_WIDTH, quality: AUDIT_SCREENSHOT_QUALITY });
      const image = firstImage(res);
      if (!image) return undefined;
      const month = new Date().toISOString().slice(0, 7);
      const dir = path.join(this.auditDir, 'computer', month);
      await fs.mkdir(dir, { recursive: true });
      const ext = String(image.mimeType || '').includes('png') ? 'png' : 'jpg';
      const safeId = requestId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const file = path.join(dir, `${safeId}-${phase}.${ext}`);
      await fs.writeFile(file, Buffer.from(image.data, 'base64'));
      return file;
    } catch (err) {
      console.warn(`[ComputerUse] Скриншот аудита (${phase}) не сохранён:`, err);
      return undefined;
    }
  }

  // ─────────────────────────────── Активность, оверлей, kill-switch ───────────────────────────────

  private markActive(ctx: ComputerCallContext): void {
    const now = Date.now();
    this.recentSessions.add(ctx.sessionId);
    const label = ctx.agentName || ctx.role || (ctx.origin === 'external' ? 'Внешний MCP-клиент' : ctx.engine === 'api' ? 'API-агент' : 'Агент');
    if (!this.activeSession || this.activeSession.sessionId !== ctx.sessionId) {
      this.activeSession = { sessionId: ctx.sessionId, label, since: now, lastActionAt: now };
      this.broadcastStatus();
    }
    this.activeSession.lastActionAt = now;
    this.emitOverlay();
    this.startPolling();
  }

  private deactivate(): void {
    this.stopPolling();
    if (this.activeSession) {
      this.activeSession = null;
      this.broadcastStatus();
    }
    this.emitOverlay();
  }

  private emitOverlay(): void {
    this.overlayHandler?.({
      active: Boolean(this.activeSession) || this.killSwitch.engaged,
      label: this.activeSession?.label,
      killSwitch: this.killSwitch.engaged,
      hotkey: this.settings.killSwitchHotkey
    });
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.detector = new HumanTakeoverDetector({ thresholdPx: this.settings.takeoverThresholdPx });
    this.pollTimer = setInterval(() => this.pollTick(), TAKEOVER_POLL_MS);
    this.pollTimer.unref?.();
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private pollTick(): void {
    const now = Date.now();
    const session = this.activeSession;
    if (!session) {
      this.stopPolling();
      return;
    }
    if (this.inflightActions === 0 && now - session.lastActionAt > OVERLAY_IDLE_MS) {
      this.deactivate();
      return;
    }
    // Перехват отслеживается только во время действия агента и сразу после него: в паузах человек
    // свободно пользуется мышью (в том числе нажимает «Разрешить» в карточке подтверждения).
    const armed = this.settings.takeoverDetection && (this.inflightActions > 0 || now - session.lastActionAt < TAKEOVER_ARMED_MS);
    if (!armed) {
      this.detector.reset();
      return;
    }
    let point: Electron.Point;
    try {
      point = screen.getCursorScreenPoint();
    } catch {
      return;
    }
    if (this.detector.sample(now, point.x, point.y)) {
      this.engageKillSwitch('human-takeover');
    }
  }

  public engageKillSwitch(reason: KillSwitchReason): void {
    if (this.killSwitch.engaged) return;
    this.killSwitch = { engaged: true, reason, at: Date.now() };
    const sessionIds = Array.from(this.recentSessions);
    console.warn(`[ComputerUse] KILL-SWITCH (${reason}): управление компьютером остановлено, сессии: ${sessionIds.join(', ') || '—'}`);
    this.stopPolling();
    hitlService.cancelMatching((r) => r.type === 'computer_action', `Kill-switch (${reason})`);
    // Убитый рантайм прерывает действие, которое выполняется прямо сейчас.
    void this.stopRuntime();
    this.activeSession = null;
    this.emitOverlay();
    this.broadcastStatus();
    this.killSwitchHandler?.({ reason, sessionIds });
  }

  public releaseKillSwitch(): void {
    if (!this.killSwitch.engaged) return;
    this.killSwitch = { engaged: false };
    this.recentSessions.clear();
    this.detector.reset();
    console.log('[ComputerUse] Kill-switch снят пользователем.');
    this.emitOverlay();
    this.broadcastStatus();
  }

  private registerHotkey(): void {
    const accelerator = this.settings.killSwitchHotkey;
    if (this.registeredHotkey === accelerator) return;
    this.unregisterHotkey();
    try {
      const ok = globalShortcut.register(accelerator, () => this.engageKillSwitch('hotkey'));
      if (ok) {
        this.registeredHotkey = accelerator;
      } else {
        console.warn(`[ComputerUse] Горячая клавиша kill-switch ${accelerator} занята другим приложением.`);
      }
    } catch (err) {
      console.warn(`[ComputerUse] Не удалось зарегистрировать горячую клавишу ${accelerator}:`, err);
    }
  }

  private unregisterHotkey(): void {
    if (!this.registeredHotkey) return;
    try {
      globalShortcut.unregister(this.registeredHotkey);
    } catch {
      /* приложение закрывается */
    }
    this.registeredHotkey = null;
  }

  // ─────────────────────────────── Диагностика ───────────────────────────────

  /** `doctor` рантайма + состояние прокси (AC #8). */
  public async diagnostics(): Promise<{ ok: boolean; runtime: unknown; status: ComputerUseStatus; error?: string }> {
    if (!(await this.ensureRuntime())) {
      return { ok: false, runtime: null, status: this.getStatus(), error: this.runtimeError ?? 'Рантайм недоступен' };
    }
    try {
      const res = await this.callRuntime('doctor', { include_remediation: true });
      const data = structuredOf(res);
      return { ok: data?.ok === true && !res.isError, runtime: data, status: this.getStatus() };
    } catch (err) {
      return { ok: false, runtime: null, status: this.getStatus(), error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Тестовый скриншот из настроек: проверка захвата экрана без агента и без аудита. */
  public async testScreenshot(): Promise<{ ok: boolean; dataUrl?: string; text?: string; error?: string }> {
    if (this.killSwitch.engaged) return { ok: false, error: 'Kill-switch активен — снимите блокировку.' };
    if (!(await this.ensureRuntime())) return { ok: false, error: this.runtimeError ?? 'Рантайм недоступен' };
    try {
      const args = await this.withScreenshotDefaults('screenshot', {});
      const res = await this.callRuntime('screenshot', args);
      const image = firstImage(res);
      const mapping = parseScreenshotMapping(firstText(res));
      if (!image) return { ok: false, error: firstText(res) || 'Рантайм не вернул изображение' };
      return {
        ok: true,
        dataUrl: `data:${image.mimeType || 'image/jpeg'};base64,${image.data}`,
        text: mapping ? describeScreenshotForModel(mapping) : firstText(res)
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export const computerUseService = new ComputerUseService();
