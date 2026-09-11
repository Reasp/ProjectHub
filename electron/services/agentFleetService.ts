import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import treeKill from 'tree-kill';
import simpleGit from 'simple-git';
import { worktreeService } from './worktreeService.js';
import { aiAgentService, type AIProviderConfig, type AIMessage } from './aiAgentService.js';
import { claudeUsageService } from './claudeUsageService.js';
import { claudeBridgeService, CLI_MCP_TOOL_TIMEOUT_MS } from './claudeBridgeService.js';
import { hitlService } from './hitlService.js';
import { applyRolePermissions } from './hitlPolicy.js';
import { appEventBus } from './eventBus.js';
import type { HitlOrigin } from './hitlTypes.js';
import { getUserDataDir, getHandoffReportsDir } from './appPaths.js';
import { loadRoles } from './roleService.js';
import { buildEngineInvocation, apiToolNamesForCategories } from './roleEngineAdapter.js';
import { buildAgentContext } from './contextBuilder.js';
import type { RoleDefinition } from './roleTypes.js';
import { SwarmSessionStore } from './swarmSessionStore.js';
import { appendLiveOutput, pushAgentLog, resetLiveOutput } from './swarmLogBuffer.js';
import {
  BUILTIN_PRICE_TABLE,
  addUsage,
  emptyUsage,
  formatUsd,
  mergePriceTables,
  parseClaudeResultEvent,
  parseCliUsageText,
  priceUsage,
  usageFromClaudeAssistantEvent,
  type AgentUsage,
  type PriceTable
} from './agentCost.js';
import { exportSwarmSessionJson, exportSwarmSessionMarkdown, summarizeSwarmSession } from './swarmExport.js';
import type {
  AgentSlotConfig,
  AgentSlotDiffSummary,
  AgentSlotState,
  HandoffStageState,
  StartFanOutOptions,
  StartHandoffOptions,
  SwarmEventPayload,
  SwarmExportFormat,
  SwarmSession,
  SwarmTranscript
} from './swarmTypes.js';

export type {
  AgentSlotConfig,
  AgentSlotDiffSummary,
  AgentSlotMetrics,
  AgentSlotState,
  AgentSlotStatus,
  HandoffStageState,
  StartFanOutOptions,
  StartHandoffOptions,
  SwarmEventPayload,
  SwarmExportFormat,
  SwarmMode,
  SwarmSession,
  SwarmStatus,
  SwarmTranscript
} from './swarmTypes.js';

/** Файл пользовательских переопределений цен моделей (см. agentCost.ts). */
export const AGENT_PRICING_FILE = 'agent-pricing.json';

/** Дополнение к промпту при возобновлении прерванного агента в том же worktree. */
export const RESUME_PROMPT_SUFFIX =
  '\n\n[ProjectHub] Предыдущий запуск этого агента был прерван перезапуском приложения. ' +
  'Рабочий каталог уже содержит частично выполненную работу: изучи текущее состояние файлов и историю git, ' +
  'продолжи с места остановки и не начинай задачу заново.';

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

function normalizeFsPath(p: string): string {
  const norm = path.resolve(p);
  return process.platform === 'win32' ? norm.toLowerCase() : norm;
}

function isActiveAgentStatus(status: AgentSlotState['status']): boolean {
  return status === 'pending' || status === 'preparing' || status === 'running';
}

function isActiveSwarmStatus(status: SwarmSession['status']): boolean {
  return status === 'preparing' || status === 'running';
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

function timeStamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export class AgentFleetService extends EventEmitter {
  private sessions = new Map<string, SwarmSession>();
  private activeProcesses = new Map<string, Set<ChildProcess>>();
  private abortControllers = new Map<string, Set<AbortController>>();
  private agentProcesses = new Map<string, Set<ChildProcess>>();
  private agentAbortControllers = new Map<string, Set<AbortController>>();
  private priceTable: PriceTable = BUILTIN_PRICE_TABLE;
  private priceTableLoaded = false;
  private readyPromise: Promise<void> = Promise.resolve();

  /**
   * @param store хранилище сессий; `null` — без персистентности (unit-тесты).
   */
  constructor(private readonly store: SwarmSessionStore | null = null) {
    super();
  }

  /** Разрешается после восстановления сессий с диска (см. `init`). */
  public get ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Восстановление сессий при старте приложения. Вызывается из main после `app.whenReady`. */
  public init(): Promise<void> {
    this.readyPromise = this.restoreFromDisk()
      .then(() => undefined)
      .catch((err) => {
        console.error('[AgentFleetService] Failed to restore swarm sessions:', err);
      });
    return this.readyPromise;
  }

  // ---------------------------------------------------------------------------
  // Процессы и отмена
  // ---------------------------------------------------------------------------

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

  private ensureSessionTracking(swarmId: string): void {
    if (!this.activeProcesses.has(swarmId)) this.activeProcesses.set(swarmId, new Set());
    if (!this.abortControllers.has(swarmId)) this.abortControllers.set(swarmId, new Set());
  }

  // ---------------------------------------------------------------------------
  // Персистентность, логи, события
  // ---------------------------------------------------------------------------

  private emitSwarmEvent(event: SwarmEventPayload): void {
    this.emit('swarmEvent', event);
    if (event.session && event.type !== 'swarm_removed') {
      const terminal = event.type === 'swarm_completed' || event.type === 'swarm_updated';
      this.persist(event.session, terminal && !isActiveSwarmStatus(event.session.status));
    }
  }

  /** Сохранение состояния: троттлинг по умолчанию, немедленная запись для терминальных событий. */
  private persist(session: SwarmSession, immediate = false): void {
    if (!this.store) return;
    if (immediate) {
      this.store.save(session).catch((e) => {
        console.warn(`[AgentFleetService] Failed to save swarm ${session.id}:`, e);
      });
    } else {
      this.store.scheduleSave(session);
    }
  }

  /** Строка лога агента: кольцевой буфер в памяти + строка в файле транскрипта. */
  private log(session: SwarmSession, agent: AgentSlotState, line: string): void {
    pushAgentLog(agent, line);
    void this.store?.appendTranscript(session.id, agent.id, `\n[${timeStamp()}] ${line}\n`);
  }

  /** Потоковый чанк вывода агента: хвост в памяти, полный текст в транскрипте, событие в UI. */
  private appendOutput(session: SwarmSession, agent: AgentSlotState, text: string): void {
    if (!text) return;
    appendLiveOutput(agent, text);
    agent.metrics.charsGenerated = (agent.metrics.charsGenerated ?? 0) + text.length;
    void this.store?.appendTranscript(session.id, agent.id, text);
    this.emitSwarmEvent({
      type: 'agent_chunk',
      swarmId: session.id,
      agentId: agent.id,
      chunk: text,
      session
    });
  }

  // ---------------------------------------------------------------------------
  // Стоимость и бюджет
  // ---------------------------------------------------------------------------

  /** Таблица цен: встроенная + переопределения из `<userData>/agent-pricing.json` (читается один раз). */
  public async getPriceTable(): Promise<PriceTable> {
    if (this.priceTableLoaded) return this.priceTable;
    this.priceTableLoaded = true;
    try {
      const file = path.join(getUserDataDir(), AGENT_PRICING_FILE);
      if (existsSync(file)) {
        const raw = JSON.parse(await fs.readFile(file, 'utf8'));
        this.priceTable = mergePriceTables(BUILTIN_PRICE_TABLE, raw);
        console.log(`[AgentFleetService] Loaded custom price table (${Object.keys(this.priceTable.models).length} models, updated ${this.priceTable.updatedAt})`);
      }
    } catch (err) {
      console.warn('[AgentFleetService] Failed to read agent-pricing.json, using built-in prices:', err);
    }
    return this.priceTable;
  }

  /** Подмена таблицы цен (тесты, настройки). */
  public setPriceTable(table: PriceTable): void {
    this.priceTable = table;
    this.priceTableLoaded = true;
  }

  private recomputeSessionCost(session: SwarmSession): void {
    const totals = summarizeSwarmSession(session);
    session.totalCostUsd = totals.costKnown ? totals.costUsd : undefined;
  }

  /**
   * Записывает usage агента (накопительно или заменяя итогом), считает стоимость по таблице
   * цен, если провайдер её не сообщил, и проверяет бюджеты слота и сессии.
   * Возвращает true, если агент остановлен по бюджету.
   */
  private recordUsage(
    session: SwarmSession,
    agent: AgentSlotState,
    usage: AgentUsage,
    mode: 'add' | 'replace',
    model?: string
  ): boolean {
    const merged = mode === 'replace' ? usage : addUsage(agent.metrics.usage ?? emptyUsage(), usage);
    const priced = priceUsage(merged, model ?? merged.model ?? agent.config.providerConfig?.model, this.priceTable);
    agent.metrics.usage = priced;
    agent.metrics.costUsd = priced.costUsd;
    this.recomputeSessionCost(session);
    return this.enforceBudget(session, agent);
  }

  /** Бюджеты: слот (`config.budgetUsd`) и сессия (`session.budgetUsd`). */
  private enforceBudget(session: SwarmSession, agent: AgentSlotState): boolean {
    const agentCost = agent.metrics.costUsd;
    const agentBudget = agent.config.budgetUsd;
    if (typeof agentBudget === 'number' && agentBudget > 0 && typeof agentCost === 'number' && agentCost > agentBudget) {
      this.stopAgentForBudget(session, agent, `Бюджет агента ${formatUsd(agentBudget)} превышен (потрачено ${formatUsd(agentCost)})`);
      return true;
    }
    const sessionBudget = session.budgetUsd;
    const total = session.totalCostUsd;
    if (typeof sessionBudget === 'number' && sessionBudget > 0 && typeof total === 'number' && total > sessionBudget) {
      const reason = `Бюджет сессии ${formatUsd(sessionBudget)} превышен (потрачено ${formatUsd(total)})`;
      session.error = reason;
      for (const a of session.agents) {
        if (isActiveAgentStatus(a.status)) this.stopAgentForBudget(session, a, reason);
      }
      return true;
    }
    return false;
  }

  private stopAgentForBudget(session: SwarmSession, agent: AgentSlotState, reason: string): void {
    if (agent.status === 'budget_exceeded') return;
    agent.status = 'budget_exceeded';
    agent.error = reason;
    this.log(session, agent, `[Swarm Budget] ${reason}. Агент остановлен.`);
    this.killAgentProcess(agent.id);
    this.emitSwarmEvent({ type: 'agent_updated', swarmId: session.id, agentId: agent.id, session });
  }

  // ---------------------------------------------------------------------------
  // Чтение
  // ---------------------------------------------------------------------------

  public getSwarm(swarmId: string): SwarmSession | undefined {
    return this.sessions.get(swarmId);
  }

  public listSwarms(projectPath?: string): SwarmSession[] {
    const all = Array.from(this.sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
    if (!projectPath) return all;
    return all.filter((s) => normalizeFsPath(s.projectPath) === normalizeFsPath(projectPath));
  }

  /** Полный транскрипт агента из файла (хвост до лимита). */
  public async readTranscript(swarmId: string, agentId: string): Promise<SwarmTranscript | null> {
    if (!this.store) return null;
    const session = this.sessions.get(swarmId);
    if (!session || !session.agents.some((a) => a.id === agentId)) return null;
    const result = await this.store.readTranscript(swarmId, agentId);
    if (!result) return null;
    return { swarmId, agentId, ...result };
  }

  /** Экспорт сессии в Markdown или JSON (AC #5). */
  public exportSession(swarmId: string, format: SwarmExportFormat): string | null {
    const session = this.sessions.get(swarmId);
    if (!session) return null;
    return format === 'json' ? exportSwarmSessionJson(session) : exportSwarmSessionMarkdown(session);
  }

  // ---------------------------------------------------------------------------
  // Восстановление после перезапуска (AC #1)
  // ---------------------------------------------------------------------------

  /**
   * Загружает сессии с диска. Незавершённые помечаются `interrupted`, их worktree сверяются
   * с `git worktree list` и файловой системой; агенты с потерянным worktree получают `worktreeMissing`.
   */
  public async restoreFromDisk(): Promise<SwarmSession[]> {
    if (!this.store) return [];
    const stored = await this.store.list();
    const worktreesByProject = new Map<string, Set<string> | null>();

    const registeredWorktrees = async (projectPath: string): Promise<Set<string> | null> => {
      const key = normalizeFsPath(projectPath);
      if (worktreesByProject.has(key)) return worktreesByProject.get(key)!;
      let set: Set<string> | null = null;
      try {
        const list = await worktreeService.listWorktrees(projectPath);
        set = new Set(list.map((w) => normalizeFsPath(w.path)));
      } catch (err) {
        console.warn(`[AgentFleetService] git worktree list failed for ${projectPath}:`, err);
      }
      worktreesByProject.set(key, set);
      return set;
    };

    const restored: SwarmSession[] = [];
    for (const session of stored) {
      if (this.sessions.has(session.id)) continue;
      session.restored = true;
      let changed = false;

      if (isActiveSwarmStatus(session.status)) {
        session.status = 'interrupted';
        session.interruptedAt = Date.now();
        changed = true;
      }
      for (const agent of session.agents) {
        if (isActiveAgentStatus(agent.status)) {
          agent.status = 'interrupted';
          pushAgentLog(agent, '[Swarm] Работа прервана перезапуском ProjectHub. Сессию можно возобновить или закрыть.');
          changed = true;
        }
        if (agent.worktreePath && (session.status === 'interrupted' || isActiveAgentStatus(agent.status) || agent.status === 'interrupted')) {
          const registered = await registeredWorktrees(session.projectPath);
          const onDisk = this.pathExists(agent.worktreePath);
          const inGit = registered ? registered.has(normalizeFsPath(agent.worktreePath)) : onDisk;
          const missing = !onDisk || !inGit;
          if (missing !== Boolean(agent.worktreeMissing)) {
            agent.worktreeMissing = missing || undefined;
            changed = true;
          }
          if (missing) pushAgentLog(agent, `[Swarm] Worktree ${agent.worktreePath} не найден: возобновление невозможно, только очистка.`);
        }
      }
      if (session.mode === 'handoff' && session.handoffStages) {
        for (const stage of session.handoffStages) {
          if (stage.status === 'running') {
            stage.status = 'pending';
            changed = true;
          }
        }
      }

      this.sessions.set(session.id, session);
      this.ensureSessionTracking(session.id);
      restored.push(session);
      if (changed) this.persist(session, true);
    }

    if (restored.length > 0) {
      const interrupted = restored.filter((s) => s.status === 'interrupted').length;
      console.log(`[AgentFleetService] Restored ${restored.length} swarm session(s) from disk, ${interrupted} interrupted`);
    }
    return restored;
  }

  /**
   * Возобновление прерванной сессии: агенты перезапускаются в своих worktree с промптом
   * «продолжи». Агенты без worktree помечаются failed.
   */
  public async resumeSwarm(swarmId: string): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(swarmId);
    if (!session) return { success: false, error: `Swarm session ${swarmId} not found` };
    if (session.status !== 'interrupted') {
      return { success: false, error: `Сессия в статусе "${session.status}" не может быть возобновлена` };
    }

    const resumable = session.agents.filter((a) => a.status === 'interrupted');
    if (resumable.length === 0) {
      return { success: false, error: 'В сессии нет прерванных агентов' };
    }
    for (const agent of resumable) {
      if (agent.worktreePath && agent.worktreeMissing) {
        agent.status = 'failed';
        agent.error = 'Worktree агента не найден после перезапуска';
        this.log(session, agent, `[Swarm Error] ${agent.error}`);
      }
    }

    // Возобновлять нечего: все прерванные агенты потеряли worktree.
    const startIndex =
      session.mode === 'handoff'
        ? Math.max(0, session.handoffStages?.findIndex((s) => s.status !== 'completed') ?? session.currentHandoffStageIndex ?? 0)
        : 0;
    const stillResumable =
      session.mode === 'handoff'
        ? session.agents[startIndex]?.status === 'interrupted'
        : session.agents.some((a) => a.status === 'interrupted');
    if (!stillResumable) {
      session.status = 'failed';
      session.error = 'Worktree прерванных агентов не найдены: возобновление невозможно, сессию можно только закрыть';
      session.completedAt = Date.now();
      this.emitSwarmEvent({ type: 'swarm_updated', swarmId: session.id, session });
      return { success: false, error: session.error };
    }

    session.status = 'running';
    session.interruptedAt = undefined;
    session.error = undefined;
    this.ensureSessionTracking(session.id);
    this.emitSwarmEvent({ type: 'swarm_updated', swarmId: session.id, session });

    if (session.mode === 'handoff') {
      void this.executeHandoff(session, startIndex, true);
    } else {
      void this.executeFanOut(session, true);
    }
    return { success: true };
  }

  private prepareAgentForResume(session: SwarmSession, agent: AgentSlotState): void {
    agent.resumeCount = (agent.resumeCount ?? 0) + 1;
    agent.status = 'pending';
    agent.error = undefined;
    agent.finalOutput = undefined;
    agent.diffSummary = undefined;
    resetLiveOutput(agent);
    this.log(session, agent, `[Swarm] Возобновление работы агента (попытка ${agent.resumeCount + 1}) в ${agent.worktreePath || session.projectPath}`);
  }

  /**
   * Закрытие сессии с очисткой: остановка процессов, удаление worktree и временных веток,
   * удаление файлов состояния и транскриптов.
   */
  public async discardSwarm(swarmId: string, cleanupWorktrees = true): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(swarmId);
    if (!session) return { success: false, error: `Swarm session ${swarmId} not found` };

    this.stopSwarm(swarmId, false);

    if (cleanupWorktrees && session.useWorktrees) {
      const seen = new Set<string>();
      for (const agent of session.agents) {
        if (!agent.worktreePath) continue;
        const key = normalizeFsPath(agent.worktreePath);
        if (seen.has(key)) continue;
        seen.add(key);
        if (normalizeFsPath(agent.worktreePath) === normalizeFsPath(session.projectPath)) continue;
        try {
          if (this.pathExists(agent.worktreePath)) {
            await this.materializeAgentResult(session, agent);
            await worktreeService.removeWorktree(session.projectPath, agent.worktreePath, true);
          }
          const branch = agent.worktreeBranch;
          if (branch && (branch.startsWith('swarm/') || branch.startsWith('handoff/'))) {
            try {
              await simpleGit(session.projectPath).deleteLocalBranch(branch, true);
            } catch (branchErr) {
              console.warn(`[AgentFleetService] Failed to delete branch ${branch}:`, branchErr);
            }
          }
        } catch (cleanErr) {
          console.warn(`[AgentFleetService] Failed to cleanup worktree ${agent.worktreePath}:`, cleanErr);
        }
      }
      try {
        await worktreeService.pruneWorktrees(session.projectPath);
      } catch { /* ignore */ }
    }

    this.sessions.delete(swarmId);
    this.activeProcesses.delete(swarmId);
    this.abortControllers.delete(swarmId);
    if (this.store) await this.store.delete(swarmId);
    this.emit('swarmEvent', { type: 'swarm_removed', swarmId } satisfies SwarmEventPayload);
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Fan-Out
  // ---------------------------------------------------------------------------

  private async detectBaseBranch(projectPath: string, fallback?: string): Promise<string> {
    let baseBranch = fallback || 'main';
    try {
      const git = simpleGit(projectPath);
      const status = await git.status();
      if (status.current) baseBranch = status.current;
    } catch (e) {
      console.warn('[AgentFleetService] Could not determine current git branch:', e);
    }
    return baseBranch;
  }

  private newAgentState(cfg: AgentSlotConfig, id: string, startTime: number): AgentSlotState {
    return {
      id,
      config: cfg,
      status: 'pending',
      logs: [],
      liveOutput: '',
      metrics: { startTime, charsGenerated: 0, tokensEstimated: 0 }
    };
  }

  /**
   * Запуск режима Fan-Out (соревнование / параллельная генерация).
   */
  public async startFanOut(options: StartFanOutOptions): Promise<SwarmSession> {
    const { projectPath, prompt, taskId, taskTitle, agents } = options;
    const useWorktrees = options.useWorktrees !== false;
    const autoCommitAgentResults = options.autoCommitAgentResults !== false;
    const swarmId = `swarm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const baseBranch = await this.detectBaseBranch(projectPath, options.baseBranch);
    await this.getPriceTable();

    const agentStates: AgentSlotState[] = agents.map((cfg) =>
      this.newAgentState(cfg, cfg.id || `agent-${Math.random().toString(36).slice(2, 7)}`, Date.now())
    );

    const session: SwarmSession = {
      id: swarmId,
      projectPath,
      taskId,
      taskTitle,
      ...(options.origin ? { origin: options.origin } : {}),
      mode: 'fan_out',
      prompt,
      baseBranch,
      useWorktrees,
      autoCommitAgentResults,
      ...(typeof options.budgetUsd === 'number' && options.budgetUsd > 0 ? { budgetUsd: options.budgetUsd } : {}),
      status: 'preparing',
      createdAt: Date.now(),
      agents: agentStates
    };

    this.sessions.set(swarmId, session);
    this.ensureSessionTracking(swarmId);

    this.emitSwarmEvent({ type: 'swarm_updated', swarmId, session });

    // Асинхронно запускаем выполнение всех агентов параллельно
    void this.executeFanOut(session, false);

    return session;
  }

  /**
   * Запуск агента, назначенного на задачу через `assignee: agent:<roleSlug>[@hostId]`
   * (decision-9 п.4, TASK-60): один слот fan-out с ролью, помеченный `origin: 'assigned'` для
   * HITL/аудита. `hostId` вне локального хоста пока не поддержан — федерация (TASK-66).
   */
  public async startAssignedAgent(options: {
    projectPath: string;
    taskId: string;
    taskTitle?: string;
    prompt: string;
    roleSlug: string;
    hostId?: string;
    useWorktrees?: boolean;
  }): Promise<SwarmSession | { error: string }> {
    if (options.hostId && options.hostId !== hitlService.currentHostId) {
      return { error: `Хост "${options.hostId}" недоступен — федерация между машинами ещё не реализована (TASK-66).` };
    }
    const { roles } = await loadRoles(options.projectPath);
    const role = roles.find((r) => r.slug === options.roleSlug);
    if (!role) {
      return { error: `Роль "${options.roleSlug}" не найдена в реестре ролей.` };
    }

    const slot: AgentSlotConfig = {
      id: `assigned-${options.taskId}-${Date.now().toString(36)}`,
      name: role.name,
      engine: role.engine || 'claude-cli',
      role: role.name,
      roleSlug: role.slug,
      budgetUsd: role.budgetUsd,
      permissions: role.permissions,
      ...(role.model || role.provider
        ? { providerConfig: { provider: (role.provider as AIProviderConfig['provider']) || 'anthropic', model: role.model || 'default' } }
        : {})
    };

    return this.startFanOut({
      projectPath: options.projectPath,
      prompt: options.prompt,
      taskId: options.taskId,
      taskTitle: options.taskTitle,
      useWorktrees: options.useWorktrees,
      origin: 'assigned',
      agents: [slot]
    });
  }

  private async executeFanOut(session: SwarmSession, resume: boolean): Promise<void> {
    session.status = 'running';
    this.emitSwarmEvent({ type: 'swarm_updated', swarmId: session.id, session });

    const targets = resume ? session.agents.filter((a) => a.status === 'interrupted') : session.agents;

    for (const agentState of targets) {
      if (resume) {
        this.prepareAgentForResume(session, agentState);
        continue;
      }
      if (session.useWorktrees) {
        try {
          const agentSlug = sanitizeSlug(agentState.config.name || agentState.id);
          const branchName = `swarm/${session.id.slice(-6)}/${agentSlug}`;
          agentState.status = 'preparing';
          this.log(session, agentState, `[Swarm] Создание изолированного Git Worktree: ветка ${branchName}...`);
          this.emitSwarmEvent({ type: 'agent_updated', swarmId: session.id, agentId: agentState.id, session });

          const wt = await worktreeService.addWorktree(session.projectPath, {
            branch: branchName,
            newBranch: true,
            baseCommitOrBranch: session.baseBranch
          });
          agentState.worktreePath = wt.path;
          agentState.worktreeBranch = wt.branch || branchName;
          this.log(session, agentState, `[Swarm] Изолированное рабочее дерево готово: ${wt.path}`);
        } catch (err: any) {
          console.error(`[AgentFleetService] Failed to create worktree for ${agentState.id}:`, err);
          this.log(session, agentState, `[Swarm Error] Не удалось создать worktree: ${err.message}. Запуск в основном каталоге.`);
        }
      }
    }

    const agentPromises = targets.map((agentState) =>
      this.runSingleAgent(session, agentState, resume ? `${session.prompt}${RESUME_PROMPT_SUFFIX}` : undefined)
    );
    await Promise.allSettled(agentPromises);

    if (session.status !== 'running') return;
    const allDone = session.agents.every((a) => !isActiveAgentStatus(a.status) && a.status !== 'interrupted');
    if (allDone) {
      this.finishSession(session);
    }
  }

  private finishSession(session: SwarmSession): void {
    session.completedAt = Date.now();
    const budgetHit =
      typeof session.budgetUsd === 'number' &&
      session.budgetUsd > 0 &&
      typeof session.totalCostUsd === 'number' &&
      session.totalCostUsd > session.budgetUsd;
    if (budgetHit) {
      session.status = 'failed';
      session.error = session.error || `Бюджет сессии ${formatUsd(session.budgetUsd)} превышен`;
      this.emitSwarmEvent({ type: 'swarm_updated', swarmId: session.id, session });
      return;
    }
    session.status = 'completed';
    this.emitSwarmEvent({ type: 'swarm_completed', swarmId: session.id, session });
  }

  /** Роль слота из реестра (decision-9, TASK-60) — `undefined`, если `roleSlug` не задан/не найден. */
  private async resolveRole(session: SwarmSession, agentState: AgentSlotState): Promise<RoleDefinition | undefined> {
    const slug = agentState.config.roleSlug;
    if (!slug) return undefined;
    try {
      const { roles } = await loadRoles(session.projectPath);
      const role = roles.find((r) => r.slug === slug);
      if (!role) this.log(session, agentState, `[Swarm] Роль "${slug}" не найдена в реестре — используется без роли.`);
      return role;
    } catch (err: any) {
      console.warn(`[AgentFleetService] Failed to load role "${slug}":`, err);
      return undefined;
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
    const role = await this.resolveRole(session, agentState);
    if (role) {
      const unsupported = buildEngineInvocation({
        engine: agentState.config.engine,
        role,
        extraSystemPrompt: agentState.config.systemPromptAddon,
        model: agentState.config.providerConfig?.model
      }).unsupportedFeatures;
      if (unsupported.length > 0) {
        this.log(
          session,
          agentState,
          `[Swarm] ⚠️ Движок "${agentState.config.engine}" не поддерживает нативно: ${unsupported.join(', ')} (роль "${role.name}") — применяется по возможности иначе.`
        );
      }
    }
    const startTime = Date.now();
    agentState.metrics.startTime = startTime;
    agentState.metrics.endTime = undefined;
    agentState.metrics.durationMs = undefined;
    agentState.status = 'running';
    this.log(session, agentState, `[Swarm] Старт агента "${agentState.config.name}" (движок: ${agentState.config.engine})...`);
    this.emitSwarmEvent({ type: 'agent_updated', swarmId: session.id, agentId: agentState.id, session });
    const busBase = {
      sessionId: this.hitlSessionId(agentState),
      projectPath: session.projectPath,
      origin: this.hitlOrigin(session),
      engine: agentState.config.engine,
      agentId: agentState.id,
      agentName: agentState.config.name,
      role: agentState.config.role,
      hostId: hitlService.currentHostId
    };
    appEventBus.publish({ type: 'agent:started', ...busBase, at: startTime });

    try {
      if (agentState.config.engine === 'claude-cli') {
        await this.runClaudeCliAgent(session, agentState, targetPath, promptToRun, role);
      } else if (agentState.config.engine === 'codex-cli') {
        await this.runCodexCliAgent(session, agentState, targetPath, promptToRun, role);
      } else if (agentState.config.engine === 'gemini-cli') {
        await this.runGeminiCliAgent(session, agentState, targetPath, promptToRun, role);
      } else {
        await this.runApiAgent(session, agentState, targetPath, promptToRun, role);
      }

      agentState.metrics.endTime = Date.now();
      agentState.metrics.durationMs = agentState.metrics.endTime - startTime;
      const chars = agentState.metrics.charsGenerated || agentState.liveOutput.length;
      agentState.metrics.charsGenerated = chars;
      // Грубая оценка нужна только когда реального usage нет.
      agentState.metrics.tokensEstimated = agentState.metrics.usage ? undefined : Math.round(chars / 4);
      agentState.metrics.speedCharsPerSec = Math.round((chars / Math.max(1, agentState.metrics.durationMs)) * 1000);

      // Остановка/бюджет могли изменить статус, пока процесс завершался — не перетираем.
      if (agentState.status === 'running') {
        agentState.status = 'completed';
        this.log(session, agentState, `[Swarm] Агент завершил работу за ${(agentState.metrics.durationMs / 1000).toFixed(1)} с.`);
      }

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
          this.log(
            session,
            agentState,
            `[Swarm] Сформирован дифф: ${agentState.diffSummary.filesChanged} файлов, +${agentState.diffSummary.insertions} / -${agentState.diffSummary.deletions}`
          );
        } catch (diffErr) {
          console.warn(`[AgentFleetService] Diff computation failed for ${agentState.id}:`, diffErr);
        }
      }
    } catch (err: any) {
      console.error(`[AgentFleetService] Agent ${agentState.id} execution failed:`, err);
      agentState.metrics.endTime = Date.now();
      agentState.metrics.durationMs = agentState.metrics.endTime - startTime;
      if (agentState.status === 'running') {
        agentState.status = 'failed';
        agentState.error = err.message || String(err);
      }
      this.log(session, agentState, `[Swarm Error] Ошибка: ${err.message || String(err)}`);
      try {
        await this.materializeAgentResult(session, agentState);
      } catch { /* ignore */ }
    } finally {
      // Агент больше не ждёт ответов: снимаем его запросы из очереди HITL (TASK-57).
      hitlService.cancelSession(busBase.sessionId, `Агент "${agentState.config.name}" завершил работу`);
      const durationMs = agentState.metrics.durationMs;
      if (agentState.status === 'failed') {
        appEventBus.publish({ type: 'agent:failed', ...busBase, at: Date.now(), durationMs, error: agentState.error || 'Ошибка агента' });
      } else {
        appEventBus.publish({
          type: 'agent:finished',
          ...busBase,
          at: Date.now(),
          durationMs,
          outcome: agentState.status === 'completed' ? 'done' : 'aborted'
        });
      }
      this.emitSwarmEvent({ type: 'agent_updated', swarmId: session.id, agentId: agentState.id, session });
    }
  }

  /** sessionId агента в очереди HITL и событиях шины. */
  private hitlSessionId(agentState: AgentSlotState): string {
    return `swarm-${agentState.id}`;
  }

  private hitlOrigin(session: SwarmSession): HitlOrigin {
    if (session.origin === 'assigned') return 'assigned';
    return session.mode === 'handoff' ? 'handoff' : 'swarm';
  }

  /**
   * Готовит HITL для Claude CLI агента Swarm/Handoff (TASK-57, decision-10): тот же
   * `--permission-prompt-tool` и встроенный MCP-сервер, что и в AI Studio; глобальные правила
   * auto-approve сужаются правами роли слота. Если сервер поднять не удалось:
   * при включённом (и не суженном ролью) auto-approve — залогированный fallback
   * `--dangerously-skip-permissions`, иначе агент не запускается.
   */
  private async prepareAgentHitl(
    session: SwarmSession,
    agentState: AgentSlotState,
    targetPath: string
  ): Promise<{ args: string[]; env: Record<string, string>; cleanup: () => void } | { error: string }> {
    let globalConfig: AIProviderConfig;
    try {
      globalConfig = await aiAgentService.getConfig();
    } catch {
      globalConfig = { provider: 'anthropic', model: 'default' };
    }
    const permissions = agentState.config.permissions;
    const sessionId = this.hitlSessionId(agentState);
    const meta = {
      origin: this.hitlOrigin(session),
      engine: 'claude-cli' as const,
      agentId: agentState.id,
      agentName: agentState.config.name,
      role: agentState.config.role,
      permissions
    };
    const onChunk = (chunk: { approvalRequest?: { title: string; type: string } }) => {
      if (chunk.approvalRequest) {
        this.log(session, agentState, `[HITL] Ожидает решения (${chunk.approvalRequest.type}): ${chunk.approvalRequest.title}`);
        this.emitSwarmEvent({ type: 'agent_updated', swarmId: session.id, agentId: agentState.id, session });
      }
    };

    const hitl = await claudeBridgeService.prepareCliPermissions(sessionId, targetPath, globalConfig, onChunk, meta);
    if (hitl) {
      const effective = applyRolePermissions(globalConfig, permissions);
      this.log(
        session,
        agentState,
        `[HITL] Разрешения через ProjectHub (auto-approve: ${effective.autoApprove ? 'вкл' : 'выкл'}${permissions ? ', права роли применены' : ''}).`
      );
      return hitl;
    }

    const effective = applyRolePermissions(globalConfig, permissions);
    if (effective.autoApprove) {
      const reason = 'Встроенный MCP-сервер недоступен, включено авто-одобрение: запуск с --dangerously-skip-permissions';
      hitlService.recordFallback({ sessionId, projectPath: session.projectPath, ...meta, reason });
      this.log(session, agentState, `[HITL] ⚠️ ${reason}. Списки исключений и запрещённых команд не применяются.`);
      return { args: ['--dangerously-skip-permissions'], env: { MCP_TOOL_TIMEOUT: String(CLI_MCP_TOOL_TIMEOUT_MS) }, cleanup: () => undefined };
    }
    return {
      error: 'Не удалось запустить встроенный MCP-сервер ProjectHub для подтверждений действий агента. '
        + 'Включите сервер в настройках MCP (или освободите его порт) либо включите авто-одобрение в настройках AI Studio.'
    };
  }

  /**
   * Единая точка внедрения контекста задачи в промпт CLI-движков (TASK-64, decision-4 п.4):
   * `systemPromptAddon` слота + contextBuilder (задача/AC, RAG, GitNexus, git-статус worktree),
   * дальше течёт как `extraSystemPrompt` в `buildEngineInvocation` для любого движка одинаково.
   */
  private async buildExtraSystemPrompt(session: SwarmSession, agentState: AgentSlotState, targetPath: string): Promise<string | undefined> {
    const addon = agentState.config.systemPromptAddon;
    if (!session.taskId) return addon;
    try {
      const context = await buildAgentContext({
        projectPath: session.projectPath,
        taskId: session.taskId,
        gitCwd: targetPath
      });
      return [addon, context.combined].filter(Boolean).join('\n\n') || undefined;
    } catch (err) {
      console.warn('[AgentFleetService] contextBuilder failed:', err);
      return addon;
    }
  }

  private async runApiAgent(
    session: SwarmSession,
    agentState: AgentSlotState,
    targetPath: string,
    prompt: string,
    role?: RoleDefinition
  ): Promise<void> {
    const config: AIProviderConfig = agentState.config.providerConfig || {
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-latest',
      temperature: 0.2
    };

    // Системный промпт роли идёт отдельным полем (buildSystemPrompt), а не в тело сообщения —
    // так он одинаково применяется независимо от того, есть ли у роли `tools` (decision-9).
    const roleSystemPrompt = [role?.systemPrompt, agentState.config.systemPromptAddon].filter(Boolean).join('\n\n') || undefined;
    const allowedToolNames = role?.tools && role.tools.length > 0 ? apiToolNamesForCategories(role.tools) : undefined;

    const messages: AIMessage[] = [
      {
        id: `msg-${Date.now()}-1`,
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString()
      }
    ];

    const controller = new AbortController();
    const abortSet = this.abortControllers.get(session.id);
    abortSet?.add(controller);
    this.trackAgentAbort(agentState.id, controller);

    return new Promise((resolve, reject) => {
      let outputBuffer = '';
      let usageSeen = false;
      const cleanup = () => {
        abortSet?.delete(controller);
        this.untrackAgentAbort(agentState.id, controller);
      };
      aiAgentService.streamChat(
        {
          sessionId: `swarm-${agentState.id}`,
          projectPath: targetPath,
          messages,
          config,
          mode: 'agent',
          roleSystemPrompt,
          allowedToolNames,
          taskId: session.taskId
        },
        (chunk) => {
          if (chunk.text) {
            outputBuffer += chunk.text;
            this.appendOutput(session, agentState, chunk.text);
          }
          if (chunk.thought) {
            this.log(session, agentState, `[Thought] ${chunk.thought.slice(0, 200)}...`);
          }
          if (chunk.toolCall) {
            this.log(session, agentState, `[Tool] ${chunk.toolCall.name}`);
          }
          if (chunk.usage) {
            usageSeen = true;
            this.recordUsage(session, agentState, chunk.usage, 'replace', config.model);
          }
        },
        (finalMsg) => {
          agentState.finalOutput = finalMsg.content || outputBuffer;
          if (finalMsg.usage && !usageSeen) {
            this.recordUsage(session, agentState, finalMsg.usage, 'replace', config.model);
          }
          cleanup();
          resolve();
        },
        (err) => {
          cleanup();
          reject(new Error(err));
        }
      ).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  /**
   * Claude Code CLI в режиме `-p --output-format stream-json`: промпт передаётся через stdin
   * (без экранирования аргументов оболочки), текст ответов идёт в вывод агента, события
   * `assistant` дают usage по каждому ходу (для бюджета), событие `result` — итоговые
   * токены и `total_cost_usd` (AC #3).
   */
  private async runClaudeCliAgent(
    session: SwarmSession,
    agentState: AgentSlotState,
    targetPath: string,
    prompt: string,
    role?: RoleDefinition
  ): Promise<void> {
    // Human-in-the-loop через единый контур (TASK-57): без --dangerously-skip-permissions,
    // кроме залогированного fallback при недоступном MCP-сервере и включённом auto-approve.
    const hitl = await this.prepareAgentHitl(session, agentState, targetPath);
    if ('error' in hitl) {
      throw new Error(hitl.error);
    }
    const hitlSessionId = this.hitlSessionId(agentState);
    const releaseHitl = () => {
      hitl.cleanup();
      hitlService.cancelSession(hitlSessionId, 'Процесс Claude CLI агента завершён');
    };

    // Роль (decision-9, TASK-60): системный промпт, модель, allow-список инструментов, бюджет.
    // Флаги подтверждены локально (`claude --help`); нативного лимита ходов у CLI нет — maxTurns
    // роли обеспечивается ниже счётчиком `assistant`-событий.
    const invocation = buildEngineInvocation({
      engine: 'claude-cli',
      role,
      extraSystemPrompt: await this.buildExtraSystemPrompt(session, agentState, targetPath),
      model: agentState.config.providerConfig?.model,
      budgetUsd: agentState.config.budgetUsd
    });
    const maxTurns = role?.maxTurns && role.maxTurns > 0 ? role.maxTurns : undefined;

    return new Promise((resolve, reject) => {
      const args = ['-p', '--output-format', 'stream-json', '--verbose', ...hitl.args, ...invocation.args];

      let child: ChildProcess;
      try {
        child = spawn('claude', args, {
          cwd: targetPath,
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            FORCE_COLOR: '0',
            ...hitl.env
          }
        });
      } catch (e: any) {
        releaseHitl();
        this.log(session, agentState, `[Swarm] ⚠️ Claude CLI недоступен напрямую (${e.message}), запуск через API fallback.`);
        return this.runApiAgent(session, agentState, targetPath, prompt, role).then(resolve).catch(reject);
      }

      const procSet = this.activeProcesses.get(session.id);
      procSet?.add(child);
      this.trackAgentProcess(agentState.id, child);

      let finished = false;
      let sawJson = false;
      let sawResult = false;
      let stdoutBuffer = '';
      let stderrTail = '';
      let turnUsage = emptyUsage();
      let assistantTurns = 0;
      let stoppedByTurnLimit = false;
      const finish = (fn: () => void) => {
        if (finished) return;
        finished = true;
        procSet?.delete(child);
        this.untrackAgentProcess(agentState.id, child);
        releaseHitl();
        fn();
      };

      const handleEvent = (event: any) => {
        if (event.type === 'rate_limit_event' || event.rate_limit_info) {
          try {
            claudeUsageService.noteRateLimitEvent(event.rate_limit_info || event);
          } catch { /* ignore */ }
          return;
        }
        if (event.type === 'user') {
          // Результаты инструментов → аудит HITL по tool_use_id (TASK-57).
          claudeBridgeService.noteCliUserEvent(event);
          return;
        }
        if (event.type === 'assistant' && event.message?.content) {
          for (const item of event.message.content) {
            if (item.type === 'text' && typeof item.text === 'string') {
              this.appendOutput(session, agentState, item.text);
            } else if (item.type === 'tool_use') {
              const input = item.input && typeof item.input === 'object' ? JSON.stringify(item.input) : '';
              this.log(session, agentState, `[Tool] ${item.name} ${input.slice(0, 300)}`);
            }
          }
          const usage = usageFromClaudeAssistantEvent(event);
          if (usage) {
            turnUsage = addUsage(turnUsage, usage);
            const stopped = this.recordUsage(session, agentState, usage, 'add', usage.model);
            if (stopped) return;
            this.emitSwarmEvent({ type: 'agent_updated', swarmId: session.id, agentId: agentState.id, session });
          }
          assistantTurns += 1;
          if (maxTurns && assistantTurns >= maxTurns && !stoppedByTurnLimit) {
            stoppedByTurnLimit = true;
            this.log(session, agentState, `[Swarm] Достигнут лимит ходов роли (${maxTurns}) — агент останавливается.`);
            killProcessTree(child);
          }
          return;
        }
        if (event.type === 'result') {
          const summary = parseClaudeResultEvent(event);
          if (!summary) return;
          sawResult = true;
          if (summary.result && !agentState.liveOutput.trim()) {
            this.appendOutput(session, agentState, summary.result);
          }
          const finalUsage =
            summary.usage.totalTokens > 0 ? summary.usage : { ...turnUsage, costUsd: summary.usage.costUsd, costSource: summary.usage.costSource };
          this.recordUsage(session, agentState, finalUsage, 'replace', summary.usage.model);
          const u = agentState.metrics.usage;
          this.log(
            session,
            agentState,
            `[Swarm Usage] ходов: ${summary.numTurns ?? '?'}, вход ${u?.inputTokens ?? 0}, выход ${u?.outputTokens ?? 0}, ` +
              `кэш ${u?.cacheReadTokens ?? 0}/${u?.cacheCreationTokens ?? 0}, стоимость ${formatUsd(u?.costUsd)} (${u?.costSource ?? 'unknown'})`
          );
          if (summary.isError && summary.subtype) {
            this.log(session, agentState, `[Swarm] Claude CLI завершился со статусом ${summary.subtype}`);
          }
        }
      };

      child.stdout?.on('data', (d: Buffer) => {
        stdoutBuffer += d.toString('utf-8');
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('{')) {
            try {
              const event = JSON.parse(trimmed);
              sawJson = true;
              handleEvent(event);
              continue;
            } catch {
              /* не JSON — ниже как обычный текст */
            }
          }
          // Старый CLI без stream-json или служебный вывод — показываем как есть.
          this.appendOutput(session, agentState, `${line}\n`);
        }
      });

      child.stderr?.on('data', (d: Buffer) => {
        const text = d.toString('utf-8');
        stderrTail = (stderrTail + text).slice(-4000);
        this.log(session, agentState, text.trimEnd());
      });
      child.stdout?.on('error', (err) => this.log(session, agentState, `[Swarm] stdout error: ${err.message}`));
      child.stderr?.on('error', (err) => this.log(session, agentState, `[Swarm] stderr error: ${err.message}`));
      child.stdin?.on('error', (err) => this.log(session, agentState, `[Swarm] stdin error: ${err.message}`));

      child.on('error', (err) => {
        finish(() => {
          this.log(session, agentState, `[Swarm] ⚠️ Ошибка Claude CLI: ${err.message}. Пробуем API fallback.`);
          this.runApiAgent(session, agentState, targetPath, prompt, role).then(resolve).catch(reject);
        });
      });

      child.on('close', (code) => {
        finish(() => {
          if (stdoutBuffer.trim()) {
            const rest = stdoutBuffer;
            stdoutBuffer = '';
            if (rest.trim().startsWith('{')) {
              try {
                handleEvent(JSON.parse(rest.trim()));
              } catch {
                this.appendOutput(session, agentState, rest);
              }
            } else {
              this.appendOutput(session, agentState, rest);
            }
          }
          if (stoppedByTurnLimit) {
            agentState.finalOutput = agentState.liveOutput;
            resolve();
            return;
          }
          // Агент остановлен пользователем или по бюджету — результат уже зафиксирован в статусе.
          if (agentState.status !== 'running') {
            agentState.finalOutput = agentState.liveOutput;
            resolve();
            return;
          }
          if (code === 0 || sawResult || (sawJson && agentState.liveOutput.length > 0)) {
            agentState.finalOutput = agentState.liveOutput;
            resolve();
          } else if (agentState.liveOutput.length > 0) {
            agentState.finalOutput = agentState.liveOutput;
            resolve();
          } else {
            this.log(session, agentState, `[Swarm] ⚠️ Claude CLI завершился с кодом ${code}${stderrTail ? `: ${stderrTail.trim().slice(-500)}` : ''}. Пробуем API fallback.`);
            this.runApiAgent(session, agentState, targetPath, prompt, role).then(resolve).catch(reject);
          }
        });
      });

      try {
        child.stdin?.write(prompt, 'utf-8');
        child.stdin?.end();
      } catch (err: any) {
        this.log(session, agentState, `[Swarm] Не удалось передать промпт в Claude CLI: ${err?.message || String(err)}`);
        killProcessTree(child);
      }
    });
  }

  /** Эффективные (суженные ролью) права для движков без собственного HITL-контура (codex/gemini). */
  private async resolveEffectivePermissions(agentState: AgentSlotState): Promise<AIProviderConfig> {
    let globalConfig: AIProviderConfig;
    try {
      globalConfig = await aiAgentService.getConfig();
    } catch {
      globalConfig = { provider: 'anthropic', model: 'default' };
    }
    return applyRolePermissions(globalConfig, agentState.config.permissions);
  }

  /** Best-effort извлечение текста из строки JSONL codex/gemini — схема событий не документирована. */
  private extractCliJsonText(event: any): string | null {
    if (!event || typeof event !== 'object') return null;
    const candidates = [
      event.text,
      event.message,
      event.msg,
      event.delta,
      event.content,
      event.item?.text,
      event.response?.text,
      typeof event.response === 'string' ? event.response : undefined
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 0) return c;
    }
    return null;
  }

  /**
   * Codex CLI: `codex exec` в неинтерактивном режиме (AC #3). Промпт роли — преамбулой перед
   * промптом пользователя, через stdin (не argv — на Windows длинные/спецсимвольные аргументы
   * ломаются экранированием shell). Флаги взяты из публичной документации Codex CLI
   * (developers.openai.com/codex/noninteractive) — `codex` не установлен на машине разработки,
   * синтаксис не проверен эмпирически (см. `implementationNotes` TASK-60); нужен ручной smoke-test.
   */
  private async runCodexCliAgent(
    session: SwarmSession,
    agentState: AgentSlotState,
    targetPath: string,
    prompt: string,
    role?: RoleDefinition
  ): Promise<void> {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'codex.cmd' : 'codex';
    const fallbackConfig: AIProviderConfig = {
      provider: 'openrouter',
      model: 'openai/gpt-4o',
      temperature: 0.2
    };
    const effective = await this.resolveEffectivePermissions(agentState);
    const invocation = buildEngineInvocation({
      engine: 'codex-cli',
      role,
      extraSystemPrompt: await this.buildExtraSystemPrompt(session, agentState, targetPath),
      model: agentState.config.providerConfig?.model,
      autoApprove: effective.autoApprove,
      allowFileWrite: effective.autoApproveRules?.allowFileWrite
    });
    const fullPrompt = invocation.promptPrefix ? `${invocation.promptPrefix}\n\n${prompt}` : prompt;

    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(cmd, invocation.args, {
          cwd: targetPath,
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, FORCE_COLOR: '0' }
        });
      } catch {
        this.log(session, agentState, '[Swarm] ⚠️ Codex CLI не запустился (бинарник не найден) — используется API fallback (OpenRouter).');
        agentState.config.providerConfig = agentState.config.providerConfig || fallbackConfig;
        return this.runApiAgent(session, agentState, targetPath, prompt, role).then(resolve).catch(reject);
      }

      const procSet = this.activeProcesses.get(session.id);
      procSet?.add(child);
      this.trackAgentProcess(agentState.id, child);
      let finished = false;
      let stderrTail = '';
      let sawOutput = false;
      let stdoutBuffer = '';
      const finish = (fn: () => void) => {
        if (finished) return;
        finished = true;
        procSet?.delete(child);
        this.untrackAgentProcess(agentState.id, child);
        fn();
      };

      child.stdout?.on('data', (d: Buffer) => {
        stdoutBuffer += d.toString('utf-8');
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('{')) {
            try {
              const event = JSON.parse(trimmed);
              const text = this.extractCliJsonText(event);
              if (text) {
                sawOutput = true;
                this.appendOutput(session, agentState, text);
              } else if (event.type) {
                this.log(session, agentState, `[Codex] ${event.type}`);
              }
              continue;
            } catch {
              /* не JSON — как обычный текст */
            }
          }
          sawOutput = true;
          this.appendOutput(session, agentState, `${line}\n`);
        }
      });
      child.stderr?.on('data', (d: Buffer) => {
        const text = d.toString('utf-8');
        stderrTail = (stderrTail + text).slice(-4000);
        this.log(session, agentState, text.trimEnd());
      });
      child.stdout?.on('error', () => undefined);
      child.stderr?.on('error', () => undefined);
      child.stdin?.on('error', (err) => this.log(session, agentState, `[Swarm] stdin error: ${err.message}`));

      child.on('error', (err) => {
        finish(() => {
          this.log(session, agentState, `[Swarm] ⚠️ Ошибка запуска Codex CLI (${err.message}) — используется API fallback (OpenRouter).`);
          agentState.config.providerConfig = agentState.config.providerConfig || fallbackConfig;
          this.runApiAgent(session, agentState, targetPath, prompt, role).then(resolve).catch(reject);
        });
      });

      child.on('close', (code) => {
        finish(() => {
          if (agentState.status !== 'running') {
            agentState.finalOutput = agentState.liveOutput;
            resolve();
            return;
          }
          if (code === 0 || sawOutput || agentState.liveOutput.length > 0) {
            agentState.finalOutput = agentState.liveOutput;
            const parsed = parseCliUsageText(`${agentState.liveOutput.slice(-4000)}\n${stderrTail}`);
            if (parsed) {
              this.recordUsage(session, agentState, parsed, 'replace', agentState.config.providerConfig?.model);
            }
            resolve();
          } else {
            this.log(
              session,
              agentState,
              `[Swarm] ⚠️ Codex CLI завершился с кодом ${code}${stderrTail ? `: ${stderrTail.trim().slice(-500)}` : ''} без вывода — используется API fallback (OpenRouter).`
            );
            agentState.config.providerConfig = agentState.config.providerConfig || fallbackConfig;
            this.runApiAgent(session, agentState, targetPath, prompt, role).then(resolve).catch(reject);
          }
        });
      });

      try {
        child.stdin?.write(fullPrompt, 'utf-8');
        child.stdin?.end();
      } catch (err: any) {
        this.log(session, agentState, `[Swarm] Не удалось передать промпт в Codex CLI: ${err?.message || String(err)}`);
        killProcessTree(child);
      }
    });
  }

  /**
   * Gemini CLI: неинтерактивный режим, промпт роли — преамбулой через stdin (см. Codex выше).
   * `--output-format json` в headless-режиме возвращает один JSON-объект по завершении, не поток
   * (geminicli.com/docs/cli/headless) — парсим весь stdout по закрытии процесса. Флаги из
   * публичной документации, `gemini` не установлен на машине разработки — не проверено
   * эмпирически (см. `implementationNotes` TASK-60).
   */
  private async runGeminiCliAgent(
    session: SwarmSession,
    agentState: AgentSlotState,
    targetPath: string,
    prompt: string,
    role?: RoleDefinition
  ): Promise<void> {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'gemini.cmd' : 'gemini';
    const fallbackConfig: AIProviderConfig = {
      provider: 'openrouter',
      model: 'google/gemini-2.0-flash-001',
      temperature: 0.2
    };
    const effective = await this.resolveEffectivePermissions(agentState);
    const invocation = buildEngineInvocation({
      engine: 'gemini-cli',
      role,
      extraSystemPrompt: await this.buildExtraSystemPrompt(session, agentState, targetPath),
      model: agentState.config.providerConfig?.model,
      autoApprove: effective.autoApprove
    });
    const fullPrompt = invocation.promptPrefix ? `${invocation.promptPrefix}\n\n${prompt}` : prompt;

    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(cmd, invocation.args, {
          cwd: targetPath,
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, FORCE_COLOR: '0' }
        });
      } catch {
        this.log(session, agentState, '[Swarm] ⚠️ Gemini CLI не запустился (бинарник не найден) — используется API fallback (OpenRouter).');
        agentState.config.providerConfig = agentState.config.providerConfig || fallbackConfig;
        return this.runApiAgent(session, agentState, targetPath, prompt, role).then(resolve).catch(reject);
      }

      const procSet = this.activeProcesses.get(session.id);
      procSet?.add(child);
      this.trackAgentProcess(agentState.id, child);
      let finished = false;
      let stdoutAll = '';
      let stderrTail = '';
      const finish = (fn: () => void) => {
        if (finished) return;
        finished = true;
        procSet?.delete(child);
        this.untrackAgentProcess(agentState.id, child);
        fn();
      };

      child.stdout?.on('data', (d: Buffer) => {
        stdoutAll += d.toString('utf-8');
      });
      child.stderr?.on('data', (d: Buffer) => {
        const text = d.toString('utf-8');
        stderrTail = (stderrTail + text).slice(-4000);
        this.log(session, agentState, text.trimEnd());
      });
      child.stdout?.on('error', () => undefined);
      child.stderr?.on('error', () => undefined);
      child.stdin?.on('error', (err) => this.log(session, agentState, `[Swarm] stdin error: ${err.message}`));

      child.on('error', (err) => {
        finish(() => {
          this.log(session, agentState, `[Swarm] ⚠️ Ошибка запуска Gemini CLI (${err.message}) — используется API fallback (OpenRouter).`);
          agentState.config.providerConfig = agentState.config.providerConfig || fallbackConfig;
          this.runApiAgent(session, agentState, targetPath, prompt, role).then(resolve).catch(reject);
        });
      });

      child.on('close', (code) => {
        finish(() => {
          if (agentState.status !== 'running') {
            agentState.finalOutput = agentState.liveOutput;
            resolve();
            return;
          }
          const trimmed = stdoutAll.trim();
          let text = trimmed;
          if (trimmed.startsWith('{')) {
            try {
              const parsed = JSON.parse(trimmed);
              text = this.extractCliJsonText(parsed) || trimmed;
            } catch {
              /* оставляем как есть */
            }
          }
          if (code === 0 || text.length > 0) {
            if (text) this.appendOutput(session, agentState, text);
            agentState.finalOutput = agentState.liveOutput;
            const parsedUsage = parseCliUsageText(`${text.slice(-4000)}\n${stderrTail}`);
            if (parsedUsage) {
              this.recordUsage(session, agentState, parsedUsage, 'replace', agentState.config.providerConfig?.model);
            }
            resolve();
          } else {
            this.log(
              session,
              agentState,
              `[Swarm] ⚠️ Gemini CLI завершился с кодом ${code}${stderrTail ? `: ${stderrTail.trim().slice(-500)}` : ''} без вывода — используется API fallback (OpenRouter).`
            );
            agentState.config.providerConfig = agentState.config.providerConfig || fallbackConfig;
            this.runApiAgent(session, agentState, targetPath, prompt, role).then(resolve).catch(reject);
          }
        });
      });

      try {
        child.stdin?.write(fullPrompt, 'utf-8');
        child.stdin?.end();
      } catch (err: any) {
        this.log(session, agentState, `[Swarm] Не удалось передать промпт в Gemini CLI: ${err?.message || String(err)}`);
        killProcessTree(child);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Handoff
  // ---------------------------------------------------------------------------

  /**
   * Запуск режима Handoff (последовательный конвейер специализированных ролей).
   */
  public async startHandoff(options: StartHandoffOptions): Promise<SwarmSession> {
    const { projectPath, prompt, taskId, taskTitle, stages } = options;
    const useWorktrees = options.useWorktrees !== false;
    const autoCommitAgentResults = options.autoCommitAgentResults !== false;
    const swarmId = `swarm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const baseBranch = await this.detectBaseBranch(projectPath, options.baseBranch);
    await this.getPriceTable();

    const agentStates: AgentSlotState[] = stages.map((stg, idx) =>
      this.newAgentState({ ...stg.agent, role: stg.role }, stg.agent.id || `handoff-agent-${idx + 1}`, 0)
    );

    const handoffStages: HandoffStageState[] = stages.map((stg, idx) => ({
      stageIndex: idx,
      role: stg.role,
      agentId: agentStates[idx].id,
      status: 'pending',
      inputPrompt: '',
      ...(stg.instructions ? { instructions: stg.instructions } : {})
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
      ...(typeof options.budgetUsd === 'number' && options.budgetUsd > 0 ? { budgetUsd: options.budgetUsd } : {}),
      status: 'preparing',
      createdAt: Date.now(),
      agents: agentStates,
      handoffStages,
      currentHandoffStageIndex: 0
    };

    this.sessions.set(swarmId, session);
    this.ensureSessionTracking(swarmId);

    this.emitSwarmEvent({ type: 'swarm_updated', swarmId, session });

    void this.executeHandoff(session, 0, false);

    return session;
  }

  /** Максимальная длина резюме этапа Handoff в промпте следующего этапа (decision-9 п.5). */
  private static readonly HANDOFF_SUMMARY_LIMIT = 2000;

  /**
   * Артефакт этапа Handoff (decision-9 п.5): отчёт `.projecthub/handoff/<n>-<roleSlug>.md` в
   * общем worktree, усечённое резюме и хэш коммита (уже собран в `materializeAgentResult`,
   * TASK-55) — вместо передачи следующему этапу сырого stdout без лимита.
   */
  private async writeHandoffStageReport(
    session: SwarmSession,
    sharedWorktreePath: string,
    stageIndex: number,
    stageState: HandoffStageState,
    agentState: AgentSlotState
  ): Promise<void> {
    const raw = stageState.outputResult || '';
    stageState.summary =
      raw.length > AgentFleetService.HANDOFF_SUMMARY_LIMIT
        ? `${raw.slice(0, AgentFleetService.HANDOFF_SUMMARY_LIMIT)}\n…(усечено, полный вывод — в файле отчёта)`
        : raw;
    stageState.commitHash = agentState.commitHash;

    if (!this.pathExists(sharedWorktreePath)) return;
    const roleSlug = sanitizeSlug(stageState.role || `stage-${stageIndex + 1}`);
    const reportsDir = getHandoffReportsDir(sharedWorktreePath);
    const reportPath = path.join(reportsDir, `${stageIndex}-${roleSlug}.md`);
    try {
      await fs.mkdir(reportsDir, { recursive: true });
      const report = [
        `# Handoff — этап ${stageIndex + 1}: ${stageState.role}`,
        '',
        `- Статус: ${stageState.status}`,
        `- Длительность: ${stageState.durationMs ? `${(stageState.durationMs / 1000).toFixed(1)} с` : '—'}`,
        `- Коммит: ${stageState.commitHash || '—'}`,
        '',
        '## Входной промпт',
        '',
        stageState.inputPrompt,
        '',
        '## Результат',
        '',
        raw || '_(пусто)_'
      ].join('\n');
      await fs.writeFile(reportPath, report, 'utf-8');
      stageState.reportPath = reportPath;
    } catch (err) {
      console.warn(`[AgentFleetService] Failed to write handoff report for stage ${stageIndex}:`, err);
    }
  }

  /** Ссылка на артефакт этапа для промпта следующего этапа (резюме + путь к отчёту + коммит). */
  private formatHandoffArtifactRef(stageState: HandoffStageState | undefined): string {
    if (!stageState) return '';
    const parts = [stageState.summary || stageState.outputResult || ''];
    if (stageState.reportPath) parts.push(`Полный отчёт: ${stageState.reportPath}`);
    if (stageState.commitHash) parts.push(`Коммит: ${stageState.commitHash}`);
    return parts.filter(Boolean).join('\n');
  }

  private async executeHandoff(session: SwarmSession, startIndex: number, resume: boolean): Promise<void> {
    session.status = 'running';
    this.emitSwarmEvent({ type: 'swarm_updated', swarmId: session.id, session });

    const stages = session.handoffStages ?? [];
    let sharedWorktreePath = session.projectPath;
    let sharedWorktreeBranch = session.baseBranch;

    if (resume) {
      const known = session.agents.find((a) => a.worktreePath);
      if (known) {
        sharedWorktreePath = known.worktreePath!;
        sharedWorktreeBranch = known.worktreeBranch || session.baseBranch;
      }
    } else if (session.useWorktrees) {
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

    let previousStageArtifact = startIndex > 0 ? this.formatHandoffArtifactRef(stages[startIndex - 1]) : '';

    for (let i = startIndex; i < stages.length; i++) {
      if (session.status !== 'running') return;
      session.currentHandoffStageIndex = i;
      const stageState = stages[i];
      const agentState = session.agents[i];
      if (!agentState) break;

      agentState.worktreePath = sharedWorktreePath;
      agentState.worktreeBranch = sharedWorktreeBranch;

      const resumingThisStage = resume && i === startIndex && agentState.status === 'interrupted';
      if (resumingThisStage) this.prepareAgentForResume(session, agentState);

      let stagePrompt = `[Задача проекта]: ${session.prompt}\n\n`;
      if (stageState.instructions) {
        stagePrompt += `[Инструкции этапа (${stageState.role})]: ${stageState.instructions}\n\n`;
      }
      if (previousStageArtifact) {
        stagePrompt += `[Артефакт предыдущего этапа]:\n${previousStageArtifact}\n\n`;
      }
      stagePrompt += `Выполни свою часть работы в рамках роли "${stageState.role}".`;
      if (resumingThisStage) stagePrompt += RESUME_PROMPT_SUFFIX;

      stageState.inputPrompt = stagePrompt;
      stageState.status = 'running';
      this.emitSwarmEvent({ type: 'swarm_updated', swarmId: session.id, session });

      const stageStart = Date.now();
      await this.runSingleAgent(session, agentState, stagePrompt);

      stageState.durationMs = Date.now() - stageStart;
      stageState.status = agentState.status === 'completed' ? 'completed' : 'failed';
      stageState.outputResult = agentState.finalOutput || agentState.liveOutput;
      await this.writeHandoffStageReport(session, sharedWorktreePath, i, stageState, agentState);
      previousStageArtifact = this.formatHandoffArtifactRef(stageState);

      this.emitSwarmEvent({ type: 'swarm_updated', swarmId: session.id, session });

      if (session.status !== 'running') return;
      if (agentState.status !== 'completed') {
        session.status = 'failed';
        session.error =
          agentState.status === 'budget_exceeded'
            ? agentState.error || `Этап ${stageState.role} остановлен по бюджету`
            : `Этап ${stageState.role} завершился с ошибкой`;
        session.completedAt = Date.now();
        this.emitSwarmEvent({ type: 'swarm_updated', swarmId: session.id, session });
        return;
      }
    }

    this.finishSession(session);
  }

  // ---------------------------------------------------------------------------
  // Pick Winner / Stop
  // ---------------------------------------------------------------------------

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
        this.log(session, winnerAgent, `[Swarm] Ветка ${mergedBranch} успешно влита в ${session.baseBranch}!`);
      } catch (err: any) {
        return { success: false, error: `Merge error: ${err.message || err}` };
      }
    }

    // 2. Остановка и принудительное завершение процессов проигравших агентов (AC #4)
    for (const agent of session.agents) {
      if (agent.id !== winnerAgentId) {
        this.killAgentProcess(agent.id);
        if (isActiveAgentStatus(agent.status) || agent.status === 'interrupted') {
          agent.status = 'stopped';
          this.log(session, agent, '[Swarm] Остановлен в связи с выбором другого победителя.');
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
            this.log(session, agent, `[Swarm] Временное рабочее дерево ${agent.worktreePath} очищено.`);

            // Удаляем временную ветку проигравшего (AC #4)
            if (agent.worktreeBranch) {
              try {
                const git = simpleGit(session.projectPath);
                await git.deleteLocalBranch(agent.worktreeBranch, true);
                this.log(
                  session,
                  agent,
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

  public stopSwarm(swarmId: string, emit = true): boolean {
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
    for (const a of session.agents) this.killAgentProcess(a.id);

    const wasActive = isActiveSwarmStatus(session.status) || session.status === 'interrupted';
    if (wasActive) {
      session.status = 'stopped';
      session.completedAt = Date.now();
    }
    for (const a of session.agents) {
      if (isActiveAgentStatus(a.status) || a.status === 'interrupted') {
        a.status = 'stopped';
        this.log(session, a, '[Swarm] Сессия принудительно остановлена пользователем.');
      }
    }

    if (emit) {
      this.emitSwarmEvent({
        type: 'swarm_updated',
        swarmId,
        session
      });
    }

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
        pushAgentLog(agentState, `[Swarm Git] Изменения зафиксированы в коммите ${head.slice(0, 7)}: "${commitMsg}"`);
      } else {
        // Режим сохранения в stash snapshot
        const stashMsg = `swarm snapshot: ${agentState.id}`;
        const stashHash = (await git.raw(['stash', 'create', stashMsg])).trim();
        if (stashHash) {
          agentState.stashHash = stashHash;
          agentState.commitStatus = 'stashed';
          pushAgentLog(agentState, `[Swarm Git] Сформирован git stash snapshot: ${stashHash.slice(0, 7)}`);
        }
      }
    } catch (err: any) {
      console.warn(`[AgentFleetService] materializeAgentResult error for ${agentState.id}:`, err);
      pushAgentLog(agentState, `[Swarm Git Warning] Не удалось зафиксировать изменения: ${err.message || String(err)}`);
    }
  }

  /** Немедленное завершение всех процессов (без записи состояния). */
  public killAll(): void {
    for (const [, procs] of this.activeProcesses.entries()) {
      for (const p of procs) killProcessTree(p);
    }
    for (const [, controllers] of this.abortControllers.entries()) {
      for (const c of controllers) c.abort();
    }
    for (const [, procs] of this.agentProcesses.entries()) {
      for (const p of procs) killProcessTree(p);
    }
    this.activeProcesses.clear();
    this.abortControllers.clear();
    this.agentProcesses.clear();
    this.agentAbortControllers.clear();
  }

  /**
   * Корректное завершение при выходе: активные сессии помечаются `interrupted`,
   * процессы убиваются, отложенные записи сбрасываются на диск.
   */
  public async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (!isActiveSwarmStatus(session.status)) continue;
      session.status = 'interrupted';
      session.interruptedAt = Date.now();
      for (const agent of session.agents) {
        if (isActiveAgentStatus(agent.status)) {
          agent.status = 'interrupted';
          pushAgentLog(agent, '[Swarm] Работа прервана завершением ProjectHub.');
        }
      }
      if (session.handoffStages) {
        for (const stage of session.handoffStages) {
          if (stage.status === 'running') stage.status = 'pending';
        }
      }
      this.persist(session, true);
    }
    this.killAll();
    if (this.store) await this.store.flush();
  }
}

export const agentFleetService = new AgentFleetService(new SwarmSessionStore());
