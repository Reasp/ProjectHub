/**
 * Хранилище памяти проекта на диске (TASK-76, decision-51 п. 1–5).
 *
 * Работает с `backlog/memory/` одного проекта: чтение фактов, запись с проверками (формат, секреты,
 * дубликаты), удаление и пересборка `MEMORY.md`. Корень проекта сюда приходит уже проверенным:
 * приведение пути сессии (worktree агента) к зарегистрированному проекту и аудит — в `memoryTools`.
 *
 * Без Electron: только fs, тестируется на временном каталоге. Записи одного проекта
 * сериализуются — два агента не получат один номер факта и не перезапишут индекс друг другу.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { nowBacklogTimestamp } from './backlogTaskFormat.js';
import {
  MEMORY_DIR_SEGMENTS,
  MEMORY_INDEX_FILE,
  buildMemoryFact,
  buildMemoryIndex,
  compareMemoryFacts,
  isValidMemoryId,
  memoryFileName,
  memoryIdFromFileName,
  nextMemoryId,
  parseMemoryFile,
  serializeMemoryFact,
  validateMemoryDraft,
  type MemoryDraft,
  type MemoryFact,
  type MemoryIssue
} from './memoryFormat.js';
import { detectSecrets, type SecretKind } from './secretPatterns.js';
import { findDuplicate, searchMemoryFacts } from './memorySearch.js';

/** Ошибки операций с памятью — коды, строки интерфейса живут в i18n рендерера. */
export const MEMORY_STORE_ERROR_CODES = ['invalid_draft', 'secret_detected', 'duplicate', 'not_found', 'invalid_id'] as const;
export type MemoryStoreErrorCode = (typeof MEMORY_STORE_ERROR_CODES)[number];

export class MemoryError extends Error {
  constructor(
    public readonly code: MemoryStoreErrorCode | 'invalid_project',
    message: string,
    /** Машиночитаемые подробности: коды проблем формата, виды секретов, id похожего факта. */
    public readonly details: { issues?: MemoryIssue[]; secretKinds?: SecretKind[]; duplicateOf?: string; duplicateTitle?: string } = {}
  ) {
    super(message);
    this.name = 'MemoryError';
  }
}

export interface MemoryEntry extends MemoryFact {
  fileName: string;
}

export interface InvalidMemoryFile {
  fileName: string;
  issues: MemoryIssue[];
}

export interface MemorySnapshot {
  facts: MemoryEntry[];
  /** Файлы в каталоге памяти, которые не удалось разобрать: показываются в UI и в lint:docs. */
  invalid: InvalidMemoryFile[];
}

export interface WriteMemoryOptions {
  /** id факта, который обновляется целиком. */
  replace?: string;
  now?: Date;
}

export interface WriteMemoryResult {
  fact: MemoryEntry;
  replaced: boolean;
  /** Путь файла относительно корня проекта, через `/`. */
  relativePath: string;
}

export function memoryDirOf(projectRoot: string): string {
  return path.join(projectRoot, ...MEMORY_DIR_SEGMENTS);
}

export function memoryRelativePath(fileName: string): string {
  return [...MEMORY_DIR_SEGMENTS, fileName].join('/');
}

const locks = new Map<string, Promise<unknown>>();

/** Сериализует операции записи одного проекта. */
async function withProjectLock<T>(projectRoot: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(projectRoot).toLowerCase();
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  try {
    return await run;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/** Все факты проекта по порядку номеров и файлы, которые не удалось разобрать. */
export async function readMemory(projectRoot: string): Promise<MemorySnapshot> {
  const dir = memoryDirOf(projectRoot);
  let names: string[];
  try {
    names = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { facts: [], invalid: [] };
    throw err;
  }

  const facts: MemoryEntry[] = [];
  const invalid: InvalidMemoryFile[] = [];
  for (const fileName of names.sort()) {
    if (fileName === MEMORY_INDEX_FILE || !fileName.toLowerCase().endsWith('.md')) continue;
    const content = await fs.readFile(path.join(dir, fileName), 'utf-8');
    const parsed = parseMemoryFile(fileName, content);
    if (parsed.ok) facts.push({ ...parsed.fact, fileName });
    else invalid.push({ fileName, issues: parsed.issues });
  }
  facts.sort(compareMemoryFacts);
  return { facts, invalid };
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, 'utf-8');
  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** Пересобирает `MEMORY.md` по фактам; файл не трогается, если содержимое не изменилось. */
async function writeIndex(projectRoot: string, facts: readonly MemoryEntry[]): Promise<void> {
  const dir = memoryDirOf(projectRoot);
  const indexPath = path.join(dir, MEMORY_INDEX_FILE);
  const next = buildMemoryIndex(facts);
  const current = await fs.readFile(indexPath, 'utf-8').catch(() => null);
  if (current !== null && current.replace(/\r\n/g, '\n') === next) return;
  await fs.mkdir(dir, { recursive: true });
  await writeFileAtomic(indexPath, next);
}

export async function rebuildMemoryIndex(projectRoot: string): Promise<void> {
  await withProjectLock(projectRoot, async () => {
    const { facts } = await readMemory(projectRoot);
    await writeIndex(projectRoot, facts);
  });
}

/** Текст черновика целиком — для поиска секретов во всех полях. */
function draftText(draft: MemoryDraft): string {
  return [draft.title, draft.description, draft.body, draft.source ?? '', draft.author ?? ''].join('\n');
}

/**
 * Записывает новый факт или обновляет существующий (`replace`). Отказ — `MemoryError` с кодом:
 * неверный черновик, секрет, дубликат, неизвестный id.
 */
export async function writeMemoryFact(projectRoot: string, draft: MemoryDraft, options: WriteMemoryOptions = {}): Promise<WriteMemoryResult> {
  const issues = validateMemoryDraft(draft);
  if (issues.length > 0) {
    throw new MemoryError('invalid_draft', `Факт не прошёл проверку формата: ${issues.map((i) => i.code).join(', ')}`, { issues });
  }
  const secrets = detectSecrets(draftText(draft));
  if (secrets.length > 0) {
    const secretKinds = secrets.map((s) => s.kind);
    throw new MemoryError('secret_detected', `В факте найден секрет (${secretKinds.join(', ')}) — секреты в память проекта не пишутся`, { secretKinds });
  }
  const replaceId = options.replace?.trim().toLowerCase();
  if (replaceId !== undefined && !isValidMemoryId(replaceId)) {
    throw new MemoryError('invalid_id', `Неверный id факта: ${options.replace}`);
  }

  return withProjectLock(projectRoot, async () => {
    const snapshot = await readMemory(projectRoot);
    const existing = replaceId ? snapshot.facts.find((f) => f.id === replaceId) : undefined;
    if (replaceId && !existing) throw new MemoryError('not_found', `Факт ${replaceId} не найден`);

    const duplicate = findDuplicate(draft, snapshot.facts, { excludeId: replaceId });
    if (duplicate) {
      throw new MemoryError(
        'duplicate',
        `Похожий факт уже есть: ${duplicate.fact.id} «${duplicate.fact.title}». Обнови его через replace или сформулируй иначе`,
        { duplicateOf: duplicate.fact.id, duplicateTitle: duplicate.fact.title }
      );
    }

    const timestamp = nowBacklogTimestamp(options.now);
    // Номер берётся и по неразобранным файлам: их id тоже заняты
    const takenIds = [...snapshot.facts.map((f) => f.id), ...snapshot.invalid.map((f) => memoryIdFromFileName(f.fileName) ?? '')];
    const id = existing?.id ?? nextMemoryId(takenIds);
    const fact = buildMemoryFact(draft, id, existing?.created ?? timestamp, existing ? timestamp : undefined);
    const fileName = memoryFileName(id, fact.title);

    const dir = memoryDirOf(projectRoot);
    await fs.mkdir(dir, { recursive: true });
    await writeFileAtomic(path.join(dir, fileName), serializeMemoryFact(fact));
    if (existing && existing.fileName !== fileName) {
      await fs.rm(path.join(dir, existing.fileName), { force: true });
    }

    const entry: MemoryEntry = { ...fact, fileName };
    const facts = [...snapshot.facts.filter((f) => f.id !== id), entry].sort(compareMemoryFacts);
    await writeIndex(projectRoot, facts);
    return { fact: entry, replaced: Boolean(existing), relativePath: memoryRelativePath(fileName) };
  });
}

/** Удаляет факт и пересобирает индекс. */
export async function deleteMemoryFact(projectRoot: string, id: string): Promise<{ relativePath: string }> {
  const factId = String(id ?? '').trim().toLowerCase();
  if (!isValidMemoryId(factId)) throw new MemoryError('invalid_id', `Неверный id факта: ${id}`);
  return withProjectLock(projectRoot, async () => {
    const snapshot = await readMemory(projectRoot);
    const target = snapshot.facts.find((f) => f.id === factId);
    if (!target) throw new MemoryError('not_found', `Факт ${factId} не найден`);
    await fs.rm(path.join(memoryDirOf(projectRoot), target.fileName), { force: true });
    await writeIndex(projectRoot, snapshot.facts.filter((f) => f.id !== factId));
    return { relativePath: memoryRelativePath(target.fileName) };
  });
}

export async function searchMemory(projectRoot: string, query: string, limit = 5): Promise<MemoryEntry[]> {
  const { facts } = await readMemory(projectRoot);
  return searchMemoryFacts(query, facts, limit).map((h) => h.fact);
}
