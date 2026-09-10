import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import treeKill from 'tree-kill';
import simpleGit from 'simple-git';
import { worktreeService } from './worktreeService.js';
import { aiAgentService, type AIProviderConfig, type AIMessage } from './aiAgentService.js';

export type SwarmMode = 'fan_out' | 'handoff';
export type SwarmStatus = 'idle' | 'preparing' | 'running' | 'completed' | 'failed' | 'stopped';
export type AgentSlotStatus = 'pending' | 'preparing' | 'running' | 'completed' | 'failed' | 'stopped';

export interface AgentSlotConfig {
  id: string;
  name: string;
  engine: 'claude-cli' | 'codex-cli' | 'api';
  role?: string;
  providerConfig?: AIProviderConfig;
  systemPromptAddon?: string;
  cliCommand?: string;
}

export interface AgentSlotDiffSummary {
  filesChanged: number;
  insertions: number;
  deletions: number;
  patch: string;
}

export interface AgentSlotMetrics {
  startTime: number;
  endTime?: number;
  durationMs?: number;
  charsGenerated?: number;
  tokensEstimated?: number;
  speedCharsPerSec?: number;
}

export interface AgentSlotState {
  id: string;
  config: AgentSlotConfig;
  status: AgentSlotStatus;
  worktreePath?: string;
  worktreeBranch?: string;
  commitHash?: string;
  stashHash?: string;
  lastCommitHash?: string;
  commitStatus?: 'committed' | 'stashed' | 'no_changes';
  logs: string[];
  liveOutput: string;
  finalOutput?: string;
  diffSummary?: AgentSlotDiffSummary;
  metrics: AgentSlotMetrics;
  winner?: boolean;
  error?: string;
}

export interface HandoffStageState {
  stageIndex: number;
  role: string;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  inputPrompt: string;
  outputResult?: string;
  durationMs?: number;
}

export interface SwarmSession {
  id: string;
  projectPath: string;
  taskId?: string;
  taskTitle?: string;
  mode: SwarmMode;
  prompt: string;
  baseBranch: string;
  useWorktrees: boolean;
  autoCommitAgentResults?: boolean;
  status: SwarmStatus;
  createdAt: number;
  completedAt?: number;
  agents: AgentSlotState[];
  handoffStages?: HandoffStageState[];
  currentHandoffStageIndex?: number;
  winnerAgentId?: string;
  error?: string;
}

export interface StartFanOutOptions {
  projectPath: string;
  prompt: string;
  taskId?: string;
  taskTitle?: string;
  baseBranch?: string;
  useWorktrees?: boolean;
  autoCommitAgentResults?: boolean;
  agents: AgentSlotConfig[];
}

export interface StartHandoffOptions {
  projectPath: string;
  prompt: string;
  taskId?: string;
  taskTitle?: string;
  baseBranch?: string;
  useWorktrees?: boolean;
  autoCommitAgentResults?: boolean;
  stages: {
    role: string;
    agent: AgentSlotConfig;
    instructions?: string;
  }[];
}

export interface SwarmEventPayload {
  type: 'swarm_updated' | 'agent_updated' | 'agent_chunk' | 'swarm_completed' | 'error';
  swarmId: string;
  agentId?: string;
  session?: SwarmSession;
  chunk?: string;
  error?: string;
}

/**
 * Парсер унифицированного диффа для подсчета затронутых файлов, добавлений и удалений.
 */
export function parseDiffSummary(patch: string): AgentSlotDiffSummary {
  if (!patch || !patch.trim()) {
    return { filesChanged: 0, insertions: 0, deletions: 0, patch: '' };
  }
  let insertions = 0;
  let deletions = 0;
  const changedFiles = new Set<string>();

  const lines = patch.split('\n');
  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      const parts = line.split(' ');
      if (parts[2]) {
        changedFiles.add(parts[2].replace(/^a\//, ''));
      }
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      insertions++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++;
    }
  }

  return {
    filesChanged: changedFiles.size || (insertions > 0 || deletions > 0 ? 1 : 0),
    insertions,
    deletions,
    patch
  };
}

function sanitizeSlug(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 30);
}

function killProcessTree(proc: ChildProcess): void {
  const pid = proc.pid;
  if (!pid) {
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    return;
  }
  treeKill(pid, 'SIGKILL', (err) => {
    if (err) {
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
  });
}

export class AgentFleetService extends EventEmitter {
  private sessions = new Map<string, SwarmSession>();
  private activeProcesses = new Map<string, Set<ChildProcess>>();
  private abortControllers = new Map<string, Set<AbortController>>();
  private agentProcesses = new Map<string, Set<ChildProcess>>();
  private agentAbortControllers = new Map<string, Set<AbortController>>();
  private storageDir = path.join(os.homedir(), '.projecthub', 'swarms');

  constructor() {
    super();
    this.ensureStorageDir();
  }

  private trackAgentProcess(agentId: string, proc: ChildProcess): void {
    if (!this.agentProcesses.has(agentId)) {
      this.agentProcesses.set(agentId, new Set());
    }
    this.agentProcesses.get(agentId)!.add(proc);
  }

  private untrackAgentProcess(agentId: string, proc: ChildProcess): void {
    this.agentProcesses.get(agentId)?.delete(proc);
  }

  private trackAgentAbort(agentId: string, controller: AbortController): void {
    if (!this.agentAbortControllers.has(agentId)) {
      this.agentAbortControllers.set(agentId, new Set());
    }
    this.agentAbortControllers.get(agentId)!.add(controller);
  }

  private untrackAgentAbort(agentId: string, controller: AbortController): void {
    this.agentAbortControllers.get(agentId)?.delete(controller);
  }

  private killAgentProcess(agentId: string): void {
    const procs = this.agentProcesses.get(agentId);
    if (procs) {
      for (const p of procs) killProcessTree(p);
      procs.clear();
      this.agentProcesses.delete(agentId);
    }
    const controllers = this.agentAbortControllers.get(agentId);
    if (controllers) {
      for (const c of controllers) c.abort();
      controllers.clear();
      this.agentAbortControllers.delete(agentId);
    }
  }



  private async ensureStorageDir(): Promise<void> {
    try {
      if (!existsSync(this.storageDir)) {
        await fs.mkdir(this.storageDir, { recursive: true });
      }
    } catch (err) {
      console.error('[AgentFleetService] Failed to create storage dir:', err);
    }
  }

  private emitSwarmEvent(event: SwarmEventPayload): void {
    this.emit('swarmEvent', event);
  }

  public getSwarm(swarmId: string): SwarmSession | undefined {
    return this.sessions.get(swarmId);
  }

  public listSwarms(projectPath?: string): SwarmSession[] {
    const all = Array.from(this.sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
    if (!projectPath) return all;
    return all.filter((s) => path.normalize(s.projectPath) === path.normalize(projectPath));
  }

  /**
   * Запуск режима Fan-Out (соревнование / параллельная генерация).
   */
  public async startFanOut(options: StartFanOutOptions): Promise<SwarmSession> {
    const { projectPath, prompt, taskId, taskTitle, agents } = options;
    const useWorktrees = options.useWorktrees !== false;
    const autoCommitAgentResults = options.autoCommitAgentResults !== false;
    const swarmId = `swarm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Определяем текущую ветку проекта
    let baseBranch = options.baseBranch || 'main';
    try {
      const git = simpleGit(projectPath);
      const status = await git.status();
      if (status.current) {
        baseBranch = status.current;
      }
    } catch (e) {
      console.warn('[AgentFleetService] Could not determine current git branch:', e);
    }

    const agentStates: AgentSlotState[] = agents.map((cfg) => ({
      id: cfg.id || `agent-${Math.random().toString(36).slice(2, 7)}`,
      config: cfg,
      status: 'pending',
      logs: [],
      liveOutput: '',
      metrics: {
        startTime: Date.now(),
        charsGenerated: 0,
        tokensEstimated: 0
      }
    }));

    const session: SwarmSession = {
      id: swarmId,
      projectPath,
      taskId,
      taskTitle,
      mode: 'fan_out',
      prompt,
      baseBranch,
      useWorktrees,
      autoCommitAgentResults,
      status: 'preparing',
      createdAt: Date.now(),
      agents: agentStates
    };

    this.sessions.set(swarmId, session);
    this.activeProcesses.set(swarmId, new Set());
    this.abortControllers.set(swarmId, new Set());

    this.emitSwarmEvent({
      type: 'swarm_updated',
      swarmId,
      session
    });

    // Асинхронно запускаем выполнение всех агентов параллельно
    void this.executeFanOut(session);

    return session;
  }

  private async executeFanOut(session: SwarmSession): Promise<void> {
    session.status = 'running';
    this.emitSwarmEvent({ type: 'swarm_updated', swarmId: session.id, session });

    // Инициализируем worktrees при необходимости
    for (const agentState of session.agents) {
      if (session.useWorktrees) {
        try {
          const agentSlug = sanitizeSlug(agentState.config.name || agentState.id);
          const branchName = `swarm/${session.id.slice(-6)}/${agentSlug}`;
          agentState.status = 'preparing';
          agentState.logs.push(`[Swarm] Создание изолированного Git Worktree: ветка ${branchName}...`);
          this.emitSwarmEvent({ type: 'agent_updated', swarmId: session.id, agentId: agentState.id, session });

          const wt = await worktreeService.addWorktree(session.projectPath, {
            branch: branchName,
            newBranch: true,
            baseCommitOrBranch: session.baseBranch
          });
          agentState.worktreePath = wt.path;
          agentState.worktreeBranch = wt.branch || branchName;
          agentState.logs.push(`[Swarm] Изолированное рабочее дерево готово: ${wt.path}`);
        } catch (err: any) {
          console.error(`[AgentFleetService] Failed to create worktree for ${agentState.id}:`, err);
          agentState.logs.push(`[Swarm Error] Не удалось создать worktree: ${err.message}. Запуск в основном каталоге.`);
        }
      }
    }

    // Запускаем каждого агента параллельно
    const agentPromises = session.agents.map((agentState) => this.runSingleAgent(session, agentState));
    await Promise.allSettled(agentPromises);

    // Проверяем общий статус
    const allDone = session.agents.every((a) => a.status === 'completed' || a.status === 'failed' || a.status === 'stopped');
    if (allDone && session.status === 'running') {
      session.status = 'completed';
      session.completedAt = Date.now();
      this.emitSwarmEvent({ type: 'swarm_completed', swarmId: session.id, session });
    }
  }

  /**
   * Выполнение одного агента в его окружении (Worktree или основной проект).
   */
  private async runSingleAgent(
    session: SwarmSession,
    agentState: AgentSlotState,
    customPrompt?: string
  ): Promise<void> {
    const targetPath = agentState.worktreePath || session.projectPath;
    const promptToRun = customPrompt || session.prompt;
    const startTime = Date.now();
    agentState.metrics.startTime = startTime;
    agentState.status = 'running';
    agentState.logs.push(`[Swarm] Старт агента "${agentState.config.name}" (движок: ${agentState.config.engine})...`);
    this.emitSwarmEvent({ type: 'agent_updated', swarmId: session.id, agentId: agentState.id, session });

    try {
      if (agentState.config.engine === 'claude-cli') {
        await this.runClaudeCliAgent(session, agentState, targetPath, promptToRun);
      } else if (agentState.config.engine === 'codex-cli') {
        await this.runCodexCliAgent(session, agentState, targetPath, promptToRun);
      } else {
        await this.runApiAgent(session, agentState, targetPath, promptToRun);
      }

      agentState.status = 'completed';
      agentState.metrics.endTime = Date.now();
      agentState.metrics.durationMs = agentState.metrics.endTime - startTime;
      const chars = agentState.metrics.charsGenerated || agentState.liveOutput.length;
      agentState.metrics.charsGenerated = chars;
      agentState.metrics.tokensEstimated = Math.round(chars / 4);
      agentState.metrics.speedCharsPerSec = Math.round((chars / Math.max(1, agentState.metrics.durationMs)) * 1000);
      agentState.logs.push(`[Swarm] Агент завершил работу за ${(agentState.metrics.durationMs / 1000).toFixed(1)} с.`);

      // Фиксируем результат агента в Git (AC #1)
      await this.materializeAgentResult(session, agentState);

      // Собираем дифф с базовой веткой (AC #2)
      if (agentState.worktreeBranch) {
        try {
          const diffRaw = await worktreeService.getWorktreeDiff(
            session.projectPath,
            agentState.worktreeBranch,
            session.baseBranch,
            agentState.worktreePath
          );
          agentState.diffSummary = parseDiffSummary(diffRaw);
          agentState.logs.push(
            `[Swarm] Сформирован дифф: ${agentState.diffSummary.filesChanged} файлов, +${agentState.diffSummary.insertions} / -${agentState.diffSummary.deletions}`
          );
        } catch (diffErr) {
          console.warn(`[AgentFleetService] Diff computation failed for ${agentState.id}:`, diffErr);
        }
      }
    } catch (err: any) {
      console.error(`[AgentFleetService] Agent ${agentState.id} execution failed:`, err);
      agentState.status = 'failed';
      agentState.error = err.message || String(err);
      agentState.logs.push(`[Swarm Error] Ошибка: ${agentState.error}`);
      try {
        await this.materializeAgentResult(session, agentState);
      } catch {}
    } finally {
      this.emitSwarmEvent({ type: 'agent_updated', swarmId: session.id, agentId: agentState.id, session });
    }
  }

  private async runApiAgent(
    session: SwarmSession,
    agentState: AgentSlotState,
    targetPath: string,
    prompt: string
  ): Promise<void> {
    const config: AIProviderConfig = agentState.config.providerConfig || {
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-latest',
      temperature: 0.2
    };

    const sysAddon = agentState.config.systemPromptAddon
      ? `\n\nИнструкции для роли: ${agentState.config.systemPromptAddon}`
      : '';

    const messages: AIMessage[] = [
      {
        id: `msg-${Date.now()}-1`,
        role: 'user',
        content: `${prompt}${sysAddon}`,
        timestamp: new Date().toISOString()
      }
    ];

    const controller = new AbortController();
    const abortSet = this.abortControllers.get(session.id);
    abortSet?.add(controller);
    this.trackAgentAbort(agentState.id, controller);

    return new Promise((resolve, reject) => {
      let outputBuffer = '';
      aiAgentService.streamChat(
        {
          sessionId: `swarm-${agentState.id}`,
          projectPath: targetPath,
          messages,
          config,
          mode: 'agent'
        },
        (chunk) => {
          if (chunk.text) {
            outputBuffer += chunk.text;
            agentState.liveOutput = outputBuffer;
            agentState.metrics.charsGenerated = outputBuffer.length;
            this.emitSwarmEvent({
              type: 'agent_chunk',
              swarmId: session.id,
              agentId: agentState.id,
              chunk: chunk.text,
              session
            });
          }
          if (chunk.thought) {
            agentState.logs.push(`[Thought] ${chunk.thought.slice(0, 200)}...`);
          }
        },
        (finalMsg) => {
          agentState.finalOutput = finalMsg.content || outputBuffer;
          abortSet?.delete(controller);
          this.untrackAgentAbort(agentState.id, controller);
          resolve();
        },
        (err) => {
          abortSet?.delete(controller);
          this.untrackAgentAbort(agentState.id, controller);
          reject(new Error(err));
        }
      ).catch((err) => {
        abortSet?.delete(controller);
        this.untrackAgentAbort(agentState.id, controller);
        reject(err);
      });
    });
  }

  private async runClaudeCliAgent(
    session: SwarmSession,
    agentState: AgentSlotState,
    targetPath: string,
    prompt: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['-p', prompt, '--dangerously-skip-permissions'];
      let child: ChildProcess;
      try {
        child = spawn('claude', args, {
          cwd: targetPath,
          shell: true,
          env: {
            ...process.env,
            FORCE_COLOR: '0'
          }
        });
      } catch (e: any) {
        agentState.logs.push(`[Swarm] Claude CLI недоступен напрямую (${e.message}), запуск через API fallback.`);
        return this.runApiAgent(session, agentState, targetPath, prompt).then(resolve).catch(reject);
      }

      const procSet = this.activeProcesses.get(session.id);
      procSet?.add(child);
      this.trackAgentProcess(agentState.id, child);

      child.stdout?.on('data', (d: Buffer) => {
        const text = d.toString('utf-8');
        agentState.liveOutput += text;
        this.emitSwarmEvent({
          type: 'agent_chunk',
          swarmId: session.id,
          agentId: agentState.id,
          chunk: text,
          session
        });
      });

      child.stderr?.on('data', (d: Buffer) => {
        const text = d.toString('utf-8');
        agentState.logs.push(text);
      });

      child.on('error', (err) => {
        procSet?.delete(child);
        this.untrackAgentProcess(agentState.id, child);
        agentState.logs.push(`[Swarm] Ошибка Claude CLI: ${err.message}. Пробуем API fallback.`);
        this.runApiAgent(session, agentState, targetPath, prompt).then(resolve).catch(reject);
      });

      child.on('close', (code) => {
        procSet?.delete(child);
        this.untrackAgentProcess(agentState.id, child);
        if (code === 0 || agentState.liveOutput.length > 0) {
          agentState.finalOutput = agentState.liveOutput;
          resolve();
        } else {
          this.runApiAgent(session, agentState, targetPath, prompt).then(resolve).catch(reject);
        }
      });
    });
  }

  private async runCodexCliAgent(
    session: SwarmSession,
    agentState: AgentSlotState,
    targetPath: string,
    prompt: string
  ): Promise<void> {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'codex.cmd' : 'codex';

    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(cmd, ['-m', prompt], {
          cwd: targetPath,
          shell: true,
          env: { ...process.env, FORCE_COLOR: '0' }
        });
      } catch {
        const fallbackConfig: AIProviderConfig = {
          provider: 'openrouter',
          model: 'openai/gpt-4o',
          temperature: 0.2
        };
        agentState.config.providerConfig = agentState.config.providerConfig || fallbackConfig;
        return this.runApiAgent(session, agentState, targetPath, prompt).then(resolve).catch(reject);
      }

      const procSet = this.activeProcesses.get(session.id);
      procSet?.add(child);
      this.trackAgentProcess(agentState.id, child);

      child.stdout?.on('data', (d: Buffer) => {
        const text = d.toString('utf-8');
        agentState.liveOutput += text;
        this.emitSwarmEvent({
          type: 'agent_chunk',
          swarmId: session.id,
          agentId: agentState.id,
          chunk: text,
          session
        });
      });

      child.on('error', () => {
        procSet?.delete(child);
        this.untrackAgentProcess(agentState.id, child);
        const fallbackConfig: AIProviderConfig = {
          provider: 'openrouter',
          model: 'openai/gpt-4o',
          temperature: 0.2
        };
        agentState.config.providerConfig = agentState.config.providerConfig || fallbackConfig;
        this.runApiAgent(session, agentState, targetPath, prompt).then(resolve).catch(reject);
      });

      child.on('close', (code) => {
        procSet?.delete(child);
        this.untrackAgentProcess(agentState.id, child);
        if (code === 0 || agentState.liveOutput.length > 0) {
          agentState.finalOutput = agentState.liveOutput;
          resolve();
        } else {
          this.runApiAgent(session, agentState, targetPath, prompt).then(resolve).catch(reject);
        }
      });
    });
  }

  /**
   * Запуск режима Handoff (последовательный конвейер специализированных ролей).
   */
  public async startHandoff(options: StartHandoffOptions): Promise<SwarmSession> {
    const { projectPath, prompt, taskId, taskTitle, stages } = options;
    const useWorktrees = options.useWorktrees !== false;
    const autoCommitAgentResults = options.autoCommitAgentResults !== false;
    const swarmId = `swarm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    let baseBranch = options.baseBranch || 'main';
    try {
      const git = simpleGit(projectPath);
      const status = await git.status();
      if (status.current) baseBranch = status.current;
    } catch { /* ignore */ }

    const agentStates: AgentSlotState[] = stages.map((stg, idx) => ({
      id: stg.agent.id || `handoff-agent-${idx + 1}`,
      config: {
        ...stg.agent,
        role: stg.role
      },
      status: 'pending',
      logs: [],
      liveOutput: '',
      metrics: {
        startTime: 0,
        charsGenerated: 0,
        tokensEstimated: 0
      }
    }));

    const handoffStages: HandoffStageState[] = stages.map((stg, idx) => ({
      stageIndex: idx,
      role: stg.role,
      agentId: agentStates[idx].id,
      status: 'pending',
      inputPrompt: ''
    }));

    const session: SwarmSession = {
      id: swarmId,
      projectPath,
      taskId,
      taskTitle,
      mode: 'handoff',
      prompt,
      baseBranch,
      useWorktrees,
      autoCommitAgentResults,
      status: 'preparing',
      createdAt: Date.now(),
      agents: agentStates,
      handoffStages,
      currentHandoffStageIndex: 0
    };

    this.sessions.set(swarmId, session);
    this.activeProcesses.set(swarmId, new Set());
    this.abortControllers.set(swarmId, new Set());

    this.emitSwarmEvent({ type: 'swarm_updated', swarmId, session });

    void this.executeHandoff(session, stages);

    return session;
  }

  private async executeHandoff(
    session: SwarmSession,
    stages: StartHandoffOptions['stages']
  ): Promise<void> {
    session.status = 'running';
    this.emitSwarmEvent({ type: 'swarm_updated', swarmId: session.id, session });

    let sharedWorktreePath = session.projectPath;
    let sharedWorktreeBranch = session.baseBranch;

    if (session.useWorktrees) {
      try {
        const branchName = `handoff/${session.id.slice(-6)}`;
        const wt = await worktreeService.addWorktree(session.projectPath, {
          branch: branchName,
          newBranch: true,
          baseCommitOrBranch: session.baseBranch
        });
        sharedWorktreePath = wt.path;
        sharedWorktreeBranch = wt.branch || branchName;
      } catch (err) {
        console.warn('[AgentFleetService] Failed to create shared worktree for handoff:', err);
      }
    }

    let previousStageOutput = '';

    for (let i = 0; i < stages.length; i++) {
      session.currentHandoffStageIndex = i;
      const stageConfig = stages[i];
      const agentState = session.agents[i];
      const stageState = session.handoffStages![i];

      agentState.worktreePath = sharedWorktreePath;
      agentState.worktreeBranch = sharedWorktreeBranch;

      let stagePrompt = `[Задача проекта]: ${session.prompt}\n\n`;
      if (stageConfig.instructions) {
        stagePrompt += `[Инструкции этапа (${stageConfig.role})]: ${stageConfig.instructions}\n\n`;
      }
      if (previousStageOutput) {
        stagePrompt += `[Артефакты и результат предыдущего этапа]:\n${previousStageOutput}\n\n`;
      }
      stagePrompt += `Выполни свою часть работы в рамках роли "${stageConfig.role}".`;

      stageState.inputPrompt = stagePrompt;
      stageState.status = 'running';
      this.emitSwarmEvent({ type: 'swarm_updated', swarmId: session.id, session });

      const stageStart = Date.now();
      await this.runSingleAgent(session, agentState, stagePrompt);

      stageState.durationMs = Date.now() - stageStart;
      stageState.status = agentState.status === 'completed' ? 'completed' : 'failed';
      stageState.outputResult = agentState.finalOutput || agentState.liveOutput;
      previousStageOutput = stageState.outputResult;

      this.emitSwarmEvent({ type: 'swarm_updated', swarmId: session.id, session });

      if (agentState.status === 'failed') {
        session.status = 'failed';
        session.error = `Этап ${stageConfig.role} завершился с ошибкой`;
        this.emitSwarmEvent({ type: 'swarm_updated', swarmId: session.id, session });
        return;
      }
    }

    session.status = 'completed';
    session.completedAt = Date.now();
    this.emitSwarmEvent({ type: 'swarm_completed', swarmId: session.id, session });
  }

  /**
   * Выбор победителя (Pick Winner) в 1 клик (AC #5, AC #4).
   */
  public async pickWinner(
    swarmId: string,
    winnerAgentId: string,
    mergeIntoBase = true
  ): Promise<{ success: boolean; error?: string; mergedBranch?: string; conflictedFiles?: string[] }> {
    const session = this.sessions.get(swarmId);
    if (!session) {
      return { success: false, error: `Swarm session ${swarmId} not found` };
    }

    const winnerAgent = session.agents.find((a) => a.id === winnerAgentId);
    if (!winnerAgent) {
      return { success: false, error: `Winner agent ${winnerAgentId} not found in swarm` };
    }

    // 1. Слияние ветки
    let mergedBranch: string | undefined;
    if (mergeIntoBase && winnerAgent.worktreeBranch) {
      try {
        const mergeResult = await worktreeService.mergeWorktree(
          session.projectPath,
          winnerAgent.worktreeBranch,
          session.baseBranch
        );
        if (!mergeResult.success) {
          return {
            success: false,
            error: mergeResult.error,
            conflictedFiles: mergeResult.conflictedFiles
          };
        }
        mergedBranch = winnerAgent.worktreeBranch;
        winnerAgent.logs.push(`[Swarm] Ветка ${mergedBranch} успешно влита в ${session.baseBranch}!`);
      } catch (err: any) {
        return { success: false, error: `Merge error: ${err.message || err}` };
      }
    }

    // 2. Остановка и принудительное завершение процессов проигравших агентов (AC #4)
    for (const agent of session.agents) {
      if (agent.id !== winnerAgentId) {
        this.killAgentProcess(agent.id);
        if (agent.status === 'running' || agent.status === 'preparing' || agent.status === 'pending') {
          agent.status = 'stopped';
          agent.logs.push('[Swarm] Остановлен в связи с выбором другого победителя.');
        }
      }
    }

    // 3. Безопасная очистка worktrees и веток проигравших агентов (AC #4, Decision-8)
    // Worktree не удаляется без коммита или снапшота; hash последнего коммита сохраняется в сессии
    if (session.useWorktrees) {
      for (const agent of session.agents) {
        if (agent.id !== winnerAgentId && agent.worktreePath) {
          try {
            if (this.pathExists(agent.worktreePath)) {
              await this.materializeAgentResult(session, agent);
              try {
                const git = this.getWorktreeGit(agent.worktreePath);
                const head = (await git.raw(['rev-parse', 'HEAD'])).trim();
                if (head) {
                  agent.lastCommitHash = head;
                }
              } catch { /* ignore */ }
            }

            await worktreeService.removeWorktree(session.projectPath, agent.worktreePath, true);
            agent.logs.push(`[Swarm] Временное рабочее дерево ${agent.worktreePath} очищено.`);

            // Удаляем временную ветку проигравшего (AC #4)
            if (agent.worktreeBranch) {
              try {
                const git = simpleGit(session.projectPath);
                await git.deleteLocalBranch(agent.worktreeBranch, true);
                agent.logs.push(
                  `[Swarm] Ветка ${agent.worktreeBranch} удалена. Хэш коммита для отката: ${agent.lastCommitHash?.slice(0, 7) || 'N/A'}`
                );
              } catch (branchErr) {
                console.warn(`[AgentFleetService] Failed to delete branch ${agent.worktreeBranch}:`, branchErr);
              }
            }
          } catch (cleanErr) {
            console.warn(`[AgentFleetService] Failed to cleanup worktree ${agent.worktreePath}:`, cleanErr);
          }
        }
      }
      try {
        await worktreeService.pruneWorktrees(session.projectPath);
      } catch { /* ignore */ }
    }

    winnerAgent.winner = true;
    session.winnerAgentId = winnerAgentId;
    session.status = 'completed';
    session.completedAt = Date.now();

    this.emitSwarmEvent({
      type: 'swarm_updated',
      swarmId,
      session
    });

    return {
      success: true,
      mergedBranch
    };
  }

  public stopSwarm(swarmId: string): boolean {
    const session = this.sessions.get(swarmId);
    if (!session) return false;

    const procs = this.activeProcesses.get(swarmId);
    if (procs) {
      for (const p of procs) killProcessTree(p);
      procs.clear();
    }

    const controllers = this.abortControllers.get(swarmId);
    if (controllers) {
      for (const c of controllers) c.abort();
      controllers.clear();
    }

    session.status = 'stopped';
    for (const a of session.agents) {
      if (a.status === 'running' || a.status === 'preparing') {
        a.status = 'stopped';
        a.logs.push('[Swarm] Сессия принудительно остановлена пользователем.');
      }
    }

    this.emitSwarmEvent({
      type: 'swarm_updated',
      swarmId,
      session
    });

    return true;
  }

  protected getWorktreeGit(worktreePath: string) {
    return simpleGit(worktreePath);
  }

  protected pathExists(p: string): boolean {
    return existsSync(p);
  }

  /**
   * Материализация результатов работы агента в Git (AC #1, Decision-8).
   * Если autoCommitAgentResults = true: коммит "agent(<role>): <taskId|sessionId>" от имени ProjectHub Agent.
   * Если autoCommitAgentResults = false: git stash create для сохранения изменений в reflog без коммита.
   */
  public async materializeAgentResult(
    session: SwarmSession,
    agentState: AgentSlotState
  ): Promise<void> {
    const targetPath = agentState.worktreePath;
    if (!targetPath || !this.pathExists(targetPath)) return;

    try {
      const git = this.getWorktreeGit(targetPath);
      const status = await git.status();
      if (status.isClean()) {
        agentState.commitStatus = 'no_changes';
        return;
      }

      // Индексируем все файлы (включая untracked)
      await git.raw(['add', '-A']);

      const shouldAutoCommit = session.autoCommitAgentResults !== false;

      if (shouldAutoCommit) {
        const role = agentState.config.role || agentState.config.name || 'contender';
        const taskOrSession = session.taskId || session.id;
        const commitMsg = `agent(${role}): ${taskOrSession}`;

        // Коммит с явным авторством ProjectHub Agent без изменения глобального gitconfig
        await git.raw([
          '-c',
          'user.name=ProjectHub Agent',
          '-c',
          'user.email=agent@projecthub.local',
          'commit',
          '-m',
          commitMsg
        ]);

        const head = (await git.raw(['rev-parse', 'HEAD'])).trim();
        agentState.commitHash = head;
        agentState.lastCommitHash = head;
        agentState.commitStatus = 'committed';
        agentState.logs.push(`[Swarm Git] Изменения зафиксированы в коммите ${head.slice(0, 7)}: "${commitMsg}"`);
      } else {
        // Режим сохранения в stash snapshot
        const stashMsg = `swarm snapshot: ${agentState.id}`;
        const stashHash = (await git.raw(['stash', 'create', stashMsg])).trim();
        if (stashHash) {
          agentState.stashHash = stashHash;
          agentState.commitStatus = 'stashed';
          agentState.logs.push(`[Swarm Git] Сформирован git stash snapshot: ${stashHash.slice(0, 7)}`);
        }
      }
    } catch (err: any) {
      console.warn(`[AgentFleetService] materializeAgentResult error for ${agentState.id}:`, err);
      agentState.logs.push(`[Swarm Git Warning] Не удалось зафиксировать изменения: ${err.message || String(err)}`);
    }
  }

  public killAll(): void {
    for (const [, procs] of this.activeProcesses.entries()) {
      for (const p of procs) killProcessTree(p);
    }
    for (const [, controllers] of this.abortControllers.entries()) {
      for (const c of controllers) c.abort();
    }
    this.activeProcesses.clear();
    this.abortControllers.clear();
  }
}

export const agentFleetService = new AgentFleetService();
