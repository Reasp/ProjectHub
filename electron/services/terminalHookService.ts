/**
 * Хуки терминальных сессий Claude Code и Codex (TASK-77, decision-54 п. 4–9).
 *
 * Скрипт `.projecthub/hooks/projecthub-hook.mjs` пересылает вход хука встроенному серверу ProjectHub
 * (`POST /api/hooks/event`), сервер вызывает {@link TerminalHookService.handle}, а готовый ответ в формате
 * движка печатается скриптом как есть.
 *
 * - PreToolUse: вердикт политики HITL роли (`evaluateToolRequest(applyRolePermissions(...))`); `deny` — отказ,
 *   `allow` — без решения (движок применяет свои правила), `ask` — общая очередь `hitlService` с ожиданием в
 *   пределах бюджета хука. Одобрение человека снимает собственный запрос Claude Code.
 * - PostToolUse / PostToolUseFailure: строка `outcome` аудита с длительностью от решения до завершения.
 * - Stop: событие `agent:finished` и (по настройке) проверки проекта с уведомлением или продолжением работы.
 *
 * Отдельный токен хуков даёт доступ только к этому маршруту: агент в терминале видит его в окружении, но
 * одобрить им ничего не может. Токен — только в переменной окружения, в файлы проекта не пишется.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyRolePermissions, CLI_READ_TOOLS, CLI_SUBAGENT_TOOLS, CLI_WRITE_TOOLS, commandFromInput, evaluateToolRequest, filePathFromInput, type PolicyVerdict } from './hitlPolicy.js';
import { roleForAgentType } from './roleExport.js';
import { hitlService } from './hitlService.js';
import { appEventBus } from './eventBus.js';
import { getUserDataDir } from './appPaths.js';
import { secretStorageService } from './secretStorageService.js';
import {
  approvalTimeoutFromBudget,
  DEFAULT_TERMINAL_HOOK_SETTINGS,
  formatHookResponse,
  isHookEngine,
  normalizeTerminalHookSettings,
  parseHookPayload,
  policyToolCalls,
  type HookEngine,
  type HookProcessOutput,
  type HookVerdict,
  type NormalizedHookEvent,
  type TerminalHookSettings
} from './terminalHookProtocol.js';
import type { AIProviderConfig } from './aiAgentService.js';
import type { ApprovalResponse, AppBusEvent, HitlEngine, HitlRequest, HitlRequestType } from './hitlTypes.js';
import type { RoleDefinition } from './roleTypes.js';

export const TERMINAL_HOOKS_FILE = 'terminal-hooks.json';
export const TERMINAL_HOOK_TOKEN_SECRET_KEY = 'terminal_hook_token';
/** Сколько помнить момент решения по `tool_use_id` для длительности PostToolUse. */
const DECISION_MEMORY_MS = 60 * 60_000;
const DECISION_MEMORY_LIMIT = 5000;

const ENGINE_LABEL: Record<HookEngine, string> = { claude: 'Claude Code', codex: 'Codex' };
const HITL_ENGINE: Record<HookEngine, HitlEngine> = { claude: 'claude-cli', codex: 'codex-cli' };

export interface TerminalHookRequestBody {
  engine: HookEngine;
  /** `CLAUDE_PROJECT_DIR` или рабочий каталог хука. */
  projectDir: string;
  payload: unknown;
  /** Сколько скрипт готов ждать ответа (мс) — срок решения человека меньше. */
  budgetMs?: number;
}

export interface StopChecksResult {
  failed: string[];
  summary: string;
}

export interface TerminalHookDeps {
  hitl: {
    request(input: HitlRequest, options?: { timeoutMs?: number }): Promise<ApprovalResponse>;
    recordAutoDecision(info: Omit<HitlRequest, 'id' | 'createdAt'> & { id?: string }, decision: 'allow' | 'deny', rule: string, detail?: string): string;
    recordOutcome(requestId: string, outcome: 'executed' | 'failed', detail?: string, extra?: { durationMs?: number }): void;
    newRequestId(prefix?: string): string;
    cancelMatching(predicate: (req: HitlRequest) => boolean, reason?: string): HitlRequest[];
  };
  getConfig(): Promise<AIProviderConfig>;
  loadRoles(projectPath: string): Promise<{ roles: RoleDefinition[] }>;
  /** Корень зарегистрированного проекта, которому принадлежит каталог; null — не проект ProjectHub. */
  resolveProject(dir: string): Promise<string | null>;
  publish(event: AppBusEvent): void;
  runStopChecks(projectPath: string): Promise<StopChecksResult>;
  buildDiff(workDir: string, toolName: string, filePath: string, input: Record<string, unknown>): Promise<HitlRequest['diff'] | undefined>;
  userDataDir(): string;
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  now(): number;
}

function defaultDeps(): TerminalHookDeps {
  return {
    hitl: hitlService,
    getConfig: async () => (await import('./aiAgentService.js')).aiAgentService.getConfig(),
    loadRoles: async (projectPath) => (await import('./roleService.js')).loadRoles(projectPath),
    resolveProject: async (dir) => {
      const [{ projectRegistry }, { findOwningProject }] = await Promise.all([import('./projectRegistry.js'), import('./pathGuard.js')]);
      const projects = await projectRegistry.getProjects();
      return findOwningProject(projects.map((p) => p.path), dir);
    },
    publish: (event) => appEventBus.publish(event),
    runStopChecks: async (projectPath) => {
      const [{ loadArenaConfig }, { executeCheck, pendingCheckResult }, { isFailedStatus }] = await Promise.all([
        import('./arenaConfig.js'),
        import('./checkRunner.js'),
        import('./arenaChecks.js')
      ]);
      const checks = (await loadArenaConfig(projectPath)).checks;
      const failed: string[] = [];
      const parts: string[] = [];
      for (const def of checks) {
        const result = await executeCheck(pendingCheckResult(def), def, projectPath);
        parts.push(`${result.name || result.id}: ${result.status}`);
        if (result.blocking && isFailedStatus(result.status)) failed.push(result.name || result.id);
      }
      return { failed, summary: parts.join('; ') || 'проверок в проекте нет' };
    },
    buildDiff: async (workDir, toolName, filePath, input) => (await import('./claudeBridgeService.js')).buildCliWriteDiff(workDir, toolName, filePath, input),
    userDataDir: () => getUserDataDir(),
    getSecret: (key) => secretStorageService.getSecret(key),
    setSecret: (key, value) => secretStorageService.setSecret(key, value),
    now: () => Date.now()
  };
}

interface DecisionMark {
  requestId: string;
  decidedAt: number;
}

const VERDICT_RANK: Record<PolicyVerdict['verdict'], number> = { allow: 0, ask: 1, deny: 2 };

function strictest(verdicts: PolicyVerdict[]): PolicyVerdict {
  return verdicts.reduce((a, b) => (VERDICT_RANK[b.verdict] > VERDICT_RANK[a.verdict] ? b : a));
}

function requestType(tool: string): HitlRequestType {
  if (CLI_WRITE_TOOLS.includes(tool)) return 'file_write';
  if (CLI_SUBAGENT_TOOLS.includes(tool)) return 'subagent_dispatch';
  return 'command';
}

function preview(value: unknown, limit = 600): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  } catch {
    text = String(value);
  }
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export class TerminalHookService {
  private readonly deps: TerminalHookDeps;
  private decisions = new Map<string, DecisionMark>();
  private settings: TerminalHookSettings | null = null;
  private token: string | null = null;

  constructor(deps: Partial<TerminalHookDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  /** Подменяет зависимости (тесты). */
  public configure(deps: Partial<TerminalHookDeps>): void {
    Object.assign(this.deps, deps);
  }

  // ─────────────────────────────── Токен ───────────────────────────────

  /** Токен хуков: создаётся один раз и хранится в зашифрованном хранилище секретов. */
  public async getToken(): Promise<string> {
    if (this.token) return this.token;
    const stored = await this.deps.getSecret(TERMINAL_HOOK_TOKEN_SECRET_KEY).catch(() => null);
    if (stored) {
      this.token = stored;
      return stored;
    }
    return this.regenerateToken();
  }

  public async regenerateToken(): Promise<string> {
    this.token = `ph_hook_${crypto.randomBytes(16).toString('hex')}`;
    await this.deps.setSecret(TERMINAL_HOOK_TOKEN_SECRET_KEY, this.token).catch((err) => {
      console.error('[TerminalHooks] Не удалось сохранить токен хуков:', err);
    });
    return this.token;
  }

  /** Сравнение за константное время; до первого `getToken()` токена нет и ничего не подходит. */
  public isHookToken(presented: string): boolean {
    if (!this.token || !presented) return false;
    const a = Buffer.from(presented, 'utf8');
    const b = Buffer.from(this.token, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // ─────────────────────────────── Настройки ───────────────────────────────

  private settingsPath(): string {
    return path.join(this.deps.userDataDir(), TERMINAL_HOOKS_FILE);
  }

  public async getSettings(): Promise<TerminalHookSettings> {
    if (this.settings) return this.settings;
    try {
      this.settings = normalizeTerminalHookSettings(JSON.parse(await fs.readFile(this.settingsPath(), 'utf-8')));
    } catch {
      this.settings = { ...DEFAULT_TERMINAL_HOOK_SETTINGS };
    }
    return this.settings;
  }

  public async saveSettings(raw: unknown): Promise<TerminalHookSettings> {
    const settings = normalizeTerminalHookSettings(raw);
    const target = this.settingsPath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
    await fs.rename(tmp, target);
    this.settings = settings;
    return settings;
  }

  // ─────────────────────────────── События ───────────────────────────────

  /** Обработка одного события хука. Не бросает: любая ошибка — «без решения» с сообщением в stderr. */
  public async handle(body: unknown, options: { signal?: AbortSignal } = {}): Promise<HookProcessOutput> {
    const b = (body && typeof body === 'object' ? body : {}) as Partial<TerminalHookRequestBody>;
    if (!isHookEngine(b.engine)) return formatHookResponse('claude', 'PostToolUse', { kind: 'none', message: 'ProjectHub: неизвестный движок хука' });
    const engine = b.engine;
    const parsed = parseHookPayload(engine, b.payload);
    if (!parsed.ok) return { exitCode: 0, stdout: '', stderr: `ProjectHub: ${parsed.error}` };
    const event = parsed.event;
    try {
      const dir = typeof b.projectDir === 'string' && b.projectDir.trim() ? b.projectDir : event.cwd;
      const projectPath = dir ? await this.deps.resolveProject(dir) : null;
      if (!projectPath) {
        return formatHookResponse(engine, event.event, { kind: 'none', message: 'ProjectHub: каталог не принадлежит зарегистрированному проекту — хук без решения' });
      }
      const verdict = await this.dispatch(event, projectPath, b.budgetMs, options.signal);
      return formatHookResponse(engine, event.event, verdict);
    } catch (err) {
      console.error('[TerminalHooks] Ошибка обработки хука:', err);
      return { exitCode: 0, stdout: '', stderr: `ProjectHub: ошибка обработки хука: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private dispatch(event: NormalizedHookEvent, projectPath: string, budgetMs: unknown, signal?: AbortSignal): Promise<HookVerdict> {
    switch (event.event) {
      case 'PreToolUse':
        return this.preToolUse(event, projectPath, budgetMs, signal);
      case 'PostToolUse':
      case 'PostToolUseFailure':
        return Promise.resolve(this.postToolUse(event, projectPath));
      case 'Stop':
        return this.stop(event, projectPath);
    }
  }

  private sessionKey(event: NormalizedHookEvent): string {
    return `terminal-${event.engine}-${event.sessionId}`;
  }

  private meta(event: NormalizedHookEvent, projectPath: string, role?: RoleDefinition) {
    const label = ENGINE_LABEL[event.engine];
    return {
      sessionId: this.sessionKey(event),
      projectPath,
      origin: 'terminal' as const,
      engine: HITL_ENGINE[event.engine],
      agentName: event.agentType ? `${label} · ${event.agentType}` : label,
      ...(event.agentType ? { agentId: event.agentType } : {}),
      ...(role ? { role: role.slug } : {}),
      ...(event.toolName ? { tool: event.toolName } : {})
    };
  }

  private remember(toolUseId: string | undefined, requestId: string): void {
    if (!toolUseId) return;
    const now = this.deps.now();
    for (const [key, mark] of this.decisions) {
      if (now - mark.decidedAt <= DECISION_MEMORY_MS && this.decisions.size < DECISION_MEMORY_LIMIT) break;
      this.decisions.delete(key);
    }
    this.decisions.set(toolUseId, { requestId, decidedAt: now });
  }

  private async preToolUse(event: NormalizedHookEvent, projectPath: string, budgetMs: unknown, signal?: AbortSignal): Promise<HookVerdict> {
    const tool = event.toolName ?? '';
    // На вопрос модели отвечает человек в терминале — очередь ProjectHub тут не нужна.
    if (tool === 'AskUserQuestion') return { kind: 'none' };

    const { roles } = await this.deps.loadRoles(projectPath);
    const role = roleForAgentType(roles, event.agentType);
    const config = applyRolePermissions(await this.deps.getConfig(), role?.permissions);
    const calls = policyToolCalls(event);
    const verdict = strictest(calls.map((c) => evaluateToolRequest(config, projectPath, c.tool, c.input)));
    const meta = this.meta(event, projectPath, role);
    const first = calls[0];
    const policyTool = first?.tool ?? tool;
    const filePath = calls.map((c) => filePathFromInput(c.input)).filter(Boolean).join(', ');
    const command = first && policyTool === 'Bash' ? commandFromInput(first.input) : '';
    const type = requestType(policyTool);
    const auditExtra = { type, title: `${tool}: ${verdict.rule}`, ...(filePath ? { filePath } : {}), ...(command ? { command } : {}) };

    if (verdict.verdict === 'deny') {
      this.deps.hitl.recordAutoDecision({ ...meta, ...auditExtra }, 'deny', verdict.rule, verdict.reason);
      return { kind: 'deny', reason: verdict.reason || `ProjectHub: инструмент ${tool} отклонён политикой (${verdict.rule})` };
    }
    if (verdict.verdict === 'allow') {
      const id = this.deps.hitl.recordAutoDecision({ ...meta, ...auditExtra }, 'allow', verdict.rule);
      this.remember(event.toolUseId, id);
      return { kind: 'none' };
    }

    const request: HitlRequest = {
      ...meta,
      id: this.deps.hitl.newRequestId('term'),
      type,
      title: this.askTitle(policyTool, tool, filePath, command, event),
      details: `${ENGINE_LABEL[event.engine]} в терминале · правило ${verdict.rule}${CLI_READ_TOOLS.includes(policyTool) ? ' (чтение)' : ''}`,
      ...(filePath ? { filePath } : {}),
      ...(command ? { command } : {}),
      createdAt: this.deps.now()
    };
    if (type === 'file_write') {
      const diff = event.engine === 'codex'
        ? { filePath, oldContent: '', newContent: '', patch: preview(event.toolInput.command ?? event.toolInput.patch ?? '', 50_000) }
        : await this.deps.buildDiff(projectPath, tool, filePathFromInput(event.toolInput), event.toolInput);
      if (diff) request.diff = diff;
    } else if (!command) {
      request.details = `${request.details}\n${preview(event.toolInput)}`;
    }

    const config2 = config.autoApproveRules?.approvalTimeoutMin;
    const timeoutMs = approvalTimeoutFromBudget(budgetMs, typeof config2 === 'number' && config2 > 0 ? config2 * 60_000 : undefined);
    const onAbort = () => this.deps.hitl.cancelMatching((r) => r.id === request.id, 'Хук терминала завершён до решения');
    if (signal?.aborted) return { kind: 'deny', reason: 'ProjectHub: хук завершён до решения' };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await this.deps.hitl.request(request, { timeoutMs });
      if (!res.approved) {
        return { kind: 'deny', reason: `Отклонено в ProjectHub${res.text ? `: ${res.text}` : ''}` };
      }
      this.remember(event.toolUseId, request.id);
      return { kind: 'allow', reason: `Разрешено в ProjectHub${res.text ? `: ${res.text}` : ''}` };
    } catch (err) {
      return { kind: 'deny', reason: `ProjectHub: ожидание решения прервано (${err instanceof Error ? err.message : String(err)})` };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private askTitle(policyTool: string, tool: string, filePath: string, command: string, event: NormalizedHookEvent): string {
    const where = `${ENGINE_LABEL[event.engine]}${event.agentType ? ` · ${event.agentType}` : ''}`;
    if (CLI_WRITE_TOOLS.includes(policyTool)) return `${where}: запись файла ${filePath || '(путь не указан)'}`;
    if (command) return `${where}: команда ${preview(command, 160)}`;
    if (CLI_READ_TOOLS.includes(policyTool)) return `${where}: чтение файла ${filePath}`;
    if (CLI_SUBAGENT_TOOLS.includes(policyTool)) return `${where}: запуск подагента ${preview(event.toolInput.description ?? '', 120)}`;
    return `${where}: инструмент ${tool}`;
  }

  private postToolUse(event: NormalizedHookEvent, projectPath: string): HookVerdict {
    if (event.toolName === 'AskUserQuestion') return { kind: 'none' };
    const outcome = event.toolFailed ? 'failed' : 'executed';
    const mark = event.toolUseId ? this.decisions.get(event.toolUseId) : undefined;
    if (mark) {
      this.decisions.delete(event.toolUseId!);
      this.deps.hitl.recordOutcome(mark.requestId, outcome, event.errorDetail, { durationMs: Math.max(0, this.deps.now() - mark.decidedAt) });
      return { kind: 'none' };
    }
    // PreToolUse не был виден (ProjectHub перезапускали или хук Pre не установлен): результат без длительности.
    const meta = this.meta(event, projectPath);
    const id = this.deps.hitl.recordAutoDecision({ ...meta, type: requestType(event.toolName ?? ''), title: `${event.toolName}: post-only` }, 'allow', 'post-only');
    this.deps.hitl.recordOutcome(id, outcome, event.errorDetail);
    return { kind: 'none' };
  }

  private async stop(event: NormalizedHookEvent, projectPath: string): Promise<HookVerdict> {
    const settings = await this.getSettings();
    const meta = this.meta(event, projectPath);
    const base = { sessionId: meta.sessionId, projectPath, origin: meta.origin, engine: meta.engine, agentName: meta.agentName, at: this.deps.now() };
    if (settings.stopChecks === 'off' || (settings.stopChecks === 'block' && event.stopHookActive)) {
      this.deps.publish({ type: 'agent:finished', outcome: 'done', ...base });
      return { kind: 'none' };
    }
    const checks = await this.deps.runStopChecks(projectPath);
    if (!checks.failed.length) {
      this.deps.publish({ type: 'agent:finished', outcome: 'done', ...base });
      return { kind: 'none' };
    }
    const reason = `Проверки проекта не прошли: ${checks.failed.join(', ')}. ${checks.summary}`;
    this.deps.publish({ type: 'agent:failed', error: reason, ...base });
    return settings.stopChecks === 'block' ? { kind: 'block', reason: `${reason}. Исправь и заверши работу снова.` } : { kind: 'none', message: reason };
  }

  /**
   * Переменные окружения встроенного терминала (decision-54 п. 4): только если в проекте установлен скрипт
   * хуков и сервер слушает. Основной токен MCP сюда не попадает.
   */
  public async terminalEnv(baseUrl: string | null): Promise<Record<string, string>> {
    if (!baseUrl) return {};
    const settings = await this.getSettings();
    return {
      PROJECTHUB_HOOK_URL: baseUrl,
      PROJECTHUB_HOOK_TOKEN: await this.getToken(),
      PROJECTHUB_HOOK_FAIL_MODE: settings.failMode
    };
  }
}

export const terminalHookService = new TerminalHookService();
