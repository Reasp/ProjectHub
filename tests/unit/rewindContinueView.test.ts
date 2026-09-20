import { describe, expect, it } from 'vitest';
import {
  continueButtonText,
  continueDialogText,
  currentSegmentIterations,
  formatStageList,
  pendingContinueAgent,
  rerunStageNumbers,
  type ContinueTexts
} from '../../src/lib/rewindContinueView';
import type { AgentSlotState, DoneLoopIteration, SwarmSession } from '../../src/types/electron';
import { en } from '../../src/i18n/en';
import { ru } from '../../src/i18n/ru';

const agent = (id: string, status: AgentSlotState['status'], note?: string): AgentSlotState =>
  ({
    id,
    config: { id, name: id.toUpperCase(), engine: 'api' },
    status,
    logs: [],
    liveOutput: '',
    metrics: { startTime: 0 },
    ...(note ? { pendingRewindNote: note } : {})
  }) as AgentSlotState;

const iter = (index: number): DoneLoopIteration => ({ index, startedAt: index, checks: [], criteria: [], reportFound: true });

const base = (extra: Partial<SwarmSession>): SwarmSession =>
  ({
    id: 's',
    projectPath: 'p',
    mode: 'fan_out',
    prompt: 'x',
    baseBranch: 'main',
    useWorktrees: true,
    status: 'completed',
    createdAt: 0,
    agents: [],
    ...extra
  }) as SwarmSession;

const handoff = base({
  mode: 'handoff',
  agents: [agent('a1', 'completed'), agent('a2', 'completed', 'note'), agent('a3', 'pending')],
  handoffStages: ['r1', 'r2', 'r3'].map((role, i) => ({ stageIndex: i, role, agentId: `a${i + 1}`, status: i === 0 ? 'completed' : 'pending', inputPrompt: '' }))
});

const loop = base({
  mode: 'done_loop',
  status: 'failed',
  agents: [agent('dl', 'completed', 'note')],
  doneLoop: {
    settings: { maxIterations: 3, checks: [], autoReview: true },
    phase: 'failed',
    currentIteration: 4,
    iterations: [iter(1), iter(2), iter(3), iter(4)]
  },
  continuations: [{ at: 1, mode: 'loop', agentId: 'dl', afterIteration: 3 }]
});

describe('rewindContinueView (decision-48 п. 6)', () => {
  it('агент, ждущий продолжения: цикл и конвейер, но не fan-out и не активная сессия', () => {
    expect(pendingContinueAgent(loop)).toMatchObject({ mode: 'loop', agent: { id: 'dl' } });
    expect(pendingContinueAgent(handoff)).toMatchObject({ mode: 'handoff', fromStage: 1, agent: { id: 'a2' } });
    expect(pendingContinueAgent({ ...handoff, status: 'running' })).toBeNull();
    expect(pendingContinueAgent({ ...loop, status: 'interrupted' })).toBeNull();
    expect(pendingContinueAgent(base({ agents: [agent('f', 'completed', 'note')] }))).toBeNull();
    expect(pendingContinueAgent({ ...loop, agents: [agent('dl', 'completed')] })).toBeNull();
  });

  it('итерации текущего отрезка и номера перезапускаемых этапов', () => {
    expect(currentSegmentIterations(loop).map((i) => i.index)).toEqual([4]);
    expect(currentSegmentIterations({ ...loop, continuations: undefined })).toHaveLength(4);
    expect(rerunStageNumbers(handoff, 1)).toEqual([2, 3]);
    expect(formatStageList([2, 3])).toBe('2–3');
    expect(formatStageList([3])).toBe('3');
  });

  it('подписи и тексты по режиму в ru и en', () => {
    for (const dict of [ru, en]) {
      const tt: ContinueTexts = dict.agentTimeline;
      expect(continueButtonText('agent', undefined, tt)).toBe(tt.continueButton);
      expect(continueButtonText('loop', undefined, tt)).toBe(tt.continueLoopButton);
      expect(continueButtonText('handoff', 1, tt)).toMatch(/2/);
      const l = continueDialogText('loop', loop, undefined, tt);
      expect(l.title).toBe(tt.continueLoopPromptTitle);
      expect(l.message).toContain('5');
      expect(l.message).not.toMatch(/\{next\}|\{max\}/);
      const h = continueDialogText('handoff', handoff, 1, tt);
      expect(h.message).toContain('2–3');
      expect(continueDialogText('agent', handoff, undefined, tt).title).toBe(tt.continuePromptTitle);
    }
    expect(continueButtonText('handoff', 1, ru.agentTimeline)).toBe('Перезапустить с этапа 2');
  });
});
