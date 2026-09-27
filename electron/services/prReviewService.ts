import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { AppBusEvent, ApprovalResponse, HitlRequest, RolePermissions } from './hitlTypes.js';
import type { AgentSlotConfig, StartFanOutOptions, SwarmAutomationMeta, SwarmSession } from './swarmTypes.js';
import type { PrReviewTarget } from './prService.js';
import { normalizePathKey } from './automationRules.js';
import {
  applyVerdicts,
  buildPrComment,
  buildReviewerPrompt,
  buildVerifierPrompt,
  dedupeFindings,
  findLinkedTaskId,
  parseReviewReport,
  parseVerifyReport,
  sanitizeForPublication,
  selectForVerification,
  type ReviewTaskInput,
  type UniqueFinding
} from './prReviewFormat.js';

/**
 * Ревью PR (TASK-81, decision-53 п. 3–9): голова PR в worktree, ревьюеры на чтение во флоте,
 * дедупликация, проверяющий, запись результата, заметка в задаче, публикация только через человека.
 * Все внешние сервисы — зависимостями (`prReviewDeps` в приложении, подделки в тестах).
 */

export const REVIEWERS_BUDGET_SHARE = 0.7;
export const PUBLISH_APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MANUAL_REVIEW_BUDGET_USD = 1;
export const PR_REVIEWS_DIR = 'pr-reviews';

export type PublishState = 'none' | 'pending' | 'published' | 'declined' | 'blocked' | 'failed';

export interface PrReviewRecord {
  id: string;
  projectPath: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  status: 'running' | 'done' | 'failed';
  stage: 'preparing' | 'reviewing' | 'verifying' | 'finished';
  startedAt: number;
  finishedAt?: number;
  error?: string;
  origin: 'manual' | 'automation';
  automation?: SwarmAutomationMeta;
  taskId?: string;
  budgetUsd?: number;
  costUsd?: number;
  reviewers: { roleSlug: string; name: string; agentId?: string; status: 'pending' | 'done' | 'failed'; findings: number; summary?: string; error?: string }[];
  verifier?: { roleSlug: string; name?: string; status: 'pending' | 'done' | 'failed' | 'skipped'; error?: string };
  swarmIds: string[];
  findings: UniqueFinding[];
  comment?: string;
  publish: { mode: 'hitl' | 'manual'; state: PublishState; requestId?: string; commentUrl?: string; error?: string; at?: number };
}

export interface StartPrReviewInput {
  projectPath: string;
  prNumber: number;
  headSha?: string;
  reviewers: string[];
  verifier?: string;
  budgetUsd?: number;
  publish: 'hitl' | 'manual';
  origin: 'manual' | 'automation';
  automation?: SwarmAutomationMeta;
  /** Повторить ревью того же head SHA (кнопка «Повторить»). */
  force?: boolean;
  onSessionStarted?: (swarmId: string, agentIds: string[]) => void;
}

export interface ReviewCompletion {
  outcome: 'success' | 'failed';
  detail?: string;
  costUsd?: number;
  swarmIds?: string[];
}

export interface PrReviewDeps {
  gh: {
    getPr(root: string, prNumber: number): Promise<PrReviewTarget>;
    getDiff(root: string, prNumber: number): Promise<string>;
    fetchHead(root: string, prNumber: number): Promise<{ ref: string; sha: string }>;
    comment(root: string, prNumber: number, body: string): Promise<string>;
  };
  fleet: {
    buildRoleSlot(root: string, roleSlug: string, slotId: string, overrides: { name?: string; permissions?: RolePermissions }): Promise<AgentSlotConfig | { error: string }>;
    startFanOut(options: StartFanOutOptions): Promise<SwarmSession>;
    getSwarm(id: string): SwarmSession | undefined;
    onSwarm(listener: (session: SwarmSession) => void): () => void;
  };
  findTask(root: string, taskId: string): Promise<ReviewTaskInput | null>;
  appendTaskNote(root: string, taskId: string, note: string): Promise<void>;
  requestApproval(request: HitlRequest, timeoutMs: number): Promise<ApprovalResponse>;
  /** Инструменты только чтения и поиска для ревьюеров (имена Claude CLI и API-агента). */
  readOnlyTools: string[];
  publish(event: AppBusEvent): void;
  stateDir: string;
  now(): number;
  log(level: 'info' | 'warn', message: string): void;
}

const TERMINAL = new Set(['completed', 'failed', 'stopped', 'interrupted']);

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 500);
}

function projectHash(root: string): string {
  return createHash('sha1').update(normalizePathKey(root)).digest('hex').slice(0, 12);
}

export class PrReviewService {
  private running = new Map<string, Promise<ReviewCompletion>>();
  private listeners = new Set<(record: PrReviewRecord) => void>();

  constructor(private readonly deps: PrReviewDeps) {}

  public onChange(listener: (record: PrReviewRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ─────────────────────────── Хранение ───────────────────────────

  private dirOf(root: string): string {
    return path.join(this.deps.stateDir, projectHash(root));
  }

  private fileOf(root: string, prNumber: number, headSha: string): string {
    return path.join(this.dirOf(root), `${prNumber}-${headSha.slice(0, 12)}.json`);
  }

  private async save(record: PrReviewRecord): Promise<void> {
    const file = this.fileOf(record.projectPath, record.prNumber, record.headSha);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
    try {
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch {
        // подписчик UI не должен ронять ревью
      }
    }
  }

  private async saveQuietly(record: PrReviewRecord): Promise<void> {
    await this.save(record).catch((err) => this.deps.log('warn', `[PrReview] Не удалось сохранить ревью ${record.id}: ${errorText(err)}`));
  }

  /** Ревью проекта (или одного PR), новые первыми. */
  public async list(root: string, prNumber?: number): Promise<PrReviewRecord[]> {
    const dir = this.dirOf(root);
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    const out: PrReviewRecord[] = [];
    for (const name of files) {
      if (!name.endsWith('.json')) continue;
      if (prNumber !== undefined && !name.startsWith(`${prNumber}-`)) continue;
      try {
        out.push(JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as PrReviewRecord);
      } catch {
        // битая запись пропускается
      }
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }

  public async get(root: string, reviewId: string): Promise<PrReviewRecord | null> {
    return (await this.list(root)).find((r) => r.id === reviewId) ?? null;
  }

  // ─────────────────────────── Запуск ───────────────────────────

  /**
   * Запускает ревью и сразу возвращает `completion` — итог без ожидания решения человека о публикации.
   * Повтор того же head SHA пропускается (`skipped`), если не задан `force`.
   */
  public async start(input: StartPrReviewInput): Promise<{ reviewId: string; completion: Promise<ReviewCompletion> } | { skipped: string } | { error: string }> {
    if (!input.reviewers.length) return { error: 'Не указаны ревьюеры' };
    let pr: PrReviewTarget;
    try {
      pr = await this.deps.gh.getPr(input.projectPath, input.prNumber);
    } catch (err) {
      return { error: `PR #${input.prNumber} не получен через gh: ${errorText(err)}` };
    }
    if (pr.state && pr.state.toUpperCase() !== 'OPEN') return { skipped: `PR #${pr.number} не открыт (${pr.state})` };

    const key = `${normalizePathKey(input.projectPath)}#${pr.number}@${pr.headSha}`;
    if (this.running.has(key)) return { skipped: `ревью PR #${pr.number} для ${pr.headSha.slice(0, 7)} уже идёт` };
    if (!input.force) {
      const existing = (await this.list(input.projectPath, pr.number)).find((r) => r.headSha === pr.headSha && r.status !== 'failed');
      if (existing) return { skipped: `PR #${pr.number} для ${pr.headSha.slice(0, 7)} уже проверен (${existing.id})` };
    }

    const now = this.deps.now();
    const record: PrReviewRecord = {
      id: `prr-${pr.number}-${now.toString(36)}-${randomUUID().slice(0, 4)}`,
      projectPath: input.projectPath,
      prNumber: pr.number,
      prTitle: pr.title,
      prUrl: pr.url,
      headSha: pr.headSha,
      headRef: pr.headRef,
      baseRef: pr.baseRef,
      status: 'running',
      stage: 'preparing',
      startedAt: now,
      origin: input.origin,
      ...(input.automation ? { automation: input.automation } : {}),
      ...(input.budgetUsd ? { budgetUsd: input.budgetUsd } : {}),
      reviewers: input.reviewers.map((slug) => ({ roleSlug: slug, name: slug, status: 'pending', findings: 0 })),
      ...(input.verifier || input.reviewers[0] ? { verifier: { roleSlug: input.verifier ?? input.reviewers[0], status: 'pending' as const } } : {}),
      swarmIds: [],
      findings: [],
      publish: { mode: input.publish, state: 'none' }
    };
    await this.saveQuietly(record);
    const completion = this.run(record, pr, input).finally(() => this.running.delete(key));
    this.running.set(key, completion);
    return { reviewId: record.id, completion };
  }

  private waitForSwarm(id: string): Promise<SwarmSession> {
    return new Promise((resolve) => {
      let unsubscribe: () => void = () => undefined;
      let done = false;
      const check = (session: SwarmSession) => {
        if (done || session.id !== id || !TERMINAL.has(session.status)) return;
        done = true;
        unsubscribe();
        resolve(session);
      };
      unsubscribe = this.deps.fleet.onSwarm(check);
      const current = this.deps.fleet.getSwarm(id);
      if (current) check(current);
    });
  }

  private readOnlyPermissions(): RolePermissions {
    return { allowFileWrite: false, allowCommands: false, allowSubagents: false, allowedTools: [...this.deps.readOnlyTools] };
  }

  private async run(record: PrReviewRecord, pr: PrReviewTarget, input: StartPrReviewInput): Promise<ReviewCompletion> {
    const root = input.projectPath;
    const budget = input.budgetUsd && input.budgetUsd > 0 ? input.budgetUsd : undefined;
    const fail = async (message: string): Promise<ReviewCompletion> => {
      record.status = 'failed';
      record.stage = 'finished';
      record.error = message;
      record.finishedAt = this.deps.now();
      await this.saveQuietly(record);
      this.publishFinished(record);
      return { outcome: 'failed', detail: message, ...(record.costUsd !== undefined ? { costUsd: record.costUsd } : {}), swarmIds: record.swarmIds };
    };

    try {
      // 1. Код головы PR, дифф и связанная задача.
      let ref: string;
      try {
        const fetched = await this.deps.gh.fetchHead(root, pr.number);
        ref = fetched.ref;
        if (fetched.sha && fetched.sha !== pr.headSha) this.deps.log('warn', `[PrReview] Голова PR #${pr.number} сдвинулась: ${pr.headSha.slice(0, 7)} → ${fetched.sha.slice(0, 7)}`);
      } catch (err) {
        return fail(`Не удалось забрать голову PR: ${errorText(err)}`);
      }
      const diff = await this.deps.gh.getDiff(root, pr.number).catch((err) => {
        this.deps.log('warn', `[PrReview] Дифф PR #${pr.number} не получен: ${errorText(err)}`);
        return '';
      });
      const taskId = findLinkedTaskId(pr.headRef, pr.title);
      const task = taskId ? await this.deps.findTask(root, taskId).catch(() => null) : null;
      if (task) record.taskId = task.id;

      // 2. Ревьюеры: fan-out на чтение от головы PR.
      const slots: AgentSlotConfig[] = [];
      for (const [i, slug] of input.reviewers.entries()) {
        const slot = await this.deps.fleet.buildRoleSlot(root, slug, `review-${pr.number}-${i + 1}-${Date.now().toString(36)}`, {
          name: `${slug} · ревьюер ${i + 1}`,
          permissions: this.readOnlyPermissions()
        });
        if ('error' in slot) return fail(slot.error);
        record.reviewers[i].name = slot.name;
        record.reviewers[i].agentId = slot.id;
        slots.push(slot);
      }
      record.stage = 'reviewing';
      await this.saveQuietly(record);
      const prInput = { number: pr.number, title: pr.title, body: pr.body, headRef: pr.headRef, baseRef: pr.baseRef, headSha: pr.headSha, url: pr.url };
      const reviewSession = await this.deps.fleet.startFanOut({
        projectPath: root,
        prompt: buildReviewerPrompt({ pr: prInput, ...(task ? { task } : {}), diff }),
        baseBranch: ref,
        useWorktrees: true,
        autoCommitAgentResults: false,
        ...(budget ? { budgetUsd: Math.round(budget * REVIEWERS_BUDGET_SHARE * 10000) / 10000 } : {}),
        origin: input.origin === 'automation' ? 'automation' : 'swarm',
        ...(input.automation ? { automation: input.automation } : {}),
        review: { reviewId: record.id, prNumber: pr.number, headSha: pr.headSha, stage: 'review' },
        agents: slots
      });
      record.swarmIds.push(reviewSession.id);
      input.onSessionStarted?.(reviewSession.id, reviewSession.agents.map((a) => a.id));
      await this.saveQuietly(record);
      const reviewed = await this.waitForSwarm(reviewSession.id);
      record.costUsd = reviewed.totalCostUsd;

      const reports = reviewed.agents.map((agent, i) => {
        const parsed = parseReviewReport(agent.finalOutput ?? '');
        const entry = record.reviewers[i];
        if (agent.status !== 'completed' || !parsed.ok) {
          entry.status = 'failed';
          entry.error = agent.error || parsed.error || `агент: ${agent.status}`;
        } else {
          entry.status = 'done';
          entry.findings = parsed.findings.length;
          if (parsed.summary) entry.summary = parsed.summary;
        }
        return { reviewer: entry.name, findings: entry.status === 'done' ? parsed.findings : [] };
      });
      if (record.reviewers.every((r) => r.status === 'failed')) return fail('Ни один ревьюер не вернул разобранный отчёт');

      // 3. Дедупликация и проверка находок.
      let findings = dedupeFindings(reports);
      const toVerify = selectForVerification(findings);
      if (toVerify.length && record.verifier) {
        record.stage = 'verifying';
        record.findings = findings;
        await this.saveQuietly(record);
        const slot = await this.deps.fleet.buildRoleSlot(root, record.verifier.roleSlug, `verify-${pr.number}-${Date.now().toString(36)}`, {
          name: `${record.verifier.roleSlug} · проверяющий`,
          permissions: this.readOnlyPermissions()
        });
        if ('error' in slot) {
          record.verifier.status = 'failed';
          record.verifier.error = slot.error;
        } else {
          record.verifier.name = slot.name;
          const verifyBudget = budget ? Math.round(Math.max(0, budget - (record.costUsd ?? 0)) * 10000) / 10000 : undefined;
          const verifySession = await this.deps.fleet.startFanOut({
            projectPath: root,
            prompt: buildVerifierPrompt({ pr: prInput, findings: toVerify }),
            baseBranch: ref,
            useWorktrees: true,
            autoCommitAgentResults: false,
            ...(verifyBudget && verifyBudget > 0 ? { budgetUsd: verifyBudget } : {}),
            origin: input.origin === 'automation' ? 'automation' : 'swarm',
            ...(input.automation ? { automation: input.automation } : {}),
            review: { reviewId: record.id, prNumber: pr.number, headSha: pr.headSha, stage: 'verify' },
            agents: [slot]
          });
          record.swarmIds.push(verifySession.id);
          input.onSessionStarted?.(verifySession.id, verifySession.agents.map((a) => a.id));
          await this.saveQuietly(record);
          const verified = await this.waitForSwarm(verifySession.id);
          record.costUsd = (record.costUsd ?? 0) + (verified.totalCostUsd ?? 0);
          const agent = verified.agents[0];
          const parsed = parseVerifyReport(agent?.finalOutput ?? '');
          if (agent?.status === 'completed' && parsed.ok) {
            record.verifier.status = 'done';
            findings = applyVerdicts(findings, parsed.verdicts);
          } else {
            record.verifier.status = 'failed';
            record.verifier.error = agent?.error || parsed.error || `агент: ${agent?.status ?? 'нет'}`;
          }
        }
      } else if (record.verifier) {
        record.verifier.status = 'skipped';
      }

      // 4. Итог, комментарий, заметка в задаче.
      record.findings = findings;
      record.status = 'done';
      record.stage = 'finished';
      record.finishedAt = this.deps.now();
      const confirmed = findings.filter((f) => f.verdict === 'confirmed').length;
      const doneReviewers = record.reviewers.filter((r) => r.status === 'done').map((r) => r.name);
      if (confirmed > 0) {
        const clean = sanitizeForPublication(
          buildPrComment({ pr: { number: pr.number, headSha: pr.headSha }, findings, reviewers: doneReviewers, ...(record.verifier?.name ? { verifier: record.verifier.name } : {}), ...(record.costUsd !== undefined ? { costUsd: record.costUsd } : {}) })
        );
        record.comment = clean.text;
        if (clean.blocked) record.publish = { ...record.publish, state: 'blocked', error: `в тексте похоже на секрет: ${clean.blocked}` };
        else if (record.publish.mode === 'hitl') record.publish = { ...record.publish, state: 'pending', requestId: `prpub-${record.id}` };
      }
      await this.saveQuietly(record);
      if (record.taskId) {
        await this.deps.appendTaskNote(root, record.taskId, this.taskNote(record)).catch((err) => this.deps.log('warn', `[PrReview] Заметка в задаче не записана: ${errorText(err)}`));
      }
      this.publishFinished(record);
      if (record.publish.state === 'pending') void this.requestPublication(record);

      const refuted = findings.filter((f) => f.verdict === 'refuted').length;
      return {
        outcome: 'success',
        detail: `PR #${pr.number}: находок ${findings.length}, подтверждено ${confirmed}, отброшено ${refuted}${record.comment ? `; публикация: ${record.publish.mode === 'hitl' ? 'ждёт решения' : 'вручную'}` : ''}`,
        ...(record.costUsd !== undefined ? { costUsd: record.costUsd } : {}),
        swarmIds: record.swarmIds
      };
    } catch (err) {
      return fail(errorText(err));
    }
  }

  private taskNote(record: PrReviewRecord): string {
    const confirmed = record.findings.filter((f) => f.verdict === 'confirmed').length;
    const refuted = record.findings.filter((f) => f.verdict === 'refuted').length;
    const cost = record.costUsd !== undefined ? `, $${record.costUsd.toFixed(2)}` : '';
    return [
      `**Ревью PR #${record.prNumber} ${new Date(record.finishedAt ?? this.deps.now()).toISOString().slice(0, 16).replace('T', ' ')} UTC** — голова \`${record.headSha.slice(0, 7)}\`${cost}`,
      `- находок ${record.findings.length}: подтверждено ${confirmed}, отброшено при проверке ${refuted}`,
      `- ревьюеры: ${record.reviewers.map((r) => `${r.name} (${r.status === 'done' ? r.findings : 'ошибка'})`).join(', ')}`
    ].join('\n');
  }

  private publishFinished(record: PrReviewRecord): void {
    const confirmed = record.findings.filter((f) => f.verdict === 'confirmed').length;
    const refuted = record.findings.filter((f) => f.verdict === 'refuted').length;
    this.deps.publish({
      type: 'pr:reviewFinished',
      projectPath: record.projectPath,
      number: record.prNumber,
      title: record.prTitle,
      ...(record.prUrl ? { url: record.prUrl } : {}),
      headSha: record.headSha,
      reviewId: record.id,
      status: record.status === 'failed' ? 'failed' : 'done',
      confirmed,
      refuted,
      unverified: record.findings.length - confirmed - refuted,
      ...(record.costUsd !== undefined ? { costUsd: record.costUsd } : {}),
      publish: record.comment && record.publish.state !== 'blocked' ? (record.publish.mode === 'hitl' ? 'pending' : 'manual') : 'none',
      ...(record.error ? { error: record.error } : {}),
      at: this.deps.now()
    });
  }

  // ─────────────────────────── Публикация ───────────────────────────

  /** Запрос HITL: одобрение с любого канала публикует комментарий, отказ и тайм-аут — нет. */
  private async requestPublication(record: PrReviewRecord): Promise<void> {
    const requestId = record.publish.requestId ?? `prpub-${record.id}`;
    let approved = false;
    try {
      const response = await this.deps.requestApproval(
        {
          id: requestId,
          sessionId: `pr-review-${record.id}`,
          projectPath: record.projectPath,
          type: 'command',
          title: `Опубликовать ревью PR #${record.prNumber} «${record.prTitle}»`,
          command: `gh pr comment ${record.prNumber} --body-file <текст ниже>`,
          details: record.comment,
          tool: 'gh pr comment',
          origin: record.origin === 'automation' ? 'automation' : 'swarm',
          createdAt: this.deps.now()
        },
        PUBLISH_APPROVAL_TIMEOUT_MS
      );
      approved = response.approved;
    } catch (err) {
      this.deps.log('info', `[PrReview] Запрос публикации ${record.id} снят: ${errorText(err)}`);
    }
    const fresh = (await this.get(record.projectPath, record.id)) ?? record;
    if (fresh.publish.state === 'published') return;
    if (!approved) {
      fresh.publish = { ...fresh.publish, state: 'declined', at: this.deps.now() };
      await this.saveQuietly(fresh);
      return;
    }
    await this.doPublish(fresh);
  }

  /** Кнопка «Опубликовать» (человек у экрана) или одобренный запрос HITL. */
  public async publishNow(root: string, reviewId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    const record = await this.get(root, reviewId);
    if (!record) return { ok: false, error: 'Ревью не найдено' };
    if (!record.comment) return { ok: false, error: 'Публиковать нечего: подтверждённых замечаний нет' };
    if (record.publish.state === 'published') return { ok: false, error: 'Уже опубликовано' };
    if (record.publish.state === 'blocked') return { ok: false, error: record.publish.error ?? 'Публикация заблокирована' };
    return this.doPublish(record);
  }

  private async doPublish(record: PrReviewRecord): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    const clean = sanitizeForPublication(record.comment ?? '');
    if (clean.blocked) {
      record.publish = { ...record.publish, state: 'blocked', error: `в тексте похоже на секрет: ${clean.blocked}`, at: this.deps.now() };
      await this.saveQuietly(record);
      return { ok: false, error: record.publish.error! };
    }
    try {
      const url = (await this.deps.gh.comment(record.projectPath, record.prNumber, clean.text)).trim();
      record.publish = { ...record.publish, state: 'published', commentUrl: url, at: this.deps.now() };
      delete record.publish.error;
      await this.saveQuietly(record);
      return { ok: true, url };
    } catch (err) {
      record.publish = { ...record.publish, state: 'failed', error: errorText(err), at: this.deps.now() };
      await this.saveQuietly(record);
      return { ok: false, error: record.publish.error! };
    }
  }
}
