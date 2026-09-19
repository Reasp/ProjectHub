import { describe, expect, it } from 'vitest';
import { createStudioToolCallbacks, STUDIO_STATUS_PROCESSING, type StudioToolChunk } from '../../electron/services/studioToolAdapter';
import { upsertToolCall } from '../../src/lib/aiToolCalls';
import type { AIToolCall } from '../../electron/services/aiAgentService';
import type { HitlRequest } from '../../electron/services/hitlTypes';

/** Адаптер чата AI Studio для общего исполнителя (TASK-103, decision-47 п. 1, 7). */

function harness(opts: { pending?: () => boolean; active?: () => boolean } = {}) {
  const chunks: StudioToolChunk[] = [];
  const statuses: Array<[string, string, boolean]> = [];
  const cb = createStudioToolCallbacks({
    emit: (c) => chunks.push(c),
    setStatus: (status, message, pending) => statuses.push([status, message, Boolean(pending)]),
    hasPendingApprovals: opts.pending ?? (() => false),
    isSessionActive: opts.active ?? (() => true)
  });
  return { cb, chunks, statuses };
}

const writeRequest: HitlRequest = {
  id: 'req-1',
  sessionId: 's',
  projectPath: '/p',
  type: 'file_write',
  title: 'Запись файла: a.txt',
  filePath: 'a.txt',
  diff: { filePath: 'a.txt', oldContent: '', newContent: 'A', patch: '+A' },
  createdAt: 1
};

describe('studioToolAdapter', () => {
  it('карточка записи: approvalRequest вместе с вызовом и диффом, статус waiting_approval', () => {
    const { cb, chunks, statuses } = harness();
    const call: AIToolCall = { id: 'c1', name: 'write_file', args: { filePath: 'a.txt' }, status: 'pending' };
    cb.onApprovalRequest(writeRequest, call);
    expect(chunks).toEqual([{ approvalRequest: writeRequest, toolCall: { ...call, diff: writeRequest.diff } }]);
    expect(call.diff).toEqual(writeRequest.diff);
    expect(statuses).toEqual([['waiting_approval', 'Запись файла: a.txt', true]]);
  });

  it('карточки без вызова (прокси computer_*) и не-записи — только approvalRequest', () => {
    const { cb, chunks } = harness();
    const question: HitlRequest = { ...writeRequest, id: 'req-2', type: 'question', diff: undefined };
    cb.onApprovalRequest(question, { id: 'c2', name: 'ask_question', args: {} });
    cb.onApprovalRequest(writeRequest);
    expect(chunks).toEqual([{ approvalRequest: question }, { approvalRequest: writeRequest }]);
  });

  it('после ответа статус возвращается в running, если других карточек нет и сессия идёт', () => {
    let pending = true;
    let active = true;
    const { cb, statuses } = harness({ pending: () => pending, active: () => active });
    cb.onApprovalSettled(writeRequest);
    pending = false;
    cb.onApprovalSettled(writeRequest);
    active = false;
    cb.onApprovalSettled(writeRequest);
    expect(statuses).toEqual([['running', STUDIO_STATUS_PROCESSING, false]]);
  });

  it('статусы вызова меняют сам объект и уходят копией; команда ставит «Выполняется» один раз', () => {
    const { cb, chunks, statuses } = harness();
    const call: AIToolCall = { id: 'c3', name: 'run_command', args: { command: 'npm test' }, status: 'pending' };
    cb.onToolUpdate(call, { kind: 'command', status: 'running' });
    cb.onToolUpdate(call, { kind: 'command', status: 'running', result: 'a' });
    cb.onToolUpdate(call, { kind: 'command', status: 'running', result: 'ab' });
    cb.onToolUpdate(call, { kind: 'command', status: 'accepted', result: 'ab' });
    expect(call).toMatchObject({ status: 'accepted', result: 'ab' });
    expect(chunks.map((c) => [c.toolCall?.status, c.toolCall?.result])).toEqual([
      ['running', undefined],
      ['running', 'a'],
      ['running', 'ab'],
      ['accepted', 'ab']
    ]);
    expect(chunks[0].toolCall).not.toBe(call);
    expect(statuses).toEqual([['running', 'Выполняется: npm test', false], ['running', STUDIO_STATUS_PROCESSING, false]]);
  });

  it('чтение не трогает статус проекта', () => {
    const { cb, statuses } = harness();
    cb.onToolUpdate({ id: 'r', name: 'read_file', args: {} }, { kind: 'read', status: 'done', result: 'x' });
    expect(statuses).toEqual([]);
  });
});

describe('upsertToolCall — одна строка на вызов в списке шагов', () => {
  it('новый id дописывается, известный обновляется на месте с сохранением диффа', () => {
    const diff = { filePath: 'a', oldContent: '', newContent: 'A', patch: '+A' };
    let list = upsertToolCall(undefined, { id: 'c1', name: 'write_file', args: {}, status: 'pending' });
    list = upsertToolCall(list, { id: 'c2', name: 'read_file', args: {}, status: 'pending' });
    list = upsertToolCall(list, { id: 'c1', name: 'write_file', args: {}, status: 'pending', diff });
    list = upsertToolCall(list, { id: 'c1', name: 'write_file', args: {}, status: 'accepted', result: 'ok' });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: 'c1', status: 'accepted', result: 'ok', diff });
    expect(list[1]).toMatchObject({ id: 'c2', status: 'pending' });
  });

  it('вызов без id всегда дописывается', () => {
    const list = upsertToolCall([{ id: '', name: 'x', args: {} }], { id: '', name: 'y', args: {} });
    expect(list).toHaveLength(2);
  });
});
