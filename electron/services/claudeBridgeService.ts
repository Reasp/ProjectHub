import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { aiAgentService, type AIProviderConfig, type AIMessage, type AIToolCall } from './aiAgentService.js';

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

export interface ClaudeBridgeMessageChunk {
  text?: string;
  thought?: string;
  toolCall?: AIToolCall;
  subagent?: SubagentInfo;
  approvalRequest?: ApprovalRequest;
  status?: AgentStatusType;
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
                // Execute command
                try {
                  const execOut = await this.executeSubprocess(cmd, projectPath);
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

  private async runClaudeCliTask(
    req: {
      sessionId: string;
      projectPath: string;
      messages: AIMessage[];
      config: AIProviderConfig;
      mode: 'agent' | 'chat' | 'architect';
    },
    onChunk: (chunk: ClaudeBridgeMessageChunk) => void,
    onComplete: (msg: AIMessage) => void,
    onError: (err: string) => void
  ): Promise<void> {
    const { sessionId, projectPath, messages } = req;
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || 'Привет';

    const child = spawn(
      'claude',
      ['-p', lastUserMessage, '--output-format', 'stream-json', '--verbose'],
      {
        cwd: projectPath,
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' }
      }
    );

    this.activeProcesses.set(sessionId, child);

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

          if (event.type === 'assistant' && event.message?.content) {
            for (const item of event.message.content) {
              if (item.type === 'text') {
                accumulatedText += item.text;
                onChunk({ text: item.text });
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
          // ignore non-json line
        }
      }
    });

    let stderrOutput = '';
    child.stderr.on('data', (data) => {
      stderrOutput += data.toString();
    });

    child.on('close', (code) => {
      this.activeProcesses.delete(sessionId);
      if (code === 0 || accumulatedText) {
        const completeMsg: AIMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: accumulatedText,
          thought: accumulatedThought,
          toolCalls,
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

  private executeSubprocess(command: string, cwd: string): Promise<string> {
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
        output += data.toString();
      });
      child.stderr.on('data', (data) => {
        output += data.toString();
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
