/**
 * Подписи и сводки цикла «до готовности» для UI (TASK-75). Чистые функции — покрыты unit-тестами.
 */
import type { TranslationDictionary } from '../i18n/types';
import type { CheckStatus, DoneLoopIteration, DoneLoopOutcome, DoneLoopPhase } from '../types/electron';

type DoneLoopDictionary = TranslationDictionary['doneLoop'];

export function doneLoopPhaseLabel(phase: DoneLoopPhase, t: DoneLoopDictionary): string {
  switch (phase) {
    case 'running_agent':
      return t.phaseRunningAgent;
    case 'checking':
      return t.phaseChecking;
    case 'verifying':
      return t.phaseVerifying;
    case 'finished':
      return t.phaseFinished;
    case 'failed':
      return t.phaseFailed;
    case 'stopped':
      return t.phaseStopped;
    default:
      return phase;
  }
}

export function doneLoopOutcomeLabel(outcome: DoneLoopOutcome, t: DoneLoopDictionary): string {
  switch (outcome) {
    case 'success':
      return t.outcomeSuccess;
    case 'iteration_limit':
      return t.outcomeIterationLimit;
    case 'budget':
      return t.outcomeBudget;
    case 'agent_error':
      return t.outcomeAgentError;
    case 'task_error':
      return t.outcomeTaskError;
    case 'stopped':
      return t.outcomeStopped;
    default:
      return outcome;
  }
}

/** Цикл ещё работает (фаза не терминальная). */
export function isActiveDoneLoopPhase(phase: DoneLoopPhase): boolean {
  return phase === 'running_agent' || phase === 'checking' || phase === 'verifying';
}

const FAILED_CHECK_STATUSES: CheckStatus[] = ['failed', 'timeout', 'error'];

export interface IterationStats {
  checksPassed: number;
  checksFailed: number;
  checksTotal: number;
  criteriaAccepted: number;
  criteriaTotal: number;
}

export function iterationStats(iteration: DoneLoopIteration): IterationStats {
  return {
    checksPassed: iteration.checks.filter((c) => c.status === 'passed').length,
    checksFailed: iteration.checks.filter((c) => FAILED_CHECK_STATUSES.includes(c.status)).length,
    checksTotal: iteration.checks.length,
    criteriaAccepted: iteration.criteria.filter((c) => c.accepted).length,
    criteriaTotal: iteration.criteria.length
  };
}

/** Цвет сегмента прогресса итерации: принята, повтор, провал, идёт. */
export function iterationTone(iteration: DoneLoopIteration | undefined): 'success' | 'retry' | 'failed' | 'running' | 'pending' {
  if (!iteration) return 'pending';
  if (!iteration.finishedAt) return 'running';
  if (iteration.decision === 'finish') return 'success';
  if (iteration.decision === 'retry') return 'retry';
  return 'failed';
}
