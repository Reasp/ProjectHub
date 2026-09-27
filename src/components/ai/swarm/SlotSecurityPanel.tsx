import React from 'react';
import { KeyRound, Package, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useTranslation } from '../../../i18n/useTranslation';
import type { AgentSlotSecurity, DependencyChange } from '../../../types/electron';
import { formatDateTime, secretKindLabel } from '../../../utils/securityFormat';

/**
 * Блок «Безопасность» карточки кандидата Swarm Arena (TASK-73.4, decision-56 п. 5): секреты в добавленных строках
 * (вид, файл:строка — без значений), добавленные и изменённые зависимости с датой публикации и флагами registry,
 * число новых пакетов в lock-файле. Чистый результат — одна зелёная строка.
 */
export const SlotSecurityPanel: React.FC<{ security?: AgentSlotSecurity }> = ({ security }) => {
  const { t, language } = useTranslation();
  const s = t.security;
  if (!security) return null;

  const deps = security.dependencies.filter((d) => d.kind !== 'removed');
  const removed = security.dependencies.filter((d) => d.kind === 'removed');
  const hasFindings = security.secrets.length > 0 || deps.length > 0 || security.lockChanges.length > 0;

  if (!hasFindings) {
    return (
      <div className="px-4 py-1.5 border-b border-border/60 text-[11px] text-emerald-400/90 flex items-center gap-1.5" data-testid="slot-security-clean">
        <ShieldCheck className="w-3.5 h-3.5" />
        {s.slotTitle}: {s.slotClean}
        {security.secretsSuppressed > 0 && <span className="text-muted-foreground">· {s.slotSuppressed.replace('{n}', String(security.secretsSuppressed))}</span>}
      </div>
    );
  }

  const registryNote = (d: DependencyChange): string => {
    if (d.registry?.publishedAt) return s.slotPublished.replace('{at}', formatDateTime(Date.parse(d.registry.publishedAt), language));
    if (d.ecosystem !== 'npm' || d.source !== 'registry') return '';
    if (security.registry === 'disabled') return s.slotLookupsOff;
    return s.slotNotQueried;
  };

  return (
    <div className="px-4 py-2 border-b border-border/60 bg-amber-500/5 text-[11px] space-y-1.5" data-testid="slot-security">
      <div className="flex items-center gap-1.5 font-semibold text-amber-300">
        <ShieldAlert className="w-3.5 h-3.5" />
        {s.slotTitle}
        {security.secretsTruncated && <span className="font-normal text-muted-foreground">· {s.slotTruncated}</span>}
        {security.secretsSuppressed > 0 && (
          <span className="font-normal text-muted-foreground">· {s.slotSuppressed.replace('{n}', String(security.secretsSuppressed))}</span>
        )}
      </div>

      {security.secrets.length > 0 && (
        <div data-testid="slot-security-secrets">
          <div className="flex items-center gap-1.5 text-rose-300 font-medium">
            <KeyRound className="w-3 h-3" />
            {s.slotSecrets.replace('{n}', String(security.secrets.length))}
          </div>
          <ul className="mt-0.5 ml-4 space-y-0.5 text-rose-200/90">
            {security.secrets.slice(0, 8).map((f, i) => (
              <li key={`${f.kind}-${f.file}-${f.line ?? i}`} className="font-mono">
                {secretKindLabel(f.kind, t)} — {f.file}
                {f.line ? `:${f.line}` : ''}
              </li>
            ))}
            {security.secrets.length > 8 && <li className="text-muted-foreground">… +{security.secrets.length - 8}</li>}
          </ul>
        </div>
      )}

      {(deps.length > 0 || security.lockChanges.length > 0) && (
        <div data-testid="slot-security-deps">
          <div className="flex items-center gap-1.5 text-amber-200 font-medium">
            <Package className="w-3 h-3" />
            {s.slotDependencies}
          </div>
          <ul className="mt-0.5 ml-4 space-y-0.5">
            {deps.slice(0, 12).map((d) => (
              <li key={`${d.manifest}:${d.name}`} className="flex flex-wrap items-center gap-x-1.5 text-foreground/90">
                <span className="font-mono">{d.name}</span>
                <span className="font-mono text-muted-foreground">
                  {d.kind === 'changed' ? `${d.from ?? '?'} → ${d.to ?? '?'}` : d.resolved ?? d.to}
                </span>
                {d.kind === 'changed' && <span className="text-muted-foreground">({s.slotChanged})</span>}
                {d.manifest !== 'package.json' && <span className="text-muted-foreground">· {d.manifest}</span>}
                {registryNote(d) && <span className="text-muted-foreground">· {registryNote(d)}</span>}
                {(d.flags ?? []).map((flag) => (
                  <span
                    key={flag}
                    className={`px-1 rounded border ${flag === 'not_found' ? 'border-rose-500/50 text-rose-300 bg-rose-500/10' : 'border-amber-500/40 text-amber-300 bg-amber-500/10'}`}
                  >
                    {s.slotFlags[flag]}
                  </span>
                ))}
              </li>
            ))}
            {deps.length > 12 && <li className="text-muted-foreground">… +{deps.length - 12}</li>}
            {security.lockChanges.map((l) => (
              <li key={l.manifest} className="text-muted-foreground">
                {s.slotLock.replace('{n}', String(l.added)).replace('{file}', l.manifest)}
                {l.sample.length ? `: ${l.sample.slice(0, 6).join(', ')}${l.added > 6 ? '…' : ''}` : ''}
              </li>
            ))}
            {removed.length > 0 && (
              <li className="text-muted-foreground">
                {s.slotRemoved}: {removed.map((d) => d.name).join(', ')}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
