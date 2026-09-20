/**
 * Представление продолжения после отката (TASK-102, decision-48 п. 6): какой агент ждёт продолжения,
 * подписи кнопок и тексты подтверждения по режиму, итерации текущего отрезка цикла. Без React и Electron.
 * Доступность окончательно проверяет main-процесс (`swarm:getTimeline`, `swarm:continueAgent`).
 */
import type { AgentSlotState, ContinueMode, DoneLoopIteration, SwarmSession } from '../types/electron';

export interface ContinueTexts {
  continueButton: string;
  continueLoopButton: string;
  continueHandoffButton: string;
  continuePromptTitle: string;
  continuePromptMessage: string;
  continueLoopPromptTitle: string;
  continueLoopPromptMessage: string;
  continueHandoffPromptTitle: string;
  continueHandoffPromptMessage: string;
}

export interface PendingContinue {
  agent: AgentSlotState;
  mode: ContinueMode;
  /** Handoff: этап (0-based), с которого пойдёт перезапуск. */
  fromStage?: number;
}

const ACTIVE_AGENT = new Set(['pending', 'preparing', 'running']);

/**
 * Агент цикла или конвейера, откатанный и ещё не продолжённый, — для кнопки в заголовке сессии.
 * У fan-out продолжение — в карточке агента, баннер не нужен.
 */
export function pendingContinueAgent(session: SwarmSession): PendingContinue | null {
  if (session.mode === 'fan_out') return null;
  if (session.status === 'running' || session.status === 'preparing' || session.status === 'interrupted') return null;
  const candidates = session.agents.filter((a) => a.pendingRewindNote && !ACTIVE_AGENT.has(a.status));
  if (candidates.length === 0) return null;
  if (session.mode === 'done_loop') return { agent: candidates[0], mode: 'loop' };
  const stageOf = (a: AgentSlotState) => session.handoffStages?.findIndex((s) => s.agentId === a.id) ?? -1;
  const withStage = candidates.map((a) => ({ a, stage: stageOf(a) })).filter((c) => c.stage >= 0);
  if (withStage.length === 0) return null;
  withStage.sort((x, y) => x.stage - y.stage);
  return { agent: withStage[0].a, mode: 'handoff', fromStage: withStage[0].stage };
}

/** Итерации текущего отрезка цикла: после последнего продолжения — для полосы прогресса. */
export function currentSegmentIterations(session: SwarmSession): DoneLoopIteration[] {
  const iterations = session.doneLoop?.iterations ?? [];
  const loops = (session.continuations ?? []).filter((c) => c.mode === 'loop');
  const start = loops.length > 0 ? loops[loops.length - 1].afterIteration ?? 0 : 0;
  return iterations.filter((it) => it.index > start);
}

/** Номера этапов (1-based), которые перезапустит конвейер. */
export function rerunStageNumbers(session: SwarmSession, fromStage: number): number[] {
  const total = session.handoffStages?.length ?? 0;
  return fromStage < 0 ? [] : Array.from({ length: Math.max(0, total - fromStage) }, (_, i) => fromStage + i + 1);
}

export function formatStageList(numbers: number[]): string {
  if (numbers.length === 0) return '';
  if (numbers.length === 1) return String(numbers[0]);
  return `${numbers[0]}–${numbers[numbers.length - 1]}`;
}

export function continueButtonText(mode: ContinueMode, fromStage: number | undefined, tt: ContinueTexts): string {
  if (mode === 'loop') return tt.continueLoopButton;
  if (mode === 'handoff') return tt.continueHandoffButton.replace('{n}', String((fromStage ?? 0) + 1));
  return tt.continueButton;
}

export function continueDialogText(
  mode: ContinueMode,
  session: SwarmSession,
  fromStage: number | undefined,
  tt: ContinueTexts
): { title: string; message: string } {
  if (mode === 'loop') {
    const loop = session.doneLoop;
    const next = (loop?.iterations.length ?? 0) + 1;
    return {
      title: tt.continueLoopPromptTitle,
      message: tt.continueLoopPromptMessage
        .replace('{next}', String(next))
        .replace('{max}', String(loop?.settings.maxIterations ?? 0))
    };
  }
  if (mode === 'handoff') {
    return {
      title: tt.continueHandoffPromptTitle,
      message: tt.continueHandoffPromptMessage.replace('{stages}', formatStageList(rerunStageNumbers(session, fromStage ?? 0)))
    };
  }
  return { title: tt.continuePromptTitle, message: tt.continuePromptMessage };
}
