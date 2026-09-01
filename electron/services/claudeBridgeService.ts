import { spawn, type ChildProcess } from 'node:child_process';
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

class ClaudeBridgeService extends EventEmitter {
  private projectStatuses = new Map<string, ProjectAgentStatus>();
  private pendingApprovals = new Map<string, (response: { approved: boolean; text?: string }) => void>();
  private activeSubagents = new Map<string, SubagentInfo[]>();
  private activeProcesses = new Map<string, ChildProcess>();

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

  public abortSession(sessionId: string): void {
    aiAgentService.abortStream(sessionId);
    const proc = this.activeProcesses.get(sessionId);
    if (proc) {
      proc.kill();
      this.activeProcesses.delete(sessionId);
    }
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

          // If tool call generated, check if it needs approval
          if (chunk.toolCall) {
            const tc = chunk.toolCall;

            if (tc.name === 'run_command' || tc.name === 'bash') {
              const cmd = tc.args.command || tc.args.cmd || '';
              const approvalReq: ApprovalRequest = {
                id: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                sessionId,
                projectPath,
                type: 'command',
                title: `Разрешение на запуск команды: ${cmd}`,
                command: cmd,
                details: tc.args.explanation || 'Выполнение команды терминала',
                createdAt: Date.now()
              };

              onChunk({ approvalRequest: approvalReq });
              const res = await this.requestApproval(approvalReq);

              if (res.approved) {
                this.setProjectStatus(projectPath, 'running', `Выполняется: ${cmd}`);
                // Execute command with real-time streaming output
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
              this.setProjectStatus(projectPath, 'running', 'Обработка результатов...');
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

    const existingCliSessionId = req.claudeCliSessionId || this.sessionClaudeCliIds.get(sessionId);
    const cliArgs = ['-p'];
    if (existingCliSessionId) {
      cliArgs.push('--resume', existingCliSessionId);
    }
    if (req.config.model && req.config.model !== 'default') {
      cliArgs.push('--model', req.config.model);
    }
    cliArgs.push('--output-format', 'stream-json', '--verbose');

    const child = spawn(
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

    this.activeProcesses.set(sessionId, child);

    // Pass the prompt safely via stdin to avoid shell argument escaping issues
    child.stdin.write(lastUserMessage, 'utf-8');
    child.stdin.end();

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
        const err = stderrOutput || `Claude Code завершился с кодом ${code}`;
        this.setProjectStatus(projectPath, 'error', err);
        onError(err);
      }
    });

    child.on('error', (err) => {
      this.activeProcesses.delete(sessionId);
      this.setProjectStatus(projectPath, 'error', err.message);
      onError(err.message);
    });
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

      child.on('close', (code) => {
        if (code === 0) {
          resolve(output || 'Команда успешно выполнена (код 0)');
        } else {
          resolve(`Команда завершилась с кодом ${code}:\n${output}`);
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }
}

export const claudeBridgeService = new ClaudeBridgeService();
