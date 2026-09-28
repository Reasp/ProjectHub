/**
 * Менеджер скиллов проекта (TASK-105, decision-61): список скиллов в `.claude/skills` и `.agents/skills`,
 * расхождения между копиями и копирование скилла — между корнями одного проекта или из источника (шаблон
 * ProjectTemplate, другой зарегистрированный проект, личные скиллы `~/.claude/skills`).
 *
 * Копирование заменяет каталог скилла целиком и атомарно: копия собирается во временном каталоге рядом,
 * сверяется по хэшу с источником и переименовывается на место. Существующий скилл с другим содержимым
 * перезаписывается только при `overwrite: true` (явный выбор человека в UI). Символические ссылки не читаются
 * и не копируются, а цепочка каталогов назначения не должна проходить через ссылку — иначе запись ушла бы за
 * пределы проекта. Логика сравнения — в чистом `skillCatalog.ts`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildSkillCatalog,
  hashSkillFileContent,
  hashSkillFiles,
  isSkillRoot,
  parseSkillMd,
  SKILL_FILE,
  SKILL_IGNORED_NAMES,
  SKILL_LIMITS,
  SKILL_ROOT_KEYS,
  SKILL_ROOTS,
  SKILL_TEMP_PREFIX,
  skillCopyAction,
  skillCopyBlocker,
  summarizeSkillCatalog,
  validateSkillId,
  type SkillCatalogSummary,
  type SkillCopy,
  type SkillCopyAction,
  type SkillEntry,
  type SkillFileEntry,
  type SkillProblem,
  type SkillRoot
} from './skillCatalog.js';

export type SkillSourceKind = 'template' | 'personal' | 'project';

/** Источник, как его присылает рендерер: путь учитывается только у `project` и проверяется по реестру. */
export interface SkillSourceRef {
  kind: SkillSourceKind;
  path?: string;
}

export interface SkillSourceInfo {
  kind: SkillSourceKind;
  /** Базовый каталог источника (корень проекта/шаблона или домашний каталог). */
  path: string;
  label: string;
  available: boolean;
}

export interface ProjectSkillListing {
  projectPath: string;
  entries: SkillEntry[];
  summary: SkillCatalogSummary;
}

export interface SkillImportItem {
  id: string;
  /** Корень источника, из которого будет взята копия. */
  from: SkillRoot;
  name?: string;
  description?: string;
  problems: SkillProblem[];
  /** Почему скилл нельзя скопировать (слишком большой, ссылки, нет SKILL.md). */
  blocker?: string;
  /** В источнике копии этого скилла в двух корнях различаются — показываются обе. */
  sourceDiverged: boolean;
  /** Что произойдёт в каждом корне текущего проекта. */
  actions: Record<SkillRoot, SkillCopyAction>;
}

export interface SkillSourceListing {
  source: SkillSourceInfo;
  items: SkillImportItem[];
}

export interface SkillCopyRequest {
  source: SkillSourceRef;
  fromRoot: SkillRoot;
  id: string;
  toRoots: SkillRoot[];
  /** Разрешить заменить существующий скилл с другим содержимым. */
  overwrite: boolean;
}

export type SkillCopyOutcome = 'created' | 'overwritten' | 'unchanged' | 'skipped';

export interface SkillCopyResult {
  results: Array<{ root: SkillRoot; outcome: SkillCopyOutcome; reason?: string }>;
  listing: ProjectSkillListing;
}

export interface SkillServiceDeps {
  /** Путь к шаблону ProjectTemplate; пустая строка — не задан. */
  templatePath(): Promise<string>;
  homeDir(): string;
  /** Пути зарегистрированных проектов. */
  projects(): Promise<string[]>;
  /** Нормализует путь зарегистрированного проекта, иначе бросает. */
  assertProject(projectPath: string): Promise<string>;
}

async function defaultDeps(): Promise<SkillServiceDeps> {
  const { projectRegistry } = await import('./projectRegistry.js');
  const { assertRegisteredProject } = await import('./projectPathGuard.js');
  const { resolveTemplatePath } = await import('./templateWizard.js');
  const { getHomeDir } = await import('./appPaths.js');
  return {
    templatePath: async () => (await resolveTemplatePath()).path,
    homeDir: () => getHomeDir(),
    projects: async () => (await projectRegistry.getProjects()).map((p) => p.path),
    assertProject: (p) => assertRegisteredProject(p)
  };
}

function rootDir(base: string, root: SkillRoot): string {
  return path.join(base, ...SKILL_ROOTS[root].split('/'));
}

function samePath(a: string, b: string): boolean {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isRegularFile(p: string): Promise<boolean> {
  try {
    return (await fs.lstat(p)).isFile();
  } catch {
    return false;
  }
}

function skipName(name: string): boolean {
  return SKILL_IGNORED_NAMES.has(name) || name.startsWith(SKILL_TEMP_PREFIX);
}

interface WalkState {
  files: Array<SkillFileEntry & { abs: string }>;
  bytes: number;
  symlinks: boolean;
  tooLarge: boolean;
}

/** Обход каталога скилла: только обычные файлы, без ссылок и служебных каталогов, с лимитами. */
async function walkSkillDir(dir: string, rel: string, state: WalkState): Promise<void> {
  const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const e of entries) {
    if (skipName(e.name)) continue;
    const abs = path.join(dir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) {
      state.symlinks = true;
      continue;
    }
    if (e.isDirectory()) {
      await walkSkillDir(abs, relPath, state);
      continue;
    }
    if (!e.isFile() || state.tooLarge) continue;
    const { size } = await fs.stat(abs);
    state.bytes += size;
    if (state.files.length + 1 > SKILL_LIMITS.maxFiles || state.bytes > SKILL_LIMITS.maxBytes) {
      state.tooLarge = true;
      continue;
    }
    state.files.push({ relPath, size, hash: '', abs });
  }
}

/** Чтение одной копии скилла: файлы с хэшами, метаданные `SKILL.md`, проблемы. */
export async function readSkillCopy(skillDir: string, root: SkillRoot, id: string): Promise<SkillCopy> {
  const state: WalkState = { files: [], bytes: 0, symlinks: false, tooLarge: false };
  await walkSkillDir(skillDir, '', state);
  const problems: SkillProblem[] = [];
  let files: SkillFileEntry[] = [];
  let hash = '';
  if (!state.tooLarge) {
    for (const f of state.files) f.hash = hashSkillFileContent(await fs.readFile(f.abs));
    files = state.files.map(({ relPath, size, hash: h }) => ({ relPath, size, hash: h }));
    hash = hashSkillFiles(files);
  }
  let skillMd: string | null = null;
  const mdPath = path.join(skillDir, SKILL_FILE);
  if (await isRegularFile(mdPath)) {
    const buf = await fs.readFile(mdPath);
    skillMd = buf.subarray(0, SKILL_LIMITS.maxPreviewBytes).toString('utf-8');
  }
  const segments = id.split('/');
  const meta = parseSkillMd(skillMd, segments[segments.length - 1]);
  problems.push(...meta.problems);
  if (segments.length > 1) problems.push('nested');
  if (state.tooLarge) problems.push('tooLarge');
  if (state.symlinks) problems.push('symlinks');
  return {
    root,
    id,
    files,
    hash,
    totalBytes: state.bytes,
    ...(meta.name ? { name: meta.name } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    problems,
    skillMd
  };
}

/**
 * Скиллы одного корня. Скилл — подкаталог с `SKILL.md`; подкаталог без него, но с подкаталогами-скиллами —
 * группа (`group/name`, помечается `nested`: Claude Code и Antigravity ищут `<корень>/<имя>/SKILL.md`).
 * Непустой подкаталог без `SKILL.md` и без вложенных скиллов показывается как скилл с проблемой `noSkillMd`.
 */
export async function scanSkillRoot(dir: string, root: SkillRoot): Promise<SkillCopy[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const copies: SkillCopy[] = [];
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!e.isDirectory() || skipName(e.name) || e.name.startsWith('.')) continue;
    const skillDir = path.join(dir, e.name);
    if (await isRegularFile(path.join(skillDir, SKILL_FILE))) {
      copies.push(await readSkillCopy(skillDir, root, e.name));
      continue;
    }
    const subs = (await fs.readdir(skillDir, { withFileTypes: true })).filter((s) => !skipName(s.name) && !s.name.startsWith('.'));
    let nested = 0;
    for (const s of subs.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!s.isDirectory()) continue;
      const sub = path.join(skillDir, s.name);
      if (await isRegularFile(path.join(sub, SKILL_FILE))) {
        copies.push(await readSkillCopy(sub, root, `${e.name}/${s.name}`));
        nested++;
      }
    }
    if (nested === 0 && subs.length > 0) copies.push(await readSkillCopy(skillDir, root, e.name));
  }
  return copies;
}

async function scanBase(base: string, roots: SkillRoot[], dirs?: Partial<Record<SkillRoot, string>>): Promise<SkillCopy[]> {
  const copies: SkillCopy[] = [];
  for (const root of roots) copies.push(...(await scanSkillRoot(dirs?.[root] ?? rootDir(base, root), root)));
  return copies;
}

export async function listProjectSkills(projectPath: string): Promise<ProjectSkillListing> {
  const entries = buildSkillCatalog(await scanBase(projectPath, SKILL_ROOT_KEYS));
  return { projectPath, entries, summary: summarizeSkillCatalog(entries) };
}

interface ResolvedSource {
  info: SkillSourceInfo;
  dirs: Partial<Record<SkillRoot, string>>;
}

async function resolveSource(ref: SkillSourceRef, d: SkillServiceDeps): Promise<ResolvedSource> {
  if (ref.kind === 'template') {
    const base = await d.templatePath();
    if (!base) throw new Error('Путь к шаблону ProjectTemplate не задан');
    return {
      info: { kind: 'template', path: base, label: path.basename(base), available: await isDir(base) },
      dirs: { claude: rootDir(base, 'claude'), agents: rootDir(base, 'agents') }
    };
  }
  if (ref.kind === 'personal') {
    const home = d.homeDir();
    const dir = rootDir(home, 'claude');
    return { info: { kind: 'personal', path: home, label: '~/.claude/skills', available: await isDir(dir) }, dirs: { claude: dir } };
  }
  if (ref.kind === 'project') {
    const base = await d.assertProject(ref.path ?? '');
    return {
      info: { kind: 'project', path: base, label: path.basename(base), available: await isDir(base) },
      dirs: { claude: rootDir(base, 'claude'), agents: rootDir(base, 'agents') }
    };
  }
  throw new Error('Неизвестный источник скиллов');
}

/** Источники для импорта: шаблон, личные скиллы и остальные зарегистрированные проекты. */
export async function listSkillSources(currentProject: string, deps?: SkillServiceDeps): Promise<SkillSourceInfo[]> {
  const d = deps ?? (await defaultDeps());
  const sources: SkillSourceInfo[] = [];
  const template = await d.templatePath();
  if (template) sources.push({ kind: 'template', path: template, label: path.basename(template), available: await isDir(template) });
  const home = d.homeDir();
  sources.push({ kind: 'personal', path: home, label: '~/.claude/skills', available: await isDir(rootDir(home, 'claude')) });
  for (const p of (await d.projects()).sort()) {
    if (samePath(p, currentProject)) continue;
    sources.push({ kind: 'project', path: p, label: path.basename(p), available: await isDir(p) });
  }
  return sources;
}

/** Скиллы источника и что будет в каждом корне текущего проекта при импорте. */
export async function listSourceSkills(ref: SkillSourceRef, targetProject: string, deps?: SkillServiceDeps): Promise<SkillSourceListing> {
  const d = deps ?? (await defaultDeps());
  const source = await resolveSource(ref, d);
  const roots = SKILL_ROOT_KEYS.filter((r) => source.dirs[r]);
  const sourceCatalog = buildSkillCatalog(await scanBase(source.info.path, roots, source.dirs));
  const target = new Map((await listProjectSkills(targetProject)).entries.map((e) => [e.id, e]));
  const items: SkillImportItem[] = [];
  for (const entry of sourceCatalog) {
    const diverged = entry.status === 'diverged';
    // Одинаковые копии источника — одна строка (из .claude/skills); разные — обе, пусть человек выберет.
    const froms = SKILL_ROOT_KEYS.filter((r) => entry.copies[r]).slice(0, diverged ? 2 : 1);
    for (const from of froms) {
      const copy = entry.copies[from]!;
      const existing = target.get(entry.id);
      const blocker = skillCopyBlocker(copy) ?? validateSkillId(entry.id);
      items.push({
        id: entry.id,
        from,
        ...(copy.name ? { name: copy.name } : {}),
        ...(copy.description ? { description: copy.description } : {}),
        problems: copy.problems,
        ...(blocker ? { blocker } : {}),
        sourceDiverged: diverged,
        actions: {
          claude: skillCopyAction(copy, existing?.copies.claude),
          agents: skillCopyAction(copy, existing?.copies.agents)
        }
      });
    }
  }
  return { source: source.info, items };
}

/** Ни один существующий каталог на пути `base/segments…` не должен быть символической ссылкой или junction. */
async function assertNoLinkOnPath(base: string, segments: string[]): Promise<void> {
  for (let i = 1; i <= segments.length; i++) {
    const p = path.join(base, ...segments.slice(0, i));
    let st;
    try {
      st = await fs.lstat(p);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) throw new Error(`${segments.slice(0, i).join('/')} — символическая ссылка, запись в неё запрещена`);
  }
}

async function copyTree(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    if (skipName(e.name) || e.isSymbolicLink()) continue;
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) await copyTree(from, to);
    else if (e.isFile()) await fs.copyFile(from, to);
  }
}

const RETRYABLE_RENAME = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Переименование каталога с короткими повторами: на Windows антивирус и индексатор ненадолго держат файлы. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!RETRYABLE_RENAME.has(code) || attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
}

/** Собрать копию во временном каталоге, сверить хэш и атомарно поставить на место `targetDir`. */
async function replaceSkillDir(sourceDir: string, source: SkillCopy, targetDir: string): Promise<void> {
  const parent = path.dirname(targetDir);
  await fs.mkdir(parent, { recursive: true });
  const stamp = `${process.pid}-${Date.now()}`;
  const base = path.basename(targetDir);
  const tmp = path.join(parent, `${SKILL_TEMP_PREFIX}tmp-${base}-${stamp}`);
  const old = path.join(parent, `${SKILL_TEMP_PREFIX}old-${base}-${stamp}`);
  try {
    await copyTree(sourceDir, tmp);
    const copied = await readSkillCopy(tmp, source.root, source.id);
    if (copied.hash !== source.hash) throw new Error('источник изменился во время копирования, повторите');
    let hadOld = false;
    try {
      await fs.lstat(targetDir);
      hadOld = true;
    } catch {
      // Скилла ещё нет.
    }
    if (hadOld) await renameWithRetry(targetDir, old);
    try {
      await renameWithRetry(tmp, targetDir);
    } catch (err) {
      if (hadOld) await renameWithRetry(old, targetDir);
      throw err;
    }
    if (hadOld) await fs.rm(old, { recursive: true, force: true });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Копирование скилла `request.id` из корня `fromRoot` источника в корни `toRoots` проекта `targetProject`.
 * `targetProject` должен быть уже проверен по реестру (IPC). Результат — по корню и свежий список скиллов.
 */
export async function copySkill(targetProject: string, request: SkillCopyRequest, deps?: SkillServiceDeps): Promise<SkillCopyResult> {
  const d = deps ?? (await defaultDeps());
  const idError = validateSkillId(request.id);
  if (idError) throw new Error(idError);
  if (!isSkillRoot(request.fromRoot)) throw new Error('Неизвестный корень скиллов источника');
  const source = await resolveSource(request.source, d);
  const fromDir = source.dirs[request.fromRoot];
  if (!fromDir) throw new Error('В этом источнике нет такого корня скиллов');
  const sourceDir = path.join(fromDir, ...request.id.split('/'));
  if (!(await isDir(sourceDir))) throw new Error(`Скилл ${request.id} не найден в источнике`);
  const sourceCopy = await readSkillCopy(sourceDir, request.fromRoot, request.id);
  const blocker = skillCopyBlocker(sourceCopy);
  if (blocker) throw new Error(`Скилл ${request.id} нельзя скопировать: ${blocker}`);

  const results: SkillCopyResult['results'] = [];
  for (const root of [...new Set(request.toRoots)].filter(isSkillRoot)) {
    const targetDir = path.join(rootDir(targetProject, root), ...request.id.split('/'));
    if (samePath(targetDir, sourceDir)) {
      results.push({ root, outcome: 'skipped', reason: 'это та же копия' });
      continue;
    }
    await assertNoLinkOnPath(targetProject, [...SKILL_ROOTS[root].split('/'), ...request.id.split('/')]);
    let existing: SkillCopy | undefined;
    try {
      const st = await fs.lstat(targetDir);
      if (!st.isDirectory()) {
        results.push({ root, outcome: 'skipped', reason: 'на месте скилла лежит файл' });
        continue;
      }
      existing = await readSkillCopy(targetDir, root, request.id);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const action = skillCopyAction(sourceCopy, existing);
    if (action === 'unchanged') {
      results.push({ root, outcome: 'unchanged' });
      continue;
    }
    if (action === 'overwrite' && !request.overwrite) {
      results.push({ root, outcome: 'skipped', reason: 'скилл уже есть и отличается — нужна явная перезапись' });
      continue;
    }
    await replaceSkillDir(sourceDir, sourceCopy, targetDir);
    results.push({ root, outcome: action === 'create' ? 'created' : 'overwritten' });
  }
  const changed = results.filter((r) => r.outcome === 'created' || r.outcome === 'overwritten');
  if (changed.length) {
    console.log(`[Skills] ${targetProject}: ${request.id} из ${source.info.kind}/${request.fromRoot} → ${changed.map((r) => `${r.root}:${r.outcome}`).join(', ')}`);
  }
  return { results, listing: await listProjectSkills(targetProject) };
}
