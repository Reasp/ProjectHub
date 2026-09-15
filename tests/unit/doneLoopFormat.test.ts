import { describe, it, expect } from 'vitest';
import { ru } from '../../src/i18n/ru';
import { en } from '../../src/i18n/en';
import {
  doneLoopOutcomeLabel,
  doneLoopPhaseLabel,
  isActiveDoneLoopPhase,
  iterationStats,
  iterationTone
} from '../../src/utils/doneLoopFormat';
import type { DoneLoopIteration } from '../../src/types/electron';

const iteration = (over: Partial<DoneLoopIteration> = {}): DoneLoopIteration => ({
  index: 1,
  startedAt: 1,
  checks: [],
  criteria: [],
  reportFound: true,
  ...over
});

describe('doneLoopFormat (TASK-75)', () => {
  it('подписи фаз и исходов есть на обоих языках', () => {
    expect(doneLoopPhaseLabel('checking', ru.doneLoop)).toBe('Проверки');
    expect(doneLoopPhaseLabel('checking', en.doneLoop)).toBe('Checks');
    expect(doneLoopOutcomeLabel('iteration_limit', ru.doneLoop)).toBe('Исчерпан лимит итераций');
    expect(doneLoopOutcomeLabel('budget', en.doneLoop)).toBe('Budget exhausted');
  });

  it('активные фазы', () => {
    expect(isActiveDoneLoopPhase('verifying')).toBe(true);
    expect(isActiveDoneLoopPhase('finished')).toBe(false);
  });

  it('сводка итерации считает упавшие проверки и засчитанные критерии', () => {
    const stats = iterationStats(
      iteration({
        checks: [
          { id: 'a', kind: 'lint', name: 'Lint', command: 'x', status: 'passed', blocking: true },
          { id: 'b', kind: 'test', name: 'Tests', command: 'y', status: 'timeout', blocking: true },
          { id: 'c', kind: 'build', name: 'Build', command: 'z', status: 'skipped', blocking: true }
        ],
        criteria: [
          { index: 1, text: 'a', accepted: true },
          { index: 2, text: 'b', accepted: false }
        ]
      })
    );
    expect(stats).toEqual({ checksPassed: 1, checksFailed: 1, checksTotal: 3, criteriaAccepted: 1, criteriaTotal: 2 });
  });

  it('тон сегмента прогресса', () => {
    expect(iterationTone(undefined)).toBe('pending');
    expect(iterationTone(iteration())).toBe('running');
    expect(iterationTone(iteration({ finishedAt: 2, decision: 'retry' }))).toBe('retry');
    expect(iterationTone(iteration({ finishedAt: 2, decision: 'finish' }))).toBe('success');
    expect(iterationTone(iteration({ finishedAt: 2, decision: 'fail' }))).toBe('failed');
  });
});
