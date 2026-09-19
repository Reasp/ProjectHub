import fs from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import treeKill from 'tree-kill';
import { searchProjectDocs } from './ragSearch.js';
import { buildAgentContext, buildComputerUseInstructions } from './contextBuilder.js';
import { secretStorageService } from './secretStorageService.js';
import matter from 'gray-matter';
import { assertInsideProject, isInsideProject } from './pathGuard.js';
import { addUsage, estimateUsage, priceUsage, usageFromAnthropic, usageFromOpenAI, type AgentUsage } from './agentCost.js';
import { pricingService } from './pricingService.js';
import { isToolAllowed } from './hitlPolicy.js';
import { resolveOpenAICompatibleEndpoint } from './llmEndpoint.js';
import {
  UNKNOWN_MODEL_CAPABILITIES,
  buildAnthropicMessagesBody,
  isUnsetModelId,
  parseAnthropicModelCapabilities,
  resolveAnthropicModelId,
  type AnthropicModelCapabilities
} from './anthropicRequest.js';
import { buildOpenAICompatibleChatBody } from './openAICompatibleRequest.js';
import { legacyProviderCompat, legacyProviderIsLocal, type LlmCompatFlags } from './llmProfiles.js';
import { llmProfileService } from './llmProfileService.js';
import { extractReasoningDelta, normalizeReasoningEffort, type ReasoningEffort } from './reasoningEffort.js';
import {
  ProviderError,
  classifyHttpError,
  classifyNetworkError,
  classifyStreamError,
  describeProviderErrorBrief,
  providerConfigError,
  secretsFromHeaders,
  timeoutError,
  toProviderErrorInfo,
  type ProviderErrorContext,
  type ProviderErrorInfo
} from './providerErrors.js';

/** Адрес, заголовки и флаги запроса к OpenAI-совместимому серверу; `label` — для сообщений. */
interface OpenAICompatibleTarget {
  endpoint: string;
  headers: Record<string, string>;
  compat: LlmCompatFlags;
  label: string;
  /** Сервер на машине пользователя: стоимость 0 (decision-42). */
  local: boolean;
  /** Id профиля — для снимка ошибки (decision-43). */
  profileId?: string;
}

const ANTHROPIC_MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages';
import { logger } from './logger.js';
import { buildClaudeCliCompletionCommand, parseClaudeCliCompletionOutput } from './claudeCliCompletion.js';
import {
  DEFAULT_MAX_TOOL_STEPS,
  OpenAIToolCallAccumulator,
  buildAnthropicToolTurn,
  buildOpenAIToolTurn,
  toOpenAITools,
  type AnthropicAssistantBlock,
  type AnthropicToolDefinition,
  type LoopToolCall,
  type ToolExecutionResult
} from './apiToolLoop.js';

export interface AutoApproveRules {
  enabled: boolean;
  allowCommands: boolean;
  allowFileWrite: boolean;
  allowFileRead: boolean;
  allowSubagents: boolean;
  writeExcludePatterns: string[];
  readExcludePatterns: string[];
  commandDenyList: string[];
  /** Таймаут команд агента (run_command) в секундах; по умолчанию 5 минут (TASK-33). */
  commandTimeoutSec?: number;
  /** Таймаут ожидания решения человека в минутах; по умолчанию 24 часа (TASK-57). */
  approvalTimeoutMin?: number;
  /** Allow-список инструментов (заполняется правами роли, decision-9); пустой — без ограничений. */
  allowedTools?: string[];
}

export interface AIProviderConfig {
  provider: 'anthropic' | 'openrouter' | 'deepseek' | 'ollama' | 'custom' | 'openai-compatible';
  /** Профиль для `openai-compatible` (TASK-70.1, decision-39): адрес, ключ и флаги — в профиле. */
  profileId?: string;
  apiKey?: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  thinkingBudget?: number;
  /** Усилие рассуждений (TASK-70.3, decision-41); без значения — режим модели по умолчанию. */
  reasoningEffort?: ReasoningEffort;
  autoApprove?: boolean;
  autoApproveRules?: AutoApproveRules;
}

export interface AIToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  status?: 'pending' | 'accepted' | 'rejected' | 'running' | 'done' | 'error';
  result?: any;
  diff?: {
    filePath: string;
    oldContent: string;
    newContent: string;
    patch: string;
  };
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thought?: string;
  toolCalls?: AIToolCall[];
  timestamp: string;
  /** Токены и стоимость ответа модели, если провайдер их сообщил (TASK-56). */
  usage?: AgentUsage;
  /** Ответ завершился ошибкой — пишет renderer (TASK-70.6); в историю для модели такой ответ не идёт. */
  error?: string;
  providerError?: ProviderErrorInfo;
}

/** Чанк стрима: текст/рассуждение/вызов инструмента, плюс usage ответа по завершении (TASK-56). */
export interface AIStreamChunkPayload {
  text?: string;
  thought?: string;
  toolCall?: AIToolCall;
  usage?: AgentUsage;
}

export interface AIStreamRequest {
  sessionId: string;
  projectPath: string;
  messages: AIMessage[];
  config: AIProviderConfig;
  mode: 'chat' | 'agent' | 'architect';
  /** Потолок ответа модели на один шаг (TASK-88); по умолчанию — `DEFAULT_STREAM_MAX_TOKENS` в пределах потолка модели. */
  maxTokens?: number;
  /** Системный промпт роли (decision-9, TASK-60) — дописывается к базовому промпту движка. */
  roleSystemPrompt?: string;
  /** Allow-список нативных имён инструментов API-движка (read_file/write_file/…); без поля — все. */
  allowedToolNames?: string[];
  /** Задача, в контексте которой идёт диалог (TASK-64) — по ней собирается contextBuilder. */
  taskId?: string;
  /** Какие части контекста включены на сессию (по умолчанию все); см. `ContextPartKey`. */
  contextParts?: Partial<Record<'task' | 'rag' | 'gitnexus' | 'git', boolean>>;
  /**
   * Активное рабочее дерево сессии (worktree), TASK-62. Инструменты работы с файлами и
   * командами используют его как рабочий каталог; контекст задачи по-прежнему собирается
   * из общего `backlog/` основного дерева (`projectPath`).
   */
  workspaceRoot?: string;
}

/** Инструмент прокси управления компьютером в формате, который отдаёт `computerUseService.listProxyTools()`. */
export interface StreamChatComputerTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

/**
 * Граница tool-loop для трассы агента (TASK-72, decision-45 п. 3): начало запроса к модели (шаг) и
 * исполненный инструмент с длительностью. Отдельный колбэк, а не чанк: в AI Studio и Remote Control
 * чанки уходят как есть.
 */
export type StreamToolBoundary =
  | { kind: 'step'; step: number; model?: string }
  | { kind: 'tool_result'; id: string; name: string; ok: boolean; outputChars: number; durationMs: number }
  /** Usage одного запроса к модели (без цены) — для бюджета между шагами (TASK-101, decision-46 п. 5). */
  | { kind: 'step_usage'; step: number; usage: AgentUsage }
  /** Лимит шагов исчерпан: вызовы последнего шага не исполнены (decision-46 п. 4). */
  | { kind: 'step_limit'; step: number; maxSteps: number; pendingCalls: number };

/** Параметры многошагового tool-loop (TASK-82). */
export interface StreamChatOptions {
  /** Исполнитель вызова: без него tool-loop выключен (один запрос, вызовы уходят чанками). */
  executeTool?: (toolCall: AIToolCall) => Promise<ToolExecutionResult>;
  /** Инструменты `computer_*`, добавляемые к инструментам агента (только с исполнителем). */
  computerTools?: StreamChatComputerTool[];
  /** Лимит запросов к модели в одном ходе. */
  maxSteps?: number;
  /**
   * Границы шагов и исполнения инструментов (трасса агента, TASK-72). Промис, возвращённый на
   * `tool_result`, tool-loop дожидается до следующего запроса к модели — так Swarm снимает чекпоинт хода
   * без гонки с моделью (decision-46 п. 8).
   */
  onToolBoundary?: (boundary: StreamToolBoundary) => void | Promise<void>;
}

/**
 * Одноразовый служебный запрос к модели (TASK-83): «отправить промпт — получить текст».
 *
 * В отличие от `streamChat`, здесь нет ни инструментов, ни сборки контекста проекта, ни
 * вендорской преамбулы «You are Claude Code» — служебным задачам вроде классификации голосовой
 * команды всё это только мешает. Провайдера и модель выбирает пользователь ([[decision-26]] п. 0):
 * своего дефолта у метода нет, при пустой модели он честно падает с ошибкой.
 */
export interface LlmCompleteRequest {
  prompt: string;
  /** Системная инструкция задачи; по умолчанию её нет вовсе. */
  system?: string;
  /** Переопределение конфигурации; без него берётся текущая настройка пользователя. */
  config?: AIProviderConfig;
  /** Потолок ответа: служебным запросам хватает десятков токенов. */
  maxTokens?: number;
  /** По умолчанию 0 — служебные запросы должны быть воспроизводимыми. */
  temperature?: number;
  /** Ограничение ожидания; по истечении запрос прерывается. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LlmCompleteResult {
  text: string;
  model: string;
  provider: string;
}

const DEFAULT_COMPLETE_TIMEOUT_MS = 20_000;
const DEFAULT_COMPLETE_MAX_TOKENS = 512;
/** Сколько не повторять неудавшийся запрос возможностей модели, мс. */
const MODEL_CAPABILITIES_RETRY_MS = 60_000;

/** Итог одного запроса к модели. */
interface ModelTurn {
  text: string;
  thought: string;
  toolCalls: AIToolCall[];
  usage: AgentUsage | null;
  /** Блоки ответа Anthropic для возврата модели на следующем шаге. */
  blocks: AnthropicAssistantBlock[];
}

/** Накопленный результат хода по всем шагам tool-loop. */
interface ToolLoopState {
  fullText: string;
  fullThought: string;
  toolCalls: AIToolCall[];
  usage: AgentUsage | null;
  /** Провайдер локальный (профиль `local`, прежний `ollama`) — для нулевой цены. */
  local?: boolean;
}

/** Символы сообщений запроса для оценки usage, когда сервер его не сообщил. */
function requestChars(messages: unknown[], tools: unknown): number {
  let chars = tools ? JSON.stringify(tools).length : 0;
  for (const m of messages) {
    const content = (m as { content?: unknown })?.content;
    chars += typeof content === 'string' ? content.length : content ? JSON.stringify(content).length : 0;
  }
  return chars;
}

/** Аргумент командной строки для spawn с `shell: true` (как в claudeBridgeService). */
function quoteShellArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** При `shell: true` `child.kill()` убил бы только оболочку, а не сам claude. */
function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.pid) {
    treeKill(child.pid, 'SIGKILL', (err) => {
      if (err) {
        try { child.kill('SIGKILL'); } catch { /* процесс уже завершён */ }
      }
    });
  } else {
    try { child.kill('SIGKILL'); } catch { /* процесс уже завершён */ }
  }
}

function abortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

/** Сетевая ошибка (обрыв, таймаут) → `ProviderError` со снимком; остальное, включая отмену, — как есть. */
function asProviderError(err: unknown, ctx: ProviderErrorContext): unknown {
  if (err instanceof ProviderError) return err;
  const info = classifyNetworkError(err, ctx);
  return info ? new ProviderError(info, { cause: err }) : err;
}

/**
 * `fetch` к провайдеру: сетевая ошибка и ответ не 2xx становятся `ProviderError` с видом ошибки,
 * адресом и моделью, без ключа (decision-43). Отмена (`AbortError`) пробрасывается как есть.
 */
async function fetchProvider(url: string, init: RequestInit, ctx: ProviderErrorContext): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw asProviderError(err, ctx);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ProviderError(classifyHttpError({ status: response.status, body, headers: response.headers }, ctx));
  }
  return response;
}

/** Контекст ошибки запроса к OpenAI-совместимому серверу: профиль, адрес, модель, ключ для вырезания. */
function openAICompatibleErrorContext(target: OpenAICompatibleTarget, model: string | undefined): ProviderErrorContext {
  return {
    provider: target.label,
    ...(target.profileId ? { profileId: target.profileId } : {}),
    endpoint: target.endpoint,
    ...(model ? { model } : {}),
    local: target.local,
    secrets: secretsFromHeaders(target.headers)
  };
}

function anthropicErrorContext(model: string | undefined, apiKey: string): ProviderErrorContext {
  return { provider: 'Anthropic', endpoint: ANTHROPIC_MESSAGES_ENDPOINT, ...(model ? { model } : {}), local: false, secrets: [apiKey] };
}

export interface ClaudeAuthStatus {
  isLoggedIn: boolean;
  email?: string;
  displayName?: string;
  seatTier?: string;
  organizationName?: string;
}

export const PROJECT_HUB_CLAUDE_DIR = path.join(os.homedir(), '.projecthub', 'claude_config');
const CONFIG_FILE = path.join(os.homedir(), '.projecthub', 'ai-config.json');

class AIAgentService {
  private activeControllers = new Map<string, AbortController>();
  /** Возможности моделей из Models API: успешный ответ — на время жизни процесса, ошибка — на минуту. */
  private modelCapabilities = new Map<string, { caps: AnthropicModelCapabilities; expiresAt: number }>();

  constructor() {
    this.ensureConfigDir();
  }

  private ensureConfigDir() {
    // Синхронно: промис fs.mkdir без await внутри try не ловится и становится unhandled rejection
    const dir = path.dirname(CONFIG_FILE);
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch (e) {
        console.error('Failed to create config dir:', e);
      }
    }
    if (!existsSync(PROJECT_HUB_CLAUDE_DIR)) {
      try {
        mkdirSync(PROJECT_HUB_CLAUDE_DIR, { recursive: true });
      } catch (e) {
        console.error('Failed to create claude config dir:', e);
      }
    }
  }

  public async getClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
    const isolatedClaudeJson = path.join(PROJECT_HUB_CLAUDE_DIR, '.claude.json');
    const globalClaudeJson = path.join(os.homedir(), '.claude.json');
    const targetPaths = [isolatedClaudeJson, globalClaudeJson];

    for (const claudeJsonPath of targetPaths) {
      if (existsSync(claudeJsonPath)) {
        try {
          const content = await fs.readFile(claudeJsonPath, 'utf-8');
          const data = JSON.parse(content);
          if (data.oauthAccount && (data.oauthAccount.emailAddress || data.oauthAccount.email)) {
            return {
              isLoggedIn: true,
              email: data.oauthAccount.emailAddress || data.oauthAccount.email,
              displayName: data.oauthAccount.displayName || data.oauthAccount.fullName,
              seatTier: data.oauthAccount.seatTier || data.oauthAccount.billingType || 'Pro / Team',
              organizationName: data.oauthAccount.organizationName
            };
          }
        } catch (e) {
          console.warn(`Failed to read ${claudeJsonPath}:`, e);
        }
      }
    }
    return { isLoggedIn: false };
  }

  public async claudeLogout(): Promise<boolean> {
    const isolatedClaudeJson = path.join(PROJECT_HUB_CLAUDE_DIR, '.claude.json');
    const globalClaudeJson = path.join(os.homedir(), '.claude.json');
    const targetPaths = [isolatedClaudeJson, globalClaudeJson];

    for (const claudeJsonPath of targetPaths) {
      if (existsSync(claudeJsonPath)) {
        try {
          const content = await fs.readFile(claudeJsonPath, 'utf-8');
          const data = JSON.parse(content);
          if (data.oauthAccount) {
            delete data.oauthAccount;
            delete data.primaryApiKey;
            await fs.writeFile(claudeJsonPath, JSON.stringify(data, null, 2), 'utf-8');
          }
        } catch (e) {
          console.warn(`Failed to clean oauthAccount from ${claudeJsonPath}:`, e);
        }
      }
    }

    try {
      const credsFile = path.join(PROJECT_HUB_CLAUDE_DIR, '.credentials.json');
      if (existsSync(credsFile)) {
        await fs.unlink(credsFile);
      }
    } catch {}

    try {
      const isWin = process.platform === 'win32';
      if (isWin) {
        spawn('cmd.exe', ['/c', 'claude auth logout'], {
          env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: PROJECT_HUB_CLAUDE_DIR
          }
        });
      } else {
        spawn('claude', ['auth', 'logout'], {
          env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: PROJECT_HUB_CLAUDE_DIR
          }
        });
      }
    } catch (e) {
      console.warn('Failed to spawn claude auth logout:', e);
    }

    return true;
  }

  public async getConfig(): Promise<AIProviderConfig> {
    try {
      if (existsSync(CONFIG_FILE)) {
        const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.apiKey) {
          parsed.apiKey = secretStorageService.decrypt(parsed.apiKey);
        }
        return parsed;
      }
    } catch (err) {
      console.warn('Failed to load AI config, using defaults:', err);
    }

    // Модель выбирает пользователь (decision-26 п. 0): «default» — сентинел «не выбрана»,
    // Claude CLI возьмёт свою модель, API-путь вернёт понятную ошибку.
    return {
      provider: 'anthropic',
      model: 'default'
    };
  }

  public async saveConfig(config: AIProviderConfig): Promise<void> {
    this.ensureConfigDir();
    const toSave = { ...config };
    if (toSave.apiKey) {
      toSave.apiKey = secretStorageService.encrypt(toSave.apiKey);
    }
    await fs.writeFile(CONFIG_FILE, JSON.stringify(toSave, null, 2), 'utf-8');
  }

  public abortStream(sessionId: string): void {
    const controller = this.activeControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(sessionId);
    }
  }

  /**
   * Одноразовый запрос к настроенной модели без стрима, инструментов и контекста проекта.
   *
   * Провайдер и модель — из настроек пользователя ([[decision-26]] п. 0). Для `anthropic` без
   * API-ключа запрос идёт в Claude Code CLI по подписке — облегчённым запуском, а не через
   * `claudeBridgeService` с его агентским циклом ([[decision-35]]; ответ около 3 с). Если провайдеру
   * нужен ключ, а его нет, метод честно возвращает ошибку — молча подменять провайдера нельзя.
   */
  public async complete(req: LlmCompleteRequest): Promise<LlmCompleteResult> {
    const config = req.config ?? (await this.getConfig());
    const model = config.model?.trim();
    if (!model || isUnsetModelId(model)) {
      throw providerConfigError('Модель не выбрана в настройках AI Studio.', 'no_model');
    }

    const timeoutMs = req.timeoutMs ?? DEFAULT_COMPLETE_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const forwardAbort = () => controller.abort();
    req.signal?.addEventListener('abort', forwardAbort);

    try {
      const text =
        config.provider !== 'anthropic'
          ? await this.completeOpenAICompatible(req, config, model, controller.signal)
          : config.apiKey?.trim()
            ? await this.completeAnthropic(req, config, model, controller.signal)
            : await this.completeClaudeCli(req, model, controller.signal);
      return { text, model, provider: config.provider };
    } catch (err) {
      // Отмена вызывающим кодом — как есть; срабатывание своего таймера — ошибка «сервер не ответил».
      if (err instanceof Error && err.name === 'AbortError' && !req.signal?.aborted) {
        throw new ProviderError(timeoutError(timeoutMs, { provider: config.provider, model }), { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  /** Messages API одним непотоковым запросом. */
  private async completeAnthropic(
    req: LlmCompleteRequest,
    config: AIProviderConfig,
    model: string,
    signal: AbortSignal
  ): Promise<string> {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      throw providerConfigError('API ключ Anthropic не указан: служебные запросы к модели идут по API, а не через Claude CLI.', 'no_key');
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? DEFAULT_COMPLETE_MAX_TOKENS,
      messages: [{ role: 'user', content: req.prompt }],
      temperature: req.temperature ?? 0,
      stream: false
    };
    if (req.system) body.system = req.system;

    const response = await fetchProvider(
      ANTHROPIC_MESSAGES_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        signal
      },
      anthropicErrorContext(model, apiKey)
    );

    const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    return (data.content ?? [])
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('')
      .trim();
  }

  /**
   * Claude Code CLI по подписке (decision-35): провайдер `anthropic` без API-ключа. Запуск облегчён
   * (`buildClaudeCliCompletionCommand`), рабочий каталог — временный, чтобы CLI не подтягивал
   * CLAUDE.md проекта. `maxTokens` и `temperature` CLI не принимает — для служебных запросов с
   * короткими ответами это не мешает.
   */
  private completeClaudeCli(req: LlmCompleteRequest, model: string, signal: AbortSignal): Promise<string> {
    const { args, stdin } = buildClaudeCliCompletionCommand({ model, system: req.system, prompt: req.prompt });

    return new Promise<string>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn('claude', args.map(quoteShellArg), {
          cwd: os.tmpdir(),
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, FORCE_COLOR: '0', CLAUDE_CONFIG_DIR: PROJECT_HUB_CLAUDE_DIR }
        });
      } catch (err) {
        reject(new Error(`Не удалось запустить Claude CLI: ${err instanceof Error ? err.message : String(err)}`, { cause: err }));
        return;
      }

      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        fn();
      };
      const onAbort = () => {
        killTree(child);
        finish(() => reject(abortError()));
      };
      signal.addEventListener('abort', onAbort);

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', (err) => finish(() => reject(new Error(`Claude CLI: ${err.message}`, { cause: err }))));
      child.on('close', (code) => {
        finish(() => {
          try {
            resolve(parseClaudeCliCompletionOutput(stdout));
          } catch (err) {
            const detail = stderr.trim() ? ` (${stderr.trim().slice(0, 300)})` : '';
            reject(new Error(`${err instanceof Error ? err.message : String(err)}; код выхода ${code}${detail}`, { cause: err }));
          }
        });
      });

      child.stdin.end(stdin, 'utf8');
    });
  }

  /** Chat Completions одним непотоковым запросом: OpenRouter, DeepSeek, Ollama, custom. */
  private async completeOpenAICompatible(
    req: LlmCompleteRequest,
    config: AIProviderConfig,
    model: string,
    signal: AbortSignal
  ): Promise<string> {
    const target = await this.resolveOpenAICompatibleTarget(config);
    const { endpoint, headers, compat } = target;
    const errorContext = openAICompatibleErrorContext(target, model);
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.prompt });

    const response = await fetchProvider(
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          temperature: req.temperature ?? 0,
          [compat.maxTokensField]: req.maxTokens ?? DEFAULT_COMPLETE_MAX_TOKENS,
          stream: false
        }),
        signal
      },
      errorContext
    );

    const data = (await response.json()) as {
      error?: unknown;
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    // Некоторые серверы отвечают 200 с {"error": …} вместо текста.
    const inBody = classifyStreamError(data, errorContext);
    if (inBody) throw new ProviderError(inBody);
    const content = data.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : '';
  }

  /**
   * Helper to compute unified diff text between old and new strings
   */
  public generateDiff(oldStr: string, newStr: string, fileName = 'file'): string {
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');

    let diffText = `--- a/${fileName}\n+++ b/${fileName}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;

    // Simple line-by-line comparison
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const o = oldLines[i];
      const n = newLines[i];
      if (o === n) {
        diffText += ` ${o ?? ''}\n`;
      } else {
        if (o !== undefined) diffText += `-${o}\n`;
        if (n !== undefined) diffText += `+${n}\n`;
      }
    }
    return diffText.trim();
  }

  /**
   * Execute safe file write after user approval
   */
  public async applyDiff(projectPath: string, relativePath: string, newContent: string): Promise<boolean> {
    // Модель может прислать абсолютный путь или `../` — запись разрешена только внутри проекта (TASK-32).
    const fullPath = assertInsideProject(projectPath, relativePath);
    const parentDir = path.dirname(fullPath);
    await fs.mkdir(parentDir, { recursive: true });
    await fs.writeFile(fullPath, newContent, 'utf-8');
    return true;
  }

  /**
   * Main Stream Chat Dispatcher
   *
   * С `options.executeTool` — многошаговый tool-loop (TASK-82): вызовы инструментов из ответа модели
   * исполняются, результаты возвращаются модели, и так до ответа без вызовов или лимита шагов.
   * Без исполнителя — один запрос, вызовы уходят чанками (ревьюер арены); Swarm передаёт исполнитель (TASK-101).
   */
  public async streamChat(
    req: AIStreamRequest,
    onChunk: (payload: AIStreamChunkPayload) => void,
    onComplete: (msg: AIMessage) => void,
    /** `info` — снимок ошибки провайдера (decision-43): вид, адрес, модель; для прочих ошибок — `unknown`. */
    onError: (err: string, info?: ProviderErrorInfo) => void,
    options: StreamChatOptions = {}
  ): Promise<void> {
    const controller = new AbortController();
    this.activeControllers.set(req.sessionId, controller);

    try {
      const computerTools = req.mode === 'agent' && options.executeTool
        ? (options.computerTools ?? []).filter((t) => isToolAllowed(t.name, req.allowedToolNames))
        : [];
      const systemPrompt = await this.buildSystemPrompt(
        req.projectPath,
        req.mode,
        req.roleSystemPrompt,
        req.taskId,
        req.contextParts,
        req.workspaceRoot,
        computerTools.length > 0
      );
      const tools: AnthropicToolDefinition[] = req.mode === 'agent'
        ? [
            ...this.getAnthropicTools(req.allowedToolNames),
            ...computerTools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
          ]
        : [];
      const loop: ToolLoopState = { fullText: '', fullThought: '', toolCalls: [], usage: null };
      const maxSteps = options.maxSteps ?? DEFAULT_MAX_TOOL_STEPS;

      if (req.config.provider === 'anthropic') {
        await this.runAnthropicLoop(req, systemPrompt, tools, controller.signal, onChunk, loop, maxSteps, options.executeTool, options.onToolBoundary);
      } else {
        // OpenAI-совместимым провайдерам инструменты отдаются только вместе с исполнителем:
        // без него вызовы остались бы без результата.
        await this.runOpenAICompatibleLoop(
          req,
          systemPrompt,
          options.executeTool ? tools : [],
          controller.signal,
          onChunk,
          loop,
          maxSteps,
          options.executeTool,
          options.onToolBoundary
        );
      }

      // Стоимость — той же таблицей и функцией, что и в Swarm (pricingService, decision-42).
      if (loop.usage) {
        loop.usage = priceUsage(loop.usage, loop.usage.model || req.config.model, await pricingService.ensureLoaded(), { local: loop.local });
        onChunk({ usage: loop.usage });
      }
      onComplete({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: loop.fullText,
        thought: loop.fullThought || undefined,
        toolCalls: loop.toolCalls.length > 0
          ? loop.toolCalls.map((tc) => ({ ...tc, status: tc.status || (tc.diff ? 'pending' : 'done') }))
          : undefined,
        timestamp: new Date().toISOString(),
        ...(loop.usage ? { usage: loop.usage } : {})
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        onChunk({ text: '\n\n*(Отменено пользователем)*' });
      } else {
        const info = toProviderErrorInfo(err, { provider: req.config.provider, ...(req.config.model ? { model: req.config.model } : {}) });
        const message = info?.message || err?.message || String(err);
        // Ключ в сообщение не попадает: адрес очищен, заголовки авторизации вырезаны (providerErrors.ts).
        logger.warn(`[aiAgentService] Сессия ${req.sessionId}: ${info ? describeProviderErrorBrief(info) : 'ошибка'} — ${message}`);
        onError(message, info);
      }
    } finally {
      this.activeControllers.delete(req.sessionId);
    }
  }

  private accumulateTurn(loop: ToolLoopState, turn: ModelTurn): void {
    loop.fullText += turn.text;
    loop.fullThought += turn.thought;
    loop.toolCalls.push(...turn.toolCalls);
    if (turn.usage) loop.usage = loop.usage ? addUsage(loop.usage, turn.usage) : turn.usage;
  }

  /** Разделитель текста между шагами tool-loop — чтобы ответы шагов не слипались. */
  private separateSteps(loop: ToolLoopState, turn: ModelTurn, onChunk: (payload: AIStreamChunkPayload) => void): void {
    if (!turn.text) return;
    loop.fullText += '\n\n';
    onChunk({ text: '\n\n' });
  }

  /**
   * Исполняет вызовы шага по одному. `null` — цикл завершён: нет исполнителя, нет вызовов или
   * достигнут лимит шагов (тогда вызовы не исполняются, пользователь видит пометку).
   */
  private async executeToolStep(
    calls: AIToolCall[],
    step: number,
    maxSteps: number,
    loop: ToolLoopState,
    onChunk: (payload: AIStreamChunkPayload) => void,
    signal: AbortSignal,
    executeTool?: StreamChatOptions['executeTool'],
    onToolBoundary?: StreamChatOptions['onToolBoundary']
  ): Promise<Array<{ call: LoopToolCall; result: ToolExecutionResult }> | null> {
    if (!executeTool || calls.length === 0) return null;
    if (step + 1 >= maxSteps) {
      const note = `\n\n*(Остановлено: достигнут лимит шагов с инструментами — ${maxSteps})*`;
      loop.fullText += note;
      onChunk({ text: note });
      await onToolBoundary?.({ kind: 'step_limit', step, maxSteps, pendingCalls: calls.length });
      return null;
    }
    const results: Array<{ call: LoopToolCall; result: ToolExecutionResult }> = [];
    for (const tc of calls) {
      if (signal.aborted) throw abortError();
      const startedAt = Date.now();
      const result = await executeTool(tc);
      results.push({ call: { id: tc.id, name: tc.name, args: tc.args }, result });
      await onToolBoundary?.({
        kind: 'tool_result',
        id: tc.id,
        name: tc.name,
        ok: result.isError !== true,
        outputChars: typeof result.content === 'string' ? result.content.length : 0,
        durationMs: Date.now() - startedAt
      });
    }
    if (signal.aborted) throw abortError();
    return results;
  }

  /**
   * Anthropic Claude API: tool-loop поверх потоковых запросов Messages API.
   */
  private async runAnthropicLoop(
    req: AIStreamRequest,
    systemPrompt: string,
    tools: AnthropicToolDefinition[],
    signal: AbortSignal,
    onChunk: (payload: AIStreamChunkPayload) => void,
    loop: ToolLoopState,
    maxSteps: number,
    executeTool?: StreamChatOptions['executeTool'],
    onToolBoundary?: StreamChatOptions['onToolBoundary']
  ): Promise<void> {
    const model = resolveAnthropicModelId(req.config.model);
    const apiKey = req.config.apiKey?.trim();
    if (!apiKey) {
      throw providerConfigError('API ключ Anthropic не указан. Пожалуйста, откройте настройки AI Studio и укажите ключ.', 'no_key', {
        provider: 'Anthropic',
        model: req.config.model
      });
    }
    const capabilities = await this.getAnthropicModelCapabilities(model, apiKey, signal);
    const messages: unknown[] = req.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    for (let step = 0; ; step++) {
      onToolBoundary?.({ kind: 'step', step, model });
      const turn = await this.requestAnthropic(req, apiKey, capabilities, systemPrompt, messages, tools, step, signal, onChunk);
      this.accumulateTurn(loop, turn);
      if (turn.usage) await onToolBoundary?.({ kind: 'step_usage', step, usage: turn.usage });
      if (signal.aborted) throw abortError();
      const results = await this.executeToolStep(turn.toolCalls, step, maxSteps, loop, onChunk, signal, executeTool, onToolBoundary);
      if (!results) break;
      messages.push(...buildAnthropicToolTurn(turn.blocks, results));
      this.separateSteps(loop, turn, onChunk);
    }
  }

  /**
   * Возможности модели из Models API (`GET /v1/models/{id}`) — по ним выбирается режим рассуждений
   * и потолок `max_tokens` (TASK-88, decision-33). При ошибке запрос к модели всё равно выполняется,
   * но без `thinking`: неверная конфигурация рассуждений дала бы 400.
   */
  private async getAnthropicModelCapabilities(
    model: string,
    apiKey: string,
    signal: AbortSignal
  ): Promise<AnthropicModelCapabilities> {
    const cached = this.modelCapabilities.get(model);
    if (cached && cached.expiresAt > Date.now()) return cached.caps;

    try {
      const response = await fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const caps = parseAnthropicModelCapabilities(await response.json());
      this.modelCapabilities.set(model, { caps, expiresAt: Number.POSITIVE_INFINITY });
      return caps;
    } catch (err) {
      if (signal.aborted) throw abortError();
      logger.warn(`[aiAgentService] Возможности модели «${model}» не получены из Models API: ${err instanceof Error ? err.message : String(err)}`);
      this.modelCapabilities.set(model, { caps: UNKNOWN_MODEL_CAPABILITIES, expiresAt: Date.now() + MODEL_CAPABILITIES_RETRY_MS });
      return UNKNOWN_MODEL_CAPABILITIES;
    }
  }

  /** Один потоковый запрос к Anthropic Messages API. */
  private async requestAnthropic(
    req: AIStreamRequest,
    apiKey: string,
    capabilities: AnthropicModelCapabilities,
    systemPrompt: string,
    messages: unknown[],
    tools: AnthropicToolDefinition[],
    step: number,
    signal: AbortSignal,
    onChunk: (payload: AIStreamChunkPayload) => void
  ): Promise<ModelTurn> {
    const { body, notes } = buildAnthropicMessagesBody(
      {
        model: req.config.model,
        system: systemPrompt,
        messages,
        tools,
        maxTokens: req.maxTokens,
        temperature: req.config.temperature,
        thinkingBudget: req.config.thinkingBudget,
        reasoningEffort: normalizeReasoningEffort(req.config.reasoningEffort)
      },
      capabilities
    );
    // Настройки одинаковы для всех шагов хода — пояснение пишем один раз.
    if (step === 0) {
      for (const note of notes) logger.info(`[aiAgentService] ${note}`);
    }
    const model = body.model as string;
    const errorContext: ProviderErrorContext = {
      ...anthropicErrorContext(model, apiKey),
      toolsSent: tools.length > 0,
      ...(req.config.reasoningEffort ? { reasoningEffort: String(req.config.reasoningEffort) } : {})
    };

    const response = await fetchProvider(
      ANTHROPIC_MESSAGES_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        signal
      },
      errorContext
    );

    let streamError: ProviderErrorInfo | undefined;
    let fullText = '';
    let fullThought = '';
    const toolCalls: AIToolCall[] = [];
    const blocks = new Map<number, AnthropicAssistantBlock>();
    let currentTool: { id: string; name: string; argsStr: string; index: number } | null = null;
    let usage: AgentUsage | null = null;

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is empty');

    const decoder = new TextDecoder();
    let buffer = '';

    while (!streamError) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        throw asProviderError(err, errorContext);
      }
      const { done, value } = chunk;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr);
          const index = typeof parsed.index === 'number' ? parsed.index : blocks.size;
          if (parsed.type === 'error') {
            // Событие error посреди потока (overloaded_error и т.п.) — раньше молча терялось.
            streamError = classifyStreamError(parsed, errorContext);
            if (streamError) break;
          } else if (parsed.type === 'message_start' && parsed.message?.usage) {
            // Входные токены и кэш известны сразу; output_tokens придут в message_delta.
            usage = usageFromAnthropic(parsed.message.usage, parsed.message.model || model) ?? usage;
          } else if (parsed.type === 'message_delta' && parsed.usage) {
            const delta = parsed.usage as Record<string, unknown>;
            const base = usage ?? usageFromAnthropic({ input_tokens: 0 }, model) ?? null;
            const merged = usageFromAnthropic(
              {
                input_tokens: typeof delta.input_tokens === 'number' ? delta.input_tokens : base?.inputTokens ?? 0,
                output_tokens: typeof delta.output_tokens === 'number' ? delta.output_tokens : base?.outputTokens ?? 0,
                cache_read_input_tokens:
                  typeof delta.cache_read_input_tokens === 'number' ? delta.cache_read_input_tokens : base?.cacheReadTokens ?? 0,
                cache_creation_input_tokens:
                  typeof delta.cache_creation_input_tokens === 'number' ? delta.cache_creation_input_tokens : base?.cacheCreationTokens ?? 0
              },
              base?.model || model
            );
            if (merged) usage = merged;
          }
          if (parsed.type === 'content_block_delta') {
            const block = blocks.get(index);
            if (parsed.delta?.type === 'text_delta') {
              const chunk = parsed.delta.text;
              fullText += chunk;
              if (block?.type === 'text') block.text += chunk;
              onChunk({ text: chunk });
            } else if (parsed.delta?.type === 'thinking_delta') {
              const chunk = parsed.delta.thinking;
              fullThought += chunk;
              if (block?.type === 'thinking') block.thinking += chunk;
              onChunk({ thought: chunk });
            } else if (parsed.delta?.type === 'signature_delta') {
              if (block?.type === 'thinking') block.signature = (block.signature ?? '') + parsed.delta.signature;
            } else if (parsed.delta?.type === 'input_json_delta' && currentTool) {
              currentTool.argsStr += parsed.delta.partial_json;
            }
          } else if (parsed.type === 'content_block_start') {
            const cb = parsed.content_block;
            if (cb?.type === 'tool_use') {
              currentTool = { id: cb.id, name: cb.name, argsStr: '', index };
            } else if (cb?.type === 'text') {
              blocks.set(index, { type: 'text', text: cb.text || '' });
            } else if (cb?.type === 'thinking') {
              blocks.set(index, { type: 'thinking', thinking: cb.thinking || '', signature: cb.signature || '' });
            } else if (cb?.type === 'redacted_thinking') {
              blocks.set(index, { type: 'redacted_thinking', data: cb.data });
            }
          } else if (parsed.type === 'content_block_stop') {
            if (currentTool) {
              let args: Record<string, any> = {};
              try {
                args = JSON.parse(currentTool.argsStr || '{}');
              } catch (e) {
                console.error('Failed to parse tool args:', e);
              }

              const toolCall: AIToolCall = {
                id: currentTool.id,
                name: currentTool.name,
                args,
                status: 'pending'
              };

              // Prepare diff if write_file
              if (currentTool.name === 'write_file' && args.filePath && args.content) {
                // Старое содержимое читаем только внутри проекта; путь вне корня отклонит applyDiff.
                const workDir = req.workspaceRoot?.trim() || req.projectPath;
                const targetPath = isInsideProject(workDir, args.filePath)
                  ? path.resolve(workDir, args.filePath)
                  : null;
                let oldContent = '';
                if (targetPath && existsSync(targetPath)) {
                  oldContent = await fs.readFile(targetPath, 'utf-8').catch(() => '');
                }
                toolCall.diff = {
                  filePath: args.filePath,
                  oldContent,
                  newContent: args.content,
                  patch: this.generateDiff(oldContent, args.content, args.filePath)
                };
              }

              blocks.set(currentTool.index, { type: 'tool_use', id: currentTool.id, name: currentTool.name, input: args });
              toolCalls.push(toolCall);
              onChunk({ toolCall });
              currentTool = null;
            }
          }
        } catch (err) {
          // ignore stream parse errors
        }
      }
    }
    if (streamError) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderError(streamError);
    }

    return {
      text: fullText,
      thought: fullThought,
      toolCalls,
      usage,
      blocks: Array.from(blocks.entries()).sort((a, b) => a[0] - b[0]).map(([, block]) => block)
    };
  }

  /**
   * Куда и с какими флагами идёт запрос Chat Completions: профиль `openai-compatible` ([[decision-39]])
   * или прежний провайдер `openrouter`/`deepseek`/`ollama`/`custom` с его прежним поведением.
   * Общий для потокового диалога и одноразового `complete`.
   */
  private async resolveOpenAICompatibleTarget(config: AIProviderConfig): Promise<OpenAICompatibleTarget> {
    if (config.provider === 'openai-compatible') {
      const target = await llmProfileService.resolveRequestTarget(config.profileId);
      return {
        endpoint: target.endpoint,
        headers: target.headers,
        compat: target.compat,
        label: target.profile.name,
        local: target.profile.local,
        profileId: target.profile.id
      };
    }
    const { endpoint, headers } = resolveOpenAICompatibleEndpoint(config);
    return {
      endpoint,
      headers,
      compat: legacyProviderCompat(config.provider),
      label: config.provider,
      local: legacyProviderIsLocal(config.provider, endpoint)
    };
  }

  /**
   * OpenAI-совместимый API (профили, OpenRouter, DeepSeek, Ollama, custom): tool-loop поверх Chat
   * Completions. Инструменты и изображения из их результатов — по флагам совместимости профиля.
   */
  private async runOpenAICompatibleLoop(
    req: AIStreamRequest,
    systemPrompt: string,
    tools: AnthropicToolDefinition[],
    signal: AbortSignal,
    onChunk: (payload: AIStreamChunkPayload) => void,
    loop: ToolLoopState,
    maxSteps: number,
    executeTool?: StreamChatOptions['executeTool'],
    onToolBoundary?: StreamChatOptions['onToolBoundary']
  ): Promise<void> {
    const target = await this.resolveOpenAICompatibleTarget(req.config);
    loop.local = target.local;
    const messages: unknown[] = [
      { role: 'system', content: systemPrompt },
      ...req.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role,
          content: m.content
        }))
    ];
    // Профиль без поддержки tools: запрос без инструментов, иначе сервер ответил бы 400.
    const openAITools = tools.length > 0 && target.compat.tools ? toOpenAITools(tools) : undefined;

    for (let step = 0; ; step++) {
      onToolBoundary?.({ kind: 'step', step, ...(req.config.model ? { model: req.config.model } : {}) });
      const inputChars = requestChars(messages, openAITools);
      const turn = await this.requestOpenAICompatible(req, target, messages, openAITools, step, signal, onChunk);
      if (!turn.usage) {
        // Сервер не прислал usage (нет флага streamUsage или сервер его не поддерживает) — оценка по длине
        // запроса и ответа с пометкой estimated (decision-42).
        const outputChars = turn.text.length + turn.thought.length + turn.toolCalls.reduce((n, tc) => n + JSON.stringify(tc.args ?? {}).length, 0);
        turn.usage = estimateUsage({ inputChars, outputChars, model: req.config.model });
      }
      this.accumulateTurn(loop, turn);
      await onToolBoundary?.({ kind: 'step_usage', step, usage: turn.usage });
      if (signal.aborted) throw abortError();
      const results = await this.executeToolStep(turn.toolCalls, step, maxSteps, loop, onChunk, signal, executeTool, onToolBoundary);
      if (!results) break;
      messages.push(...buildOpenAIToolTurn(turn.text, results, { vision: target.compat.vision }));
      this.separateSteps(loop, turn, onChunk);
    }
  }

  /** Один потоковый запрос Chat Completions; `delta.tool_calls` собираются в вызовы инструментов. */
  private async requestOpenAICompatible(
    req: AIStreamRequest,
    target: OpenAICompatibleTarget,
    messages: unknown[],
    tools: ReturnType<typeof toOpenAITools> | undefined,
    step: number,
    signal: AbortSignal,
    onChunk: (payload: AIStreamChunkPayload) => void
  ): Promise<ModelTurn> {
    const { endpoint, headers } = target;
    const reasoningEffort = normalizeReasoningEffort(req.config.reasoningEffort);
    const notes: string[] = [];
    const body = buildOpenAICompatibleChatBody({
      provider: target.label,
      compat: target.compat,
      model: req.config.model,
      messages,
      tools,
      temperature: req.config.temperature,
      maxTokens: req.maxTokens,
      reasoningEffort,
      notes
    });
    // Настройки одинаковы для всех шагов хода — пояснение пишем один раз.
    if (step === 0) {
      for (const note of notes) logger.info(`[aiAgentService] ${note}`);
    }

    // Отказ сервера разбирает классификатор (decision-43): «не поддерживает tools» — только если tools
    // были в запросе, совет по усилию — только если усилие ушло в тело (notes пусты, decision-41 п. 2).
    const errorContext: ProviderErrorContext = {
      ...openAICompatibleErrorContext(target, typeof body.model === 'string' ? body.model : req.config.model),
      toolsSent: Boolean(tools),
      ...(reasoningEffort && notes.length === 0 ? { reasoningEffort } : {})
    };
    const response = await fetchProvider(
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal
      },
      errorContext
    );

    // Ошибка внутри потока при статусе 200 (OpenRouter, Ollama) — раньше молча терялась.
    let streamError: ProviderErrorInfo | undefined;
    let fullText = '';
    let fullThought = '';
    let usage: AgentUsage | null = null;
    const accumulator = new OpenAIToolCallAccumulator();

    type OpenAIDelta = { content?: string; tool_calls?: unknown };
    type OpenAIStreamPayload = { error?: unknown; usage?: unknown; model?: string; choices?: Array<{ delta?: OpenAIDelta; message?: OpenAIDelta }> };
    const handlePayload = (parsed: OpenAIStreamPayload) => {
      const inStream = classifyStreamError(parsed, errorContext);
      if (inStream) {
        streamError = inStream;
        return;
      }
      if (parsed.usage) {
        usage = usageFromOpenAI(parsed.usage, parsed.model || body.model) ?? usage;
      }
      const choice = parsed.choices?.[0];
      // Потоковый ответ несёт delta, непотоковый (некоторые серверы при tools) — message.
      const delta = choice?.delta ?? choice?.message;
      if (delta) {
        // reasoning_content (DeepSeek), reasoning (Ollama, OpenRouter) — decision-41 п. 6.
        const thought = extractReasoningDelta(delta);
        if (thought) {
          fullThought += thought;
          onChunk({ thought });
        }
        if (delta.content) {
          fullText += delta.content;
          onChunk({ text: delta.content });
        }
        if (delta.tool_calls) {
          accumulator.push(delta.tool_calls);
        }
      }
    };

    if (!(response.headers.get('content-type') || '').includes('text/event-stream') && response.body) {
      let text: string;
      try {
        text = await response.text();
      } catch (err) {
        throw asProviderError(err, errorContext);
      }
      try {
        handlePayload(JSON.parse(text));
      } catch {
        // Не JSON — пробуем разобрать как поток SSE ниже нельзя (тело уже прочитано), игнорируем.
      }
    } else {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Response body is empty');

      const decoder = new TextDecoder();
      let buffer = '';

      while (!streamError) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (err) {
          // Обрыв соединения посреди ответа (`terminated`) — сетевая ошибка провайдера.
          throw asProviderError(err, errorContext);
        }
        const { done, value } = chunk;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') continue;

          try {
            handlePayload(JSON.parse(dataStr));
          } catch (e) {
            // ignore chunk parse errors
          }
          if (streamError) break;
        }
      }
      if (streamError) await reader.cancel().catch(() => undefined);
    }
    if (streamError) throw new ProviderError(streamError);

    const toolCalls: AIToolCall[] = accumulator.finalize(`call-${step}`).map((call) => ({
      id: call.id,
      name: call.name,
      args: call.args,
      status: 'pending'
    }));
    for (const toolCall of toolCalls) onChunk({ toolCall });

    return { text: fullText, thought: fullThought, toolCalls, usage, blocks: [] };
  }

  /**
   * System Prompt with Project Context
   */
  private async buildSystemPrompt(
    projectPath: string,
    mode: 'chat' | 'agent' | 'architect',
    roleSystemPrompt?: string,
    taskId?: string,
    contextParts?: AIStreamRequest['contextParts'],
    workspaceRoot?: string,
    /** Агенту доступны инструменты `computer_*` — добавить инструкцию accessibility-first (TASK-82). */
    computerUse = false
  ): Promise<string> {
    // Рабочий каталог — активное дерево (worktree), задачи и документация — общий backlog проекта.
    const workDir = workspaceRoot?.trim() || projectPath;
    const base = `You are Claude Code, Anthropic's official AI assistant for software development.
Working directory: "${workDir}".
Answer directly, clearly, and concisely as Claude Code. If the user addresses you in Russian, answer naturally in Russian while preserving technical terms, file paths, and code.`;

    let taskContext = '';
    if (taskId) {
      try {
        const context = await buildAgentContext({ projectPath, taskId, enabledParts: contextParts });
        taskContext = context.combined;
      } catch (err) {
        console.warn('[aiAgentService] contextBuilder failed:', err);
      }
    }

    return [base, roleSystemPrompt, taskContext, computerUse ? buildComputerUseInstructions() : ''].filter(Boolean).join('\n\n');
  }

  /**
   * Anthropic Tool Definitions. `allowedToolNames` — allow-список роли (decision-9); без него — все.
   */
  private getAnthropicTools(allowedToolNames?: string[]) {
    const all = [
      {
        name: 'read_file',
        description: 'Прочитать содержимое файла проекта',
        input_schema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Относительный или абсолютный путь к файлу' }
          },
          required: ['filePath']
        }
      },
      {
        name: 'write_file',
        description: 'Создать или изменить файл проекта (показывает интерактивный Diff пользователю)',
        input_schema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Относительный или абсолютный путь к файлу' },
            content: { type: 'string', description: 'Полное новое содержимое файла' },
            explanation: { type: 'string', description: 'Краткое объяснение внесенных изменений' }
          },
          required: ['filePath', 'content']
        }
      },
      {
        name: 'list_dir',
        description: 'Получить список файлов и подкаталогов в директории проекта',
        input_schema: {
          type: 'object',
          properties: {
            subDir: { type: 'string', description: 'Относительный путь подкаталога (пустая строка для корня)' }
          }
        }
      },
      {
        name: 'run_command',
        description:
          'Выполнить команду оболочки в корне проекта и получить её вывод (ожидание ограничено таймаутом, по умолчанию 5 минут). '
          + 'Долгоживущие процессы (dev-серверы, вотчеры, `npm run dev`) запускай с background: true — они уходят в менеджер процессов ProjectHub и не блокируют работу.',
        input_schema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Команда оболочки (PowerShell на Windows, bash на macOS/Linux)' },
            explanation: { type: 'string', description: 'Зачем нужна команда (показывается пользователю при запросе одобрения)' },
            background: { type: 'boolean', description: 'true — запустить в фоне через менеджер процессов и сразу вернуть управление' },
            name: { type: 'string', description: 'Имя фонового процесса (только с background: true), например "dev-server"' }
          },
          required: ['command']
        }
      },
      {
        name: 'search_rag',
        description: 'Семантический поиск по документации и ADR проекта через LanceDB',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Поисковый запрос на естественном языке' }
          },
          required: ['query']
        }
      },
      {
        name: 'ask_question',
        description: 'Задать интерактивный вопрос пользователю с выбором вариантов (радиокнопки, чекбоксы, свой вариант)',
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Краткий заголовок вопроса (например, "Что делаем?")' },
            question: { type: 'string', description: 'Развернутый текст вопроса пользователю' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Название варианта ответа' },
                  description: { type: 'string', description: 'Подробное описание или действие для этого варианта' }
                },
                required: ['label']
              },
              description: 'Список вариантов ответа (от 2 до 10 вариантов)'
            },
            is_multi_select: { type: 'boolean', description: 'Если true — множественный выбор (чекбоксы), если false — одиночный (радиокнопки)' }
          },
          required: ['question', 'options']
        }
      }
    ];
    if (!allowedToolNames || allowedToolNames.length === 0) return all;
    const allowed = new Set(allowedToolNames);
    return all.filter((tool) => allowed.has(tool.name));
  }
}

export const aiAgentService = new AIAgentService();
