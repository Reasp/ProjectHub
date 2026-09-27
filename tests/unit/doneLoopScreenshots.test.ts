import { describe, it, expect } from 'vitest';
import {
  REPORT_FENCE,
  buildDoneLoopFinalSummary,
  buildDoneLoopInstructions,
  buildRetryPrompt,
  isUiCriterion,
  parseAgentReport,
  verifyCriteria
} from '../../electron/services/doneLoop';
import { iterationScreenshots } from '../../electron/services/visualArtifacts';
import type { CheckDefinition, CheckRunResult } from '../../electron/services/arenaTypes';

const uiCheck: CheckRunResult = {
  id: 'ui-smoke',
  kind: 'ui-smoke',
  name: 'UI smoke',
  command: 'npm run ui-smoke',
  status: 'passed',
  blocking: true,
  artifacts: [
    { name: 'home.png', relPath: 'swarm-1/a/iter-1/ui-smoke/home.png', kind: 'screenshot', bytes: 10 },
    { name: 'trace.zip', relPath: 'swarm-1/a/iter-1/ui-smoke/trace.zip', kind: 'trace', bytes: 10 }
  ]
};
const shots = iterationScreenshots([uiCheck]);

const criteria = [
  { text: '[ui] Главная страница показывает заголовок', completed: false },
  { text: 'Функция sum покрыта тестом', completed: false }
];

describe('поле screenshots в отчёте', () => {
  it('разбирается из массива, строки и синонима artifacts', () => {
    const text = `\`\`\`${REPORT_FENCE}\n${JSON.stringify({
      summary: 's',
      criteria: [
        { index: 1, status: 'done', evidence: 'ok', screenshots: ['home.png', ' '] },
        { index: 2, status: 'done', evidence: 'tests/unit/sum.test.ts проходит', screenshot: 'x.png' },
        { index: 3, status: 'done', evidence: 'e', artifacts: ['y.png'] }
      ]
    })}\n\`\`\``;
    const parsed = parseAgentReport(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.report.criteria.map((c) => c.screenshots)).toEqual([['home.png'], ['x.png'], ['y.png']]);
  });

  it('без поля отчёт прежний', () => {
    const parsed = parseAgentReport(`\`\`\`${REPORT_FENCE}\n{"criteria":[{"index":1,"status":"done","evidence":"src/a.ts:1 — сделано"}]}\n\`\`\``);
    expect(parsed.ok && parsed.report.criteria[0].screenshots).toBeUndefined();
  });
});

describe('verifyCriteria со скриншотами', () => {
  it('найденный скриншот засчитывает критерий [ui] даже с коротким текстом', () => {
    const [ui] = verifyCriteria(criteria, { summary: '', criteria: [{ index: 1, status: 'done', evidence: 'ok', screenshots: ['home.png'] }] }, 12, shots);
    expect(ui.accepted).toBe(true);
    expect(ui.ui).toBe(true);
    expect(ui.screenshots).toEqual([{ ref: 'home.png', checkId: 'ui-smoke', name: 'home.png', relPath: 'swarm-1/a/iter-1/ui-smoke/home.png' }]);
  });

  it('критерий [ui] без скриншота не засчитан, даже с подробным текстом', () => {
    const [ui] = verifyCriteria(
      criteria,
      { summary: '', criteria: [{ index: 1, status: 'done', evidence: 'src/pages/Home.tsx:12 — заголовок выводится' }] },
      12,
      shots
    );
    expect(ui.accepted).toBe(false);
    expect(ui.reason).toMatch(/\[ui\] требует скриншот/);
  });

  it('ненайденный скриншот — не засчитан, trace скриншотом не считается', () => {
    const [, plain] = verifyCriteria(
      criteria,
      { summary: '', criteria: [{ index: 2, status: 'done', evidence: 'tests/unit/sum.test.ts проходит', screenshots: ['trace.zip'] }] },
      12,
      shots
    );
    expect(plain.accepted).toBe(false);
    expect(plain.reason).toMatch(/«trace\.zip» не найден среди артефактов/);
  });

  it('обычный критерий без скриншотов — прежние правила', () => {
    const [, plain] = verifyCriteria(criteria, { summary: '', criteria: [{ index: 2, status: 'done', evidence: 'tests/unit/sum.test.ts проходит' }] });
    expect(plain.accepted).toBe(true);
    expect(plain.ui).toBeUndefined();
  });

  it('isUiCriterion', () => {
    expect(isUiCriterion('[UI] кнопка')).toBe(true);
    expect(isUiCriterion('UI кнопка')).toBe(false);
  });
});

describe('тексты цикла', () => {
  const uiDef: CheckDefinition = { id: 'ui-smoke', kind: 'ui-smoke', name: 'UI smoke', command: 'npm run ui-smoke' };
  const testDef: CheckDefinition = { id: 'test', kind: 'test', name: 'Tests', command: 'npm test' };

  it('инструкция объясняет скриншоты, только если есть ui-smoke', () => {
    const withUi = buildDoneLoopInstructions({ taskId: 'TASK-1', criteria, checks: [testDef, uiDef], maxIterations: 3 });
    expect(withUi).toMatch(/## Скриншоты как evidence/);
    expect(withUi).toMatch(/PROJECTHUB_ARTIFACTS_DIR/);
    const noUi = buildDoneLoopInstructions({ taskId: 'TASK-1', criteria: [criteria[1]], checks: [testDef], maxIterations: 3 });
    expect(noUi).not.toMatch(/Скриншоты/);
  });

  it('критерии [ui] без проверки ui-smoke — предупреждение в инструкции', () => {
    const text = buildDoneLoopInstructions({ taskId: 'TASK-1', criteria, checks: [testDef], maxIterations: 3 });
    expect(text).toMatch(/## Критерии \[ui\]/);
  });

  it('промпт повтора перечисляет скриншоты итерации', () => {
    const verification = verifyCriteria(criteria, null);
    const text = buildRetryPrompt({ iteration: 1, maxIterations: 3, checks: [uiCheck], criteria: verification });
    expect(text).toMatch(/## Скриншоты проверок этой итерации/);
    expect(text).toMatch(/- ui-smoke\/home\.png/);
    expect(text).not.toMatch(/trace\.zip/);
  });

  it('Final Summary называет скриншоты по имени, без путей userData', () => {
    const verification = verifyCriteria(criteria, { summary: '', criteria: [{ index: 1, status: 'done', evidence: 'ok', screenshots: ['home.png'] }] }, 12, shots);
    const summary = buildDoneLoopFinalSummary({
      outcome: 'success',
      iterations: 1,
      maxIterations: 3,
      agentName: 'a',
      engine: 'claude-cli',
      criteria: verification,
      checks: [uiCheck]
    });
    expect(summary).toMatch(/#1 \[ui\] Главная страница показывает заголовок — ok \(скриншоты: ui-smoke\/home\.png\)/);
    expect(summary).not.toMatch(/swarm-1\/a/);
    expect(summary).toMatch(/скриншотов: 1, trace: 1/);
  });
});
