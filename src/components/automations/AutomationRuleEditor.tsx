import React, { useEffect, useMemo, useState } from 'react';
import { Save, X } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import { useProjectStore } from '../../store/useProjectStore';
import { useRolesStore } from '../../store/useRolesStore';
import {
  AUDIT_MIN_SEVERITIES,
  AUTOMATION_ACTIONS,
  AUTOMATION_EVENTS,
  emptyAutomationForm,
  formFromRule,
  ruleFromForm,
  type AuditMinSeverity,
  type AutomationFormState
} from '../../lib/automationForm';
import type { AutomationRule } from '../../types/electron';

/**
 * Редактор правила этой машины (TASK-74, decision-52): триггер, условия выбранного триггера,
 * действие и лимиты. Проверку схемы делает main — ошибка показывается как есть.
 */

interface Props {
  rule?: AutomationRule;
  onSaved: () => void;
  onCancel: () => void;
}

const inputCls = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary';
const labelCls = 'block text-[11px] font-medium text-muted-foreground mb-1';

export const AutomationRuleEditor: React.FC<Props> = ({ rule, onSaved, onCancel }) => {
  const { t } = useTranslation();
  const a = t.automations;
  const e = a.editor;
  const projects = useProjectStore((s) => s.projects);
  const rolesByProject = useRolesStore((s) => s.rolesByProject);
  const loadRoles = useRolesStore((s) => s.loadRolesAction);
  const [form, setForm] = useState<AutomationFormState>(() => (rule ? formFromRule(rule) : emptyAutomationForm()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Роли проекта правила, иначе глобальные: ключ стора ролей — путь проекта или пустая строка.
  const roleProject = form.projects[0];
  useEffect(() => {
    void loadRoles(roleProject);
  }, [loadRoles, roleProject]);
  const roles = useMemo(() => rolesByProject[roleProject || ''] ?? [], [rolesByProject, roleProject]);

  const set = <K extends keyof AutomationFormState>(key: K, value: AutomationFormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const isEvent = form.triggerKind === 'event';
  const isTaskEvent = isEvent && form.event.startsWith('task.');

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await window.api.saveAutomationRule(ruleFromForm(form));
      if (res.ok) onSaved();
      else setError(res.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleProject = (path: string) =>
    set('projects', form.projects.includes(path) ? form.projects.filter((p) => p !== path) : [...form.projects, path]);
  const toggleReviewer = (slug: string) =>
    set('reviewers', form.reviewers.includes(slug) ? form.reviewers.filter((r) => r !== slug) : [...form.reviewers, slug].slice(0, 3));
  const toggleOutcome = (o: 'completed' | 'failed' | 'stopped') =>
    set('outcomes', form.outcomes.includes(o) ? form.outcomes.filter((x) => x !== o) : [...form.outcomes, o]);

  return (
    <div className="rounded-lg border border-primary/40 bg-secondary/10 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{rule ? e.titleEdit.replace('{name}', rule.name) : e.titleNew}</h3>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={form.enabled} onChange={(ev) => set('enabled', ev.target.checked)} />
          {e.enabled}
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{e.name}</label>
          <input className={inputCls} value={form.name} onChange={(ev) => set('name', ev.target.value)} />
        </div>
        <div>
          <label className={labelCls}>{e.id}</label>
          <input className={inputCls} value={form.id} disabled={Boolean(rule)} placeholder={e.idHint} onChange={(ev) => set('id', ev.target.value)} />
        </div>
      </div>

      <section className="space-y-2">
        <div className="text-xs font-semibold">{e.trigger}</div>
        <div className="flex gap-2">
          {(['event', 'cron', 'manual'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => set('triggerKind', kind)}
              className={`px-2.5 py-1 rounded-md border text-xs ${form.triggerKind === kind ? 'border-indigo-400 bg-indigo-500/25 text-indigo-100' : 'border-border text-muted-foreground'}`}
            >
              {e.triggerKinds[kind]}
            </button>
          ))}
        </div>
        {form.triggerKind === 'cron' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{e.cronExpr}</label>
              <input className={`${inputCls} font-mono`} value={form.cronExpr} onChange={(ev) => set('cronExpr', ev.target.value)} />
              <p className="mt-1 text-[10px] text-muted-foreground">{e.cronHint}</p>
            </div>
            <div>
              <label className={labelCls}>{e.catchUp}</label>
              <select className={inputCls} value={form.catchUp} onChange={(ev) => set('catchUp', ev.target.value as 'skip' | 'once')}>
                <option value="skip">{e.catchUpSkip}</option>
                <option value="once">{e.catchUpOnce}</option>
              </select>
            </div>
          </div>
        )}
        {isEvent && (
          <div>
            <label className={labelCls}>{e.event}</label>
            <select className={inputCls} value={form.event} onChange={(ev) => set('event', ev.target.value as AutomationFormState['event'])}>
              {AUTOMATION_EVENTS.map((ev) => (
                <option key={ev} value={ev}>
                  {a.events[ev]}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="text-xs font-semibold">{e.conditions}</div>
        <div>
          <label className={labelCls}>{e.projects}</label>
          <div className="flex flex-wrap gap-1.5">
            {projects.map((p) => (
              <button
                key={p.path}
                type="button"
                title={p.path}
                onClick={() => toggleProject(p.path)}
                className={`px-2 py-0.5 rounded border text-[11px] ${form.projects.includes(p.path) ? 'border-indigo-400 bg-indigo-500/25 text-indigo-100' : 'border-border text-muted-foreground'}`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">{e.projectsHint}</p>
        </div>
        {isTaskEvent && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{e.labels}</label>
              <input className={inputCls} value={form.labels} placeholder={e.listHint} onChange={(ev) => set('labels', ev.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{e.assignee}</label>
              <input className={inputCls} value={form.assignee} placeholder={e.assigneeHint} onChange={(ev) => set('assignee', ev.target.value)} />
            </div>
          </div>
        )}
        {isEvent && form.event === 'task.statusChanged' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{e.statusTo}</label>
              <input className={inputCls} value={form.statusTo} placeholder={e.listHint} onChange={(ev) => set('statusTo', ev.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{e.statusFrom}</label>
              <input className={inputCls} value={form.statusFrom} placeholder={e.listHint} onChange={(ev) => set('statusFrom', ev.target.value)} />
            </div>
          </div>
        )}
        {isEvent && form.event === 'swarm.finished' && (
          <div>
            <label className={labelCls}>{e.outcomes}</label>
            <div className="flex gap-3 text-xs">
              {(['failed', 'completed', 'stopped'] as const).map((o) => (
                <label key={o} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={form.outcomes.includes(o)} onChange={() => toggleOutcome(o)} />
                  {e.outcomeNames[o]}
                </label>
              ))}
            </div>
          </div>
        )}
        {isEvent && form.event === 'process.crashed' && (
          <div>
            <label className={labelCls}>{e.processName}</label>
            <input className={inputCls} value={form.processName} onChange={(ev) => set('processName', ev.target.value)} />
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="text-xs font-semibold">{e.action}</div>
        <select className={inputCls} value={form.actionType} onChange={(ev) => set('actionType', ev.target.value as AutomationFormState['actionType'])}>
          {AUTOMATION_ACTIONS.map((type) => (
            <option key={type} value={type}>
              {a.actions[type]}
            </option>
          ))}
        </select>
        {form.actionType === 'runAgent' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{e.role}</label>
              <select className={inputCls} value={form.roleSlug} onChange={(ev) => set('roleSlug', ev.target.value)}>
                <option value="">{e.rolePlaceholder}</option>
                {roles.map((r) => (
                  <option key={r.slug} value={r.slug}>
                    {r.name} ({r.slug})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>{e.mode}</label>
              <select className={inputCls} value={form.mode} onChange={(ev) => set('mode', ev.target.value as 'single' | 'doneLoop')}>
                <option value="single">{e.modeSingle}</option>
                <option value="doneLoop">{e.modeDoneLoop}</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>{e.prompt}</label>
              <textarea className={`${inputCls} h-16 resize-y`} value={form.prompt} onChange={(ev) => set('prompt', ev.target.value)} />
              <p className="mt-1 text-[10px] text-muted-foreground">{e.promptHint}</p>
            </div>
            {!isTaskEvent && (
              <div>
                <label className={labelCls}>{e.taskId}</label>
                <input className={inputCls} value={form.taskId} placeholder="TASK-1" onChange={(ev) => set('taskId', ev.target.value)} />
              </div>
            )}
            <div>
              <label className={labelCls}>{e.runBudget}</label>
              <input className={inputCls} value={form.runBudgetUsd} onChange={(ev) => set('runBudgetUsd', ev.target.value)} />
            </div>
            {form.mode === 'doneLoop' && (
              <div>
                <label className={labelCls}>{e.maxIterations}</label>
                <input className={inputCls} value={form.maxIterations} onChange={(ev) => set('maxIterations', ev.target.value)} />
              </div>
            )}
          </div>
        )}
        {form.actionType === 'runChecks' && (
          <div>
            <label className={labelCls}>{e.checkIds}</label>
            <input className={inputCls} value={form.checkIds} placeholder={e.checkIdsHint} onChange={(ev) => set('checkIds', ev.target.value)} />
          </div>
        )}
        {form.actionType === 'notify' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{e.notifyTitle}</label>
              <input className={inputCls} value={form.notifyTitle} onChange={(ev) => set('notifyTitle', ev.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{e.notifyBody}</label>
              <input className={inputCls} value={form.notifyBody} onChange={(ev) => set('notifyBody', ev.target.value)} />
            </div>
          </div>
        )}
        {form.actionType === 'auditDependencies' && (
          <div>
            <label className={labelCls}>{e.minSeverity}</label>
            <select className={inputCls} value={form.minSeverity} onChange={(ev) => set('minSeverity', ev.target.value as AuditMinSeverity)}>
              {AUDIT_MIN_SEVERITIES.map((sev) => (
                <option key={sev} value={sev}>
                  {t.security.severity[sev]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-muted-foreground">{e.minSeverityHint}</p>
          </div>
        )}
        {form.actionType === 'projectAction' && (
          <div>
            <label className={labelCls}>{e.actionId}</label>
            <input className={inputCls} value={form.actionId} onChange={(ev) => set('actionId', ev.target.value)} />
            <p className="mt-1 text-[10px] text-muted-foreground">{e.actionIdHint}</p>
          </div>
        )}
        {form.actionType === 'reviewPr' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>{e.reviewers}</label>
              <div className="flex flex-wrap gap-1.5">
                {roles.map((r) => (
                  <button
                    key={r.slug}
                    type="button"
                    onClick={() => toggleReviewer(r.slug)}
                    className={`px-2 py-0.5 rounded border text-[11px] ${form.reviewers.includes(r.slug) ? 'border-indigo-400 bg-indigo-500/25 text-indigo-100' : 'border-border text-muted-foreground'}`}
                  >
                    {r.name} ({r.slug})
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">{e.reviewersHint}</p>
            </div>
            <div>
              <label className={labelCls}>{e.verifier}</label>
              <select className={inputCls} value={form.verifier} onChange={(ev) => set('verifier', ev.target.value)}>
                <option value="">{e.verifierDefault}</option>
                {roles.map((r) => (
                  <option key={r.slug} value={r.slug}>
                    {r.name} ({r.slug})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>{e.reviewBudget}</label>
              <input className={inputCls} value={form.runBudgetUsd} onChange={(ev) => set('runBudgetUsd', ev.target.value)} />
            </div>
            <div>
              <label className={labelCls}>{e.publishMode}</label>
              <select className={inputCls} value={form.publish} onChange={(ev) => set('publish', ev.target.value as 'hitl' | 'manual')}>
                <option value="hitl">{e.publishHitl}</option>
                <option value="manual">{e.publishManual}</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs self-end pb-1.5">
              <input type="checkbox" checked={form.includeDrafts} onChange={(ev) => set('includeDrafts', ev.target.checked)} />
              {e.includeDrafts}
            </label>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="text-xs font-semibold">{e.limits}</div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>{e.cooldown}</label>
            <input className={inputCls} value={form.cooldownMin} onChange={(ev) => set('cooldownMin', ev.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{e.maxRuns}</label>
            <input className={inputCls} value={form.maxRunsPerDay} onChange={(ev) => set('maxRunsPerDay', ev.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{e.dailyBudget}</label>
            <input className={inputCls} value={form.dailyBudgetUsd} onChange={(ev) => set('dailyBudgetUsd', ev.target.value)} />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">{e.dailyBudgetHint}</p>
      </section>

      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 whitespace-pre-wrap">{error}</div>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs">
          <X className="w-3.5 h-3.5" />
          {e.cancel}
        </button>
        <button
          type="button"
          disabled={saving || !form.name.trim()}
          onClick={() => void save()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? e.saving : e.save}
        </button>
      </div>
    </div>
  );
};
