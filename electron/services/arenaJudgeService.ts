/**
 * Автосудья Swarm Arena (decision-12, TASK-61).
 *
 * Оркестрация поверх чистых модулей: `arenaChecks` (что запускать и как разбирать вывод),
 * `arenaScoring` (как считать балл) и `reviewerPrompt` (о чём спрашивать ревьюера). Здесь —
 * только побочные эффекты: запуск проверок в worktree кандидатов, метрики диффа, вызов LLM и
 * сборка `JudgeState`. Слияние сюда не входит: финальное решение принимает человек, а авто-мердж
 * выполняет `agentFleetService` по вердикту `autoMergeDecision`.
 *
 * Сервис ничего не знает про `agentFleetService` (иначе получился бы цикл импортов): состояние
 * сессии он меняет напрямую, а наружу сообщает через хуки `onUpdate`/`log`.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { processManager } from './processManager.js';
import { aiAgentService, type AIMessage, type AIProviderConfig } from './aiAgentService.js';
import { loadRoles } from './roleService.js';
import { apiToolNamesForCategories } from './roleEngineAdapter.js';
import { findTaskFile } from './taskFileLookup.js';
import { parseTaskBody, stripCriterionPrefix } from './backlogTaskFormat.js';
import { fetchDiffImpact } from './gitNexusClient.js';
import { loadArenaConfig } from './arenaConfig.js';
import {
  CHECK_OUTPUT_TAIL_CHARS,
  checkStatusFromExit,
  parseCheckOutput,
  summarizeCheckResult,
  tailOutput
} from './arenaChecks.js';
import { autoMergeDecision, recommendCandidate, scoreCandidates, type CandidateScoreInput } from './arenaScoring.js';
import { buildReviewerPrompt, parseReviewerResponse } from './reviewerPrompt.js';
import type { ArenaConfig, CheckRunResult, JudgeState, ReviewerVerdict } from './arenaTypes.js';
import type { AgentSlotState, SwarmSession } from './swarmTypes.js';

/** Сколько ждать ответа ревьюера, прежде чем признать отзыв несостоявшимся. */
export const REVIEWER_TIMEOUT_MS = 5 * 60 * 1000;

/** Модель ревьюера по умолчанию, если её не задали ни роль, ни настройки проекта. */
export const DEFAULT_REVIEWER_MODEL = 'claude-sonnet-5';

export interface JudgeHooks {
  /** Состояние сессии изменилось — отдать его в UI и на диск. */
  onUpdate: (agentId?: string) => void;
  /** Строка в лог конкретного агента арены. */
  log: (agent: AgentSlotState, line: string) => void;
}

export interface RunJudgeOptions {
  /** Прогонять проверки заново, даже если у кандидата уже есть результаты. */
  rerunChecks?: boolean;
  /** Не спрашивать ревьюера (быстрый прогон только объективных метрик). */
  skipReview?: boolean;
}

/** Кандидаты, которых имеет смысл судить: с рабочим деревом и завершённой работой. */
export function judgeableAgents(session: SwarmSession): AgentSlotState[] {
  return session.agents.filter(
    (a) => (a.status === 'completed' || a.status === 'failed' || a.status === 'budget_exceeded') && !a.worktreeMissing
  );
}

/**
 * Модули, затронутые диффом: два первых сегмента пути каждого файла. Считается локально по
 * патчу и не зависит от GitNexus — метрика локальности должна работать в любом проекте.
 */
export function modulesFromPatch(patch: string): string[] {
  const modules = new Set<string>();
  for (const line of (patch ?? '').split('\n')) {
    if (!line.startsWith('diff --git')) continue;
    const parts = line.split(' ');
    const file = parts[2]?.replace(/^a\//, '');
    if (!file) continue;
    const segments = file.split('/');
    modules.add(segments.length > 1 ? segments.slice(0, Math.min(2, segments.length - 1)).join('/') : '.');
  }
  return [...modules];
}

/** Файлы, изменённые кандидатом (для частичной сборки результата и отображения). */
export function filesFromPatch(patch: string): string[] {
  const files: string[] = [];
  for (const line of (patch ?? '').split('\n')) {
    if (!line.startsWith('diff --git')) continue;
    const file = line.split(' ')[2]?.replace(/^a\//, '');
    if (file && !files.includes(file)) files.push(file);
  }
  return files;
}

/** Выполняет задачи пачками по `limit` — проверки нескольких кандидатов не должны съесть машину. */
export async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length || 1)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  });
  await Promise.all(workers);
  return results;
}

export class ArenaJudgeService {
  /** Отмена прогона по swarmId (остановка сессии, закрытие приложения). */
  private controllers = new Map<string, AbortController>();

  public isRunning(swarmId: string): boolean {
    return this.controllers.has(swarmId);
  }

  public cancelJudge(swarmId: string): boolean {
    const controller = this.controllers.get(swarmId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  public cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  public loadConfig(projectPath: string): Promise<ArenaConfig> {
    return loadArenaConfig(projectPath);
  }

  /**
   * Полный прогон судьи по сессии: проверки → метрики диффа → ревью → скоринг → рекомендация.
   * Ошибка на любом кандидате не роняет прогон: она оседает в его результатах, остальные судятся.
   */
  public async runJudge(session: SwarmSession, hooks: JudgeHooks, options: RunJudgeOptions = {}): Promise<JudgeState> {
    if (this.controllers.has(session.id)) {
      return session.judge ?? { status: 'running' };
    }
    const controller = new AbortController();
    this.controllers.set(session.id, controller);

    const judge: JudgeState = { status: 'running', startedAt: Date.now(), stage: 'checks' };
    session.judge = judge;
    hooks.onUpdate();

    try {
      const config = await this.loadConfig(session.projectPath);
      judge.weights = config.weights;

      const candidates = judgeableAgents(session);
      if (candidates.length === 0) {
        judge.status = 'done';
        judge.finishedAt = Date.now();
        judge.error = 'Нет завершённых кандидатов с рабочим деревом';
        return judge;
      }

      await this.runAllChecks(session, candidates, config, hooks, controller.signal, options.rerunChecks === true);
      if (controller.signal.aborted) return this.markCancelled(judge);

      judge.stage = 'diff';
      hooks.onUpdate();
      await this.collectDiffMetrics(session, candidates, hooks);
      if (controller.signal.aborted) return this.markCancelled(judge);

      const criteria = await this.loadAcceptanceCriteria(session);

      if (config.reviewer.enabled && options.skipReview !== true) {
        judge.stage = 'review';
        hooks.onUpdate();
        await this.runReviews(session, candidates, config, criteria, hooks, controller.signal);
      } else {
        for (const agent of candidates) {
          agent.review = { agentId: agent.id, status: 'skipped' };
        }
      }
      if (controller.signal.aborted) return this.markCancelled(judge);

      judge.stage = 'scoring';
      this.score(session, candidates, config);

      const scores = candidates.map((a) => a.score!).filter(Boolean);
      const recommendation = recommendCandidate(scores);
      judge.recommendedAgentId = recommendation.agentId;

      const checksByAgent: Record<string, CheckRunResult[]> = {};
      for (const agent of candidates) checksByAgent[agent.id] = agent.checks ?? [];
      const auto = autoMergeDecision(scores, checksByAgent, config.autoMerge);
      judge.autoMerge = {
        enabled: config.autoMerge.enabled,
        attempted: false,
        merged: false,
        ...(auto.agentId ? { agentId: auto.agentId } : {}),
        reason: auto.reason
      };

      judge.status = 'done';
      judge.stage = undefined;
      judge.finishedAt = Date.now();
      return judge;
    } catch (err) {
      judge.status = 'failed';
      judge.stage = undefined;
      judge.finishedAt = Date.now();
      judge.error = err instanceof Error ? err.message : String(err);
      console.error('[ArenaJudge] Прогон судьи завершился ошибкой:', err);
      return judge;
    } finally {
      this.controllers.delete(session.id);
      hooks.onUpdate();
    }
  }

  private markCancelled(judge: JudgeState): JudgeState {
    judge.status = 'cancelled';
    judge.stage = undefined;
    judge.finishedAt = Date.now();
    return judge;
  }

  // ───────────────────────────────── Проверки ─────────────────────────────────

  private async runAllChecks(
    session: SwarmSession,
    candidates: AgentSlotState[],
    config: ArenaConfig,
    hooks: JudgeHooks,
    signal: AbortSignal,
    rerun: boolean
  ): Promise<void> {
    const enabled = config.checks.filter((c) => c.enabled !== false);
    if (enabled.length === 0) {
      for (const agent of candidates) {
        if (!agent.checks || rerun) agent.checks = [];
      }
      hooks.onUpdate();
      return;
    }

    interface Job {
      agent: AgentSlotState;
      result: CheckRunResult;
      workdir?: string;
      timeoutMs?: number;
      command: string;
      portStrategy?: 'fixed' | 'auto';
      port?: number;
    }
    const jobs: Job[] = [];

    for (const agent of candidates) {
      if (agent.checks && agent.checks.length > 0 && !rerun) continue;
      const workdir = agent.worktreePath || session.projectPath;
      const usable = existsSync(workdir);
      agent.checks = enabled.map((def) => ({
        id: def.id,
        kind: def.kind,
        name: def.name,
        command: def.command,
        status: usable ? ('pending' as const) : ('skipped' as const),
        blocking: def.blocking !== false,
        ...(usable ? {} : { detail: `Рабочий каталог не найден: ${workdir}` })
      }));
      if (!usable) {
        hooks.log(agent, `[Судья] Проверки пропущены: каталог ${workdir} не найден.`);
        continue;
      }
      agent.checks.forEach((result, i) => {
        jobs.push({
          agent,
          result,
          workdir,
          command: enabled[i].command,
          timeoutMs: enabled[i].timeoutMs,
          portStrategy: enabled[i].portStrategy,
          port: enabled[i].port
        });
      });
    }

    hooks.onUpdate();
    if (jobs.length === 0) return;

    await runWithConcurrency(
      jobs.map((job) => async () => {
        if (signal.aborted) {
          job.result.status = 'skipped';
          job.result.detail = 'Прогон судьи отменён';
          return;
        }
        job.result.status = 'running';
        job.result.startedAt = Date.now();
        hooks.onUpdate(job.agent.id);
        hooks.log(job.agent, `[Судья] Проверка «${job.result.name}»: ${job.command}`);

        const run = await processManager.runOnce(job.command, {
          cwd: job.workdir!,
          timeoutMs: job.timeoutMs,
          signal,
          portStrategy: job.portStrategy,
          port: job.port
        });

        const counters = parseCheckOutput(job.result.kind, run.output);
        const { text, truncated } = tailOutput(run.output, CHECK_OUTPUT_TAIL_CHARS);
        job.result.exitCode = run.exitCode ?? undefined;
        job.result.durationMs = run.durationMs;
        job.result.outputTail = text;
        job.result.outputTruncated = truncated || run.truncated;
        Object.assign(job.result, counters);
        if (run.error && run.exitCode === null) {
          job.result.status = signal.aborted ? 'skipped' : 'error';
          job.result.detail = run.error;
        } else {
          job.result.status = checkStatusFromExit(run.exitCode, run.timedOut);
        }

        hooks.log(job.agent, `[Судья] «${job.result.name}» → ${summarizeCheckResult(job.result)}`);
        hooks.onUpdate(job.agent.id);
      }),
      config.maxConcurrentChecks
    );
  }

  // ──────────────────────────── Метрики диффа ────────────────────────────

  private async collectDiffMetrics(
    session: SwarmSession,
    candidates: AgentSlotState[],
    hooks: JudgeHooks
  ): Promise<void> {
    const repoName = path.basename(path.normalize(session.projectPath));
    for (const agent of candidates) {
      const patch = agent.diffSummary?.patch;
      if (!agent.diffSummary) continue;
      agent.diffSummary.modules = modulesFromPatch(patch ?? '');

      const workdir = agent.worktreePath || session.projectPath;
      if (!existsSync(workdir)) continue;
      try {
        const impact = await fetchDiffImpact({ cwd: workdir, baseRef: session.baseBranch, repo: repoName });
        if (impact?.changedSymbols !== undefined) {
          agent.diffSummary.dependentSymbols = impact.changedSymbols;
          agent.diffSummary.affectedProcesses = impact.affectedProcesses;
          agent.diffSummary.riskLevel = impact.riskLevel;
          hooks.log(
            agent,
            `[Судья] GitNexus: задето символов ${impact.changedSymbols}` +
              (impact.affectedProcesses !== undefined ? `, потоков выполнения ${impact.affectedProcesses}` : '') +
              (impact.riskLevel ? `, риск ${impact.riskLevel}` : '')
          );
        }
      } catch (err) {
        console.warn('[ArenaJudge] Не удалось получить impact из GitNexus:', err);
      }
    }
    hooks.onUpdate();
  }

  /** Критерии приёмки задачи Backlog.md — по ним ревьюер выносит вердикты (AC #3). */
  private async loadAcceptanceCriteria(session: SwarmSession): Promise<string[]> {
    if (!session.taskId) return [];
    try {
      const file = await findTaskFile(session.projectPath, session.taskId);
      if (!file) return [];
      const { criteria } = parseTaskBody(file.content);
      return criteria.map((c) => stripCriterionPrefix(c.text)).filter(Boolean);
    } catch (err) {
      console.warn('[ArenaJudge] Не удалось прочитать критерии приёмки задачи:', err);
      return [];
    }
  }

  // ───────────────────────────── LLM-ревьюер ─────────────────────────────

  private async runReviews(
    session: SwarmSession,
    candidates: AgentSlotState[],
    config: ArenaConfig,
    criteria: string[],
    hooks: JudgeHooks,
    signal: AbortSignal
  ): Promise<void> {
    const role = await this.resolveReviewerRole(session.projectPath, config.reviewer.roleSlug);
    const providerConfig: AIProviderConfig = {
      provider: (config.reviewer.provider || role?.provider || 'anthropic') as AIProviderConfig['provider'],
      model: config.reviewer.model || role?.model || DEFAULT_REVIEWER_MODEL,
      temperature: 0
    };

    for (const agent of candidates) {
      if (signal.aborted) return;
      agent.review = { agentId: agent.id, status: 'running', model: providerConfig.model };
      hooks.onUpdate(agent.id);

      const prompt = buildReviewerPrompt({
        taskId: session.taskId,
        taskTitle: session.taskTitle,
        prompt: session.prompt,
        criteria,
        agentName: agent.config.name,
        agentRole: agent.config.role,
        diffPatch: agent.diffSummary?.patch ?? '',
        diffSummary: agent.diffSummary
          ? {
              filesChanged: agent.diffSummary.filesChanged,
              insertions: agent.diffSummary.insertions,
              deletions: agent.diffSummary.deletions
            }
          : undefined,
        checks: agent.checks ?? []
      });

      const startedAt = Date.now();
      try {
        const { text, costUsd } = await this.askReviewer(session, agent, prompt, providerConfig, role?.systemPrompt, signal);
        const parsed = parseReviewerResponse(text, criteria);
        const verdict: ReviewerVerdict = {
          agentId: agent.id,
          status: parsed.ok ? 'done' : 'failed',
          model: providerConfig.model,
          durationMs: Date.now() - startedAt,
          ...(costUsd !== undefined ? { costUsd } : {}),
          ...(parsed.summary ? { summary: parsed.summary } : {}),
          ...(parsed.overall !== undefined ? { overall: parsed.overall } : {}),
          criteria: parsed.criteria,
          findings: parsed.findings,
          risks: parsed.risks,
          ...(parsed.ok ? {} : { error: parsed.parseError, raw: text.slice(0, 4000) })
        };
        agent.review = verdict;
        hooks.log(
          agent,
          parsed.ok
            ? `[Судья] Ревью получено: замечаний ${parsed.findings.length}, критериев оценено ${parsed.criteria.length}.`
            : `[Судья] Ревью не разобрано: ${parsed.parseError}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        agent.review = {
          agentId: agent.id,
          status: signal.aborted ? 'skipped' : 'failed',
          model: providerConfig.model,
          durationMs: Date.now() - startedAt,
          error: message
        };
        hooks.log(agent, `[Судья] Ревьюер недоступен: ${message}`);
      }
      hooks.onUpdate(agent.id);
    }
  }

  private async resolveReviewerRole(projectPath: string, slug: string) {
    try {
      const { roles } = await loadRoles(projectPath);
      return roles.find((r) => r.slug === slug);
    } catch (err) {
      console.warn(`[ArenaJudge] Роль "${slug}" не загрузилась:`, err);
      return undefined;
    }
  }

  /**
   * Один вызов LLM-ревьюера. Ревьюер только читает: инструменты записи и команд ему не даются,
   * `projectPath` указывает на worktree кандидата, а сам дифф уже в промпте.
   */
  private askReviewer(
    session: SwarmSession,
    agent: AgentSlotState,
    prompt: string,
    config: AIProviderConfig,
    roleSystemPrompt: string | undefined,
    signal: AbortSignal
  ): Promise<{ text: string; costUsd?: number }> {
    const sessionId = `judge-${agent.id}`;
    const messages: AIMessage[] = [
      { id: `msg-${Date.now()}`, role: 'user', content: prompt, timestamp: new Date().toISOString() }
    ];

    return new Promise((resolve, reject) => {
      let buffer = '';
      let costUsd: number | undefined;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        aiAgentService.abortStream(sessionId);
        reject(new Error(`Ревьюер не ответил за ${Math.round(REVIEWER_TIMEOUT_MS / 1000)} с`));
      }, REVIEWER_TIMEOUT_MS);
      timer.unref?.();

      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        aiAgentService.abortStream(sessionId);
        reject(new Error('Прогон судьи отменён'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        fn();
      };

      aiAgentService
        .streamChat(
          {
            sessionId,
            projectPath: agent.worktreePath || session.projectPath,
            messages,
            config,
            mode: 'chat',
            roleSystemPrompt,
            allowedToolNames: apiToolNamesForCategories(['read', 'search']),
            taskId: session.taskId
          },
          (chunk) => {
            if (chunk.text) buffer += chunk.text;
            if (chunk.usage?.costUsd !== undefined) costUsd = chunk.usage.costUsd;
          },
          (finalMsg) => {
            if (finalMsg.usage?.costUsd !== undefined) costUsd = finalMsg.usage.costUsd;
            done(() => resolve({ text: finalMsg.content || buffer, ...(costUsd !== undefined ? { costUsd } : {}) }));
          },
          (err) => done(() => reject(new Error(err)))
        )
        .catch((err) => done(() => reject(err instanceof Error ? err : new Error(String(err)))));
    });
  }

  // ─────────────────────────────── Скоринг ───────────────────────────────

  private score(session: SwarmSession, candidates: AgentSlotState[], config: ArenaConfig): void {
    const inputs: CandidateScoreInput[] = candidates.map((agent) => ({
      agentId: agent.id,
      checks: agent.checks ?? [],
      ...(agent.review?.criteria ? { criteria: agent.review.criteria } : {}),
      ...(agent.review?.overall !== undefined ? { reviewOverall: agent.review.overall } : {}),
      ...(agent.review?.findings ? { reviewFindings: agent.review.findings } : {}),
      reviewFailed: agent.review?.status === 'failed' || agent.review?.status === 'skipped',
      ...(agent.diffSummary
        ? {
            diff: {
              filesChanged: agent.diffSummary.filesChanged,
              insertions: agent.diffSummary.insertions,
              deletions: agent.diffSummary.deletions,
              modules: agent.diffSummary.modules?.length,
              dependents: agent.diffSummary.dependentSymbols
            }
          }
        : {}),
      ...(typeof (agent.metrics.usage?.costUsd ?? agent.metrics.costUsd) === 'number'
        ? { costUsd: agent.metrics.usage?.costUsd ?? agent.metrics.costUsd }
        : {}),
      ...(typeof agent.metrics.durationMs === 'number' ? { durationMs: agent.metrics.durationMs } : {})
    }));

    const scores = scoreCandidates(inputs, config.weights);
    for (const score of scores) {
      const agent = candidates.find((a) => a.id === score.agentId);
      if (agent) agent.score = score;
    }
    // Кандидаты вне выборки (прерванные, без worktree) не должны показывать устаревший балл.
    for (const agent of session.agents) {
      if (!candidates.includes(agent)) agent.score = undefined;
    }
  }
}

export const arenaJudgeService = new ArenaJudgeService();
