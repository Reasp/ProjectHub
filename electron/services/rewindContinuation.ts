/**
 * Продолжение после отката в цикле «до готовности» и перезапуск этапов handoff (TASK-102, decision-48).
 *
 * Чистый модуль без Electron и git: доступность продолжения, пометка итераций, отменённых откатом,
 * отрезки цикла, промпт первой итерации отрезка, инвалидация и перезапуск этапов конвейера.
 * Сервис флота только исполняет эти планы.
 */
import { REPORT_FENCE } from './doneLoop.js';
import { parseTaskBody, toggleCriterionInContent } from './backlogTaskFormat.js';
import type { AgentCheckpoint } from './agentTraceTypes.js';
import type { DoneLoopIteration, DoneLoopState } from './doneLoopTypes.js';
import type { ContinueMode, HandoffStageState, SwarmContinuation, SwarmMode } from './swarmTypes.js';

/** Максимальная длина уточнения человека в промпте продолжения. */
export const CONTINUE_INSTRUCTION_LIMIT = 4000;

export function continueModeOf(mode: SwarmMode): ContinueMode {
  if (mode === 'done_loop') return 'loop';
  if (mode === 'handoff') return 'handoff';
  return 'agent';
}

/** Уточнение человека: обрезка и лимит; пустая строка — уточнения нет. */
export function normalizeInstruction(instruction: unknown): string {
  return typeof instruction === 'string' ? instruction.trim().slice(0, CONTINUE_INSTRUCTION_LIMIT) : '';
}

export function instructionBlock(instruction: string): string {
  return instruction ? `[ProjectHub] Уточнение пользователя: ${instruction}` : '';
}

// ───────────────────────────── Цикл «до готовности» ─────────────────────────────

/**
 * Отмена итерации откатом к чекпоинту (decision-48 п. 2.2): итерации позже запуска чекпоинта — целиком,
 * итерация самого запуска — целиком для `start`, частично для `turn`; `end` и `pre_rewind` — состояние после
 * запуска, его итерация остаётся в силе. Без номеров запусков (старые сессии) — не помечаем.
 */
export function rollbackMarkFor(
  iterationRun: number | undefined,
  checkpoint: Pick<AgentCheckpoint, 'run' | 'kind'>
): 'full' | 'partial' | undefined {
  if (iterationRun === undefined || checkpoint.run === undefined) return undefined;
  if (iterationRun > checkpoint.run) return 'full';
  if (iterationRun < checkpoint.run) return undefined;
  if (checkpoint.kind === 'start') return 'full';
  if (checkpoint.kind === 'turn') return 'partial';
  return undefined;
}

/** Пометки всех итераций пересчитываются заново — так же работает и «отмена отката» через `pre_rewind`. */
export function applyRollbackMarks(
  iterations: DoneLoopIteration[],
  checkpoint: Pick<AgentCheckpoint, 'run' | 'kind'>
): DoneLoopIteration[] {
  return iterations.map((it) => {
    const mark = rollbackMarkFor(it.run, checkpoint);
    const { rolledBack: _previous, ...rest } = it;
    return mark ? { ...rest, rolledBack: mark } : rest;
  });
}

/** Сколько итераций было до текущего отрезка цикла (последнее продолжение цикла). */
export function loopSegmentStart(continuations: SwarmContinuation[] | undefined): number {
  const loops = (continuations ?? []).filter((c) => c.mode === 'loop');
  return loops.length > 0 ? loops[loops.length - 1].afterIteration ?? 0 : 0;
}

/** Номер текущего отрезка: 0 — исходный запуск. */
export function loopSegmentNumber(continuations: SwarmContinuation[] | undefined): number {
  return (continuations ?? []).filter((c) => c.mode === 'loop').length;
}

/** Номер итерации внутри отрезка — его получают `decideNext` и промпт повтора. */
export function iterationInSegment(index: number, segmentStart: number): number {
  return Math.max(1, index - segmentStart);
}

/** Почему нельзя продолжить цикл; `undefined` — можно (decision-48 п. 2.1). Общие проверки сессии — в сервисе. */
export function doneLoopContinueBlockReason(input: {
  state: Pick<DoneLoopState, 'totalCostUsd' | 'settings'> | undefined;
  hasPendingRewind: boolean;
}): string | undefined {
  if (!input.state) return 'Сессия «до готовности» повреждена: нет состояния цикла';
  if (!input.hasPendingRewind) return 'Продолжить цикл можно после отката к чекпоинту; без отката запустите цикл заново';
  const budget = input.state.settings.budgetUsd;
  const spent = input.state.totalCostUsd;
  if (typeof budget === 'number' && budget > 0 && typeof spent === 'number' && spent >= budget) {
    return `Бюджет цикла $${budget.toFixed(2)} исчерпан (потрачено $${spent.toFixed(2)}): продолжение невозможно, запустите цикл заново с большим бюджетом`;
  }
  return undefined;
}

/** «2», «2–3», «1, 3–4» — номера итераций для текста. */
export function formatIndexRanges(indexes: number[]): string {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? String(sorted[i]) : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return parts.join(', ');
}

/**
 * Промпт первой итерации отрезка (decision-48 п. 2.4): исходная задача, что отменено откатом, уточнение.
 * Пояснение об откате (к какому ходу) добавляет `runSingleAgent`, либо `note` при пересборке после перезапуска.
 */
export function buildLoopContinuationPrompt(input: {
  basePrompt: string;
  iterations: DoneLoopIteration[];
  instruction?: string;
  note?: string;
}): string {
  const full = input.iterations.filter((it) => it.rolledBack === 'full').map((it) => it.index);
  const partial = input.iterations.filter((it) => it.rolledBack === 'partial').map((it) => it.index);
  const cancelled: string[] = [];
  const many = (n: number) => (n > 1 ? ['итерации', 'отменены'] : ['итерация', 'отменена']);
  if (full.length > 0) cancelled.push(`${many(full.length)[0]} ${formatIndexRanges(full)} ${many(full.length)[1]} откатом`);
  if (partial.length > 0) cancelled.push(`${many(partial.length)[0]} ${formatIndexRanges(partial)} ${many(partial.length)[1]} частично`);
  const block =
    `[ProjectHub Done-loop] Цикл продолжен после отката${cancelled.length ? `: ${cancelled.join(', ')}` : ''}. ` +
    'Результаты прошлых проверок к текущим файлам не относятся: проверки проекта и критерии приёмки будут сверены заново. ' +
    `В конце хода выведи отчёт в ограде \`\`\`${REPORT_FENCE}\`\`\` по всем критериям.`;
  return [input.basePrompt, block, instructionBlock(input.instruction ?? ''), input.note ?? ''].filter(Boolean).join('\n\n');
}

/**
 * Снять отметки критериев, поставленные циклом при прошлом успехе (decision-48 п. 2.5): только те, что цикл
 * отметил сам, и только если текст критерия не менялся с начала цикла. `null` — менять нечего.
 */
export function uncheckHarnessCriteria(
  content: string,
  checked: number[],
  baseline: Array<{ text: string }> | undefined
): { content: string; unchecked: number[] } | null {
  let body = content;
  const unchecked: number[] = [];
  const current = parseTaskBody(body).criteria;
  for (const index of checked) {
    const now = current[index - 1];
    if (!now || !now.completed) continue;
    if (baseline && baseline[index - 1]?.text !== now.text) continue;
    const updated = toggleCriterionInContent(body, index - 1, false);
    if (updated !== null) {
      body = updated;
      unchecked.push(index);
    }
  }
  return unchecked.length > 0 ? { content: body, unchecked } : null;
}

export function cancelledSummaryText(checkpointN: number | undefined, at: Date): string {
  return (
    `Итог цикла «до готовности» отменён откатом${checkpointN !== undefined ? ` к чекпоинту #${checkpointN}` : ''} ` +
    `(${at.toISOString()}); цикл продолжен, отметки критериев сняты до нового результата.`
  );
}

// ───────────────────────────── Handoff ─────────────────────────────

export function stageIndexOfAgent(stages: HandoffStageState[] | undefined, agentId: string): number {
  return (stages ?? []).findIndex((s) => s.agentId === agentId);
}

/**
 * Откат этапа запрещён, пока предыдущий этап не выполнен или отменён более ранним откатом (decision-48 п. 3.2):
 * чекпоинты такого этапа описывают отменённое «будущее» общего worktree.
 */
export function handoffRewindBlockReason(stages: HandoffStageState[] | undefined, stageIndex: number): string | undefined {
  if (!stages || stageIndex < 0) return undefined;
  for (let i = 0; i < stageIndex; i++) {
    const s = stages[i];
    if (s.status !== 'completed') {
      return `Этап ${i + 1} («${s.role}») не выполнен или отменён более ранним откатом — сначала перезапустите конвейер`;
    }
  }
  return undefined;
}

/** Этапы, чей результат отменяет откат агента этапа `stageIndex`: он сам и все последующие (общий worktree). */
export function stagesInvalidatedBy(stages: HandoffStageState[] | undefined, stageIndex: number): number[] {
  if (!stages || stageIndex < 0) return [];
  return stages.slice(stageIndex).map((s) => s.stageIndex);
}

/** Этап после инвалидации: результат описывает удалённые коммиты и файлы. */
export function invalidatedStage(stage: HandoffStageState, at: number): HandoffStageState {
  const { outputResult: _o, summary: _s, reportPath: _r, commitHash: _c, durationMs: _d, ...rest } = stage;
  return { ...rest, status: 'pending', invalidatedAt: at };
}

export type HandoffRerunPlan = { fromStage: number; stages: number[] } | { error: string };

/**
 * Перезапуск конвейера после отката (decision-48 п. 3.3): с этапа, чей агент откатан и ещё не продолжен,
 * до конца. Только откатанный этап без последующих не предусмотрен: их работу откат уже удалил.
 */
export function planHandoffRerun(
  stages: HandoffStageState[] | undefined,
  agents: Array<{ id: string; pendingRewindNote?: string }>,
  agentId: string
): HandoffRerunPlan {
  if (!stages || stages.length === 0) return { error: 'У сессии нет этапов конвейера' };
  const fromStage = stageIndexOfAgent(stages, agentId);
  if (fromStage < 0) return { error: 'Агент не относится ни к одному этапу конвейера' };
  const agent = agents.find((a) => a.id === agentId);
  if (!agent?.pendingRewindNote) {
    return { error: 'Перезапустить этап можно после отката его агента к чекпоинту' };
  }
  const blocked = handoffRewindBlockReason(stages, fromStage);
  if (blocked) return { error: blocked };
  return { fromStage, stages: stages.slice(fromStage).map((s) => s.stageIndex) };
}
