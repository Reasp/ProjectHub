/**
 * Артефакты визуальных проверок (`ui-smoke`): скриншоты и trace (TASK-78, decision-55 п. 4–7).
 *
 * Чистый модуль без Electron и файловой системы: какие файлы считаются артефактами, лимиты,
 * план ротации хранилища `<userData>/visual`, проверка пути при чтении и разрешение ссылок на
 * скриншоты из отчёта агента Done-loop. Файлы копирует и удаляет `visualArtifactService`.
 */
import path from 'node:path';
import { isInsideProject } from './pathGuard.js';
import type { CheckArtifact, CheckArtifactKind, CheckDefinition, CheckRunResult } from './arenaTypes.js';

/** Имя переменной окружения и плейсхолдер команды с каталогом артефактов проверки. */
export const ARTIFACTS_DIR_ENV = 'PROJECTHUB_ARTIFACTS_DIR';
export const ARTIFACTS_DIR_PLACEHOLDER = '${artifactsDir}';

/** Сколько скриншотов должна оставить проверка `ui-smoke` по умолчанию. */
export const DEFAULT_MIN_SCREENSHOTS = 1;

export interface ArtifactLimits {
  maxFileBytes: number;
  maxFilesPerCheck: number;
  maxBytesPerCheck: number;
}

export const DEFAULT_ARTIFACT_LIMITS: ArtifactLimits = {
  maxFileBytes: 15 * 1024 * 1024,
  maxFilesPerCheck: 40,
  maxBytesPerCheck: 60 * 1024 * 1024
};

export interface StoreLimits {
  maxBytes: number;
  maxAgeMs: number;
}

export const DEFAULT_STORE_LIMITS: StoreLimits = {
  maxBytes: 1024 * 1024 * 1024,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000
};

const SCREENSHOT_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const TRACE_EXT = new Set(['.zip']);

/** Вид артефакта по расширению; `null` — файл не собирается (логи, markdown, видео). */
export function artifactKindOf(fileName: string): CheckArtifactKind | null {
  const ext = path.extname(fileName ?? '').toLowerCase();
  if (SCREENSHOT_EXT.has(ext)) return 'screenshot';
  if (TRACE_EXT.has(ext)) return 'trace';
  return null;
}

export function isUiSmokeCheck(def: Pick<CheckDefinition, 'kind'>): boolean {
  return def.kind === 'ui-smoke';
}

/** Каталог артефактов в команде: `${artifactsDir}` → путь (кавычки ставит автор команды). */
export function substituteArtifactsDir(command: string, dir: string): string {
  return command.split(ARTIFACTS_DIR_PLACEHOLDER).join(dir);
}

/** Имя каталога без символов, опасных для пути (id сессии, агента, проверки). */
export function safeSegment(value: string): string {
  const cleaned = String(value ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 80);
  return cleaned || 'x';
}

/** Относительный путь каталога проверки внутри `<userData>/visual` (всегда с `/`). */
export function checkArtifactsRelDir(parts: { scope: string; agentId?: string; run: string; checkId: string }): string {
  return [parts.scope, parts.agentId ?? 'main', parts.run, parts.checkId].map(safeSegment).join('/');
}

/**
 * Пути `artifacts.from` относительно рабочего каталога. Абсолютные и выходящие наружу пути
 * отбрасываются: проверка не может утащить в хранилище файлы машины.
 */
export function resolveArtifactSources(workdir: string, from: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of from ?? []) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    if (path.isAbsolute(raw)) continue;
    if (!isInsideProject(workdir, raw)) continue;
    const abs = path.resolve(workdir, raw);
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}

export interface ArtifactCandidate {
  /** Абсолютный путь исходного файла. */
  sourcePath: string;
  /** Путь внутри каталога проверки, с `/` (`home.png`, `test-results/smoke/shot.png`). */
  name: string;
  bytes: number;
}

export interface ArtifactSelection {
  selected: Array<ArtifactCandidate & { kind: CheckArtifactKind }>;
  truncated: boolean;
}

/**
 * Отбор файлов для хранилища: только известные виды, по лимитам файла, числа и объёма.
 * Скриншоты раньше trace (evidence важнее), внутри вида — по имени, чтобы порядок был стабилен.
 */
export function selectArtifacts(candidates: readonly ArtifactCandidate[], limits: ArtifactLimits = DEFAULT_ARTIFACT_LIMITS): ArtifactSelection {
  const typed = candidates
    .map((c) => ({ ...c, name: c.name.replace(/\\/g, '/'), kind: artifactKindOf(c.name) }))
    .filter((c): c is ArtifactCandidate & { kind: CheckArtifactKind } => c.kind !== null);
  typed.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'screenshot' ? -1 : 1));

  const selected: ArtifactSelection['selected'] = [];
  const seen = new Set<string>();
  let total = 0;
  let truncated = false;
  for (const c of typed) {
    if (seen.has(c.name)) continue;
    if (c.bytes > limits.maxFileBytes || selected.length >= limits.maxFilesPerCheck || total + c.bytes > limits.maxBytesPerCheck) {
      truncated = true;
      continue;
    }
    seen.add(c.name);
    selected.push(c);
    total += c.bytes;
  }
  return { selected, truncated };
}

export function screenshotCount(result: Pick<CheckRunResult, 'artifacts'>): number {
  return (result.artifacts ?? []).filter((a) => a.kind === 'screenshot').length;
}

/**
 * `ui-smoke` с кодом 0, но без скриншотов — провал: пустой прогон не выдаётся за визуальную
 * проверку (decision-55 п. 4). Мутирует результат, как `executeCheck`.
 */
export function enforceMinScreenshots(result: CheckRunResult, minScreenshots = DEFAULT_MIN_SCREENSHOTS): void {
  if (result.status !== 'passed' || minScreenshots <= 0) return;
  const count = screenshotCount(result);
  if (count >= minScreenshots) return;
  result.status = 'failed';
  result.detail = `нет скриншотов: найдено ${count}, нужно не меньше ${minScreenshots}`;
}

export interface StoreEntry {
  /** Каталог верхнего уровня хранилища (`swarm-<id>`, `adhoc`). */
  key: string;
  bytes: number;
  /** Время последнего изменения каталога. */
  mtimeMs: number;
}

/**
 * Какие каталоги верхнего уровня удалить: старше `maxAgeMs`, затем самые старые, пока объём не
 * войдёт в `maxBytes`. Каталоги из `keep` (текущая сессия) не удаляются никогда.
 */
export function planStorePrune(
  entries: readonly StoreEntry[],
  options: StoreLimits & { now: number; keep?: ReadonlySet<string> }
): string[] {
  const keep = options.keep ?? new Set<string>();
  const remove = new Set<string>();
  for (const e of entries) {
    if (!keep.has(e.key) && options.now - e.mtimeMs > options.maxAgeMs) remove.add(e.key);
  }
  let total = entries.filter((e) => !remove.has(e.key)).reduce((sum, e) => sum + e.bytes, 0);
  const byAge = entries.filter((e) => !remove.has(e.key) && !keep.has(e.key)).sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const e of byAge) {
    if (total <= options.maxBytes) break;
    remove.add(e.key);
    total -= e.bytes;
  }
  return entries.filter((e) => remove.has(e.key)).map((e) => e.key);
}

/** Абсолютный путь артефакта для чтения; `null` — путь пустой или выходит за хранилище. */
export function resolveArtifactReadPath(root: string, relPath: string): string | null {
  if (typeof relPath !== 'string' || !relPath.trim() || relPath.includes('\0')) return null;
  if (path.isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath)) return null;
  if (!isInsideProject(root, relPath)) return null;
  const abs = path.resolve(root, relPath);
  return abs === path.resolve(root) ? null : abs;
}

export function mimeOfArtifact(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  if (ext === '.zip') return 'application/zip';
  return 'application/octet-stream';
}

/** Артефакт проверки вместе с id проверки — для разрешения ссылок из отчёта. */
export interface IterationArtifact {
  checkId: string;
  artifact: CheckArtifact;
}

/** Скриншоты всех проверок итерации. */
export function iterationScreenshots(checks: readonly CheckRunResult[]): IterationArtifact[] {
  const out: IterationArtifact[] = [];
  for (const c of checks) {
    for (const a of c.artifacts ?? []) if (a.kind === 'screenshot') out.push({ checkId: c.id, artifact: a });
  }
  return out;
}

export type ScreenshotRefResolution =
  | { ok: true; match: IterationArtifact }
  | { ok: false; error: 'not_found' | 'ambiguous'; candidates?: string[] };

/**
 * Ссылка агента на скриншот: путь внутри каталога проверки (`home.png`, `smoke/home.png`),
 * `<checkId>/<путь>` или однозначное имя файла. Регистр имени не учитывается.
 */
export function resolveScreenshotRef(ref: string, screenshots: readonly IterationArtifact[]): ScreenshotRefResolution {
  const norm = String(ref ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  if (!norm) return { ok: false, error: 'not_found' };
  const label = (s: IterationArtifact) => `${s.checkId}/${s.artifact.name}`;

  const exact = screenshots.filter((s) => s.artifact.name.toLowerCase() === norm || label(s).toLowerCase() === norm);
  if (exact.length === 1) return { ok: true, match: exact[0] };
  if (exact.length > 1) return { ok: false, error: 'ambiguous', candidates: exact.map(label) };

  const base = norm.split('/').pop() ?? norm;
  const byBase = screenshots.filter((s) => (s.artifact.name.split('/').pop() ?? '').toLowerCase() === base);
  if (byBase.length === 1) return { ok: true, match: byBase[0] };
  if (byBase.length > 1) return { ok: false, error: 'ambiguous', candidates: byBase.map(label) };
  return { ok: false, error: 'not_found' };
}
