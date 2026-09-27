/**
 * IPC ревью PR для UI (TASK-81, decision-53): список ревью PR, ручной запуск (человек у экрана),
 * публикация комментария кнопкой. Путь проекта проверяется по реестру (decision-5 п. 2).
 */
import { ipcMain } from 'electron';
import type { IpcContext } from './types';
import { assertRegisteredProject } from '../services/projectPathGuard';
import { prReviewService } from '../services/prReviewApp';
import { DEFAULT_MANUAL_REVIEW_BUDGET_USD } from '../services/prReviewService';
import { MAX_PR_REVIEWERS } from '../services/automationRules';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerPrReviewIpc(ctx: IpcContext) {
  let pending: NodeJS.Timeout | null = null;
  prReviewService.onChange(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const win = ctx.getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('prReview:changed');
    }, 200);
  });

  ipcMain.handle('prReview:list', async (_event, projectPath: unknown, prNumber?: unknown) => {
    try {
      const root = await assertRegisteredProject(String(projectPath ?? ''));
      return { ok: true, reviews: await prReviewService.list(root, typeof prNumber === 'number' ? prNumber : undefined) };
    } catch (err) {
      return { ok: false, error: errorText(err), reviews: [] };
    }
  });

  ipcMain.handle('prReview:start', async (_event, projectPath: unknown, prNumber: unknown, options: unknown) => {
    try {
      const root = await assertRegisteredProject(String(projectPath ?? ''));
      const o = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>;
      const reviewers = Array.isArray(o.reviewers) ? o.reviewers.map(String).filter(Boolean).slice(0, MAX_PR_REVIEWERS) : [];
      const budget = typeof o.budgetUsd === 'number' && o.budgetUsd > 0 ? o.budgetUsd : DEFAULT_MANUAL_REVIEW_BUDGET_USD;
      const res = await prReviewService.start({
        projectPath: root,
        prNumber: Number(prNumber),
        reviewers,
        ...(typeof o.verifier === 'string' && o.verifier ? { verifier: o.verifier } : {}),
        budgetUsd: budget,
        publish: o.publish === 'manual' ? 'manual' : 'hitl',
        origin: 'manual',
        force: o.force === true
      });
      if ('error' in res) return { ok: false, error: res.error };
      if ('skipped' in res) return { ok: false, error: res.skipped };
      return { ok: true, reviewId: res.reviewId };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  });

  ipcMain.handle('prReview:publish', async (_event, projectPath: unknown, reviewId: unknown) => {
    try {
      const root = await assertRegisteredProject(String(projectPath ?? ''));
      return await prReviewService.publishNow(root, String(reviewId ?? ''));
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  });
}
