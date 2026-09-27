/**
 * Изменения зависимостей в результате агента (decision-56 п. 5, TASK-73).
 *
 * Сравниваются две версии файлов — базовой ветки и worktree кандидата, — а не строки патча: JSON из кусков hunk
 * не собрать надёжно. `package.json` — по секциям зависимостей, `package-lock.json` — по новым записям `packages`
 * (транзитивные), `requirements*.txt` — по требованиям. Метаданные registry (`npm view … time deprecated --json`)
 * разбираются здесь же, флаги риска считаются от них.
 *
 * Чистый модуль: без Electron, процессов и файловой системы.
 */

export const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
export type DepSection = (typeof DEP_SECTIONS)[number];

/** Откуда берётся пакет: только `registry` проверяется запросом к registry. */
export type DependencySource = 'registry' | 'git' | 'file' | 'url' | 'workspace' | 'alias';

export type DependencyRiskFlag = 'not_found' | 'recent' | 'young' | 'deprecated';

/** Версия моложе этого — `recent` (свежий релиз: окно, когда вредоносную версию ещё не сняли). */
export const RECENT_VERSION_DAYS = 7;
/** Пакет моложе этого — `young` (новое имя: опечатка, захват имени, выдуманный моделью пакет). */
export const YOUNG_PACKAGE_DAYS = 30;
/** Сколько пакетов слота проверяется в registry. */
export const MAX_REGISTRY_LOOKUPS = 20;

export interface RegistryMeta {
  /** Дата публикации запрошенной версии (ISO). */
  publishedAt?: string;
  /** Дата создания пакета (ISO). */
  createdAt?: string;
  deprecated?: string;
  /** Registry ответил 404 — пакета нет. */
  notFound?: boolean;
  /** Запрос не удался (сеть, тайм-аут) — данных нет, это не флаг риска. */
  error?: string;
}

export interface DependencyChange {
  ecosystem: 'npm' | 'pip';
  /** Путь манифеста относительно корня (`package.json`, `apps/web/package.json`, `requirements.txt`). */
  manifest: string;
  name: string;
  section?: DepSection;
  kind: 'added' | 'changed' | 'removed';
  /** Спецификация до и после (`^1.2.0`, `==2.31.0`). */
  from?: string;
  to?: string;
  source: DependencySource;
  /** Версия, реально записанная в lock-файл worktree. */
  resolved?: string;
  registry?: RegistryMeta;
  flags?: DependencyRiskFlag[];
}

export interface LockChange {
  manifest: string;
  /** Новые записи `packages` (с транзитивными). */
  added: number;
  /** Первые имена — для подсказки в карточке. */
  sample: string[];
}

function parseJsonObject(text: string | null | undefined): Record<string, unknown> | null {
  if (!text || !text.trim()) return null;
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function dependencySource(spec: string | undefined): DependencySource {
  const s = (spec ?? '').trim();
  if (/^workspace:/i.test(s)) return 'workspace';
  if (/^npm:/i.test(s)) return 'alias';
  if (/^(?:file:|link:|\.{0,2}\/)/i.test(s)) return 'file';
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:)/i.test(s) || /^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(s)) return 'git';
  if (/^https?:/i.test(s)) return 'url';
  return 'registry';
}

function sectionMap(json: Record<string, unknown> | null, section: DepSection): Record<string, string> {
  const raw = json?.[section];
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [name, spec] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof spec === 'string') out[name] = spec;
    }
  }
  return out;
}

/**
 * Изменения по секциям `package.json`. Пакет, переехавший из `devDependencies` в `dependencies` с той же версией,
 * не считается новым: он уже был в проекте.
 */
export function diffManifestDependencies(manifest: string, baseText: string | null, headText: string | null): DependencyChange[] {
  const base = parseJsonObject(baseText);
  const head = parseJsonObject(headText);
  if (!head && !base) return [];
  const baseAll = new Map<string, string>();
  for (const section of DEP_SECTIONS) for (const [n, s] of Object.entries(sectionMap(base, section))) baseAll.set(n, s);
  const changes: DependencyChange[] = [];
  for (const section of DEP_SECTIONS) {
    const before = sectionMap(base, section);
    const after = sectionMap(head, section);
    for (const [name, to] of Object.entries(after)) {
      const from = before[name];
      if (from === undefined) {
        const elsewhere = baseAll.get(name);
        if (elsewhere === to) continue;
        changes.push({
          ecosystem: 'npm',
          manifest,
          name,
          section,
          kind: elsewhere === undefined ? 'added' : 'changed',
          ...(elsewhere !== undefined ? { from: elsewhere } : {}),
          to,
          source: dependencySource(to)
        });
      } else if (from !== to) {
        changes.push({ ecosystem: 'npm', manifest, name, section, kind: 'changed', from, to, source: dependencySource(to) });
      }
    }
    for (const [name, from] of Object.entries(before)) {
      if (after[name] !== undefined) continue;
      const movedTo = DEP_SECTIONS.some((s) => s !== section && sectionMap(head, s)[name] !== undefined);
      if (!movedTo) changes.push({ ecosystem: 'npm', manifest, name, section, kind: 'removed', from, source: dependencySource(from) });
    }
  }
  return changes;
}

function lockPackages(json: Record<string, unknown> | null): Record<string, Record<string, unknown>> {
  const packages = json?.packages;
  return packages && typeof packages === 'object' && !Array.isArray(packages) ? (packages as Record<string, Record<string, unknown>>) : {};
}

/** Имя пакета из ключа lock v2/v3: `node_modules/a/node_modules/@s/b` → `@s/b`. */
export function packageNameFromLockKey(key: string): string {
  const idx = key.lastIndexOf('node_modules/');
  return idx >= 0 ? key.slice(idx + 'node_modules/'.length) : key;
}

/** Новые записи `packages` lock-файла (v2/v3); корень `""` и ссылки рабочих областей не считаются. */
export function diffLockPackages(manifest: string, baseText: string | null, headText: string | null): LockChange | null {
  const head = parseJsonObject(headText);
  if (!head) return null;
  const before = lockPackages(parseJsonObject(baseText));
  const after = lockPackages(head);
  const added: string[] = [];
  for (const [key, entry] of Object.entries(after)) {
    if (!key || !key.includes('node_modules/') || entry?.link === true) continue;
    if (!(key in before)) added.push(packageNameFromLockKey(key));
  }
  if (added.length === 0) return null;
  const unique = [...new Set(added)].sort();
  return { manifest, added: added.length, sample: unique.slice(0, 10) };
}

/** Версия пакета верхнего уровня из lock-файла worktree (для запроса в registry по точной версии). */
export function resolvedLockVersion(lockText: string | null, name: string, manifestDir = ''): string | undefined {
  const packages = lockPackages(parseJsonObject(lockText));
  const prefix = manifestDir ? `${manifestDir.replace(/\/+$/, '')}/` : '';
  const entry = packages[`${prefix}node_modules/${name}`] ?? packages[`node_modules/${name}`];
  return typeof entry?.version === 'string' ? entry.version : undefined;
}

/** PEP 503: имена сравниваются без регистра, `-`, `_`, `.` равнозначны. */
export function normalizePipName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

/** Требования из `requirements*.txt`: имя → спецификация (`==2.31.0`, `>=1`, `` для голого имени). */
export function parseRequirements(text: string | null): Map<string, { name: string; spec: string }> {
  const out = new Map<string, { name: string; spec: string }>();
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*?)\s*(?:;.*)?$/);
    if (!m) continue;
    out.set(normalizePipName(m[1]), { name: m[1], spec: m[3].trim() });
  }
  return out;
}

export function diffRequirements(manifest: string, baseText: string | null, headText: string | null): DependencyChange[] {
  const before = parseRequirements(baseText);
  const after = parseRequirements(headText);
  const changes: DependencyChange[] = [];
  for (const [key, { name, spec }] of after) {
    const prev = before.get(key);
    if (!prev) changes.push({ ecosystem: 'pip', manifest, name, kind: 'added', to: spec, source: 'registry' });
    else if (prev.spec !== spec) changes.push({ ecosystem: 'pip', manifest, name, kind: 'changed', from: prev.spec, to: spec, source: 'registry' });
  }
  for (const [key, { name, spec }] of before) {
    if (!after.has(key)) changes.push({ ecosystem: 'pip', manifest, name, kind: 'removed', from: spec, source: 'registry' });
  }
  return changes;
}

/** Какие файлы диффа разбирать: манифесты вне `node_modules`. */
export function dependencyFilesInDiff(files: string[]): { manifests: string[]; locks: string[]; requirements: string[] } {
  const clean = files.filter((f) => !/(^|\/)node_modules\//.test(f));
  return {
    manifests: clean.filter((f) => /(^|\/)package\.json$/.test(f)),
    locks: clean.filter((f) => /(^|\/)(?:package-lock|npm-shrinkwrap)\.json$/.test(f)),
    requirements: clean.filter((f) => /(^|\/)requirements[\w.-]*\.txt$/i.test(f))
  };
}

// ─────────────────────────────── Registry ───────────────────────────────

/** Имя npm-пакета (с областью). Имя приходит из диффа агента и уходит в команду — только строгий шаблон. */
export const NPM_NAME_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isSafeNpmName(name: string): boolean {
  return name.length <= 214 && NPM_NAME_RE.test(name);
}

export function isExactVersion(version: string | undefined): version is string {
  return typeof version === 'string' && EXACT_VERSION_RE.test(version);
}

/**
 * Спецификация для `npm view`: точная версия из lock или из манифеста (`1.2.3`, `=1.2.3`, `v1.2.3`); иначе только
 * имя — диапазон дал бы массив ответов по многим версиям.
 */
export function registryLookupSpec(change: DependencyChange): string | null {
  if (change.ecosystem !== 'npm' || change.kind === 'removed' || change.source !== 'registry' || !isSafeNpmName(change.name)) return null;
  const fromSpec = change.to?.trim().replace(/^[=v]+/, '');
  const version = isExactVersion(change.resolved) ? change.resolved : isExactVersion(fromSpec) ? fromSpec : undefined;
  return version ? `${change.name}@${version}` : change.name;
}

/**
 * Ответ `npm view <spec> time deprecated --json`. Проверено на npm 10.9: при наличии `deprecated` — объект
 * `{ time: {...}, deprecated }`, без него — сама карта `time` (`{ created, modified, "1.0.0": ... }`); несуществующий
 * пакет — `{ error: { code: "E404" } }`.
 */
export function parseNpmViewOutput(stdout: string, version?: string, stderr = ''): RegistryMeta {
  let data: unknown;
  try {
    data = JSON.parse((stdout ?? '').trim() || 'null');
  } catch {
    data = null;
  }
  const obj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const err = obj?.error as Record<string, unknown> | undefined;
  if (err && typeof err === 'object') {
    if (err.code === 'E404') return { notFound: true };
    return { error: String(err.summary ?? err.code ?? 'ошибка npm view').split('\n')[0].slice(0, 200) };
  }
  if (!obj) {
    if (/E404/.test(stderr)) return { notFound: true };
    return { error: (stderr.split(/\r?\n/).find((l) => l.trim()) ?? 'npm view не вернул JSON').slice(0, 200) };
  }
  const time = (obj.time && typeof obj.time === 'object' ? obj.time : 'created' in obj || 'modified' in obj ? obj : {}) as Record<string, unknown>;
  const meta: RegistryMeta = {};
  if (typeof time.created === 'string') meta.createdAt = time.created;
  if (version && typeof time[version] === 'string') meta.publishedAt = time[version] as string;
  if (typeof obj.deprecated === 'string' && obj.deprecated.trim()) meta.deprecated = obj.deprecated.trim().slice(0, 300);
  return meta;
}

function ageDays(iso: string | undefined, now: number): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now - t) / 86_400_000 : undefined;
}

export function riskFlags(meta: RegistryMeta | undefined, now: number): DependencyRiskFlag[] {
  if (!meta || meta.error) return [];
  if (meta.notFound) return ['not_found'];
  const flags: DependencyRiskFlag[] = [];
  const versionAge = ageDays(meta.publishedAt, now);
  if (versionAge !== undefined && versionAge < RECENT_VERSION_DAYS) flags.push('recent');
  const packageAge = ageDays(meta.createdAt, now);
  if (packageAge !== undefined && packageAge < YOUNG_PACKAGE_DAYS) flags.push('young');
  if (meta.deprecated) flags.push('deprecated');
  return flags;
}

/** Изменения, требующие взгляда человека при слиянии: всё, кроме удалений. */
export function reviewableChanges(changes: DependencyChange[]): DependencyChange[] {
  return changes.filter((c) => c.kind !== 'removed');
}

export function riskyChanges(changes: DependencyChange[]): DependencyChange[] {
  return changes.filter((c) => (c.flags?.length ?? 0) > 0);
}

/** «+left-pad 1.3.0 [deprecated], lodash ^4.17.20→^4.18.1» — для заголовков HITL и сводки ревьюера. */
export function summarizeDependencyChanges(changes: DependencyChange[], max = 8): string {
  const list = reviewableChanges(changes).map((c) => {
    const version = c.resolved ?? c.to ?? '';
    const flags = c.flags?.length ? ` [${c.flags.join(', ')}]` : '';
    return c.kind === 'added' ? `+${c.name} ${version}${flags}`.trim() : `${c.name} ${c.from ?? '?'}→${c.to ?? '?'}${flags}`;
  });
  return list.slice(0, max).join(', ') + (list.length > max ? ` и ещё ${list.length - max}` : '');
}
