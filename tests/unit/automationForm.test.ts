import { describe, expect, it } from 'vitest';
import { emptyAutomationForm, formFromRule, parseNumber, ruleFromForm, ruleIdFromName, splitList } from '../../src/lib/automationForm';
import type { AutomationRule } from '../../src/types/electron';

/** Форма редактора правила Automations ↔ правило (TASK-74, decision-52). */

describe('вспомогательные разборы', () => {
  it('списки, числа и id из названия', () => {
    expect(splitList(' a, b ,,\nc ')).toEqual(['a', 'b', 'c']);
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('abc')).toBeUndefined();
    expect(ruleIdFromName('Чеки на ревью!')).toBe('cheki-na-revyu');
    expect(ruleIdFromName('???')).toBe('rule');
  });
});

describe('ruleFromForm', () => {
  it('событие смены статуса с условиями и запуском агента', () => {
    const rule = ruleFromForm({
      ...emptyAutomationForm(),
      name: 'Ревью агентом',
      triggerKind: 'event',
      event: 'task.statusChanged',
      statusTo: 'Review',
      labels: 'backend, api',
      outcomes: ['failed'],
      processName: 'dev',
      actionType: 'runAgent',
      roleSlug: 'reviewer',
      mode: 'doneLoop',
      maxIterations: '3',
      runBudgetUsd: '0.5',
      dailyBudgetUsd: '2',
      cooldownMin: '15'
    });
    expect(rule).toEqual({
      id: 'revyu-agentom',
      name: 'Ревью агентом',
      enabled: true,
      trigger: { kind: 'event', event: 'task.statusChanged' },
      // Условия чужих триггеров (исход роя, процесс) в правило не попадают.
      conditions: { labels: ['backend', 'api'], statusTo: ['Review'] },
      action: { type: 'runAgent', roleSlug: 'reviewer', mode: 'doneLoop', budgetUsd: 0.5, maxIterations: 3 },
      limits: { cooldownMin: 15, maxRunsPerDay: 20, dailyBudgetUsd: 2 }
    });
  });

  it('cron с проектами и уведомлением', () => {
    const rule = ruleFromForm({
      ...emptyAutomationForm(),
      id: 'morning',
      name: 'Утро',
      triggerKind: 'cron',
      cronExpr: ' 0 9 * * 1-5 ',
      catchUp: 'once',
      projects: ['C:/Work/app'],
      actionType: 'notify',
      notifyTitle: 'Доброе утро',
      cooldownMin: '',
      maxRunsPerDay: ''
    });
    expect(rule).toMatchObject({
      id: 'morning',
      trigger: { kind: 'cron', expr: '0 9 * * 1-5', catchUp: 'once' },
      conditions: { projects: ['C:/Work/app'] },
      action: { type: 'notify', title: 'Доброе утро' },
      limits: {}
    });
  });
});

describe('formFromRule ↔ ruleFromForm', () => {
  it('правило переживает круг через форму', () => {
    const rule: AutomationRule = {
      id: 'crash-checks',
      name: 'Чеки после падения',
      enabled: false,
      trigger: { kind: 'event', event: 'process.crashed' },
      conditions: { processName: 'dev*', projects: ['C:/a'] },
      action: { type: 'runChecks', checkIds: ['lint', 'test'] },
      limits: { cooldownMin: 5, maxRunsPerDay: 3 }
    };
    expect(ruleFromForm(formFromRule(rule))).toEqual(rule);
    const agent: AutomationRule = {
      id: 'nightly',
      name: 'Ночной агент',
      enabled: true,
      trigger: { kind: 'cron', expr: '0 3 * * *', catchUp: 'skip' },
      conditions: { projects: ['C:/a'] },
      action: { type: 'runAgent', roleSlug: 'dev', mode: 'single', prompt: 'Обнови зависимости', budgetUsd: 1 },
      limits: { cooldownMin: 10, maxRunsPerDay: 1, dailyBudgetUsd: 1 }
    };
    expect(ruleFromForm(formFromRule(agent))).toEqual(agent);
  });
});
