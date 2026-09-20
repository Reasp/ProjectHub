import { describe, expect, it } from 'vitest';
import {
  applyRollbackMarks,
  buildLoopContinuationPrompt,
  continueModeOf,
  doneLoopContinueBlockReason,
  formatIndexRanges,
  handoffRewindBlockReason,
  invalidatedStage,
  iterationInSegment,
  loopSegmentNumber,
  loopSegmentStart,
  normalizeInstruction,
  planHandoffRerun,
  rollbackMarkFor,
  stagesInvalidatedBy,
  uncheckHarnessCriteria
} from '../../electron/services/rewindContinuation';
import type { DoneLoopIteration, DoneLoopSettings } from '../../electron/services/doneLoopTypes';
import type { HandoffStageState, SwarmContinuation } from '../../electron/services/swarmTypes';

const iter = (index: number, run?: number, extra: Partial<DoneLoopIteration> = {}): DoneLoopIteration => ({
  index,
  startedAt: index,
  checks: [],
  criteria: [],
  reportFound: true,
  ...(run !== undefined ? { run } : {}),
  ...extra
});

const settings: DoneLoopSettings = { maxIterations: 3, checks: [], autoReview: true };

const stage = (i: number, status: HandoffStageState['status'], extra: Partial<HandoffStageState> = {}): HandoffStageState => ({
  stageIndex: i,
  role: `role${i + 1}`,
  agentId: `a${i + 1}`,
  status,
  inputPrompt: 'p',
  ...extra
});

describe('rewindContinuation: цикл «до готовности» (decision-48 п. 2)', () => {
  it('режим продолжения выводится из режима сессии', () => {
    expect(continueModeOf('fan_out')).toBe('agent');
    expect(continueModeOf('done_loop')).toBe('loop');
    expect(continueModeOf('handoff')).toBe('handoff');
  });

  it('пометка итерации по чекпоинту: позже — целиком, свой запуск — по виду чекпоинта', () => {
    expect(rollbackMarkFor(3, { run: 2, kind: 'end' })).toBe('full');
    expect(rollbackMarkFor(1, { run: 2, kind: 'start' })).toBeUndefined();
    expect(rollbackMarkFor(2, { run: 2, kind: 'start' })).toBe('full');
    expect(rollbackMarkFor(2, { run: 2, kind: 'turn' })).toBe('partial');
    expect(rollbackMarkFor(2, { run: 2, kind: 'end' })).toBeUndefined();
    expect(rollbackMarkFor(2, { run: 2, kind: 'pre_rewind' })).toBeUndefined();
    // старые сессии без номера запуска и чекпоинты без run — без пометок
    expect(rollbackMarkFor(undefined, { run: 1, kind: 'start' })).toBeUndefined();
    expect(rollbackMarkFor(2, { kind: 'start' })).toBeUndefined();
  });

  it('пометки пересчитываются целиком: отмена отката снимает прежние', () => {
    const its = [iter(1, 1), iter(2, 2), iter(3, 3)];
    const afterTurn1 = applyRollbackMarks(its, { run: 1, kind: 'turn' });
    expect(afterTurn1.map((i) => i.rolledBack)).toEqual(['partial', 'full', 'full']);
    // «отмена отката» — к pre_rewind после третьего запуска: снова всё в силе
    const undo = applyRollbackMarks(afterTurn1, { run: 3, kind: 'pre_rewind' });
    expect(undo.map((i) => i.rolledBack)).toEqual([undefined, undefined, undefined]);
    expect('rolledBack' in undo[0]).toBe(false);
    // исходный массив не меняется
    expect(its.every((i) => i.rolledBack === undefined)).toBe(true);
  });

  it('отрезки цикла: начало, номер и номер итерации внутри отрезка', () => {
    const conts: SwarmContinuation[] = [
      { at: 1, mode: 'loop', agentId: 'a', afterIteration: 2 },
      { at: 2, mode: 'agent', agentId: 'b' },
      { at: 3, mode: 'loop', agentId: 'a', afterIteration: 5 }
    ];
    expect(loopSegmentStart(undefined)).toBe(0);
    expect(loopSegmentStart(conts)).toBe(5);
    expect(loopSegmentNumber(conts)).toBe(2);
    expect(iterationInSegment(6, 5)).toBe(1);
    expect(iterationInSegment(3, 0)).toBe(3);
  });

  it('продолжение цикла требует отката и не превышает бюджет', () => {
    expect(doneLoopContinueBlockReason({ state: undefined, hasPendingRewind: true })).toMatch(/повреждена/);
    expect(doneLoopContinueBlockReason({ state: { settings }, hasPendingRewind: false })).toMatch(/после отката/);
    expect(doneLoopContinueBlockReason({ state: { settings, totalCostUsd: 5 }, hasPendingRewind: true })).toBeUndefined();
    const budget = { settings: { ...settings, budgetUsd: 1 }, totalCostUsd: 1 };
    expect(doneLoopContinueBlockReason({ state: budget, hasPendingRewind: true })).toMatch(/Бюджет цикла \$1\.00 исчерпан/);
    expect(doneLoopContinueBlockReason({ state: { ...budget, totalCostUsd: 0.4 }, hasPendingRewind: true })).toBeUndefined();
  });

  it('промпт первой итерации отрезка: задача, отменённые итерации, уточнение, пояснение', () => {
    expect(formatIndexRanges([4, 2, 3, 7])).toBe('2–4, 7');
    const prompt = buildLoopContinuationPrompt({
      basePrompt: 'Сделай файлы',
      iterations: [iter(1, 1, { rolledBack: 'partial' }), iter(2, 2, { rolledBack: 'full' }), iter(3, 3, { rolledBack: 'full' })],
      instruction: 'только one.txt',
      note: '[ProjectHub] Рабочий каталог откатён'
    });
    expect(prompt.startsWith('Сделай файлы\n\n[ProjectHub Done-loop] Цикл продолжен после отката')).toBe(true);
    expect(prompt).toContain('итерации 2–3 отменены откатом, итерация 1 отменена частично');
    expect(prompt).toContain('```projecthub-report```');
    expect(prompt).toContain('Уточнение пользователя: только one.txt');
    expect(prompt.endsWith('[ProjectHub] Рабочий каталог откатён')).toBe(true);
    // без пометок и уточнения — только задача и блок
    const plain = buildLoopContinuationPrompt({ basePrompt: 'x', iterations: [iter(1)] });
    expect(plain.split('\n\n')).toHaveLength(2);
    expect(plain).toContain('Цикл продолжен после отката. ');
  });

  it('уточнение обрезается и ограничивается', () => {
    expect(normalizeInstruction('  да  ')).toBe('да');
    expect(normalizeInstruction(42)).toBe('');
    expect(normalizeInstruction('я'.repeat(5000))).toHaveLength(4000);
  });

  it('снимаются только отметки цикла и только у неизменённых критериев', () => {
    const body = ['## Acceptance Criteria', '<!-- AC:BEGIN -->', '- [x] #1 Первый', '- [x] #2 Второй изменён', '- [x] #3 Третий', '<!-- AC:END -->', ''].join('\n');
    const baseline = [{ text: 'Первый' }, { text: 'Второй' }, { text: 'Третий' }];
    const res = uncheckHarnessCriteria(body, [1, 2], baseline);
    expect(res!.unchecked).toEqual([1]);
    expect(res!.content).toContain('- [ ] #1 Первый');
    expect(res!.content).toContain('- [x] #2 Второй изменён');
    // #3 был отмечен до цикла — не трогаем
    expect(res!.content).toContain('- [x] #3 Третий');
    expect(uncheckHarnessCriteria(res!.content, [1], baseline)).toBeNull();
  });
});

describe('rewindContinuation: handoff (decision-48 п. 3)', () => {
  it('откат этапа запрещён, пока предыдущий не выполнен', () => {
    const stages = [stage(0, 'completed'), stage(1, 'pending', { invalidatedAt: 1 }), stage(2, 'pending')];
    expect(handoffRewindBlockReason(stages, 0)).toBeUndefined();
    expect(handoffRewindBlockReason(stages, 1)).toBeUndefined();
    expect(handoffRewindBlockReason(stages, 2)).toMatch(/Этап 2 \(«role2»\) не выполнен/);
    expect(handoffRewindBlockReason(undefined, 3)).toBeUndefined();
  });

  it('откат этапа отменяет его и все последующие; результат очищается', () => {
    const stages = [stage(0, 'completed'), stage(1, 'completed'), stage(2, 'completed')];
    expect(stagesInvalidatedBy(stages, 1)).toEqual([1, 2]);
    expect(stagesInvalidatedBy(stages, -1)).toEqual([]);
    const inv = invalidatedStage(
      stage(1, 'completed', { outputResult: 'o', summary: 's', reportPath: 'r', commitHash: 'c', durationMs: 5, rerunCount: 1, instructions: 'i' }),
      99
    );
    expect(inv).toEqual({ stageIndex: 1, role: 'role2', agentId: 'a2', status: 'pending', inputPrompt: 'p', rerunCount: 1, instructions: 'i', invalidatedAt: 99 });
  });

  it('перезапуск — с откатанного этапа до конца, только после отката', () => {
    const stages = [stage(0, 'completed'), stage(1, 'pending', { invalidatedAt: 1 }), stage(2, 'pending', { invalidatedAt: 1 })];
    const agents = [{ id: 'a1' }, { id: 'a2', pendingRewindNote: 'note' }, { id: 'a3' }];
    expect(planHandoffRerun(stages, agents, 'a2')).toEqual({ fromStage: 1, stages: [1, 2] });
    expect(planHandoffRerun(stages, agents, 'a3')).toMatchObject({ error: expect.stringMatching(/после отката его агента/) });
    expect(planHandoffRerun(stages, agents, 'zz')).toMatchObject({ error: expect.stringMatching(/ни к одному этапу/) });
    expect(planHandoffRerun([], agents, 'a1')).toMatchObject({ error: expect.stringMatching(/нет этапов/) });
    // предыдущий этап не выполнен — перезапуск с этого этапа запрещён
    const broken = [stage(0, 'failed'), stage(1, 'pending')];
    expect(planHandoffRerun(broken, agents, 'a2')).toMatchObject({ error: expect.stringMatching(/Этап 1/) });
  });
});
