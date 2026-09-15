/**
 * Оркестрация цикла «до готовности» (TASK-75, decision-28).
 *
 * Ход агента → откат правок агента в чекбоксах критериев → проверки проекта в рабочем каталоге →
 * разбор отчёта агента → сверка критериев → решение (`doneLoop.decideNext`) → повторный ход с
 * ошибками или итог в Backlog.md. Логика решений и тексты промптов — в чистом `doneLoop.ts`.
 *
 * Сервис ничего не знает про `agentFleetService` (иначе цикл импортов, как у судьи арены):
 * ход агента, коммит и события он получает через хуки. Критерии в задаче отмечает только он —
 * по отчёту агента с evidence; статус `Done` не выставляется никогда.
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import { actionConfigService } from './actionConfigService.js';
import { loadArenaConfig, readProjectStack } from './arenaConfig.js';
import { readBacklogConfig } from './backlogConfigService.js';
import { findTaskFile } from './taskFileLookup.js';
import {
  applyFinalSummary,
  normalizeFrontmatter,
  parseTaskBody,
  restoreCriteriaFlags,
  toggleCriterionInContent,
  withUpdatedDate
} from './backlogTaskFormat.js';
import { summarizeCheckResult } from './arenaChecks.js';
import { executeCheck, pendingCheckResult } from './checkRunner.js';
import {
  OUTCOME_LABELS,
  buildDoneLoopFinalSummary,
  buildDoneLoopInstructions,
  buildRetryPrompt,
  checksPassed,
  decideNext,
  findReviewStatus,
  parseAgentReport,
  resolveDoneLoopSettings,
  verifyCriteria
} from './doneLoop.js';
import type { CheckDefinition, CheckRunResult } from './arenaTypes.js';
import type { DoneLoopIteration, DoneLoopOutcome, DoneLoopProjectSettings, DoneLoopSettings, DoneLoopState } from './doneLoopTypes.js';
import type { AgentSlotState, SwarmSession } from './swarmTypes.js';

export interface DoneLoopHooks {
  /** Один ход агента в его рабочем каталоге (включая авто-коммит результата). */
  runTurn: (prompt: string, options: { iteration: number; continueSession: boolean }) => Promise<void>;
  /** Зафиксировать текущее состояние рабочего каталога (decision-8). */
  materialize: () => Promise<void>;
  onUpdate: () => void;
  log: (line: string) => void;
  /** Человек остановил сессию (или приложение завершается). */
  isStopped: () => boolean;
  signal: AbortSignal;
}

export interface DoneLoopRunOptions {
  /** Продолжение после перезапуска приложения. */
  resume?: boolean;
  /** Приписка к промпту при возобновлении (задаёт вызывающий сервис). */
  resumeSuffix?: string;
}

export interface DoneLoopRunResult {
  outcome: DoneLoopOutcome;
  reason?: string;
}

/** Настройки цикла для проекта: проверки как у арены + секция `doneLoop` + выбор пользователя. */
export async function loadDoneLoopSettings(
  projectPath: string,
  overrides?: Partial<Pick<DoneLoopProjectSettings, 'maxIterations' | 'budgetUsd' | 'checkIds' | 'autoReview'>>
): Promise<DoneLoopSettings> {
  const [arena, config, stack] = await Promise.all([
    loadArenaConfig(projectPath),
    actionConfigService.getConfig(projectPath),
    readProjectStack(projectPath)
  ]);
  return resolveDoneLoopSettings({
    projectChecks: arena.checks,
    project: config.doneLoop,
    scripts: stack.scripts,
    packageManager: stack.packageManager,
    overrides
  });
}

interface RawTaskFile {
  eol: string;
  data: Record<string, unknown>;
  content: string;
}

async function readTaskFile(filePath: string): Promise<RawTaskFile> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = matter(raw.replace(/\r\n/g, '\n'));
  return { eol: raw.includes('\r\n') ? '\r\n' : '\n', data: { ...parsed.data }, content: parsed.content };
}

async function writeTaskFile(filePath: string, file: RawTaskFile): Promise<void> {
  const text = matter.stringify(file.content, normalizeFrontmatter(withUpdatedDate(file.data)));
  await fs.writeFile(filePath, file.eol === '\n' ? text : text.replace(/\n/g, file.eol), 'utf-8');
}

function agentCost(agent: AgentSlotState): number | undefined {
  const cost = agent.metrics.usage?.costUsd ?? agent.metrics.costUsd;
  return typeof cost === 'number' ? cost : undefined;
}

export class DoneLoopService {
  public async run(
    session: SwarmSession,
    agent: AgentSlotState,
    hooks: DoneLoopHooks,
    options: DoneLoopRunOptions = {}
  ): Promise<DoneLoopRunResult> {
    const state = session.doneLoop;
    if (!state) return { outcome: 'task_error', reason: 'Сессия не в режиме «до готовности»' };
    if (!session.taskId) return this.fail(state, 'task_error', 'Цикл «до готовности» требует задачу Backlog.md', hooks);

    if (!state.criteriaBaseline) {
      const task = await findTaskFile(session.projectPath, session.taskId).catch(() => null);
      if (!task) return this.fail(state, 'task_error', `Задача ${session.taskId} не найдена в backlog/tasks`, hooks);
      state.criteriaBaseline = parseTaskBody(task.content).criteria;
      state.task = { filePath: task.filePath, criteriaChecked: [] };
    }
    state.instructions ??= buildDoneLoopInstructions({
      taskId: session.taskId,
      criteria: state.criteriaBaseline,
      checks: state.settings.checks,
      maxIterations: state.settings.maxIterations
    });

    let prompt = this.initialPrompt(session, state, options);
    let continueSession = Boolean(options.resume);

    for (;;) {
      if (hooks.isStopped()) return this.fail(state, 'stopped', 'Цикл остановлен человеком', hooks);

      const iteration: DoneLoopIteration = {
        index: state.iterations.length + 1,
        startedAt: Date.now(),
        checks: [],
        criteria: [],
        reportFound: false
      };
      state.iterations.push(iteration);
      state.currentIteration = iteration.index;
      state.phase = 'running_agent';
      hooks.log(`[Done-loop] Итерация ${iteration.index}/${state.settings.maxIterations}: ход агента`);
      hooks.onUpdate();

      const costBefore = agentCost(agent);
      await hooks.runTurn(prompt, { iteration: iteration.index, continueSession: continueSession || iteration.index > 1 });
      continueSession = false;
      iteration.agentStatus = agent.status;
      iteration.commitHash = agent.commitHash;
      const costAfter = agentCost(agent);
      if (costAfter !== undefined) {
        iteration.costUsd = Math.max(0, costAfter - (costBefore ?? 0));
        state.totalCostUsd = costAfter;
      }

      if (!hooks.isStopped() && agent.status === 'completed') {
        iteration.tamperedCriteria = await this.enforceHarnessCriteria(session, agent, state, hooks);

        state.phase = 'checking';
        hooks.onUpdate();
        iteration.checks = await this.runChecks(session, agent, state.settings.checks, hooks);

        state.phase = 'verifying';
        const parsed = parseAgentReport(agent.finalOutput || agent.liveOutput);
        iteration.reportFound = parsed.ok;
        if (parsed.ok) {
          if (parsed.report.summary) iteration.reportSummary = parsed.report.summary;
        } else {
          iteration.reportError = parsed.error;
        }
        iteration.criteria = verifyCriteria(state.criteriaBaseline, parsed.ok ? parsed.report : null);
        const accepted = iteration.criteria.filter((c) => c.accepted).length;
        hooks.log(
          `[Done-loop] Отчёт: ${parsed.ok ? 'разобран' : `не принят (${parsed.error})`}; критериев засчитано ${accepted}/${iteration.criteria.length}`
        );
      }

      const decision = decideNext({
        iteration: iteration.index,
        maxIterations: state.settings.maxIterations,
        stopped: hooks.isStopped(),
        agentStatus: agent.status,
        agentError: agent.error,
        checksPassed: checksPassed(iteration.checks),
        allCriteriaAccepted: iteration.criteria.every((c) => c.accepted),
        costUsd: state.totalCostUsd,
        budgetUsd: state.settings.budgetUsd
      });
      iteration.decision = decision.action;
      iteration.finishedAt = Date.now();
      hooks.onUpdate();

      if (decision.action === 'retry') {
        hooks.log(`[Done-loop] Итерация ${iteration.index} не принята — повторный ход с ошибками и незакрытыми критериями.`);
        prompt = this.retryPrompt(state, iteration);
        continue;
      }
      if (decision.action === 'finish') {
        await this.completeTask(session, agent, state, iteration, hooks);
        return { outcome: 'success' };
      }
      return this.fail(state, decision.outcome, decision.reason, hooks);
    }
  }

  private initialPrompt(session: SwarmSession, state: DoneLoopState, options: DoneLoopRunOptions): string {
    if (!options.resume) return session.prompt;
    // Незаконченная итерация пересчитывается заново: её ход прерван, проверки не досчитаны.
    const last = state.iterations[state.iterations.length - 1];
    if (last && !last.finishedAt) state.iterations.pop();
    const previous = state.iterations[state.iterations.length - 1];
    const base = previous?.decision === 'retry' ? this.retryPrompt(state, previous) : session.prompt;
    return `${base}${options.resumeSuffix ?? ''}`;
  }

  private retryPrompt(state: DoneLoopState, iteration: DoneLoopIteration): string {
    return buildRetryPrompt({
      iteration: iteration.index,
      maxIterations: state.settings.maxIterations,
      checks: iteration.checks,
      criteria: iteration.criteria,
      reportError: iteration.reportError
    });
  }

  /**
   * Критерии отмечает только ProjectHub (decision-28): если агент поменял чекбоксы в файле задачи
   * своего рабочего каталога, отметки возвращаются к эталону и правка фиксируется коммитом.
   */
  private async enforceHarnessCriteria(
    session: SwarmSession,
    agent: AgentSlotState,
    state: DoneLoopState,
    hooks: DoneLoopHooks
  ): Promise<boolean> {
    const workdir = agent.worktreePath || session.projectPath;
    const baseline = state.criteriaBaseline ?? [];
    try {
      const task = await findTaskFile(workdir, session.taskId!);
      if (!task) return false;
      const file = await readTaskFile(task.filePath);
      const restored = restoreCriteriaFlags(file.content, baseline.map((c) => c.completed));
      if (restored === null) return false;
      await writeTaskFile(task.filePath, { ...file, content: restored });
      hooks.log('[Done-loop] ⚠️ Агент менял отметки критериев в файле задачи — откачено: критерии отмечает только ProjectHub.');
      if (workdir !== session.projectPath) await hooks.materialize();
      return true;
    } catch (err) {
      hooks.log(`[Done-loop] Не удалось сверить отметки критериев: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** Проверки выполняются последовательно: сборка и тесты в одном каталоге мешают друг другу. */
  private async runChecks(
    session: SwarmSession,
    agent: AgentSlotState,
    checks: CheckDefinition[],
    hooks: DoneLoopHooks
  ): Promise<CheckRunResult[]> {
    const workdir = agent.worktreePath || session.projectPath;
    const results = checks.map(pendingCheckResult);
    agent.checks = results;
    if (!existsSync(workdir)) {
      for (const r of results) {
        r.status = 'skipped';
        r.detail = `Рабочий каталог не найден: ${workdir}`;
      }
      return results;
    }
    for (let i = 0; i < checks.length; i++) {
      const result = results[i];
      if (hooks.signal.aborted) {
        result.status = 'skipped';
        result.detail = 'Цикл остановлен';
        continue;
      }
      hooks.log(`[Done-loop] Проверка «${result.name}»: ${result.command}`);
      const running = executeCheck(result, checks[i], workdir, hooks.signal);
      hooks.onUpdate();
      await running;
      hooks.log(`[Done-loop] «${result.name}» → ${summarizeCheckResult(result)}`);
      hooks.onUpdate();
    }
    return results;
  }

  /** Успех: отметки критериев, статус Review (если он есть в проекте) и Final Summary в задаче. */
  private async completeTask(
    session: SwarmSession,
    agent: AgentSlotState,
    state: DoneLoopState,
    iteration: DoneLoopIteration,
    hooks: DoneLoopHooks
  ): Promise<void> {
    state.phase = 'finished';
    state.outcome = 'success';
    state.reason = `Проверки и критерии приёмки выполнены за ${iteration.index} итер.`;
    const checked: number[] = [];

    try {
      const filePath = state.task?.filePath ?? (await findTaskFile(session.projectPath, session.taskId!))?.filePath;
      if (!filePath || !existsSync(filePath)) throw new Error('файл задачи не найден');
      const file = await readTaskFile(filePath);

      let body = file.content;
      const current = parseTaskBody(body).criteria;
      for (const c of iteration.criteria) {
        if (!c.accepted || c.alreadyChecked) continue;
        // Человек мог поправить чеклист во время цикла — отмечаем только тот же самый критерий.
        if (current[c.index - 1]?.text !== c.text) {
          hooks.log(`[Done-loop] Критерий #${c.index} изменился в задаче во время цикла — не отмечен.`);
          continue;
        }
        const updated = toggleCriterionInContent(body, c.index - 1, true);
        if (updated !== null) {
          body = updated;
          checked.push(c.index);
        }
      }

      let reviewStatus: string | undefined;
      if (state.settings.autoReview) {
        const backlogConfig = await readBacklogConfig(session.projectPath);
        reviewStatus = findReviewStatus(backlogConfig.statuses);
        if (reviewStatus) file.data.status = reviewStatus;
        else hooks.log('[Done-loop] В конфиге Backlog.md проекта нет статуса Review — статус задачи не изменён.');
      }

      body = applyFinalSummary(
        body,
        buildDoneLoopFinalSummary({
          outcome: 'success',
          iterations: iteration.index,
          maxIterations: state.settings.maxIterations,
          agentName: agent.config.name,
          engine: agent.config.engine,
          criteria: iteration.criteria,
          checks: iteration.checks,
          costUsd: state.totalCostUsd,
          durationMs: Date.now() - session.createdAt,
          reportSummary: iteration.reportSummary,
          branch: agent.worktreeBranch,
          commitHash: agent.commitHash ?? agent.lastCommitHash
        })
      );
      await writeTaskFile(filePath, { ...file, content: body });
      state.task = { filePath, criteriaChecked: checked, movedToReview: Boolean(reviewStatus), ...(reviewStatus ? { reviewStatus } : {}), finalSummaryWritten: true };
      hooks.log(
        `[Done-loop] ✅ Готово: отмечено критериев ${checked.length}${reviewStatus ? `, задача переведена в ${reviewStatus}` : ''}, Final Summary записан.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.task = { ...(state.task ?? { criteriaChecked: [] }), criteriaChecked: checked, error: message };
      hooks.log(`[Done-loop] Цикл успешен, но записать итог в задачу не удалось: ${message}`);
    }
    hooks.onUpdate();
  }

  private fail(state: DoneLoopState, outcome: DoneLoopOutcome, reason: string, hooks: DoneLoopHooks): DoneLoopRunResult {
    state.phase = outcome === 'stopped' ? 'stopped' : 'failed';
    state.outcome = outcome;
    state.reason = reason;
    hooks.log(`[Done-loop] ${outcome === 'stopped' ? '⏹' : '❌'} ${OUTCOME_LABELS[outcome]}: ${reason}`);
    hooks.onUpdate();
    return { outcome, reason };
  }
}

export const doneLoopService = new DoneLoopService();
