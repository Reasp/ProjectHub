import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import treeKill from 'tree-kill';
import {
  aiAgentService,
  PROJECT_HUB_CLAUDE_DIR,
  type AIProviderConfig,
  type AIMessage,
  type AIToolCall,
  type AutoApproveRules
} from './aiAgentService.js';
import { isInsideProject } from './pathGuard.js';
import { processManager } from './processManager.js';
import { claudeUsageService } from './claudeUsageService.js';
import { parseClaudeResultEvent, priceUsage, type AgentUsage } from './agentCost.js';
import { hitlService, ApprovalCancelledError } from './hitlService.js';
import { appEventBus } from './eventBus.js';
import { buildAgentContext } from './contextBuilder.js';
import {
  applyRolePermissions,
  evaluateToolRequest,
  isCommandDenied as policyIsCommandDenied,
  isPathExcluded as policyIsPathExcluded,
  CLI_WRITE_TOOLS
} from './hitlPolicy.js';
import type {
  ApprovalResponse,
  HitlDecisionSource,
  HitlEngine,
  HitlOrigin,
  HitlRequest,
  QuestionData,
  QuestionOption,
  RolePermissions
} from './hitlTypes.js';

export { ApprovalCancelledError };
export type { ApprovalResponse, QuestionData, QuestionOption };

export type AgentStatusType = 'idle' | 'running' | 'waiting_approval' | 'done' | 'error';

export interface ProjectAgentStatus {
  projectPath: string;
  projectName: string;
  status: AgentStatusType;
  lastMessage?: string;
  pendingApproval?: ApprovalRequest;
  activeSubagentsCount?: number;
  updatedAt: number;
}

/** Карточка одобрения = запрос единого HITL-контура (TASK-57); сам тип описан в hitlTypes. */
export type ApprovalRequest = HitlRequest;

export interface SubagentInfo {
  id: string;
  parentSessionId: string;
  projectPath: string;
  name: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  progress?: string;
  output?: string;
  startedAt: number;
  completedAt?: number;
}

export interface ClaudeModelOption {
  id: string;
  name: string;
  description: string;
  badge?: string;
  family: 'default' | 'sonnet' | 'opus' | 'haiku' | 'fable';
}

export const CLAUDE_MODELS_CATALOG: ClaudeModelOption[] = [
  {
    id: 'default',
    name: 'Default (recommended)',
    description: 'Sonnet 5 · Efficient for routine tasks',
    family: 'default'
  },
  {
    id: 'sonnet',
    name: 'Sonnet',
    description: 'Sonnet 5 · Efficient for routine tasks',
    family: 'sonnet'
  },
  {
    id: 'fable',
    name: 'Fable',
    description: 'Fable 5 · Most capable for your hardest and longest-running tasks',
    badge: 'Requires usage credits',
    family: 'fable'
  },
  {
    id: 'opus[1m]',
    name: 'Opus (1M context)',
    description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
    badge: '1M Context',
    family: 'opus'
  },
  {
    id: 'haiku',
    name: 'Haiku',
    description: 'Haiku 4.5 · Fastest for quick answers',
    badge: 'Fast',
    family: 'haiku'
  },
  {
    id: 'best',
    name: 'Best',
    description: 'Auto-selects optimal model for task complexity',
    family: 'default'
  },
  {
    id: 'opusplan',
    name: 'OpusPlan',
    description: 'Opus planning with Sonnet execution',
    family: 'opus'
  },
  {
    id: 'sonnet[1m]',
    name: 'Sonnet (1M context)',
    description: 'Sonnet 5 with extended 1M context window',
    badge: '1M Context',
    family: 'sonnet'
  },
  {
    id: 'fable[1m]',
    name: 'Fable (1M context)',
    description: 'Fable 5 with extended 1M context window',
    badge: '1M Context',
    family: 'fable'
  }
];

export interface RateLimitWarning {
  id: string;
  type: 'rate_limit' | 'context_window' | 'quota_warning' | 'throttled';
  title: string;
  message: string;
  utilization?: number;
  resetsAt?: string;
  tier?: string;
  timestamp: number;
}

export interface ClaudeBridgeMessageChunk {
  text?: string;
  thought?: string;
  toolCall?: AIToolCall;
  subagent?: SubagentInfo;
  approvalRequest?: ApprovalRequest;
  status?: AgentStatusType;
  claudeCliSessionId?: string;
  rateLimitWarning?: RateLimitWarning;
  /** Токены и стоимость ответа (событие `result` stream-json или usage API-провайдера), TASK-56. */
  usage?: AgentUsage;
}

export interface ClaudeCliAvailability {
  available: boolean;
  version?: string;
  message?: string;
}

/** Через сколько повторять проверку CLI после неудачи (чтобы после установки не требовался перезапуск приложения). */
const CLAUDE_CLI_RECHECK_MS = 30_000;
/** Таймаут ответа `claude --version`. */
const CLAUDE_CLI_CHECK_TIMEOUT_MS = 10_000;
/** Таймаут команды агента по умолчанию (TASK-33, аудит 1.4); переопределяется `autoApproveRules.commandTimeoutSec`. */
export const SUBPROCESS_DEFAULT_TIMEOUT_MS = 5 * 60_000;
/** Лимит накопленного вывода команды агента: хранится только «хвост» этого размера. */
export const SUBPROCESS_MAX_OUTPUT_BYTES = 1024 * 1024;

export interface SubprocessOptions {
  /** Сессия-владелец: процесс убивается вместе с ней в abortSession/killAll. */
  sessionId?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface SubprocessResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

// ─────────────────────────────────────────────────────────────
// Human-in-the-loop для режима Claude CLI (TASK-42, аудит 5.3)
//
// CLI запускается без --dangerously-skip-permissions; всё, что потребовало бы
// подтверждения, Claude Code отправляет во встроенный MCP-сервер ProjectHub
// (--permission-prompt-tool), а тот — в handleCliPermissionRequest. Решение
// принимается ДО выполнения инструмента: карточка одобрения в AI Studio или
// авто-ответ по правилам autoApproveRules.
// ─────────────────────────────────────────────────────────────

/** Запрос разрешения от Claude CLI: имя встроенного инструмента и его вход. */
export interface CliPermissionRequest {
  tool_name: string;
  input: Record<string, any>;
  tool_use_id?: string;
}

/** Ответ инструмента разрешений в формате, который ожидает Claude Code. */
export type CliPermissionDecision =
  | { behavior: 'allow'; updatedInput: Record<string, any> }
  | { behavior: 'deny'; message: string };

/** Адрес встроенного MCP-сервера ProjectHub, через который CLI запрашивает разрешения. */
export interface CliPermissionEndpoint {
  url: string;
  token: string;
}

export interface CliPermissionBroker {
  /** Гарантирует, что MCP-сервер запущен, и возвращает его адрес; null — сервер поднять не удалось. */
  ensureEndpoint(): Promise<CliPermissionEndpoint | null>;
}

/** Имя MCP-сервера в конфиге CLI; флаг --permission-prompt-tool = mcp__<server>__<tool>. */
export const CLI_HITL_MCP_SERVER_NAME = 'projecthub-hitl';
export const CLI_HITL_PERMISSION_TOOL = 'permission_prompt';
/** Query-параметр SSE-URL, по которому MCP-сервер привязывает подключение CLI к сессии AI Studio. */
export const CLI_HITL_QUERY_PARAM = 'phSession';
/** Таймаут MCP-инструмента для CLI: одобрение может ждать человека часами. */
export const CLI_MCP_TOOL_TIMEOUT_MS = 24 * 60 * 60_000;

/** Кто запускает Claude CLI: нужно очереди HITL и аудиту, чтобы отличать AI Studio от Swarm. */
export interface CliPermissionMeta {
  origin?: HitlOrigin;
  engine?: HitlEngine;
  agentId?: string;
  agentName?: string;
  role?: string;
  /** Права роли (decision-9): применяются поверх глобальных настроек и только сужают их. */
  permissions?: RolePermissions;
}

interface CliPermissionContext extends CliPermissionMeta {
  projectPath: string;
  /** Уже суженная правами роли конфигурация. */
  config: AIProviderConfig;
  onChunk: (chunk: ClaudeBridgeMessageChunk) => void;
}

/**
 * Шаблон исключений ProjectHub → правила путей Claude Code (gitignore-подобный синтаксис).
 * Шаблон без префикса (`.env*`, `*.key`) Claude Code трактует относительно cwd, поэтому
 * дублируем его формой `**\/<pattern>`, чтобы правило срабатывало на любой глубине.
 */
function toCliPathRulePatterns(pattern: string): string[] {
  const p = pattern.trim().replace(/\\/g, '/');
  if (!p) return [];
  if (/^(\/\/|~\/|\/|\.\/|\*\*\/)/.test(p)) return [p];
  return [`./${p}`, `**/${p}`];
}

/**
 * Настройки `--settings` для Claude CLI: правила `permissions.ask`, которые заставляют CLI
 * спросить ProjectHub даже там, где allow-правила из `.claude/settings*.json` проекта
 * разрешили бы инструмент молча (ask имеет приоритет над allow). Решение по каждому
 * запросу всё равно принимает handleCliPermissionRequest; правила лишь гарантируют, что
 * запрос до него дойдёт. Возвращает null, если ни одного правила не требуется.
 */
export function buildCliPermissionSettings(config: AIProviderConfig): { permissions: { ask: string[] } } | null {
  const rules = config.autoApproveRules;
  const manual = !config.autoApprove;
  const ask = new Set<string>();

  if (manual || rules?.allowCommands === false) ask.add('Bash');
  if (manual || rules?.allowFileWrite === false) CLI_WRITE_TOOLS.forEach((t) => ask.add(t));
  if (rules?.allowFileRead === false) ask.add('Read');
  if (rules?.allowSubagents === false) {
    ask.add('Agent');
    ask.add('Task');
  }
  for (const denied of rules?.commandDenyList ?? []) {
    const d = denied.trim();
    if (d) ask.add(`Bash(${d}*)`);
  }
  for (const pattern of rules?.writeExcludePatterns ?? []) {
    for (const r of toCliPathRulePatterns(pattern)) {
      ask.add(`Edit(${r})`);
      ask.add(`Write(${r})`);
    }
  }
  for (const pattern of rules?.readExcludePatterns ?? []) {
    for (const r of toCliPathRulePatterns(pattern)) ask.add(`Read(${r})`);
  }

  return ask.size > 0 ? { permissions: { ask: Array.from(ask) } } : null;
}

/** Аргумент командной строки для spawn с `shell: true` (пути с пробелами). */
function quoteShellArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** Убивает дерево процессов: при `shell: true` `child.kill()` убил бы только оболочку, а не сам claude/npm. */
function killProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.pid) {
    treeKill(child.pid, 'SIGKILL', (err) => {
      if (err) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    });
  } else {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
}

class ClaudeBridgeService extends EventEmitter {
  private projectStatuses = new Map<string, ProjectAgentStatus>();
  private activeSubagents = new Map<string, SubagentInfo[]>();
  /** Процессы Claude CLI по sessionId. */
  private activeProcesses = new Map<string, ChildProcess>();
  /** Команды агента (executeSubprocess) по sessionId. */
  private sessionSubprocesses = new Map<string, Set<ChildProcess>>();
  /** Сессии, у которых сейчас выполняется runAgentTask: sessionId → projectPath. */
  private activeSessions = new Map<string, string>();
  /** Сессии, прерванные пользователем: их завершение считается отменой, а не ошибкой. */
  private abortedSessions = new Set<string>();
  private sessionClaudeCliIds = new Map<string, string>();
  private claudeCliCheck: (ClaudeCliAvailability & { checkedAt: number }) | null = null;
  private claudeCliCheckPromise: Promise<ClaudeCliAvailability> | null = null;
  /** Поставщик адреса встроенного MCP-сервера для --permission-prompt-tool (внедряется из main.ts). */
  private cliPermissionBroker: CliPermissionBroker | null = null;
  /** Контексты сессий Claude CLI, ожидающих запросов разрешений: sessionId → правила и канал чанков. */
  private cliPermissionContexts = new Map<string, CliPermissionContext>();
  /** tool_use_id Claude CLI → requestId HITL: чтобы результат инструмента попал в аудит (TASK-57). */
  private cliToolUseRequests = new Map<string, string>();
  /** Движок активных сессий AI Studio для событий agent:* (TASK-57). */
  private sessionEngines = new Map<string, HitlEngine>();
  private sessionStartedAt = new Map<string, number>();

  constructor() {
    super();
  }

  public setCliPermissionBroker(broker: CliPermissionBroker | null): void {
    this.cliPermissionBroker = broker;
  }

  /**
   * Регистрирует сессию CLI как получателя запросов разрешений (публично ради unit-тестов).
   * `meta.permissions` (права роли) сужают `config` до сохранения контекста.
   */
  public registerCliPermissionContext(
    sessionId: string,
    projectPath: string,
    config: AIProviderConfig,
    onChunk: (chunk: ClaudeBridgeMessageChunk) => void,
    meta: CliPermissionMeta = {}
  ): void {
    const effective = applyRolePermissions(config, meta.permissions);
    this.cliPermissionContexts.set(sessionId, { ...meta, projectPath, config: effective, onChunk });
  }

  public unregisterCliPermissionContext(sessionId: string): void {
    this.cliPermissionContexts.delete(sessionId);
  }

  public hasCliPermissionContext(sessionId: string): boolean {
    return this.cliPermissionContexts.has(sessionId);
  }

  /**
   * Результат инструмента Claude CLI (событие `user` → `tool_result` stream-json): если инструмент
   * проходил через HITL, результат записывается в аудит по requestId.
   */
  public noteCliToolResult(toolUseId: string | undefined, isError: boolean, detail?: string): void {
    if (!toolUseId) return;
    const requestId = this.cliToolUseRequests.get(toolUseId);
    if (!requestId) return;
    this.cliToolUseRequests.delete(toolUseId);
    hitlService.recordOutcome(requestId, isError ? 'failed' : 'executed', detail);
  }

  /** Разбирает событие stream-json Claude CLI типа `user` и передаёт tool_result в аудит. */
  public noteCliUserEvent(event: any): void {
    const content = event?.message?.content;
    if (!Array.isArray(content)) return;
    for (const item of content) {
      if (item?.type !== 'tool_result') continue;
      const text = typeof item.content === 'string'
        ? item.content
        : Array.isArray(item.content) ? item.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join(' ') : '';
      this.noteCliToolResult(item.tool_use_id, Boolean(item.is_error), text ? text.slice(0, 200) : undefined);
    }
  }

  /**
   * Обработчик --permission-prompt-tool: вызывается MCP-сервером ProjectHub до выполнения
   * инструмента Claude Code. Вердикт даёт политика (`evaluateToolRequest`, правила пользователя,
   * суженные ролью); при `ask` показывается карточка через единую очередь `hitlService`.
   * Авто-решения тоже попадают в аудит с именем правила.
   */
  public async handleCliPermissionRequest(sessionId: string, request: CliPermissionRequest): Promise<CliPermissionDecision> {
    const ctx = this.cliPermissionContexts.get(sessionId);
    if (!ctx) {
      return { behavior: 'deny', message: 'ProjectHub: сессия агента не найдена или уже завершена — запрос разрешения отклонён.' };
    }
    const { projectPath, config, onChunk } = ctx;
    const rules = config.autoApproveRules;
    const toolName = String(request.tool_name || '');
    const input: Record<string, any> = request.input && typeof request.input === 'object' ? request.input : {};
    const meta = {
      origin: ctx.origin ?? 'studio',
      engine: ctx.engine ?? 'claude-cli',
      agentId: ctx.agentId,
      agentName: ctx.agentName,
      role: ctx.role,
      tool: toolName
    } as const;
    const verdict = evaluateToolRequest(config, projectPath, toolName, input);

    const allow = (updatedInput: Record<string, any> = input): CliPermissionDecision => ({ behavior: 'allow', updatedInput });
    const deny = (message: string): CliPermissionDecision => ({ behavior: 'deny', message });
    const newId = () => hitlService.newRequestId();
    const filePathOf = () => String(input.file_path || input.notebook_path || input.path || '');
    const commandOf = () => String(input.command || input.cmd || '');
    const recordAuto = (decision: 'allow' | 'deny', type: ApprovalRequest['type'], extra: Partial<ApprovalRequest> = {}) => {
      const id = hitlService.recordAutoDecision(
        { sessionId, projectPath, type, title: `${toolName}: ${verdict.rule}`, ...meta, ...extra },
        decision,
        verdict.rule,
        verdict.reason
      );
      if (request.tool_use_id && decision === 'allow') this.cliToolUseRequests.set(request.tool_use_id, id);
    };

    /** Показывает карточку и ждёт ответа; null — ожидание отменено (abortSession/killAll). */
    const ask = async (approvalReq: ApprovalRequest): Promise<ApprovalResponse | null> => {
      const req: ApprovalRequest = { ...meta, ...approvalReq };
      if (request.tool_use_id) this.cliToolUseRequests.set(request.tool_use_id, req.id);
      onChunk({ approvalRequest: req });
      try {
        return await this.requestApproval(req, { timeoutMs: this.approvalTimeoutMs(config) });
      } catch (err) {
        if (err instanceof ApprovalCancelledError) return null;
        throw err;
      } finally {
        if (this.activeSessions.has(sessionId) && this.getPendingApprovalIds(sessionId).length === 0) {
          this.setProjectStatus(projectPath, 'running', 'Claude Code продолжает работу...');
        }
      }
    };
    const decide = (res: ApprovalResponse | null, what: string): CliPermissionDecision => {
      if (res === null) return deny('Сессия прервана пользователем');
      if (res.approved) return allow();
      return deny(`Пользователь отклонил ${what}${res.text ? `: ${res.text}` : ''}`);
    };

    if (verdict.verdict === 'deny') {
      recordAuto('deny', CLI_WRITE_TOOLS.includes(toolName) ? 'file_write' : 'command', {
        filePath: filePathOf() || undefined,
        command: commandOf() || undefined
      });
      return deny(verdict.reason || `Инструмент ${toolName} отклонён политикой (${verdict.rule}).`);
    }

    if (toolName === 'AskUserQuestion') {
      const questions: any[] = Array.isArray(input.questions) ? input.questions : [];
      const answers: Record<string, string> = {};
      if (questions.length === 0) {
        const qData = this.parseQuestionData(input);
        const res = await ask({
          id: newId(), sessionId, projectPath, type: 'question',
          title: qData.title || 'Вопрос от Claude Code', details: qData.subtitle, questionData: qData, createdAt: Date.now()
        });
        if (!res || !res.approved) return deny(res ? 'Пользователь закрыл вопрос без ответа' : 'Сессия прервана пользователем');
        answers[qData.subtitle || qData.title] = this.normalizeQuestionAnswer(res.text);
        return allow({ ...input, answers });
      }
      for (const q of questions) {
        const questionText = String(q?.question || q?.header || 'Вопрос');
        const options: QuestionOption[] = (Array.isArray(q?.options) ? q.options : []).map((opt: any, idx: number) => ({
          id: `opt-${idx}`,
          label: String(opt?.label ?? opt),
          description: opt?.description ? String(opt.description) : undefined
        }));
        const res = await ask({
          id: newId(), sessionId, projectPath, type: 'question',
          title: String(q?.header || 'Вопрос от Claude Code'),
          details: questionText,
          questionData: { title: String(q?.header || 'Вопрос от Claude Code'), subtitle: questionText, options, isMultiSelect: Boolean(q?.multiSelect), allowOther: true },
          createdAt: Date.now()
        });
        if (!res || !res.approved) return deny(res ? 'Пользователь закрыл вопрос без ответа' : 'Сессия прервана пользователем');
        answers[questionText] = this.normalizeQuestionAnswer(res.text);
      }
      return allow({ ...input, questions, answers });
    }

    if (toolName === 'Read' || toolName === 'NotebookRead') {
      const filePath = filePathOf();
      if (verdict.verdict === 'allow') {
        recordAuto('allow', 'question', { filePath });
        return allow();
      }
      const reason = verdict.rule === 'read-excluded'
        ? `Файл ${filePath} находится в списке исключений для чтения.`
        : verdict.rule === 'read-outside' ? `Файл ${filePath} находится вне корня проекта.` : 'Чтение файлов требует подтверждения по настройкам.';
      const res = await ask({
        id: newId(), sessionId, projectPath, type: 'question', filePath,
        title: 'Чтение защищенного файла',
        details: `${reason} Разрешить Claude Code доступ?`,
        questionData: {
          title: 'Чтение защищенного файла',
          subtitle: `Разрешить Claude Code прочитать ${filePath}?`,
          options: [
            { id: 'allow', label: 'Разрешить чтение', description: 'Предоставить доступ к файлу' },
            { id: 'deny', label: 'Запретить чтение', description: 'Заблокировать чтение' }
          ],
          isMultiSelect: false,
          allowOther: false
        },
        createdAt: Date.now()
      });
      if (res === null) return deny('Сессия прервана пользователем');
      if (!res.approved || res.text?.includes('deny') || res.text?.includes('Запретить')) {
        return deny(`Пользователь запретил чтение файла ${filePath}`);
      }
      return allow();
    }

    if (CLI_WRITE_TOOLS.includes(toolName)) {
      const filePath = filePathOf();
      // Путь вне корня проекта уже отклонён политикой выше (rule `outside-project`, TASK-32).
      const isExcluded = verdict.rule === 'write-excluded';
      if (verdict.verdict === 'allow') {
        recordAuto('allow', 'file_write', { filePath });
        return allow();
      }

      const diff = await this.buildCliWriteDiff(projectPath, toolName, filePath, input);
      const res = await ask({
        id: newId(), sessionId, projectPath, type: 'file_write',
        title: isExcluded ? `⚠️ Файл в списке исключений: ${filePath}` : `Разрешение на запись файла: ${filePath}`,
        filePath,
        details: isExcluded ? 'Файл защищен списком исключений авто-одобрения' : `Claude Code (${toolName}) запрашивает изменение файла`,
        diff,
        createdAt: Date.now()
      });
      return decide(res, `запись файла ${filePath}`);
    }

    if (toolName === 'Bash' || toolName === 'PowerShell') {
      const cmd = commandOf();
      const isDenied = verdict.rule === 'command-denied';
      if (verdict.verdict === 'allow') {
        recordAuto('allow', 'command', { command: cmd });
        return allow();
      }
      const res = await ask({
        id: newId(), sessionId, projectPath, type: 'command',
        title: isDenied ? `⚠️ Заблокированная команда требует подтверждения: ${cmd}` : `Разрешение на запуск команды: ${cmd}`,
        command: cmd,
        details: input.description || (isDenied ? 'Команда находится в списке запрещенных для авто-запуска' : 'Выполнение команды терминала'),
        createdAt: Date.now()
      });
      return decide(res, 'запуск команды');
    }

    if (toolName === 'Agent' || toolName === 'Task') {
      // Подагенты: карточка только при allowSubagents=false (как до TASK-57); в ручном режиме
      // каждый инструмент подагента всё равно пройдёт через этот же обработчик.
      if (rules?.allowSubagents !== false) {
        recordAuto('allow', 'subagent_dispatch');
        return allow();
      }
      const description = String(input.description || input.prompt || 'Подзадача').slice(0, 200);
      const res = await ask({
        id: newId(), sessionId, projectPath, type: 'subagent_dispatch',
        title: `Запуск подагента: ${description}`,
        details: String(input.prompt || '').slice(0, 1000) || 'Claude Code запрашивает запуск подагента',
        createdAt: Date.now()
      });
      return decide(res, 'запуск подагента');
    }

    // Прочие инструменты (WebFetch, WebSearch, MCP-инструменты и т.п.).
    if (verdict.verdict === 'allow') {
      recordAuto('allow', 'command');
      return allow();
    }
    let inputPreview: string;
    try {
      inputPreview = JSON.stringify(input) ?? '';
    } catch {
      inputPreview = String(input);
    }
    const res = await ask({
      id: newId(), sessionId, projectPath, type: 'command',
      title: `Инструмент Claude Code: ${toolName}`,
      details: inputPreview.length > 600 ? `${inputPreview.slice(0, 600)}…` : inputPreview,
      createdAt: Date.now()
    });
    return decide(res, `инструмент ${toolName}`);
  }

  /** Ответ карточки → значение для AskUserQuestion: свободный текст вместо «Other: …». */
  private normalizeQuestionAnswer(text?: string): string {
    const t = (text || '').trim();
    const m = /^Other:\s*(.*)$/i.exec(t);
    return m ? m[1].trim() : t || 'Approved';
  }

  /** Диф для карточки одобрения записи: Write — файл целиком, Edit — заменяемый фрагмент. */
  private async buildCliWriteDiff(
    projectPath: string,
    toolName: string,
    filePath: string,
    input: Record<string, any>
  ): Promise<ApprovalRequest['diff'] | undefined> {
    try {
      if (toolName === 'Write' && typeof input.content === 'string') {
        let oldContent = '';
        const fullPath = path.resolve(projectPath, filePath);
        if (existsSync(fullPath)) oldContent = await fs.readFile(fullPath, 'utf-8');
        return { filePath, oldContent, newContent: input.content, patch: aiAgentService.generateDiff(oldContent, input.content, filePath) };
      }
      if (toolName === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string') {
        return { filePath, oldContent: input.old_string, newContent: input.new_string, patch: aiAgentService.generateDiff(input.old_string, input.new_string, filePath) };
      }
    } catch {
      /* диф — только подсказка для пользователя */
    }
    return undefined;
  }

  public getProjectStatus(projectPath: string): ProjectAgentStatus {
    return (
      this.projectStatuses.get(projectPath) || {
        projectPath,
        projectName: path.basename(projectPath),
        status: 'idle',
        updatedAt: Date.now()
      }
    );
  }

  public getAllProjectStatuses(): ProjectAgentStatus[] {
    return Array.from(this.projectStatuses.values());
  }

  public getAvailableModels(): ClaudeModelOption[] {
    return CLAUDE_MODELS_CATALOG;
  }

  public setProjectStatus(
    projectPath: string,
    status: AgentStatusType,
    lastMessage?: string,
    pendingApproval?: ApprovalRequest
  ): void {
    const currentSubagents = this.activeSubagents.get(projectPath) || [];
    const activeCount = currentSubagents.filter((s) => s.status === 'running').length;

    const updated: ProjectAgentStatus = {
      projectPath,
      projectName: path.basename(projectPath),
      status,
      lastMessage,
      pendingApproval,
      activeSubagentsCount: activeCount,
      updatedAt: Date.now()
    };

    // Статус idle — значение по умолчанию у getProjectStatus, хранить его незачем:
    // иначе projectStatuses растёт с числом когда-либо открытых проектов (аудит 2.3).
    if (status === 'idle') {
      this.projectStatuses.delete(projectPath);
    } else {
      this.projectStatuses.set(projectPath, updated);
    }
    this.emit('statusChanged', updated);
  }

  /** Таймаут ожидания решения из настроек (минуты) → мс; без настройки — умолчание hitlService. */
  private approvalTimeoutMs(config: AIProviderConfig | undefined): number | undefined {
    const min = config?.autoApproveRules?.approvalTimeoutMin;
    return typeof min === 'number' && min > 0 ? min * 60_000 : undefined;
  }

  /**
   * Ставит карточку в единую очередь HITL и ждёт решения (TASK-57). Ответ может прийти из окна,
   * с телефона или от MCP-клиента — все они вызывают `hitlService.decide(requestId, …)`.
   * Отмена сессии → reject {@link ApprovalCancelledError}; таймаут → `{ approved: false }`.
   */
  public async requestApproval(request: ApprovalRequest, options: { timeoutMs?: number } = {}): Promise<ApprovalResponse> {
    const req: ApprovalRequest = { origin: 'studio', engine: 'api', ...request };
    const promise = hitlService.request(req, options);
    this.setProjectStatus(req.projectPath, 'waiting_approval', req.title, req);
    return promise;
  }

  /** Локальное решение из окна ProjectHub; адресуется строго по requestId. */
  public sendApprovalResponse(requestId: string, response: ApprovalResponse, source: HitlDecisionSource = { kind: 'local' }): boolean {
    return hitlService.decide(requestId, response, source).ok;
  }

  public getPendingApprovalIds(sessionId?: string): string[] {
    return hitlService.listPending(sessionId ? { sessionId } : {}).map((r) => r.id);
  }

  /**
   * Отклоняет все ожидающие одобрения сессии (или всех сессий, если sessionId не задан) и
   * переводит статус проекта из waiting_approval в idle. Возвращает число отклонённых.
   */
  public rejectPendingApprovals(sessionId?: string, reason?: string): number {
    const cancelled = sessionId ? hitlService.cancelSession(sessionId, reason) : hitlService.cancelAll(reason);
    for (const req of cancelled) {
      if (this.projectStatuses.get(req.projectPath)?.status === 'waiting_approval') {
        this.setProjectStatus(req.projectPath, 'idle', 'Ожидание одобрения отменено');
      }
    }
    return cancelled.length;
  }

  public getClaudeCliSessionId(sessionId: string): string | undefined {
    return this.sessionClaudeCliIds.get(sessionId);
  }

  public isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  private startSession(sessionId: string, projectPath: string, engine: HitlEngine): void {
    this.abortedSessions.delete(sessionId);
    this.activeSessions.set(sessionId, projectPath);
    this.sessionEngines.set(sessionId, engine);
    this.sessionStartedAt.set(sessionId, Date.now());
    appEventBus.publish({ type: 'agent:started', sessionId, projectPath, origin: 'studio', engine, hostId: hitlService.currentHostId, at: Date.now() });
  }

  /**
   * Единая точка завершения сессии: статус проекта, подагенты, снятие с учёта, отмена ожидающих
   * запросов HITL и событие `agent:finished|failed` в шину (TASK-57).
   * Вызывается ровно один раз на запуск runAgentTask (done/error/aborted).
   */
  private finishSession(
    sessionId: string,
    projectPath: string,
    outcome: 'done' | 'error' | 'aborted',
    message: string
  ): void {
    this.activeSessions.delete(sessionId);
    this.abortedSessions.delete(sessionId);
    this.finishSessionSubagents(sessionId, outcome === 'done' ? 'completed' : 'failed');
    hitlService.cancelSession(sessionId, outcome === 'done' ? 'Сессия завершена' : message);
    this.setProjectStatus(projectPath, outcome === 'done' ? 'done' : outcome === 'error' ? 'error' : 'idle', message);

    const engine = this.sessionEngines.get(sessionId) ?? 'api';
    const startedAt = this.sessionStartedAt.get(sessionId);
    this.sessionEngines.delete(sessionId);
    this.sessionStartedAt.delete(sessionId);
    const base = { sessionId, projectPath, origin: 'studio' as const, engine, hostId: hitlService.currentHostId, at: Date.now(), durationMs: startedAt ? Date.now() - startedAt : undefined };
    if (outcome === 'error') {
      appEventBus.publish({ type: 'agent:failed', ...base, error: message });
    } else {
      appEventBus.publish({ type: 'agent:finished', ...base, outcome });
    }
  }

  public registerSubagent(subagent: SubagentInfo): void {
    const existing = this.activeSubagents.get(subagent.projectPath) || [];
    const idx = existing.findIndex((s) => s.id === subagent.id);
    if (idx >= 0) {
      existing[idx] = subagent;
    } else {
      existing.push(subagent);
    }
    this.activeSubagents.set(subagent.projectPath, existing);
    this.emit('subagentUpdated', subagent);
  }

  public getSubagents(projectPath: string): SubagentInfo[] {
    return this.activeSubagents.get(projectPath) || [];
  }

  /**
   * Завершает подагентов родительской сессии: ещё выполняющиеся получают итоговый статус
   * (с событием subagentUpdated для UI), после чего все подагенты сессии удаляются из реестра.
   */
  public finishSessionSubagents(sessionId: string, status: 'completed' | 'failed'): SubagentInfo[] {
    const finished: SubagentInfo[] = [];
    for (const [projectPath, list] of Array.from(this.activeSubagents.entries())) {
      const own = list.filter((s) => s.parentSessionId === sessionId);
      if (own.length === 0) continue;
      const rest = list.filter((s) => s.parentSessionId !== sessionId);
      if (rest.length > 0) {
        this.activeSubagents.set(projectPath, rest);
      } else {
        this.activeSubagents.delete(projectPath);
      }
      for (const sub of own) {
        const final: SubagentInfo = sub.status === 'running'
          ? { ...sub, status, completedAt: Date.now(), progress: status === 'completed' ? 'Родительская сессия завершена' : 'Родительская сессия прервана' }
          : sub;
        finished.push(final);
        this.emit('subagentUpdated', final);
      }
    }
    return finished;
  }

  private buildCliMissingMessage(detail: string): string {
    const reason = detail.trim() ? ` (${detail.trim()})` : '';
    return [
      `Claude CLI не найден или не запускается${reason}.`,
      'Установите Claude Code: `npm install -g @anthropic-ai/claude-code`, затем выполните вход',
      'через кнопку входа в настройках AI Studio или командой `claude auth login`.',
      'Либо укажите API-ключ Anthropic в настройках провайдера — тогда CLI не требуется.'
    ].join(' ');
  }

  /**
   * Проверяет доступность Claude CLI через `claude --version`.
   * Успешный результат кэшируется до перезапуска приложения, неуспешный — на CLAUDE_CLI_RECHECK_MS.
   * Параллельные вызовы делят одну проверку.
   */
  public ensureClaudeCliAvailable(force = false): Promise<ClaudeCliAvailability> {
    if (!force && this.claudeCliCheck) {
      const { checkedAt, ...cached } = this.claudeCliCheck;
      if (cached.available || Date.now() - checkedAt < CLAUDE_CLI_RECHECK_MS) {
        return Promise.resolve(cached);
      }
    }
    if (this.claudeCliCheckPromise) return this.claudeCliCheckPromise;

    this.claudeCliCheckPromise = new Promise<ClaudeCliAvailability>((resolve) => {
      let settled = false;
      // eslint-disable-next-line prefer-const -- присваивается ниже; finish() может сработать раньше (с const — TDZ)
      let timer: NodeJS.Timeout | undefined;
      const finish = (result: ClaudeCliAvailability) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.claudeCliCheck = { ...result, checkedAt: Date.now() };
        this.claudeCliCheckPromise = null;
        if (!result.available) console.warn('[ClaudeBridge] Claude CLI недоступен:', result.message);
        resolve(result);
      };

      let child: ChildProcess;
      try {
        child = spawn('claude', ['--version'], {
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, FORCE_COLOR: '0', CLAUDE_CONFIG_DIR: PROJECT_HUB_CLAUDE_DIR }
        });
      } catch (err: any) {
        finish({ available: false, message: this.buildCliMissingMessage(err?.message || String(err)) });
        return;
      }

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf-8'); });
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf-8'); });
      child.stdout?.on('error', () => {});
      child.stderr?.on('error', () => {});

      timer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        finish({
          available: false,
          message: `Claude CLI не ответил на \`claude --version\` за ${CLAUDE_CLI_CHECK_TIMEOUT_MS / 1000} с. Проверьте установку и PATH.`
        });
      }, CLAUDE_CLI_CHECK_TIMEOUT_MS);

      child.on('error', (err) => finish({ available: false, message: this.buildCliMissingMessage(err.message) }));
      child.on('close', (code) => {
        if (code === 0) {
          const version = stdout.trim().split('\n')[0] || undefined;
          console.log(`[ClaudeBridge] Claude CLI доступен: ${version || 'версия неизвестна'}`);
          finish({ available: true, version });
        } else {
          finish({ available: false, message: this.buildCliMissingMessage(stderr.trim() || `код выхода ${code}`) });
        }
      });
    });

    return this.claudeCliCheckPromise;
  }

  /**
   * Прерывает сессию: отклоняет ожидающие одобрения, останавливает стрим API и убивает
   * процесс Claude CLI и команды агента. Если сессия была активна, статус проекта → idle.
   */
  public abortSession(sessionId: string): void {
    const projectPath = this.activeSessions.get(sessionId);
    if (projectPath) this.abortedSessions.add(sessionId);

    this.rejectPendingApprovals(sessionId);
    aiAgentService.abortStream(sessionId);
    this.killSessionProcesses(sessionId);

    if (projectPath) {
      const current = this.projectStatuses.get(projectPath)?.status;
      if (current === 'running' || current === 'waiting_approval') {
        this.setProjectStatus(projectPath, 'idle', 'Сессия прервана пользователем');
      }
    }
  }

  private killSessionProcesses(sessionId: string): void {
    const proc = this.activeProcesses.get(sessionId);
    if (proc) {
      killProcessTree(proc);
      this.activeProcesses.delete(sessionId);
    }
    const subs = this.sessionSubprocesses.get(sessionId);
    if (subs) {
      for (const child of subs) killProcessTree(child);
      this.sessionSubprocesses.delete(sessionId);
    }
  }

  /** Полная очистка сессии (закрытие/очистка диалога в UI): процессы, одобрения, CLI-id. */
  public clearSession(sessionId: string): void {
    this.abortSession(sessionId);
    this.sessionClaudeCliIds.delete(sessionId);
    this.finishSessionSubagents(sessionId, 'failed');
  }

  /** Остановка всего при выходе из приложения (performGracefulShutdown). */
  public killAll(): void {
    this.rejectPendingApprovals(undefined, 'Приложение закрывается');
    for (const sessionId of Array.from(this.activeSessions.keys())) {
      aiAgentService.abortStream(sessionId);
    }
    for (const sessionId of Array.from(new Set([...this.activeProcesses.keys(), ...this.sessionSubprocesses.keys()]))) {
      this.killSessionProcesses(sessionId);
    }
    this.activeSessions.clear();
    this.abortedSessions.clear();
    this.activeSubagents.clear();
    this.sessionClaudeCliIds.clear();
    this.cliPermissionContexts.clear();
    this.cliToolUseRequests.clear();
    this.sessionEngines.clear();
    this.sessionStartedAt.clear();
  }

  /**
   * Готовит запуск Claude CLI с Human-in-the-loop: MCP-конфиг встроенного сервера (с привязкой
   * подключения к sessionId через query-параметр) и файл настроек с правилами `permissions.ask`.
   * Файлы пишутся в ~/.projecthub/claude_config/hitl и удаляются по завершении процесса.
   * null — брокер не задан или сервер поднять не удалось.
   *
   * Публичный: тем же путём Swarm/Handoff запускают своих агентов (TASK-57), передавая в `meta`
   * источник, роль и её права. `env` содержит MCP_TOOL_TIMEOUT для дочернего процесса.
   */
  public async prepareCliPermissions(
    sessionId: string,
    projectPath: string,
    config: AIProviderConfig,
    onChunk: (chunk: ClaudeBridgeMessageChunk) => void,
    meta: CliPermissionMeta = {}
  ): Promise<{ args: string[]; env: Record<string, string>; cleanup: () => void } | null> {
    if (!this.cliPermissionBroker) return null;
    let endpoint: CliPermissionEndpoint | null = null;
    try {
      endpoint = await this.cliPermissionBroker.ensureEndpoint();
    } catch (err) {
      console.error('[ClaudeBridge] Не удалось получить адрес MCP-сервера для HITL:', err);
    }
    if (!endpoint) return null;

    const files: string[] = [];
    const cleanup = () => {
      for (const f of files) {
        fs.unlink(f).catch(() => { /* файл мог быть уже удалён */ });
      }
    };

    try {
      const dir = path.join(PROJECT_HUB_CLAUDE_DIR, 'hitl');
      await fs.mkdir(dir, { recursive: true });
      const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');

      const sseUrl = new URL(endpoint.url);
      sseUrl.searchParams.set(CLI_HITL_QUERY_PARAM, sessionId);
      const mcpConfigPath = path.join(dir, `${safeId}.mcp.json`);
      await fs.writeFile(
        mcpConfigPath,
        JSON.stringify({
          mcpServers: {
            [CLI_HITL_MCP_SERVER_NAME]: {
              type: 'sse',
              url: sseUrl.toString(),
              headers: { Authorization: `Bearer ${endpoint.token}` }
            }
          }
        }),
        { encoding: 'utf-8', mode: 0o600 }
      );
      files.push(mcpConfigPath);

      const args = [
        '--mcp-config', quoteShellArg(mcpConfigPath),
        '--permission-prompt-tool', `mcp__${CLI_HITL_MCP_SERVER_NAME}__${CLI_HITL_PERMISSION_TOOL}`
      ];

      const effective = applyRolePermissions(config, meta.permissions);
      const settings = buildCliPermissionSettings(effective);
      if (settings) {
        const settingsPath = path.join(dir, `${safeId}.settings.json`);
        await fs.writeFile(settingsPath, JSON.stringify(settings), { encoding: 'utf-8', mode: 0o600 });
        files.push(settingsPath);
        args.push('--settings', quoteShellArg(settingsPath));
      }

      this.registerCliPermissionContext(sessionId, projectPath, effective, onChunk, meta);
      const cleanupAll = () => {
        this.cliPermissionContexts.delete(sessionId);
        cleanup();
      };
      return { args, env: { MCP_TOOL_TIMEOUT: String(CLI_MCP_TOOL_TIMEOUT_MS) }, cleanup: cleanupAll };
    } catch (err) {
      console.error('[ClaudeBridge] Не удалось подготовить файлы HITL для Claude CLI:', err);
      cleanup();
      return null;
    }
  }

  public getActiveProcessCount(): number {
    let count = this.activeProcesses.size;
    for (const subs of this.sessionSubprocesses.values()) count += subs.size;
    return count;
  }

  public parseQuestionData(args: Record<string, any>): QuestionData {
    const title = args.title || 'Вопрос от ассистента';
    let subtitle = args.question || args.prompt || args.subtitle || args.description || '';
    let isMultiSelect = Boolean(args.is_multi_select || args.isMultiSelect || args.multiple);
    let rawOptions: any[] = [];

    if (Array.isArray(args.questions) && args.questions.length > 0) {
      const q0 = args.questions[0];
      if (q0.question) subtitle = q0.question;
      if (q0.is_multi_select !== undefined) isMultiSelect = Boolean(q0.is_multi_select);
      if (Array.isArray(q0.options)) rawOptions = q0.options;
    } else if (Array.isArray(args.options)) {
      rawOptions = args.options;
    } else if (Array.isArray(args.choices)) {
      rawOptions = args.choices;
    }

    const options: QuestionOption[] = rawOptions.map((opt, idx) => {
      if (typeof opt === 'string') {
        const dashIdx = opt.indexOf(' - ');
        if (dashIdx > 0) {
          return {
            id: `opt-${idx}`,
            label: opt.slice(0, dashIdx).trim(),
            description: opt.slice(dashIdx + 3).trim()
          };
        }
        return {
          id: `opt-${idx}`,
          label: opt,
          description: undefined
        };
      } else if (typeof opt === 'object' && opt !== null) {
        return {
          id: opt.id || `opt-${idx}`,
          label: opt.label || opt.text || opt.title || opt.name || `Вариант ${idx + 1}`,
          description: opt.description || opt.desc || opt.detail
        };
      }
      return {
        id: `opt-${idx}`,
        label: String(opt)
      };
    });

    return {
      title,
      subtitle,
      options,
      isMultiSelect,
      allowOther: args.allowOther ?? true
    };
  }

  /** Реализация вынесена в чистый модуль hitlPolicy (TASK-57); методы оставлены для совместимости. */
  public isPathExcluded(filePath: string, patterns: string[] = []): boolean {
    return policyIsPathExcluded(filePath, patterns);
  }

  public isCommandDenied(command: string, denyList: string[] = []): boolean {
    return policyIsCommandDenied(command, denyList);
  }

  /**
   * Run autonomous agent loop with Human-in-the-Loop approvals and subagents
   */
  public async runAgentTask(
    req: {
      sessionId: string;
      projectPath: string;
      messages: AIMessage[];
      config: AIProviderConfig;
      mode: 'agent' | 'chat' | 'architect';
      claudeCliSessionId?: string;
      /** Задача, привязанная к сессии AI Studio (TASK-64) — по ней contextBuilder собирает контекст. */
      taskId?: string;
      contextParts?: Partial<Record<'task' | 'rag' | 'gitnexus' | 'git', boolean>>;
    },
    onChunk: (chunk: ClaudeBridgeMessageChunk) => void,
    onComplete: (msg: AIMessage) => void,
    onError: (err: string) => void
  ): Promise<void> {
    const { sessionId, projectPath } = req;
    const isMasterAutoApprove = Boolean(req.config.autoApprove);
    const rules = req.config.autoApproveRules;
    const canAutoCommands = isMasterAutoApprove && (rules ? rules.allowCommands !== false : true);
    const canAutoWrite = isMasterAutoApprove && (rules ? rules.allowFileWrite !== false : true);
    const canAutoRead = rules ? rules.allowFileRead !== false : true;
    const canAutoSubagents = isMasterAutoApprove && (rules ? rules.allowSubagents !== false : true);

    // If using Anthropic without API key, run directly via local Claude CLI subscription!
    const useCli = req.config.provider === 'anthropic' && (!req.config.apiKey || !req.config.apiKey.trim());
    this.startSession(sessionId, projectPath, useCli ? 'claude-cli' : 'api');
    this.setProjectStatus(projectPath, 'running', 'Агент анализирует задачу...');

    if (useCli) {
      return this.runClaudeCliTask(req, onChunk, onComplete, onError);
    }

    try {
      // Stream Claude thought & tool planning through aiAgentService
      await aiAgentService.streamChat(
        req,
        async (chunk) => {
          onChunk(chunk);
          if (!chunk.toolCall) return;

          // Обработчик чанка никто не await'ит: отклонение промиса (отмена одобрения при
          // abortSession) или ошибка инструмента иначе стали бы unhandled rejection.
          try {
            await this.handleApiToolCall(chunk.toolCall, req, rules, { canAutoCommands, canAutoWrite, canAutoRead, canAutoSubagents }, onChunk);
          } catch (err: any) {
            const tc = chunk.toolCall;
            if (err instanceof ApprovalCancelledError) {
              tc.status = 'rejected';
              tc.result = err.message;
            } else {
              tc.status = 'error';
              tc.result = `Error: ${err?.message || String(err)}`;
            }
            onChunk({ toolCall: tc });
          }
        },
        (completedMsg) => {
          this.finishSession(sessionId, projectPath, 'done', 'Задача успешно выполнена');
          onComplete(completedMsg);
        },
        (err) => {
          this.finishSession(sessionId, projectPath, 'error', `Ошибка: ${err}`);
          onError(err);
        }
      );
      // streamChat при AbortError не зовёт ни onComplete, ни onError — закрываем сессию как отменённую.
      if (this.activeSessions.has(sessionId)) {
        this.finishSession(sessionId, projectPath, 'aborted', 'Сессия прервана пользователем');
      }
    } catch (err: any) {
      this.finishSession(sessionId, projectPath, 'error', err.message);
      onError(err.message);
    }
  }

  /** Запуск команды агента: в фоне через processManager (background: true) или с ожиданием и таймаутом. */
  private async runCommandTool(
    tc: AIToolCall,
    cmd: string,
    sessionId: string,
    projectPath: string,
    rules: AutoApproveRules | undefined,
    onChunk: (chunk: ClaudeBridgeMessageChunk) => void
  ): Promise<void> {
    this.setProjectStatus(projectPath, 'running', `Выполняется: ${cmd}`);

    if (tc.args.background === true) {
      const name = String(tc.args.name || `agent-${Date.now().toString(36)}`).trim();
      const info = await processManager.startProcess(projectPath, cmd, name);
      tc.status = 'accepted';
      tc.result = `Процесс "${info.name}" запущен в фоне (pid ${info.pid ?? '?'}, id "${info.id}"). `
        + 'Цикл агента не блокируется; логи и остановка — во вкладке Processes.';
      onChunk({ toolCall: tc });
      return;
    }

    const timeoutSec = rules?.commandTimeoutSec;
    const timeoutMs = typeof timeoutSec === 'number' && timeoutSec > 0 ? timeoutSec * 1000 : SUBPROCESS_DEFAULT_TIMEOUT_MS;
    const res = await this.executeSubprocess(
      cmd,
      projectPath,
      (outputSoFar) => {
        tc.status = 'running';
        tc.result = outputSoFar;
        onChunk({ toolCall: { ...tc } });
      },
      { sessionId, timeoutMs }
    );
    tc.status = res.timedOut ? 'error' : 'accepted';
    tc.result = this.formatSubprocessResult(res, timeoutMs);
    onChunk({ toolCall: tc });
  }

  private formatSubprocessResult(res: SubprocessResult, timeoutMs: number): string {
    const output = res.truncated
      ? `[… вывод усечён, показан только последний ${Math.round(SUBPROCESS_MAX_OUTPUT_BYTES / 1024)} КБ …]\n${res.output}`
      : res.output;
    if (res.timedOut) {
      return `Команда прервана по таймауту (${Math.round(timeoutMs / 1000)} с) и убита вместе с дочерними процессами. `
        + 'Для долгоживущих процессов (dev-серверы, вотчеры) запускай run_command с background: true.\n' + output;
    }
    if (res.exitCode === 0) {
      return output || 'Команда успешно выполнена (код 0)';
    }
    return `Команда завершилась с кодом ${res.exitCode}:\n${output}`;
  }

  private async handleApiToolCall(
    tc: AIToolCall,
    req: { sessionId: string; projectPath: string; config: AIProviderConfig },
    rules: AutoApproveRules | undefined,
    perms: { canAutoCommands: boolean; canAutoWrite: boolean; canAutoRead: boolean; canAutoSubagents: boolean },
    onChunk: (chunk: ClaudeBridgeMessageChunk) => void
  ): Promise<void> {
    const { sessionId, projectPath } = req;
    const { canAutoCommands, canAutoWrite } = perms;
    const timeoutMs = this.approvalTimeoutMs(req.config);
    const meta = { origin: 'studio' as const, engine: 'api' as const, tool: tc.name };
    const autoInfo = (type: ApprovalRequest['type'], extra: Partial<ApprovalRequest> = {}) =>
      ({ sessionId, projectPath, type, title: `${tc.name}`, ...meta, ...extra });
    if (tc.name === 'ask_question' || tc.name === 'AskUserQuestion') {
      const qData = this.parseQuestionData(tc.args);
      const approvalReq: ApprovalRequest = {
        id: hitlService.newRequestId(),
        sessionId,
        projectPath,
        ...meta,
        type: 'question',
        title: qData.title || 'Вопрос от ассистента',
        details: qData.subtitle,
        questionData: qData,
        createdAt: Date.now()
      };

      onChunk({ approvalRequest: approvalReq });
      const res = await this.requestApproval(approvalReq, { timeoutMs });
      tc.status = res.approved ? 'accepted' : 'rejected';
      tc.result = res.text || (res.approved ? 'Подтверждено пользователем' : 'Отклонено пользователем');
      onChunk({ toolCall: tc });
    } else if (tc.name === 'read_file' || tc.name === 'read') {
      const filePath = tc.args.filePath || tc.args.path || '';
      const isExcludedFromRead = rules?.readExcludePatterns && this.isPathExcluded(filePath, rules.readExcludePatterns);

      if (isExcludedFromRead) {
        const approvalReq: ApprovalRequest = {
          id: hitlService.newRequestId(),
          sessionId,
          projectPath,
          ...meta,
          filePath,
          type: 'question',
          title: `Разрешение на чтение защищенного файла`,
          details: `Файл ${filePath} находится в списке исключений для чтения. Разрешить агенту доступ?`,
          questionData: {
            title: 'Чтение защищенного файла',
            subtitle: `Разрешить агенту прочитать файл ${filePath}?`,
            options: [
              { id: 'allow', label: 'Разрешить чтение', description: 'Предоставить агенту содержимое файла' },
              { id: 'deny', label: 'Запретить чтение', description: 'Скрыть содержимое файла от агента' }
            ],
            isMultiSelect: false,
            allowOther: false
          },
          createdAt: Date.now()
        };

        onChunk({ approvalRequest: approvalReq });
        const res = await this.requestApproval(approvalReq, { timeoutMs });
        if (!res.approved || res.text?.includes('deny') || res.text?.includes('Запретить')) {
          tc.status = 'rejected';
          tc.result = `Доступ к чтению файла ${filePath} отклонен пользователем`;
          onChunk({ toolCall: tc });
          return;
        }
      }
    } else if (tc.name === 'run_command' || tc.name === 'bash') {
      const cmd = tc.args.command || tc.args.cmd || '';
      const isDenied = rules?.commandDenyList && this.isCommandDenied(cmd, rules.commandDenyList);
      const shouldAutoRun = canAutoCommands && !isDenied;
      const runApproved = async (requestId: string) => {
        try {
          await this.runCommandTool(tc, cmd, sessionId, projectPath, rules, onChunk);
          hitlService.recordOutcome(requestId, tc.status === 'error' ? 'failed' : 'executed');
        } catch (e: any) {
          tc.status = 'error';
          tc.result = `Error: ${e.message}`;
          onChunk({ toolCall: tc });
          hitlService.recordOutcome(requestId, 'failed', e?.message);
        }
      };

      if (shouldAutoRun) {
        await runApproved(hitlService.recordAutoDecision(autoInfo('command', { command: cmd }), 'allow', 'auto-command'));
      } else {
        const approvalReq: ApprovalRequest = {
          id: hitlService.newRequestId(),
          sessionId,
          projectPath,
          ...meta,
          type: 'command',
          title: isDenied ? `⚠️ Заблокированная команда требует подтверждения: ${cmd}` : `Разрешение на запуск команды: ${cmd}`,
          command: cmd,
          details: tc.args.explanation || (isDenied ? 'Команда находится в списке запрещенных для авто-запуска' : 'Выполнение команды терминала'),
          createdAt: Date.now()
        };

        onChunk({ approvalRequest: approvalReq });
        const res = await this.requestApproval(approvalReq, { timeoutMs });

        if (res.approved) {
          await runApproved(approvalReq.id);
        } else {
          tc.status = 'rejected';
          tc.result = `Отклонено пользователем: ${res.text || 'Без комментария'}`;
          onChunk({ toolCall: tc });
        }
      }
      this.setProjectStatus(projectPath, 'running', 'Обработка результатов...');
    } else if (tc.name === 'write_file' || tc.name === 'write_to_file') {
      const filePath = tc.args.filePath || tc.args.path || '';
      const content = tc.args.content || '';
      const isExcluded = rules?.writeExcludePatterns && this.isPathExcluded(filePath, rules.writeExcludePatterns);
      const shouldAutoWrite = canAutoWrite && !isExcluded;

      const applyApproved = async (requestId: string, successMessage: string) => {
        try {
          await aiAgentService.applyDiff(projectPath, filePath, content);
          tc.status = 'accepted';
          tc.result = successMessage;
          onChunk({ toolCall: tc });
          hitlService.recordOutcome(requestId, 'executed');
        } catch (e: any) {
          hitlService.recordOutcome(requestId, 'failed', e?.message);
          throw e;
        }
      };

      if (!isInsideProject(projectPath, filePath)) {
        // Абсолютный путь вне проекта или выход через `..` — отклоняем до любых
        // одобрений, даже при auto-approve, и объясняем модели причину (TASK-32).
        tc.status = 'rejected';
        tc.result = `Запись отклонена: путь "${filePath}" находится вне корня проекта "${projectPath}". `
          + 'Разрешены только пути внутри проекта — укажи путь относительно его корня без выхода через "..".';
        onChunk({ toolCall: tc });
        hitlService.recordAutoDecision(autoInfo('file_write', { filePath }), 'deny', 'outside-project', tc.result);
      } else if (shouldAutoWrite) {
        await applyApproved(
          hitlService.recordAutoDecision(autoInfo('file_write', { filePath }), 'allow', 'auto-write'),
          `Файл ${filePath} успешно записан`
        );
      } else {
        let oldContent = '';
        const fullPath = path.resolve(projectPath, filePath);
        if (existsSync(fullPath)) {
          try {
            oldContent = await fs.readFile(fullPath, 'utf-8');
          } catch {}
        }
        const patch = aiAgentService.generateDiff(oldContent, content, filePath);
        tc.diff = { filePath, oldContent, newContent: content, patch };

        const approvalReq: ApprovalRequest = {
          id: hitlService.newRequestId(),
          sessionId,
          projectPath,
          ...meta,
          type: 'file_write',
          title: isExcluded ? `⚠️ Файл в списке исключений: ${filePath}` : `Разрешение на запись файла: ${filePath}`,
          filePath,
          details: isExcluded ? 'Файл защищен списком исключений авто-одобрения' : (tc.args.explanation || 'Изменение содержимого файла'),
          diff: tc.diff,
          createdAt: Date.now()
        };

        onChunk({ approvalRequest: approvalReq, toolCall: tc });
        const res = await this.requestApproval(approvalReq, { timeoutMs });
        if (res.approved) {
          await applyApproved(approvalReq.id, `Файл ${filePath} успешно сохранен`);
        } else {
          tc.status = 'rejected';
          tc.result = `Отклонено пользователем: ${res.text || 'Без комментария'}`;
          onChunk({ toolCall: tc });
        }
      }
    } else if (tc.name === 'spawn_subagent' || tc.name === 'dispatch_agent') {
      const subTask = tc.args.task || tc.args.prompt || 'Подзадача';
      const subagentId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const subagent: SubagentInfo = {
        id: subagentId,
        parentSessionId: sessionId,
        projectPath,
        name: tc.args.name || `Подагент #${subagentId.slice(-4)}`,
        task: subTask,
        status: 'running',
        progress: 'Инициализация подзадачи...',
        startedAt: Date.now()
      };

      this.registerSubagent(subagent);
      onChunk({ subagent });
    }
  }

  private async runClaudeCliTask(
    req: {
      sessionId: string;
      projectPath: string;
      messages: AIMessage[];
      config: AIProviderConfig;
      mode: 'agent' | 'chat' | 'architect';
      claudeCliSessionId?: string;
      taskId?: string;
      contextParts?: Partial<Record<'task' | 'rag' | 'gitnexus' | 'git', boolean>>;
    },
    onChunk: (chunk: ClaudeBridgeMessageChunk) => void,
    onComplete: (msg: AIMessage) => void,
    onError: (err: string) => void
  ): Promise<void> {
    const { sessionId, projectPath, messages } = req;
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    if (!lastUserMessage.trim()) {
      onComplete({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: 'Пожалуйста, введите сообщение.',
        timestamp: new Date().toISOString()
      });
      return;
    }

    const cliCheck = await this.ensureClaudeCliAvailable();
    if (!cliCheck.available) {
      const message = cliCheck.message || 'Claude CLI недоступен.';
      this.finishSession(sessionId, projectPath, 'error', message);
      onError(message);
      return;
    }
    if (this.abortedSessions.has(sessionId)) {
      // Пользователь прервал сессию, пока шла проверка CLI.
      this.finishSession(sessionId, projectPath, 'aborted', 'Сессия прервана пользователем');
      onComplete({ id: `msg-${Date.now()}`, role: 'assistant', content: '*(Отменено пользователем)*', timestamp: new Date().toISOString() });
      return;
    }

    const existingCliSessionId = req.claudeCliSessionId || this.sessionClaudeCliIds.get(sessionId);
    const cliArgs = ['-p'];
    if (existingCliSessionId) {
      cliArgs.push('--resume', existingCliSessionId);
    }
    if (req.config.model && req.config.model !== 'default') {
      cliArgs.push('--model', req.config.model);
    }

    // Контекст задачи (TASK-64) — задача/AC, RAG, GitNexus и git-статус в системный промпт
    // Claude CLI через тот же канал `--append-system-prompt`, что и роли в agentFleetService.
    if (req.taskId) {
      try {
        const agentContext = await buildAgentContext({
          projectPath,
          taskId: req.taskId,
          enabledParts: req.contextParts
        });
        if (agentContext.combined) {
          cliArgs.push('--append-system-prompt', agentContext.combined);
        }
      } catch (err) {
        console.warn('[claudeBridgeService] contextBuilder failed:', err);
      }
    }

    // Human-in-the-loop (TASK-42): разрешения запрашиваются через встроенный MCP-сервер
    // до выполнения инструмента. --dangerously-skip-permissions — только как запасной
    // вариант при auto-approve, если сервер поднять не удалось.
    const hitl = await this.prepareCliPermissions(sessionId, projectPath, req.config, onChunk, { origin: 'studio', engine: 'claude-cli' });
    let hitlWarning = '';
    if (hitl) {
      cliArgs.push(...hitl.args);
    } else if (req.config.autoApprove) {
      cliArgs.push('--dangerously-skip-permissions');
      hitlWarning = '> ⚠️ Встроенный MCP-сервер ProjectHub недоступен: Claude Code запущен без проверки разрешений, '
        + 'списки исключений и запрещённых команд в этом ответе не применяются.\n\n';
      hitlService.recordFallback({
        sessionId,
        projectPath,
        origin: 'studio',
        engine: 'claude-cli',
        reason: 'Встроенный MCP-сервер недоступен, включено авто-одобрение: запуск с --dangerously-skip-permissions'
      });
    } else {
      const message = 'Не удалось запустить встроенный MCP-сервер ProjectHub, через который Claude Code запрашивает '
        + 'подтверждения действий. Включите сервер в настройках MCP (или освободите его порт) либо включите авто-одобрение в настройках AI Studio.';
      this.finishSession(sessionId, projectPath, 'error', message);
      onError(message);
      return;
    }
    cliArgs.push('--output-format', 'stream-json', '--verbose');

    const cleanupHitl = () => {
      this.cliPermissionContexts.delete(sessionId);
      hitl?.cleanup();
    };
    const hitlEnv = hitl?.env ?? { MCP_TOOL_TIMEOUT: String(CLI_MCP_TOOL_TIMEOUT_MS) };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(
        'claude',
        cliArgs,
        {
          cwd: projectPath,
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            FORCE_COLOR: '0',
            CLAUDE_CONFIG_DIR: PROJECT_HUB_CLAUDE_DIR,
            // Инструмент разрешений ждёт человека — стандартный таймаут MCP-инструмента слишком мал.
            ...hitlEnv
          }
        }
      );
    } catch (err: any) {
      cleanupHitl();
      const message = `Не удалось запустить Claude CLI: ${err?.message || String(err)}`;
      this.finishSession(sessionId, projectPath, 'error', message);
      onError(message);
      return;
    }

    this.activeProcesses.set(sessionId, child);
    if (hitlWarning) onChunk({ text: hitlWarning });

    // Гарантируем, что onComplete/onError для сессии вызываются ровно один раз:
    // события 'error' и 'close' у ChildProcess могут прийти оба.
    let finished = false;
    let stdinError: string | null = null;
    const failSession = (message: string) => {
      if (finished) return;
      finished = true;
      this.activeProcesses.delete(sessionId);
      cleanupHitl();
      this.finishSession(sessionId, projectPath, 'error', message);
      onError(message);
    };

    // Ошибки на stdio-потоках (например EPIPE, если оболочка или CLI завершились мгновенно)
    // без обработчика становятся uncaughtException и роняют весь main-процесс.
    // Для stdin не завершаем сессию сразу: итог решает 'close' (там есть stderr и код выхода).
    child.stdin.on('error', (err) => {
      stdinError = err.message;
      console.warn(`[ClaudeBridge] stdin error for session ${sessionId}:`, err.message);
    });
    child.stdout.on('error', (err) => failSession(`Ошибка чтения вывода Claude CLI: ${err.message}`));
    child.stderr.on('error', (err) => failSession(`Ошибка чтения stderr Claude CLI: ${err.message}`));

    let accumulatedText = hitlWarning;
    let accumulatedThought = '';
    const toolCalls: AIToolCall[] = [];
    let buffer = '';
    let resultUsage: AgentUsage | undefined;

    child.stdout.on('data', async (data: Buffer) => {
      buffer += data.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('{')) continue;

        try {
          const event = JSON.parse(trimmed);

          if (event.session_id) {
            this.sessionClaudeCliIds.set(sessionId, event.session_id);
            onChunk({ claudeCliSessionId: event.session_id });
          }

          if (event.type === 'rate_limit_event' || event.rate_limit_info) {
            const info = event.rate_limit_info || event;
            // Единственный бесплатный источник окон лимитов для бейджа Usage (TASK-44).
            claudeUsageService.noteRateLimitEvent(info);
            const utilization = info.utilization ?? info.unifiedWindows?.[0]?.utilization;
            const resetsAt = info.resetsAt || info.reset_at || info.unifiedWindows?.[0]?.resetsAt;
            const warning: RateLimitWarning = {
              id: `rl-${Date.now()}`,
              type: info.status === 'throttled' ? 'throttled' : 'rate_limit',
              title: info.status === 'throttled' ? 'Достигнут лимит запросов Claude Code' : 'Приближение к лимиту запросов Claude Code',
              message: info.message || `Использовано ${utilization ? Math.round(utilization * 100) : 85}% доступного лимита запросов.`,
              utilization: utilization ? Math.round(utilization * 100) : 85,
              resetsAt: resetsAt ? new Date(resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined,
              timestamp: Date.now()
            };
            onChunk({ rateLimitWarning: warning });
          }

          if (event.type === 'assistant' && event.message?.content) {
            for (const item of event.message.content) {
              if (item.type === 'text') {
                accumulatedText += item.text;
                onChunk({ text: item.text });

                // Check text for rate limit warning phrases
                const lowerText = item.text.toLowerCase();
                if (lowerText.includes('rate limit') || (lowerText.includes('used ') && lowerText.includes('% of your'))) {
                  const matchPercent = item.text.match(/(\d+)%/);
                  const percent = matchPercent ? parseInt(matchPercent[1], 10) : 85;
                  const warning: RateLimitWarning = {
                    id: `rl-${Date.now()}`,
                    type: percent >= 100 ? 'throttled' : 'rate_limit',
                    title: percent >= 100 ? 'Достигнут лимит запросов Claude Code' : `Приближение к лимиту запросов (${percent}%)`,
                    message: item.text,
                    utilization: percent,
                    timestamp: Date.now()
                  };
                  onChunk({ rateLimitWarning: warning });
                }
              } else if (item.type === 'thinking') {
                accumulatedThought += item.thinking;
                onChunk({ thought: item.thinking });
              } else if (item.type === 'tool_use') {
                const tc: AIToolCall = {
                  id: item.id || `tool-${Date.now()}`,
                  name: item.name,
                  args: item.input || {}
                };
                toolCalls.push(tc);
                // Карточки одобрения здесь больше не создаются: событие tool_use приходит уже
                // после решения о разрешении. Одобрение запрашивается до выполнения инструмента
                // через --permission-prompt-tool → handleCliPermissionRequest (TASK-42).
                onChunk({ toolCall: tc });
              }
            }
          } else if (event.type === 'user') {
            // Результаты инструментов (tool_result) — в аудит HITL по tool_use_id (TASK-57).
            this.noteCliUserEvent(event);
          } else if (event.type === 'result') {
            if (event.result && typeof event.result === 'string' && !accumulatedText) {
              accumulatedText = event.result;
              onChunk({ text: event.result });
            }
            // Реальные токены и total_cost_usd ответа — в сообщение AI Studio (TASK-56).
            const summary = parseClaudeResultEvent(event);
            if (summary && (summary.usage.totalTokens > 0 || typeof summary.usage.costUsd === 'number')) {
              resultUsage = priceUsage(summary.usage, summary.usage.model);
              onChunk({ usage: resultUsage });
            }
          }
        } catch {
          // Check non-json line for warning
          if (trimmed.includes('rate limit') || trimmed.includes('429 Too Many')) {
            const warning: RateLimitWarning = {
              id: `rl-${Date.now()}`,
              type: 'rate_limit',
              title: 'Предупреждение о лимитах Claude Code',
              message: trimmed,
              timestamp: Date.now()
            };
            onChunk({ rateLimitWarning: warning });
          }
        }
      }
    });

    let stderrOutput = '';
    child.stderr.on('data', (data) => {
      const chunkStr = data.toString();
      stderrOutput += chunkStr;

      if (chunkStr.includes('rate limit') || chunkStr.includes('429 Too Many')) {
        const warning: RateLimitWarning = {
          id: `rl-${Date.now()}`,
          type: 'rate_limit',
          title: 'Предупреждение о лимитах Claude Code',
          message: chunkStr.trim(),
          timestamp: Date.now()
        };
        onChunk({ rateLimitWarning: warning });
      }
    });

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      this.activeProcesses.delete(sessionId);
      cleanupHitl();
      const aborted = this.abortedSessions.has(sessionId);
      if (code === 0 || accumulatedText || aborted) {
        const completeMsg: AIMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: aborted ? `${accumulatedText}\n\n*(Отменено пользователем)*`.trim() : accumulatedText,
          thought: accumulatedThought,
          toolCalls: toolCalls.map((tc) => ({
            ...tc,
            status: tc.status || 'done'
          })),
          timestamp: new Date().toISOString(),
          ...(resultUsage ? { usage: resultUsage } : {})
        };
        if (aborted) {
          this.finishSession(sessionId, projectPath, 'aborted', 'Сессия прервана пользователем');
        } else {
          this.finishSession(sessionId, projectPath, 'done', 'Задача успешно выполнена');
        }
        onComplete(completeMsg);
      } else {
        const err =
          stderrOutput ||
          (stdinError ? `Не удалось передать запрос в Claude CLI: ${stdinError}` : '') ||
          `Claude Code завершился с кодом ${code}`;
        this.finishSession(sessionId, projectPath, 'error', err);
        onError(err);
      }
    });

    child.on('error', (err) => failSession(err.message));

    // Передаём запрос через stdin (без экранирования аргументов оболочки) — только после навешивания всех обработчиков.
    try {
      child.stdin.write(lastUserMessage, 'utf-8');
      child.stdin.end();
    } catch (err: any) {
      failSession(`Не удалось передать запрос в Claude CLI: ${err?.message || String(err)}`);
      killProcessTree(child);
    }
  }

  /**
   * Выполняет команду оболочки с ожиданием завершения. Таймаут (по умолчанию 5 минут) убивает
   * дерево процессов через tree-kill; вывод ограничен maxOutputBytes (хранится «хвост»).
   * `onProgress` получает уже ограниченный снимок вывода. Ошибки запуска — reject.
   */
  public executeSubprocess(
    command: string,
    cwd: string,
    onProgress?: (outputSoFar: string) => void,
    options: SubprocessOptions = {}
  ): Promise<SubprocessResult> {
    const timeoutMs = options.timeoutMs ?? SUBPROCESS_DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes ?? SUBPROCESS_MAX_OUTPUT_BYTES;
    const { sessionId } = options;

    return new Promise((resolve, reject) => {
      const isWin = process.platform === 'win32';
      const shell = isWin ? 'powershell.exe' : '/bin/bash';
      const args = isWin ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(shell, args, {
          cwd,
          env: { ...process.env, FORCE_COLOR: '0' }
        });
      } catch (err) {
        reject(err);
        return;
      }

      if (sessionId) {
        const set = this.sessionSubprocesses.get(sessionId) ?? new Set<ChildProcess>();
        set.add(child);
        this.sessionSubprocesses.set(sessionId, set);
      }

      let settled = false;
      let timedOut = false;
      let truncated = false;
      let output = '';
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          timedOut = true;
          killProcessTree(child);
        }, timeoutMs)
        : undefined;

      const untrack = () => {
        if (timer) clearTimeout(timer);
        if (sessionId) {
          const set = this.sessionSubprocesses.get(sessionId);
          if (set) {
            set.delete(child);
            if (set.size === 0) this.sessionSubprocesses.delete(sessionId);
          }
        }
      };
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        untrack();
        fn();
      };

      const append = (data: Buffer) => {
        output += data.toString();
        if (output.length > maxOutputBytes) {
          output = output.slice(-maxOutputBytes);
          truncated = true;
        }
        onProgress?.(output);
      };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      // Необработанное 'error' на stdio-потоке роняет main-процесс
      child.stdin.on('error', (err) => settle(() => reject(err)));
      child.stdout.on('error', (err) => settle(() => reject(err)));
      child.stderr.on('error', (err) => settle(() => reject(err)));

      child.on('close', (code) => {
        settle(() => resolve({ output, exitCode: code, timedOut, truncated }));
      });

      child.on('error', (err) => settle(() => reject(err)));
    });
  }
}

export const claudeBridgeService = new ClaudeBridgeService();
