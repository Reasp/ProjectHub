import path from 'node:path';
import type { AppBusEvent } from './hitlTypes.js';
import type { CheckDefinition, CheckRunResult } from './arenaTypes.js';
import type { ActionDefinition, ProjectActionConfig } from './actionConfigService.js';
import { isFailedStatus, scriptCommand, type DefaultChecksInput } from './arenaChecks.js';
import type { RunOnceResult } from './processManager.js';
import { DEFAULT_TASK_PROMPT, renderTemplate, type AutomationAction, type AutomationEvent } from './automationRules.js';
import type { AuditSeverity } from './dependencyAudit.js';

/**
 * Исполнение действий Automations (TASK-74, decision-52 п. 1, 6).
 *
 * Модуль не знает о флоте, проверках и процессах напрямую — всё приходит зависимостями, чтобы
 * действия проверялись тестами без Electron. Агент запускается асинхронно: результат действия
 * `pending` со `swarmId`, итог подводит сервис по завершении сессии.
 */

/** Метка запуска автоматизацией в сессии флота — по ней сервис связывает события с правилом. */
export interface AutomationRunMeta {
  ruleKey: string;
  ruleName: string;
  runId: string;
  depth: number;
}

export interface StartRoleAgentRequest {
  projectPath: string;
  roleSlug: string;
  prompt: string;
  mode: 'single' | 'doneLoop';
  taskId?: string;
  taskTitle?: string;
  budgetUsd?: number;
  maxIterations?: number;
  automation: AutomationRunMeta;
}

export interface StartedAgentSession {
  id: string;
  agents: { id: string }[];
}

/** Запрос ревью PR (TASK-81, decision-53); исполняет `prReviewService`. */
export interface PrReviewRequest {
  projectPath: string;
  prNumber: number;
  headSha?: string;
  reviewers: string[];
  verifier?: string;
  budgetUsd?: number;
  publish: 'hitl' | 'manual';
  automation: AutomationRunMeta;
  /** Сессия флота запущена — движок связывает её события с запуском правила. */
  onSessionStarted: (swarmId: string, agentIds: string[]) => void;
}

export interface DeferredCompletion {
  outcome: 'success' | 'failed';
  detail?: string;
  costUsd?: number;
  swarmIds?: string[];
}

export interface ActionDeps {
  startRoleAgent(req: StartRoleAgentRequest): Promise<StartedAgentSession | { error: string }>;
  startPrReview(req: PrReviewRequest): Promise<{ reviewId: string; completion: Promise<DeferredCompletion> } | { skipped: string } | { error: string }>;
  findTaskTitle(projectRoot: string, taskId: string): Promise<string | null>;
  loadChecks(projectRoot: string): Promise<CheckDefinition[]>;
  runCheck(def: CheckDefinition, workdir: string): Promise<CheckRunResult>;
  readProjectStack(projectRoot: string): Promise<DefaultChecksInput>;
  getProjectConfig(projectRoot: string): Promise<ProjectActionConfig>;
  runOnce(command: string, options: { cwd: string; timeoutMs: number; env?: Record<string, string>; portStrategy?: 'fixed' | 'auto'; port?: number }): Promise<RunOnceResult>;
  publish(event: AppBusEvent): void;
  /** Аудит зависимостей (decision-56 п. 8); сервис сам публикует `security:finding` о новых находках. */
  auditDependencies?(projectRoot: string, minSeverity: AuditSeverity): Promise<{ ok: boolean; detail: string }>;
}

export interface ActionContext {
  action: AutomationAction;
  ruleKey: string;
  ruleId: string;
  ruleName: string;
  runId: string;
  depth: number;
  /** Корень зарегистрированного проекта; не нужен только уведомлению. */
  projectRoot?: string;
  event?: AutomationEvent;
  /** Бюджет запуска агента (остаток дневного бюджета правила). */
  budgetUsd?: number;
  /** Для действий из нескольких сессий флота: сообщить движку о каждой (причинность цепочек). */
  onSessionStarted?: (swarmId: string, agentIds: string[]) => void;
}

export type ActionResult =
  | { outcome: 'success' | 'failed'; detail?: string }
  | { outcome: 'pending'; swarmId: string; agentIds: string[]; taskId?: string; detail?: string }
  /** Итог придёт позже и не сводится к одной сессии роя (ревью PR: ревьюеры, затем проверяющий). */
  | { outcome: 'deferred'; completion: Promise<DeferredCompletion>; detail?: string };

export const PROJECT_ACTION_TIMEOUT_MS = 30 * 60 * 1000;
export const REINDEX_TIMEOUT_MS = 15 * 60 * 1000;
const DETAIL_TAIL_CHARS = 600;

function tail(text: string, max = DETAIL_TAIL_CHARS): string {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '').trim(); // eslint-disable-line no-control-regex -- снятие ANSI-цветов из вывода команды
  return clean.length > max ? `…${clean.slice(-max)}` : clean;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function templateVars(ctx: ActionContext, taskTitle?: string): Record<string, string | undefined> {
  return {
    taskId: ctx.event?.taskId ?? (ctx.action.type === 'runAgent' ? ctx.action.taskId : undefined),
    taskTitle: taskTitle ?? ctx.event?.taskTitle,
    event: ctx.event?.summary,
    projectName: ctx.projectRoot ? path.basename(ctx.projectRoot) : undefined,
    ruleName: ctx.ruleName
  };
}

/** Ищет действие `.projecthub.json` по id: `run`, `test`, `deploy` или id из `customActions`. */
export function findProjectAction(config: ProjectActionConfig, actionId: string): ActionDefinition | null {
  if (actionId === 'run' || actionId === 'test' || actionId === 'deploy') return config[actionId] ?? null;
  return config.customActions?.find((a) => a.id === actionId) ?? null;
}

export async function executeAutomationAction(ctx: ActionContext, deps: ActionDeps): Promise<ActionResult> {
  const { action } = ctx;
  if (action.type !== 'notify' && !ctx.projectRoot) return { outcome: 'failed', detail: 'Не определён проект для действия' };
  const root = ctx.projectRoot as string;

  switch (action.type) {
    case 'notify': {
      const vars = templateVars(ctx);
      deps.publish({
        type: 'automation:notify',
        ruleId: ctx.ruleId,
        ruleName: ctx.ruleName,
        ...(ctx.projectRoot ? { projectPath: ctx.projectRoot } : {}),
        title: renderTemplate(action.title, vars) || ctx.ruleName,
        ...(action.body ? { body: renderTemplate(action.body, vars) } : {}),
        at: Date.now()
      });
      return { outcome: 'success' };
    }

    case 'runAgent': {
      const taskId = action.taskId ?? ctx.event?.taskId;
      const taskTitle = taskId ? (ctx.event?.taskTitle ?? (await deps.findTaskTitle(root, taskId)) ?? undefined) : undefined;
      if (action.mode === 'doneLoop' && !taskId) return { outcome: 'failed', detail: 'Циклу «до готовности» нужна задача' };
      const template = action.prompt?.trim() || (taskId ? DEFAULT_TASK_PROMPT : '');
      const prompt = renderTemplate(template, { ...templateVars(ctx, taskTitle), taskId });
      if (!prompt) return { outcome: 'failed', detail: 'Пустой промпт агента' };
      const started = await deps.startRoleAgent({
        projectPath: root,
        roleSlug: action.roleSlug,
        prompt,
        mode: action.mode,
        ...(taskId ? { taskId } : {}),
        ...(taskTitle ? { taskTitle } : {}),
        ...(ctx.budgetUsd !== undefined ? { budgetUsd: ctx.budgetUsd } : {}),
        ...(action.maxIterations ? { maxIterations: action.maxIterations } : {}),
        automation: { ruleKey: ctx.ruleKey, ruleName: ctx.ruleName, runId: ctx.runId, depth: ctx.depth }
      });
      if ('error' in started) return { outcome: 'failed', detail: started.error };
      return {
        outcome: 'pending',
        swarmId: started.id,
        agentIds: started.agents.map((a) => a.id),
        ...(taskId ? { taskId } : {}),
        detail: `роль ${action.roleSlug}${action.mode === 'doneLoop' ? ', до готовности' : ''}`
      };
    }

    case 'runChecks': {
      const all = await deps.loadChecks(root);
      const wanted = action.checkIds?.length ? all.filter((c) => action.checkIds!.includes(c.id)) : all;
      const missing = action.checkIds?.filter((id) => !all.some((c) => c.id === id)) ?? [];
      if (!wanted.length) {
        return { outcome: missing.length ? 'failed' : 'success', detail: missing.length ? `Нет проверок: ${missing.join(', ')}` : 'Проверок в проекте нет' };
      }
      const results: CheckRunResult[] = [];
      for (const def of wanted) results.push(await deps.runCheck(def, root));
      const failed = results.filter((r) => r.blocking && isFailedStatus(r.status));
      const summary = results.map((r) => `${r.name || r.id}: ${r.status}`).join('; ');
      return {
        outcome: failed.length || missing.length ? 'failed' : 'success',
        detail: [summary, missing.length ? `нет проверок: ${missing.join(', ')}` : ''].filter(Boolean).join('; ')
      };
    }

    case 'reindexDocs': {
      const stack = await deps.readProjectStack(root);
      if (!stack.scripts?.['index-docs']) return { outcome: 'failed', detail: 'В package.json проекта нет скрипта index-docs' };
      const run = await deps.runOnce(scriptCommand(stack.packageManager ?? 'npm', 'index-docs'), { cwd: root, timeoutMs: REINDEX_TIMEOUT_MS });
      const ok = run.exitCode === 0 && !run.timedOut;
      return { outcome: ok ? 'success' : 'failed', detail: ok ? 'Индекс документации пересобран' : run.error || tail(run.output) };
    }

    case 'reviewPr': {
      const prNumber = ctx.event?.prNumber;
      if (!prNumber) return { outcome: 'failed', detail: 'В событии нет номера PR' };
      const started = await deps.startPrReview({
        projectPath: root,
        prNumber,
        ...(ctx.event?.headSha ? { headSha: ctx.event.headSha } : {}),
        reviewers: action.reviewers,
        ...(action.verifier ? { verifier: action.verifier } : {}),
        ...(ctx.budgetUsd !== undefined ? { budgetUsd: ctx.budgetUsd } : action.budgetUsd ? { budgetUsd: action.budgetUsd } : {}),
        publish: action.publish,
        automation: { ruleKey: ctx.ruleKey, ruleName: ctx.ruleName, runId: ctx.runId, depth: ctx.depth },
        onSessionStarted: (swarmId, agentIds) => ctx.onSessionStarted?.(swarmId, agentIds)
      });
      if ('error' in started) return { outcome: 'failed', detail: started.error };
      if ('skipped' in started) return { outcome: 'success', detail: started.skipped };
      return { outcome: 'deferred', completion: started.completion, detail: `ревью PR #${prNumber}` };
    }

    case 'auditDependencies': {
      if (!deps.auditDependencies) return { outcome: 'failed', detail: 'Аудит зависимостей недоступен' };
      const res = await deps.auditDependencies(root, action.minSeverity);
      return { outcome: res.ok ? 'success' : 'failed', detail: res.detail };
    }

    case 'projectAction': {
      let config: ProjectActionConfig;
      try {
        config = await deps.getProjectConfig(root);
      } catch (err) {
        return { outcome: 'failed', detail: `Не прочитан .projecthub.json: ${errorText(err)}` };
      }
      const def = findProjectAction(config, action.actionId);
      if (!def?.command) return { outcome: 'failed', detail: `Действие «${action.actionId}» не найдено в .projecthub.json` };
      if (def.requiresConfirmation) {
        return { outcome: 'failed', detail: `Действие «${def.name || action.actionId}» требует подтверждения человека — автоматизация его не выполняет` };
      }
      const run = await deps.runOnce(def.command, {
        cwd: def.cwd ? path.resolve(root, def.cwd) : root,
        timeoutMs: PROJECT_ACTION_TIMEOUT_MS,
        ...(def.env ? { env: def.env } : {}),
        ...(def.portStrategy ? { portStrategy: def.portStrategy } : {}),
        ...(def.port ? { port: def.port } : {})
      });
      const ok = run.exitCode === 0 && !run.timedOut;
      return { outcome: ok ? 'success' : 'failed', detail: run.timedOut ? 'Тайм-аут действия' : run.error || tail(run.output) };
    }
  }
}
