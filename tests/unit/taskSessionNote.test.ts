import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyImplementationNote, NOTES_BEGIN, NOTES_END } from '../../electron/services/backlogTaskFormat';
import { appendSessionNoteToTask, formatSessionNote, noteSummary, NOTE_SUMMARY_MAX, resolveNoteStatus } from '../../electron/services/taskSessionNote';

/** Заметка хода в Implementation Notes задачи (TASK-76.4, decision-51 п. 8). */

const AT = new Date(Date.UTC(2026, 8, 26, 13, 40));

describe('formatSessionNote', () => {
  it('цикл «до готовности»: исход, итерации, стоимость, агент с веткой и коммитом, итог', () => {
    const note = formatSessionNote({
      at: AT,
      mode: 'done_loop',
      status: 'completed',
      totalCostUsd: 0.1234,
      iterations: 2,
      agents: [{ name: 'Кодер', role: 'developer', engine: 'claude-cli', model: 'sonnet', status: 'completed', branch: 'swarm/ab12cd/done-task-7', commitHash: '1a2b3c4d5e6f' }],
      summary: 'Сделал сумму.\n\n## Детали\nтесты зелёные'
    });
    expect(note.split('\n')).toEqual([
      '**Сессия агента 2026-09-26 13:40 UTC** — цикл «до готовности», успех, итераций: 2, $0.12',
      '- Кодер (developer, claude-cli, sonnet): completed, ветка `swarm/ab12cd/done-task-7`, коммит 1a2b3c4',
      'Итог: Сделал сумму. ## Детали тесты зелёные'
    ]);
  });

  it('провал с причиной, несколько агентов со стоимостью, продолжение', () => {
    const note = formatSessionNote({
      at: AT,
      mode: 'fan_out',
      status: 'failed',
      error: 'Бюджет сессии $1.00 превышен',
      totalCostUsd: 1.2,
      continuation: 1,
      agents: [
        { name: 'A', engine: 'api', status: 'failed', costUsd: 0.7 },
        { name: 'B', engine: 'codex-cli', status: 'completed', costUsd: 0.5 }
      ]
    });
    expect(note).toContain('— арена (fan-out), провал, $1.20, продолжение 1');
    expect(note).toContain('Причина: Бюджет сессии $1.00 превышен');
    expect(note).toContain('- A (api): failed, $0.70');
    expect(note).not.toContain('Итог:');
  });

  it('остановка без причины в тексте успеха', () => {
    const note = formatSessionNote({ at: AT, mode: 'handoff', status: 'stopped', agents: [] });
    expect(note).toBe('**Сессия агента 2026-09-26 13:40 UTC** — конвейер (handoff), остановлена');
  });
});

describe('resolveNoteStatus', () => {
  it('completed без успешного агента — провал; остальное как есть', () => {
    expect(resolveNoteStatus('completed', ['failed'])).toBe('failed');
    expect(resolveNoteStatus('completed', ['failed', 'stopped'])).toBe('failed');
    expect(resolveNoteStatus('completed', ['failed', 'completed'])).toBe('completed');
    expect(resolveNoteStatus('completed', [])).toBe('completed');
    expect(resolveNoteStatus('stopped', ['completed'])).toBe('stopped');
  });
});

describe('noteSummary', () => {
  it('одна строка, без секретов, длинный текст — хвост', () => {
    expect(noteSummary('a\nb')).toBe('a b');
    expect(noteSummary('ключ OPENAI_API_KEY=sk-abcdef123456 записан')).toBe('ключ OPENAI_API_KEY=*** записан');
    const long = noteSummary(`начало ${'x'.repeat(2000)} вывод`);
    expect(long.startsWith('…')).toBe(true);
    expect(long.endsWith('вывод')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(NOTE_SUMMARY_MAX + 1);
    expect(noteSummary(undefined)).toBe('');
  });
});

describe('applyImplementationNote', () => {
  const base = ['## Description', '', 'Текст', ''].join('\n');

  it('создаёт секцию в конце файла', () => {
    const out = applyImplementationNote(base, 'заметка 1');
    expect(out).toBe(['## Description', '', 'Текст', '', '## Implementation Notes', '', NOTES_BEGIN, 'заметка 1', NOTES_END].join('\n'));
  });

  it('дописывает в существующий блок, не трогая прежние заметки', () => {
    const once = applyImplementationNote(base, 'заметка 1');
    const twice = applyImplementationNote(once, 'заметка 2\nвторая строка');
    expect(twice).toContain(`${NOTES_BEGIN}\nзаметка 1\n\nзаметка 2\nвторая строка\n${NOTES_END}`);
    expect(twice.match(/## Implementation Notes/g)).toHaveLength(1);
  });

  it('секция без маркеров: прежний текст уходит внутрь маркеров', () => {
    const legacy = ['## Description', 'x', '', '## Implementation Notes', '', 'руками', '', '## Final Summary', 'итог'].join('\n');
    const out = applyImplementationNote(legacy, 'новая');
    expect(out).toContain(`## Implementation Notes\n\n${NOTES_BEGIN}\nруками\n\nновая\n${NOTES_END}\n\n## Final Summary\nитог`);
  });

  it('новая секция встаёт перед Final Summary и Comments', () => {
    const withSummary = ['## Description', 'x', '', '## Final Summary', 'итог'].join('\n');
    expect(applyImplementationNote(withSummary, 'n')).toBe(
      ['## Description', 'x', '', '## Implementation Notes', '', NOTES_BEGIN, 'n', NOTES_END, '', '## Final Summary', 'итог'].join('\n')
    );
    const withComments = ['## Description', 'x', '', '## Comments', 'c'].join('\n');
    expect(applyImplementationNote(withComments, 'n').indexOf('## Implementation Notes')).toBeLessThan(
      applyImplementationNote(withComments, 'n').indexOf('## Comments')
    );
  });
});

describe('appendSessionNoteToTask', () => {
  let project: string;

  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-note-'));
    await fs.mkdir(path.join(project, 'backlog', 'tasks'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(project, { recursive: true, force: true });
  });

  it('сохраняет CRLF, обновляет updated_date, дату пишет строкой; параллельные заметки не теряются', async () => {
    const file = path.join(project, 'backlog', 'tasks', 'task-7 - Задача.md');
    const lines = ['---', 'id: TASK-7', 'title: Задача', 'status: To Do', "created_date: '2026-09-15 10:00'", '---', '', '## Description', '', 'x', ''];
    await fs.writeFile(file, lines.join('\r\n'), 'utf-8');
    await Promise.all([
      appendSessionNoteToTask(project, 'TASK-7', 'первая'),
      appendSessionNoteToTask(project, 'TASK-7', 'вторая')
    ]);
    const out = await fs.readFile(file, 'utf-8');
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    expect(out).toMatch(/updated_date: '\d{4}-\d{2}-\d{2} \d{2}:\d{2}'/);
    expect(out).toContain('первая');
    expect(out).toContain('вторая');
    expect(await appendSessionNoteToTask(project, 'TASK-99', 'нет')).toBe(false);
  });
});
