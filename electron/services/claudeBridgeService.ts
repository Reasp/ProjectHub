import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import {
  aiAgentService,
  PROJECT_HUB_CLAUDE_DIR,
  type AIProviderConfig,
  type AIMessage,
  type AIToolCall
} from './aiAgentService.js';
import { isInsideProject } from './pathGuard.js';

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

export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface QuestionData {
  title: string;
  subtitle?: string;
  options: QuestionOption[];
  isMultiSelect?: boolean;
  allowOther?: boolean;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  projectPath: string;
  type: 'command' | 'file_write' | 'question' | 'subagent_dispatch';
  title: string;
  details?: string;
  command?: string;
  filePath?: string;
  diff?: {
    filePath: string;
    oldContent: string;
    newContent: string;
    patch: string;
  };
  questionData?: QuestionData;
  createdAt: number;
}

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

class ClaudeBridgeService extends EventEmitter {
  private projectStatuses = new Map<string, ProjectAgentStatus>();
  private pendingApprovals = new Map<string, (response: { approved: boolean; text?: string }) => void>();
  private activeSubagents = new Map<string, SubagentInfo[]>();
  private activeProcesses = new Map<string, ChildProcess>();
  private claudeCliCheck: (ClaudeCliAvailability & { checkedAt: number }) | null = null;
  private claudeCliCheckPromise: Promise<ClaudeCliAvailability> | null = null;

  constructor() {
    super();
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

    this.projectStatuses.set(projectPath, updated);
    this.emit('statusChanged', updated);
  }

  public async requestApproval(request: ApprovalRequest): Promise<{ approved: boolean; text?: string }> {
    return new Promise((resolve) => {
      this.pendingApprovals.set(request.id, resolve);
      this.setProjectStatus(request.projectPath, 'waiting_approval', request.title, request);
    });
  }

  public sendApprovalResponse(requestId: string, response: { approved: boolean; text?: string }): boolean {
    const resolver = this.pendingApprovals.get(requestId);
    if (resolver) {
      resolver(response);
      this.pendingApprovals.delete(requestId);
      return true;
    }
    return false;
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

  public abortSession(sessionId: string): void {
    aiAgentService.abortStream(sessionId);
    const proc = this.activeProcesses.get(sessionId);
    if (proc) {
      proc.kill();
      this.activeProcesses.delete(sessionId);
    }
  }

  public parseQuestionData(args: Record<string, any>): QuestionData {
    let title = args.title || 'Вопрос от ассистента';
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

  public isPathExcluded(filePath: string, patterns: string[] = []): boolean {
    if (!filePath || !patterns || patterns.length === 0) return false;
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    const baseName = path.basename(normalized);

    return patterns.some((rawPattern) => {
      const pattern = rawPattern.trim().replace(/\\/g, '/').toLowerCase();
      if (!pattern) return false;

      if (pattern.startsWith('*') && pattern.endsWith('*')) {
        const sub = pattern.slice(1, -1);
        return normalized.includes(sub);
      }
      if (pattern.startsWith('*')) {
        const ext = pattern.slice(1);
        return normalized.endsWith(ext);
      }
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        return normalized.startsWith(prefix) || baseName.startsWith(prefix);
      }
      if (pattern.startsWith('**/')) {
        const sub = pattern.slice(3);
        return normalized.endsWith(sub) || baseName === sub;
      }
      return normalized === pattern || baseName === pattern || normalized.endsWith('/' + pattern);
    });
  }

  public isCommandDenied(command: string, denyList: string[] = []): boolean {
    if (!command || !denyList || denyList.length === 0) return false;
    const normCmd = command.trim().toLowerCase();
    return denyList.some((denied) => {
      const d = denied.trim().toLowerCase();
      return d && normCmd.includes(d);
    });
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

    this.setProjectStatus(projectPath, 'running', 'Агент анализирует задачу...');

    // If using Anthropic without API key, run directly via local Claude CLI subscription!
    if (req.config.provider === 'anthropic' && (!req.config.apiKey || !req.config.apiKey.trim())) {
      return this.runClaudeCliTask(req, onChunk, onComplete, onError);
    }

    try {
      // Stream Claude thought & tool planning through aiAgentService
      await aiAgentService.streamChat(
        req,
        async (chunk) => {
          onChunk(chunk);

          // If tool call generated, check if it needs approval or interactive question
          if (chunk.toolCall) {
            const tc = chunk.toolCall;

            if (tc.name === 'ask_question' || tc.name === 'AskUserQuestion') {
              const qData = this.parseQuestionData(tc.args);
              const approvalReq: ApprovalRequest = {
                id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                sessionId,
                projectPath,
                type: 'question',
                title: qData.title || 'Вопрос от ассистента',
                details: qData.subtitle,
                questionData: qData,
                createdAt: Date.now()
              };

              onChunk({ approvalRequest: approvalReq });
              const res = await this.requestApproval(approvalReq);
              tc.status = res.approved ? 'accepted' : 'rejected';
              tc.result = res.text || (res.approved ? 'Подтверждено пользователем' : 'Отклонено пользователем');
              onChunk({ toolCall: tc });
            } else if (tc.name === 'read_file' || tc.name === 'read') {
              const filePath = tc.args.filePath || tc.args.path || '';
              const isExcludedFromRead = rules?.readExcludePatterns && this.isPathExcluded(filePath, rules.readExcludePatterns);

              if (isExcludedFromRead) {
                const approvalReq: ApprovalRequest = {
                  id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  sessionId,
                  projectPath,
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
                const res = await this.requestApproval(approvalReq);
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

              if (shouldAutoRun) {
                this.setProjectStatus(projectPath, 'running', `Выполняется: ${cmd}`);
                try {
                  let liveOutput = '';
                  const execOut = await this.executeSubprocess(cmd, projectPath, (chunkText) => {
                    liveOutput += chunkText;
                    tc.status = 'running';
                    tc.result = liveOutput;
                    onChunk({ toolCall: { ...tc } });
                  });
                  tc.status = 'accepted';
                  tc.result = execOut;
                  onChunk({ toolCall: tc });
                } catch (e: any) {
                  tc.status = 'error';
                  tc.result = `Error: ${e.message}`;
                  onChunk({ toolCall: tc });
                }
              } else {
                const approvalReq: ApprovalRequest = {
                  id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  sessionId,
                  projectPath,
                  type: 'command',
                  title: isDenied ? `⚠️ Заблокированная команда требует подтверждения: ${cmd}` : `Разрешение на запуск команды: ${cmd}`,
                  command: cmd,
                  details: tc.args.explanation || (isDenied ? 'Команда находится в списке запрещенных для авто-запуска' : 'Выполнение команды терминала'),
                  createdAt: Date.now()
                };

                onChunk({ approvalRequest: approvalReq });
                const res = await this.requestApproval(approvalReq);

                if (res.approved) {
                  this.setProjectStatus(projectPath, 'running', `Выполняется: ${cmd}`);
                  try {
                    let liveOutput = '';
                    const execOut = await this.executeSubprocess(cmd, projectPath, (chunkText) => {
                      liveOutput += chunkText;
                      tc.status = 'running';
                      tc.result = liveOutput;
                      onChunk({ toolCall: { ...tc } });
                    });
                    tc.status = 'accepted';
                    tc.result = execOut;
                    onChunk({ toolCall: tc });
                  } catch (e: any) {
                    tc.status = 'error';
                    tc.result = `Error: ${e.message}`;
                    onChunk({ toolCall: tc });
                  }
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

              if (!isInsideProject(projectPath, filePath)) {
                // Абсолютный путь вне проекта или выход через `..` — отклоняем до любых
                // одобрений, даже при auto-approve, и объясняем модели причину (TASK-32).
                tc.status = 'rejected';
                tc.result = `Запись отклонена: путь "${filePath}" находится вне корня проекта "${projectPath}". `
                  + 'Разрешены только пути внутри проекта — укажи путь относительно его корня без выхода через "..".';
                onChunk({ toolCall: tc });
              } else if (shouldAutoWrite) {
                await aiAgentService.applyDiff(projectPath, filePath, content);
                tc.status = 'accepted';
                tc.result = `Файл ${filePath} успешно записан`;
                onChunk({ toolCall: tc });
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
                  id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  sessionId,
                  projectPath,
                  type: 'file_write',
                  title: isExcluded ? `⚠️ Файл в списке исключений: ${filePath}` : `Разрешение на запись файла: ${filePath}`,
                  filePath,
                  details: isExcluded ? 'Файл защищен списком исключений авто-одобрения' : (tc.args.explanation || 'Изменение содержимого файла'),
                  diff: tc.diff,
                  createdAt: Date.now()
                };

                onChunk({ approvalRequest: approvalReq, toolCall: tc });
                const res = await this.requestApproval(approvalReq);
                if (res.approved) {
                  await aiAgentService.applyDiff(projectPath, filePath, content);
                  tc.status = 'accepted';
                  tc.result = `Файл ${filePath} успешно сохранен`;
                  onChunk({ toolCall: tc });
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
        },
        (completedMsg) => {
          this.setProjectStatus(projectPath, 'done', 'Задача успешно выполнена');
          onComplete(completedMsg);
        },
        (err) => {
          this.setProjectStatus(projectPath, 'error', `Ошибка: ${err}`);
          onError(err);
        }
      );
    } catch (err: any) {
      this.setProjectStatus(projectPath, 'error', err.message);
      onError(err.message);
    }
  }

  private sessionClaudeCliIds = new Map<string, string>();

  public clearSession(sessionId: string): void {
    this.sessionClaudeCliIds.delete(sessionId);
    this.abortSession(sessionId);
  }

  private async runClaudeCliTask(
    req: {
      sessionId: string;
      projectPath: string;
      messages: AIMessage[];
      config: AIProviderConfig;
      mode: 'agent' | 'chat' | 'architect';
      claudeCliSessionId?: string;
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
      this.setProjectStatus(projectPath, 'error', message);
      onError(message);
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
    cliArgs.push('--dangerously-skip-permissions');
    cliArgs.push('--output-format', 'stream-json', '--verbose');

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
            CLAUDE_CONFIG_DIR: PROJECT_HUB_CLAUDE_DIR
          }
        }
      );
    } catch (err: any) {
      const message = `Не удалось запустить Claude CLI: ${err?.message || String(err)}`;
      this.setProjectStatus(projectPath, 'error', message);
      onError(message);
      return;
    }

    this.activeProcesses.set(sessionId, child);

    // Гарантируем, что onComplete/onError для сессии вызываются ровно один раз:
    // события 'error' и 'close' у ChildProcess могут прийти оба.
    let finished = false;
    let stdinError: string | null = null;
    const failSession = (message: string) => {
      if (finished) return;
      finished = true;
      this.activeProcesses.delete(sessionId);
      this.setProjectStatus(projectPath, 'error', message);
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

    let accumulatedText = '';
    let accumulatedThought = '';
    const toolCalls: AIToolCall[] = [];
    let buffer = '';

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
                onChunk({ toolCall: tc });

                // Detect interactive questions or tool approvals
                if (item.name === 'AskUserQuestion' || item.name === 'ask_question' || item.name === 'ask_user') {
                  const qData = this.parseQuestionData(item.input || {});
                  const approvalReq: ApprovalRequest = {
                    id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    sessionId,
                    projectPath,
                    type: 'question',
                    title: qData.title || 'Вопрос от Claude Code',
                    details: qData.subtitle,
                    questionData: qData,
                    createdAt: Date.now()
                  };
                  onChunk({ approvalRequest: approvalReq });
                } else if (item.name === 'Write' || item.name === 'Edit') {
                  const filePath = item.input?.file_path || item.input?.path || item.input?.target || '';
                  const rules = req.config.autoApproveRules;
                  const isExcluded = rules?.writeExcludePatterns && this.isPathExcluded(filePath, rules.writeExcludePatterns);
                  const shouldPrompt = !req.config.autoApprove || isExcluded || (rules && rules.allowFileWrite === false);

                  if (shouldPrompt) {
                    const approvalReq: ApprovalRequest = {
                      id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      sessionId,
                      projectPath,
                      type: 'file_write',
                      title: isExcluded ? `⚠️ Файл в списке исключений: ${filePath}` : `Запись в файл: ${filePath}`,
                      filePath,
                      details: isExcluded ? 'Файл защищен списком исключений авто-одобрения' : `Claude Code запрашивает запись в файл ${filePath}`,
                      createdAt: Date.now()
                    };
                    onChunk({ approvalRequest: approvalReq });
                  }
                } else if (item.name === 'Read' || item.name === 'read_file') {
                  const filePath = item.input?.file_path || item.input?.path || item.input?.target || '';
                  const rules = req.config.autoApproveRules;
                  const isExcluded = rules?.readExcludePatterns && this.isPathExcluded(filePath, rules.readExcludePatterns);

                  if (isExcluded) {
                    const approvalReq: ApprovalRequest = {
                      id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      sessionId,
                      projectPath,
                      type: 'question',
                      title: `Чтение защищенного файла`,
                      details: `Файл ${filePath} находится в списке исключений для чтения. Разрешить Claude Code доступ?`,
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
                    };
                    onChunk({ approvalRequest: approvalReq });
                  }
                } else if (item.name === 'Bash' || item.name === 'bash') {
                  const cmd = item.input?.command || item.input?.cmd || '';
                  const rules = req.config.autoApproveRules;
                  const isDenied = rules?.commandDenyList && this.isCommandDenied(cmd, rules.commandDenyList);
                  const shouldPrompt = !req.config.autoApprove || isDenied || (rules && rules.allowCommands === false);

                  if (shouldPrompt) {
                    const approvalReq: ApprovalRequest = {
                      id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      sessionId,
                      projectPath,
                      type: 'command',
                      title: isDenied ? `⚠️ Заблокированная команда: ${cmd}` : `Команда терминала: ${cmd}`,
                      command: cmd,
                      details: isDenied ? 'Команда находится в списке запрещенных для авто-запуска' : `Claude Code выполняет команду ${cmd}`,
                      createdAt: Date.now()
                    };
                    onChunk({ approvalRequest: approvalReq });
                  }
                }
              }
            }
          } else if (event.type === 'result') {
            if (event.result && typeof event.result === 'string' && !accumulatedText) {
              accumulatedText = event.result;
              onChunk({ text: event.result });
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
      if (code === 0 || accumulatedText) {
        const completeMsg: AIMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: accumulatedText,
          thought: accumulatedThought,
          toolCalls: toolCalls.map((tc) => ({
            ...tc,
            status: tc.status || 'done'
          })),
          timestamp: new Date().toISOString()
        };
        this.setProjectStatus(projectPath, 'done', 'Задача успешно выполнена');
        onComplete(completeMsg);
      } else {
        const err =
          stderrOutput ||
          (stdinError ? `Не удалось передать запрос в Claude CLI: ${stdinError}` : '') ||
          `Claude Code завершился с кодом ${code}`;
        this.setProjectStatus(projectPath, 'error', err);
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
      try { child.kill(); } catch { /* ignore */ }
    }
  }

  private executeSubprocess(command: string, cwd: string, onOutput?: (chunk: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const isWin = process.platform === 'win32';
      const shell = isWin ? 'powershell.exe' : '/bin/bash';
      const args = isWin ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];

      const child = spawn(shell, args, {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0' }
      });

      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      let output = '';
      child.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        onOutput?.(text);
      });
      child.stderr.on('data', (data) => {
        const text = data.toString();
        output += text;
        onOutput?.(text);
      });
      // Необработанное 'error' на stdio-потоке роняет main-процесс
      child.stdin?.on('error', (err) => settle(() => reject(err)));
      child.stdout.on('error', (err) => settle(() => reject(err)));
      child.stderr.on('error', (err) => settle(() => reject(err)));

      child.on('close', (code) => {
        settle(() => {
          if (code === 0) {
            resolve(output || 'Команда успешно выполнена (код 0)');
          } else {
            resolve(`Команда завершилась с кодом ${code}:\n${output}`);
          }
        });
      });

      child.on('error', (err) => settle(() => reject(err)));
    });
  }
}

export const claudeBridgeService = new ClaudeBridgeService();
