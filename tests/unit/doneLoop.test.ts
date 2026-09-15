import { describe, it, expect } from 'vitest';
import {
  AgentReportSchema,
  DEFAULT_DONE_LOOP_MAX_ITERATIONS,
  MAX_DONE_LOOP_ITERATIONS,
  REPORT_FENCE,
  buildDoneLoopFinalSummary,
  buildDoneLoopInstructions,
  buildRetryPrompt,
  checksPassed,
  decideNext,
  findReviewStatus,
  parseAgentReport,
  resolveDoneLoopSettings,
  verifyCriteria,
  type DecideInput
} from '../../electron/services/doneLoop';
import type { CheckDefinition, CheckRunResult } from '../../electron/services/arenaTypes';

const fenced = (json: string) => `Сделал работу.\n\n\`\`\`${REPORT_FENCE}\n${json}\n\`\`\`\n`;

const check = (over: Partial<CheckRunResult> = {}): CheckRunResult => ({
  id: 'test',
  kind: 'test',
  name: 'Tests',
  command: 'npm test',
  status: 'passed',
  blocking: true,
  ...over
});

const def = (over: Partial<CheckDefinition> = {}): CheckDefinition => ({
  id: 'lint',
  kind: 'lint',
  name: 'Lint',
  command: 'npm run lint',
  blocking: true,
  enabled: true,
  ...over
});

describe('doneLoop: разбор отчёта агента (схема zod)', () => {
  it('разбирает отчёт в ограде projecthub-report', () => {
    const res = parseAgentReport(
      fenced('{ "summary": "Готово", "criteria": [{ "index": 1, "status": "done", "evidence": "src/a.ts:10 функция sum" }] }')
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.report.summary).toBe('Готово');
      expect(res.report.criteria).toEqual([{ index: 1, status: 'done', evidence: 'src/a.ts:10 функция sum' }]);
    }
  });

  it('берёт последнюю ограду, если агент выводил отчёт несколько раз', () => {
    const text =
      fenced('{ "criteria": [{ "index": 1, "status": "not_done", "evidence": "черновик" }] }') +
      fenced('{ "criteria": [{ "index": 1, "status": "done", "evidence": "tests/unit/a.test.ts проходит" }] }');
    const res = parseAgentReport(text);
    expect(res.ok && res.report.criteria[0].status).toBe('done');
  });

  it('без ограды берёт последний JSON-объект с полем criteria и игнорирует прочие JSON и незакрытые скобки', () => {
    const text =
      'function x() { return 1;\n' +
      '{"tool": "Read"}\n' +
      'Итог: {"summary": "ok", "criteria": [{"acId": "#2", "status": "met", "evidence": "npm test: 12 passed"}]}';
    const res = parseAgentReport(text);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.report.criteria).toEqual([{ index: 2, status: 'done', evidence: 'npm test: 12 passed' }]);
  });

  it('отклоняет отчёт с неизвестным статусом или без номера критерия', () => {
    const badStatus = parseAgentReport(fenced('{ "criteria": [{ "index": 1, "status": "maybe", "evidence": "x" }] }'));
    expect(badStatus.ok).toBe(false);
    if (!badStatus.ok) expect(badStatus.error).toMatch(/схеме/);

    const noIndex = parseAgentReport(fenced('{ "criteria": [{ "status": "done", "evidence": "x" }] }'));
    expect(noIndex.ok).toBe(false);
  });

  it('сообщает об отсутствии отчёта и о битом JSON', () => {
    const none = parseAgentReport('Я всё сделал, поверьте.');
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error).toMatch(/нет отчёта/);

    const broken = parseAgentReport(`\`\`\`${REPORT_FENCE}\nне json\n\`\`\``);
    expect(broken.ok).toBe(false);
  });

  it('схема подставляет пустое summary и пустой evidence', () => {
    const parsed = AgentReportSchema.parse({ criteria: [{ index: '3', status: 'blocked' }] });
    expect(parsed).toEqual({ summary: '', criteria: [{ index: 3, status: 'blocked', evidence: '' }] });
  });
});

describe('doneLoop: сверка критериев (AC отмечает только harness)', () => {
  const criteria = [
    { text: 'Первый', completed: false },
    { text: 'Второй', completed: false },
    { text: 'Третий', completed: true },
    { text: 'Четвёртый', completed: false }
  ];

  it('засчитывает только done с достаточным evidence; молчание и not_done не засчитываются', () => {
    const result = verifyCriteria(criteria, {
      summary: '',
      criteria: [
        { index: 1, status: 'done', evidence: 'src/a.ts:42 — реализовано, тест a.test.ts' },
        { index: 2, status: 'done', evidence: 'готово' },
        { index: 4, status: 'not_done', evidence: 'не успел' }
      ]
    });
    expect(result.map((c) => c.accepted)).toEqual([true, false, true, false]);
    expect(result[1].reason).toMatch(/evidence/);
    expect(result[2].alreadyChecked).toBe(true);
    expect(result[3].reported).toBe('not_done');
  });

  it('критерий, о котором агент промолчал, остаётся открытым', () => {
    const result = verifyCriteria(criteria.slice(0, 2), { summary: '', criteria: [] });
    expect(result.every((c) => !c.accepted && c.reason === 'Агент не отчитался по критерию')).toBe(true);
  });

  it('без отчёта засчитываются только уже отмеченные критерии', () => {
    const result = verifyCriteria(criteria, null);
    expect(result.filter((c) => c.accepted).map((c) => c.index)).toEqual([3]);
  });
});

describe('doneLoop: проверки', () => {
  it('падение неблокирующей проверки и пропуски не мешают', () => {
    expect(checksPassed([check(), check({ id: 'x', status: 'failed', blocking: false }), check({ id: 's', status: 'skipped' })])).toBe(true);
    expect(checksPassed([check({ status: 'timeout' })])).toBe(false);
    expect(checksPassed([])).toBe(true);
  });
});

describe('doneLoop: машина состояний decideNext', () => {
  const base: DecideInput = {
    iteration: 1,
    maxIterations: 5,
    stopped: false,
    agentStatus: 'completed',
    checksPassed: true,
    allCriteriaAccepted: true
  };

  it('успех с первой попытки завершает цикл', () => {
    expect(decideNext(base)).toEqual({ action: 'finish' });
  });

  it('упавшие проверки или незакрытые критерии дают повтор, пока есть итерации', () => {
    expect(decideNext({ ...base, checksPassed: false })).toEqual({ action: 'retry' });
    expect(decideNext({ ...base, allCriteriaAccepted: false, iteration: 4 })).toEqual({ action: 'retry' });
  });

  it('лимит итераций останавливает цикл с причиной', () => {
    const d = decideNext({ ...base, iteration: 5, checksPassed: false });
    expect(d.action).toBe('fail');
    if (d.action === 'fail') {
      expect(d.outcome).toBe('iteration_limit');
      expect(d.reason).toMatch(/лимит итераций \(5\).*проверки не прошли/);
    }
  });

  it('успешный ход на последней итерации всё равно завершает цикл', () => {
    expect(decideNext({ ...base, iteration: 5, maxIterations: 5 })).toEqual({ action: 'finish' });
  });

  it('исчерпанный бюджет цикла останавливает повтор', () => {
    const d = decideNext({ ...base, checksPassed: false, costUsd: 2.5, budgetUsd: 2 });
    expect(d).toMatchObject({ action: 'fail', outcome: 'budget' });
    expect(decideNext({ ...base, checksPassed: false, costUsd: 1, budgetUsd: 2 })).toEqual({ action: 'retry' });
  });

  it('агент, остановленный по бюджету слота, — провал по бюджету', () => {
    expect(decideNext({ ...base, agentStatus: 'budget_exceeded', agentError: 'Бюджет агента $1 превышен' })).toEqual({
      action: 'fail',
      outcome: 'budget',
      reason: 'Бюджет агента $1 превышен'
    });
  });

  it('остановка человеком сильнее любого результата', () => {
    expect(decideNext({ ...base, stopped: true })).toMatchObject({ action: 'fail', outcome: 'stopped' });
    expect(decideNext({ ...base, agentStatus: 'stopped' })).toMatchObject({ action: 'fail', outcome: 'stopped' });
  });

  it('ошибка хода агента не повторяется вслепую', () => {
    expect(decideNext({ ...base, agentStatus: 'failed', agentError: 'CLI упал' })).toEqual({
      action: 'fail',
      outcome: 'agent_error',
      reason: 'CLI упал'
    });
  });
});

describe('doneLoop: промпты и итог', () => {
  it('инструкция содержит критерии, проверки, формат отчёта и запрет трогать чекбоксы', () => {
    const text = buildDoneLoopInstructions({
      taskId: 'TASK-7',
      criteria: [{ text: 'Работает экспорт', completed: false }, { text: 'Есть тесты', completed: true }],
      checks: [def()],
      maxIterations: 3
    });
    expect(text).toContain('TASK-7');
    expect(text).toContain('1. Работает экспорт');
    expect(text).toContain('2. [уже отмечен] Есть тесты');
    expect(text).toContain('`npm run lint`');
    expect(text).toContain('```' + REPORT_FENCE);
    expect(text).toMatch(/Не отмечай чекбоксы/);
  });

  it('промпт повтора передаёт хвост упавшей проверки и незакрытые критерии с причиной', () => {
    const longOutput = `${'x'.repeat(5000)}\nFAIL tests/a.test.ts > sum`;
    const text = buildRetryPrompt({
      iteration: 2,
      maxIterations: 5,
      checks: [check({ status: 'failed', failedTests: 1, totalTests: 3, outputTail: longOutput }), check({ id: 'lint', name: 'Lint' })],
      criteria: [
        { index: 1, text: 'Сумма', accepted: false, reason: 'Нет конкретного evidence (файл/тест/вывод команды)', evidence: 'ok' },
        { index: 2, text: 'Готово', accepted: true }
      ],
      reportError: 'JSON отчёта не разобрался'
    });
    expect(text).toContain('Итерация 2 из 5');
    expect(text).toContain('FAIL tests/a.test.ts > sum');
    expect(text).not.toContain('x'.repeat(4000));
    expect(text).toContain('#1 Сумма — Нет конкретного evidence');
    expect(text).not.toContain('#2 Готово');
    expect(text).toContain('JSON отчёта не разобрался');
  });

  it('итоговое резюме перечисляет критерии, проверки, стоимость и итерации', () => {
    const summary = buildDoneLoopFinalSummary({
      outcome: 'success',
      iterations: 2,
      maxIterations: 5,
      agentName: 'Implementer',
      engine: 'claude-cli',
      criteria: [
        { index: 1, text: 'Сумма', accepted: true, evidence: 'src/sum.ts:3' },
        { index: 2, text: 'Старый', accepted: true, alreadyChecked: true }
      ],
      checks: [check({ durationMs: 1500 })],
      costUsd: 0.1234,
      branch: 'swarm/abc/done-task-1',
      commitHash: 'abcdef1234'
    });
    expect(summary).toContain('итераций 2 из 5');
    expect(summary).toContain('- [x] #1 Сумма — src/sum.ts:3');
    expect(summary).toContain('- [x] #2 Старый — отмечен до запуска');
    expect(summary).toContain('Tests (`npm test`): passed');
    expect(summary).toContain('$0.1234');
    expect(summary).toContain('коммит abcdef1');
  });
});

describe('doneLoop: настройки', () => {
  it('дефолты: 5 итераций, автоперевод в Review, только включённые проверки', () => {
    const settings = resolveDoneLoopSettings({ projectChecks: [def(), def({ id: 'build', enabled: false })] });
    expect(settings).toEqual({ maxIterations: DEFAULT_DONE_LOOP_MAX_ITERATIONS, checks: [def()], autoReview: true });
  });

  it('выбор в модалке сильнее настроек проекта; лимит итераций ограничен', () => {
    const settings = resolveDoneLoopSettings({
      projectChecks: [def(), def({ id: 'test', kind: 'test', name: 'Tests', command: 'npm test' })],
      project: { maxIterations: 3, budgetUsd: 4, checkIds: ['lint'], autoReview: true },
      overrides: { maxIterations: 99, checkIds: ['test'], autoReview: false }
    });
    expect(settings.maxIterations).toBe(MAX_DONE_LOOP_ITERATIONS);
    expect(settings.budgetUsd).toBe(4);
    expect(settings.checks.map((c) => c.id)).toEqual(['test']);
    expect(settings.autoReview).toBe(false);
  });

  it('добавляет lint:docs/check-index из package.json, без дублей и если не отключено', () => {
    const scripts = { 'lint:docs': 'node scripts/validate-docs.mjs && node scripts/rag/check-index.mjs', 'check-index': 'node check.mjs' };
    const withDocs = resolveDoneLoopSettings({ projectChecks: [def()], scripts, packageManager: 'pnpm' });
    expect(withDocs.checks.map((c) => [c.id, c.command])).toEqual([
      ['lint', 'npm run lint'],
      ['lint-docs', 'pnpm run lint:docs'],
      ['check-index', 'pnpm run check-index']
    ]);

    const existing = resolveDoneLoopSettings({ projectChecks: [def({ id: 'docs', command: 'npm run lint:docs' })], scripts });
    expect(existing.checks.map((c) => c.id)).toEqual(['docs', 'check-index']);

    const off = resolveDoneLoopSettings({ projectChecks: [def()], scripts, project: { docChecks: false } });
    expect(off.checks.map((c) => c.id)).toEqual(['lint']);
  });

  it('находит статус Review в конфиге проекта без учёта регистра', () => {
    expect(findReviewStatus(['To Do', 'In Progress', 'review', 'Done'])).toBe('review');
    expect(findReviewStatus(['To Do', 'Done'])).toBeUndefined();
  });
});
