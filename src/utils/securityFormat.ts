import type { AuditSeverity, DiffSecretFinding, DiffSecretKind } from '../types/electron';

/** Порядок уровней в сводке — от серьёзных к лёгким (как `AUDIT_SEVERITIES` в main). */
export const SEVERITY_ORDER: AuditSeverity[] = ['critical', 'high', 'moderate', 'low', 'info', 'unknown'];

/** Цвет плашки уровня; нулевой счётчик — приглушённый. */
export function severityClass(severity: AuditSeverity, active: boolean): string {
  if (!active) return 'border-slate-800 bg-slate-900/40 text-slate-500';
  switch (severity) {
    case 'critical':
      return 'border-rose-600/60 bg-rose-950/60 text-rose-300';
    case 'high':
      return 'border-orange-600/60 bg-orange-950/50 text-orange-300';
    case 'moderate':
      return 'border-amber-600/50 bg-amber-950/40 text-amber-300';
    case 'low':
      return 'border-sky-700/50 bg-sky-950/40 text-sky-300';
    case 'unknown':
      return 'border-fuchsia-700/50 bg-fuchsia-950/40 text-fuchsia-300';
    default:
      return 'border-slate-700 bg-slate-800/60 text-slate-300';
  }
}

export function formatDateTime(ts: number, language: string): string {
  try {
    return new Date(ts).toLocaleString(language === 'en' ? 'en-US' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return new Date(ts).toISOString();
  }
}

type SecretLabels = { memory: { secretKinds: Record<string, string> }; security: { envFile: string } };

/** Подпись вида секрета: словарь памяти (общий детектор) плюс `env_file`. */
export function secretKindLabel(kind: DiffSecretKind, t: SecretLabels): string {
  if (kind === 'env_file') return t.security.envFile;
  return t.memory.secretKinds[kind] ?? kind;
}

/** Список находок для диалога: «• ключ провайдера LLM — src/config.ts:2», не больше `max` строк. */
export function formatSecretFindings(findings: DiffSecretFinding[], t: SecretLabels, max = 12): string {
  const lines = findings.slice(0, max).map((f) => `• ${secretKindLabel(f.kind, t)} — ${f.file}${f.line ? `:${f.line}` : ''}`);
  if (findings.length > max) lines.push(`… +${findings.length - max}`);
  return lines.join('\n');
}
