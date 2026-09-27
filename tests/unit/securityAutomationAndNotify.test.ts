import { describe, expect, it } from 'vitest';
import { executeAutomationAction, type ActionDeps } from '../../electron/services/automationActions';
import { validateRule, validateRuleForScope, AutomationRuleSchema } from '../../electron/services/automationRules';
import { defaultChannelMatrix, describeBusEvent, normalizeSettings } from '../../electron/services/notificationRules';
import { NOTIFICATION_KINDS } from '../../electron/services/notificationTypes';
import { formFromRule, ruleFromForm } from '../../src/lib/automationForm';
import type { AutomationRule } from '../../src/types/electron';

/** Действие Automations `auditDependencies` и уведомление `securityFinding` (TASK-73.5, decision-56 п. 8, 10). */

const ROOT = 'C:/Work/app';

describe('действие auditDependencies', () => {
  const base = { ruleKey: 'global:audit', ruleId: 'audit', ruleName: 'Аудит', runId: 'r1', depth: 0, projectRoot: ROOT };

  it('вызывает аудит с порогом и сводит итог', async () => {
    const calls: Array<[string, string]> = [];
    const deps = {
      auditDependencies: async (root: string, min: string) => {
        calls.push([root, min]);
        return { ok: true, detail: 'critical 1; новых находок: 1' };
      }
    } as unknown as ActionDeps;
    const res = await executeAutomationAction({ ...base, action: { type: 'auditDependencies', minSeverity: 'critical' } }, deps);
    expect(res).toEqual({ outcome: 'success', detail: 'critical 1; новых находок: 1' });
    expect(calls).toEqual([[ROOT, 'critical']]);
  });

  it('сбой инструмента — failed; без реализации — failed с причиной', async () => {
    const failing = { auditDependencies: async () => ({ ok: false, detail: 'npm: registry недоступен' }) } as unknown as ActionDeps;
    expect(await executeAutomationAction({ ...base, action: { type: 'auditDependencies', minSeverity: 'high' } }, failing)).toEqual({
      outcome: 'failed',
      detail: 'npm: registry недоступен'
    });
    expect((await executeAutomationAction({ ...base, action: { type: 'auditDependencies', minSeverity: 'high' } }, {} as ActionDeps)).outcome).toBe('failed');
  });

  it('схема: по умолчанию порог high, не агентное действие — бюджет не нужен; глобальному cron нужен проект', () => {
    const parsed = AutomationRuleSchema.parse({ id: 'audit', name: 'Аудит', trigger: { kind: 'cron', expr: '0 9 * * 1' }, action: { type: 'auditDependencies' } });
    expect(parsed.action).toEqual({ type: 'auditDependencies', minSeverity: 'high' });
    expect(validateRule({ id: 'a', name: 'A', trigger: { kind: 'cron', expr: '0 9 * * *' }, action: { type: 'auditDependencies', minSeverity: 'bad' } }).ok).toBe(false);
    expect(validateRuleForScope(parsed, { kind: 'global' })).toMatch(/список проектов/);
    expect(validateRuleForScope({ ...parsed, conditions: { projects: [ROOT] } }, { kind: 'global' })).toBeNull();
  });

  it('правило переживает круг через форму редактора', () => {
    const rule: AutomationRule = {
      id: 'weekly-audit',
      name: 'Еженедельный аудит',
      enabled: true,
      trigger: { kind: 'cron', expr: '0 9 * * 1', catchUp: 'skip' },
      conditions: { projects: [ROOT] },
      action: { type: 'auditDependencies', minSeverity: 'moderate' },
      limits: { cooldownMin: 10, maxRunsPerDay: 20 }
    };
    expect(ruleFromForm(formFromRule(rule))).toEqual(rule);
  });
});

describe('уведомление securityFinding', () => {
  const event = {
    type: 'security:finding' as const,
    projectPath: ROOT,
    source: 'audit' as const,
    severity: 'critical' as const,
    title: 'Новые уязвимости зависимостей: 2',
    summary: 'critical 1, high 1 · minimist, lodash',
    count: 2,
    key: 'lodash:GHSA-x,minimist:GHSA-y',
    at: 5
  };

  it('аудит: critical, клик во вкладку «Безопасность», дедуп по набору advisory', () => {
    const n = describeBusEvent(event);
    expect(n).toMatchObject({ kind: 'securityFinding', severity: 'critical', title: 'Новые уязвимости зависимостей: 2', projectName: 'app' });
    expect(n?.body).toBe('critical 1, high 1 · minimist, lodash · app');
    expect(n?.action).toEqual({ type: 'openSecurity', projectPath: ROOT });
    expect(n?.dedupKey).toBe(`security:audit:${ROOT}:lodash:GHSA-x,minimist:GHSA-y`);
    expect(describeBusEvent({ ...event, severity: 'moderate' })?.severity).toBe('info');
    expect(describeBusEvent({ ...event, severity: 'unknown' })?.severity).toBe('warning');
  });

  it('секреты в слоте Swarm: всегда critical, клик в сессию', () => {
    const n = describeBusEvent({ ...event, source: 'secrets', severity: 'critical', swarmId: 'swarm-1', agentId: 'a' });
    expect(n).toMatchObject({ severity: 'critical', sessionId: 'swarm-1', action: { type: 'openSwarm', projectPath: ROOT, sessionId: 'swarm-1' } });
  });

  it('вид в матрице каналов и настройках', () => {
    expect(NOTIFICATION_KINDS).toContain('securityFinding');
    expect(defaultChannelMatrix().securityFinding).toEqual(['tray', 'os', 'telegram', 'remote']);
    // старые настройки без нового вида получают матрицу по умолчанию
    expect(normalizeSettings({ channels: { hitl: ['tray'] } }).channels.securityFinding).toEqual(['tray', 'os', 'telegram', 'remote']);
  });
});
