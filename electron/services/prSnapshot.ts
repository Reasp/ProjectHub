/**
 * Снимок открытых PR проекта и его разница для событий `pr:opened` / `pr:updated`
 * (TASK-81, decision-53 п. 1). Чистый модуль: опрос `gh` и хранение снимка — в `prWatcher`.
 */

export interface PrInfo {
  number: number;
  title: string;
  url: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  draft: boolean;
  author?: string;
}

export interface PrSnapshotEntry {
  headSha: string;
  draft: boolean;
}

export interface PrProjectSnapshot {
  /** Номер PR → голова и признак черновика. */
  prs: Record<string, PrSnapshotEntry>;
  /** Когда проект впервые опрошен: с этого момента PR сравниваются, а не принимаются как данность. */
  baselineAt: number;
  updatedAt: number;
}

export type PrChangeReason = 'new' | 'commits' | 'ready';

export interface PrChange {
  kind: 'opened' | 'updated';
  reason: PrChangeReason;
  pr: PrInfo;
  previousSha?: string;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Разбор `gh pr list --json number,title,url,headRefOid,headRefName,baseRefName,isDraft,author`. */
export function parseGhPrList(raw: string): PrInfo[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: PrInfo[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const number = typeof r.number === 'number' ? r.number : Number.parseInt(String(r.number), 10);
    const headSha = toText(r.headRefOid);
    if (!Number.isInteger(number) || number <= 0 || !headSha) continue;
    const author = r.author && typeof r.author === 'object' ? toText((r.author as Record<string, unknown>).login) : '';
    out.push({
      number,
      title: toText(r.title) || `#${number}`,
      url: toText(r.url),
      headSha,
      headRef: toText(r.headRefName),
      baseRef: toText(r.baseRefName),
      draft: r.isDraft === true,
      ...(author ? { author } : {})
    });
  }
  return out;
}

/**
 * Что изменилось с прошлого опроса. Первый опрос проекта — только базовая линия: уже открытые PR
 * событий не дают, иначе включение правила запустило бы ревью всех старых PR разом. Закрытые PR
 * просто выпадают из снимка; повторно открытый PR снова даст `opened`.
 */
export function diffPrSnapshot(
  prev: PrProjectSnapshot | undefined,
  current: PrInfo[],
  now: number
): { changes: PrChange[]; next: PrProjectSnapshot } {
  const prs: Record<string, PrSnapshotEntry> = {};
  for (const pr of current) prs[String(pr.number)] = { headSha: pr.headSha, draft: pr.draft };
  const next: PrProjectSnapshot = { prs, baselineAt: prev?.baselineAt ?? now, updatedAt: now };
  if (!prev) return { changes: [], next };

  const changes: PrChange[] = [];
  for (const pr of current) {
    const before = prev.prs[String(pr.number)];
    if (!before) {
      changes.push({ kind: 'opened', reason: 'new', pr });
    } else if (before.headSha !== pr.headSha) {
      changes.push({ kind: 'updated', reason: 'commits', pr, previousSha: before.headSha });
    } else if (before.draft && !pr.draft) {
      changes.push({ kind: 'updated', reason: 'ready', pr, previousSha: before.headSha });
    }
  }
  return { changes, next };
}
