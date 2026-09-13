import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { parseBacklogConfig, readBacklogConfig } from '../../electron/services/backlogConfigService';
import { DEFAULT_TASK_STATUSES } from '../../src/utils/taskStatus';

/**
 * TASK-68: состав статусов доски берётся из `backlog/config.yml` проекта.
 * Любая проблема с конфигом обязана деградировать в fallback, а не ломать открытие проекта.
 */
describe('parseBacklogConfig', () => {
  it('читает statuses, default_status, project_name и task_prefix', () => {
    const cfg = parseBacklogConfig(
      [
        'project_name: "WorldSim"',
        'default_status: "In Progress"',
        'statuses: ["To Do", "In Progress", "Blocked", "Review", "Done"]',
        'task_prefix: "task"',
        'default_editor: "C:\\\\Windows\\\\notepad.exe"'
      ].join('\n')
    );

    expect(cfg.statuses).toEqual(['To Do', 'In Progress', 'Blocked', 'Review', 'Done']);
    expect(cfg.defaultStatus).toBe('In Progress');
    expect(cfg.projectName).toBe('WorldSim');
    expect(cfg.taskPrefix).toBe('task');
    expect(cfg.fromConfig).toBe(true);
  });

  it('поддерживает блочный список статусов', () => {
    const cfg = parseBacklogConfig('statuses:\n  - To Do\n  - Testing\n  - Done\n');
    expect(cfg.statuses).toEqual(['To Do', 'Testing', 'Done']);
    expect(cfg.fromConfig).toBe(true);
  });

  it('пустой ввод даёт fallback из четырёх стандартных статусов', () => {
    for (const raw of [undefined, null, '', '   \n']) {
      const cfg = parseBacklogConfig(raw);
      expect(cfg.statuses).toEqual([...DEFAULT_TASK_STATUSES]);
      expect(cfg.defaultStatus).toBe('To Do');
      expect(cfg.fromConfig).toBe(false);
    }
  });

  it('битый YAML не бросает исключение и даёт fallback', () => {
    const cfg = parseBacklogConfig('statuses: ["To Do", "In Progress"\nfoo: :::\n');
    expect(cfg.statuses).toEqual([...DEFAULT_TASK_STATUSES]);
    expect(cfg.fromConfig).toBe(false);
  });

  it('пустой или нелистовой statuses даёт fallback, но project_name сохраняется', () => {
    expect(parseBacklogConfig('project_name: "Demo"\nstatuses: []\n')).toMatchObject({
      statuses: [...DEFAULT_TASK_STATUSES],
      fromConfig: false,
      projectName: 'Demo'
    });
    expect(parseBacklogConfig('project_name: "Demo"\nstatuses: "To Do"\n')).toMatchObject({
      statuses: [...DEFAULT_TASK_STATUSES],
      fromConfig: false,
      projectName: 'Demo'
    });
  });

  it('отбрасывает дубликаты (регистр и пробелы не значимы), сохраняя первое написание', () => {
    const cfg = parseBacklogConfig('statuses: ["To Do", "to do", "  To   Do  ", "Done"]');
    expect(cfg.statuses).toEqual(['To Do', 'Done']);
  });

  it('поддерживает не-ASCII статусы и статусы с пробелами', () => {
    const cfg = parseBacklogConfig('statuses: ["К выполнению", "В работе", "На ревью", "Готово"]');
    expect(cfg.statuses).toEqual(['К выполнению', 'В работе', 'На ревью', 'Готово']);
    expect(cfg.defaultStatus).toBe('К выполнению');
  });

  it('пропускает пустые и нестроковые элементы списка', () => {
    const cfg = parseBacklogConfig('statuses: ["To Do", "", null, {a: 1}, [1, 2], "Done"]');
    expect(cfg.statuses).toEqual(['To Do', 'Done']);
  });

  it('приводит значения-даты и числа к строкам (правило 16)', () => {
    const cfg = parseBacklogConfig('statuses: [2026-09-03, 42, true, "Done"]');
    expect(cfg.statuses).toEqual(['2026-09-03', '42', 'true', 'Done']);
    for (const status of cfg.statuses) {
      expect(typeof status).toBe('string');
    }
  });

  it('default_status вне списка заменяется на To Do или первый статус', () => {
    expect(parseBacklogConfig('statuses: ["To Do", "Done"]\ndefault_status: "Backlog"').defaultStatus).toBe('To Do');
    expect(parseBacklogConfig('statuses: ["Idea", "Done"]\ndefault_status: "Backlog"').defaultStatus).toBe('Idea');
  });

  it('default_status сопоставляется без учёта регистра', () => {
    expect(parseBacklogConfig('statuses: ["To Do", "Done"]\ndefault_status: "done"').defaultStatus).toBe('Done');
  });

  it('строка --- внутри конфига не обрывает разбор', () => {
    const cfg = parseBacklogConfig('project_name: "Demo"\nstatuses: ["A", "B"]\nnote: "---"\n');
    expect(cfg.statuses).toEqual(['A', 'B']);
    expect(cfg.projectName).toBe('Demo');
  });
});

describe('readBacklogConfig', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-backlog-config-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('читает backlog/config.yml проекта', async () => {
    await fs.mkdir(path.join(dir, 'backlog'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'backlog', 'config.yml'),
      'project_name: "Demo"\nstatuses: ["To Do", "Blocked", "Done"]\n',
      'utf-8'
    );

    const cfg = await readBacklogConfig(dir);
    expect(cfg.statuses).toEqual(['To Do', 'Blocked', 'Done']);
    expect(cfg.projectName).toBe('Demo');
    expect(cfg.fromConfig).toBe(true);
  });

  it('отсутствие файла даёт fallback без исключения', async () => {
    const cfg = await readBacklogConfig(dir);
    expect(cfg.statuses).toEqual([...DEFAULT_TASK_STATUSES]);
    expect(cfg.fromConfig).toBe(false);
  });
});
