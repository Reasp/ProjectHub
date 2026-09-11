import type {
  CandidateScore,
  CheckRunResult,
  CheckStatus,
  CriterionVerdict,
  ReviewSeverity,
  ScoreComponentKey
} from '../types/electron';
import type { TranslationDictionary } from '../i18n/types';

/**
 * Форматирование результатов автосудьи для рендерера (TASK-61).
 * Логика подсчёта живёт в main (`electron/services/arenaScoring.ts`); здесь только подписи и цвета.
 */

export function checkStatusLabel(status: CheckStatus, t: TranslationDictionary['judge']): string {
  switch (status) {
    case 'pending':
      return t.checkStatusPending;
    case 'running':
      return t.checkStatusRunning;
    case 'passed':
      return t.checkStatusPassed;
    case 'failed':
      return t.checkStatusFailed;
    case 'timeout':
      return t.checkStatusTimeout;
    case 'skipped':
      return t.checkStatusSkipped;
    default:
      return t.checkStatusError;
  }
}

export function checkStatusClass(status: CheckStatus): string {
  switch (status) {
    case 'passed':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    case 'failed':
    case 'error':
      return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
    case 'timeout':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    case 'running':
      return 'bg-primary/10 text-primary border-primary/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

/** Сводка по набору проверок для бейджа в карточке кандидата. */
export function checksSummary(checks: CheckRunResult[] | undefined): {
  passed: number;
  failed: number;
  running: number;
  total: number;
  blockedByFailure: boolean;
} {
  const list = checks ?? [];
  const counted = list.filter((c) => c.status !== 'skipped' && c.status !== 'pending');
  return {
    passed: list.filter((c) => c.status === 'passed').length,
    failed: list.filter((c) => c.status === 'failed' || c.status === 'timeout' || c.status === 'error').length,
    running: list.filter((c) => c.status === 'running').length,
    total: counted.length,
    blockedByFailure: list.some(
      (c) => c.blocking && (c.status === 'failed' || c.status === 'timeout' || c.status === 'error')
    )
  };
}

export function componentLabel(key: ScoreComponentKey, t: TranslationDictionary['judge']): string {
  switch (key) {
    case 'checks':
      return t.componentChecks;
    case 'acceptance':
      return t.componentAcceptance;
    case 'review':
      return t.componentReview;
    case 'diffSize':
      return t.componentDiffSize;
    case 'locality':
      return t.componentLocality;
    case 'cost':
      return t.componentCost;
    default:
      return t.componentTime;
  }
}

export function verdictLabel(verdict: CriterionVerdict, t: TranslationDictionary['judge']): string {
  switch (verdict) {
    case 'met':
      return t.verdictMet;
    case 'partial':
      return t.verdictPartial;
    case 'unmet':
      return t.verdictUnmet;
    default:
      return t.verdictUnknown;
  }
}

export function verdictClass(verdict: CriterionVerdict): string {
  switch (verdict) {
    case 'met':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    case 'partial':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    case 'unmet':
      return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function severityLabel(severity: ReviewSeverity, t: TranslationDictionary['judge']): string {
  switch (severity) {
    case 'critical':
      return t.severityCritical;
    case 'major':
      return t.severityMajor;
    case 'minor':
      return t.severityMinor;
    default:
      return t.severityInfo;
  }
}

export function severityClass(severity: ReviewSeverity): string {
  switch (severity) {
    case 'critical':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/40';
    case 'major':
      return 'bg-orange-500/10 text-orange-300 border-orange-500/30';
    case 'minor':
      return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
    default:
      return 'bg-secondary text-muted-foreground border-border';
  }
}

/** Цвет числа балла: зелёный у сильного кандидата, красный у заблокированного. */
export function scoreClass(score: CandidateScore | undefined): string {
  if (!score) return 'text-muted-foreground';
  if (score.blocked) return 'text-rose-400';
  if (score.total >= 80) return 'text-emerald-400';
  if (score.total >= 55) return 'text-amber-400';
  return 'text-muted-foreground';
}

export function formatScore(score: CandidateScore | undefined): string {
  if (!score) return '—';
  return score.total.toFixed(1);
}
