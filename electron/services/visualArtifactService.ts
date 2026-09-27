/**
 * Хранилище артефактов визуальных проверок `<userData>/visual` (TASK-78, decision-55 п. 5).
 *
 * Готовит каталог проверки `ui-smoke`, после прогона собирает скриншоты/trace из него и из
 * `artifacts.from` рабочего каталога с лимитами, ротирует хранилище и отдаёт картинки рендереру
 * только из своего корня. Решения (что брать, что удалять, какой путь допустим) — в чистом
 * `visualArtifacts.ts`; здесь только файловая система.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getUserDataDir } from './appPaths.js';
import {
  DEFAULT_ARTIFACT_LIMITS,
  DEFAULT_MIN_SCREENSHOTS,
  DEFAULT_STORE_LIMITS,
  checkArtifactsRelDir,
  enforceMinScreenshots,
  mimeOfArtifact,
  planStorePrune,
  resolveArtifactReadPath,
  resolveArtifactSources,
  safeSegment,
  selectArtifacts,
  type ArtifactCandidate,
  type StoreEntry
} from './visualArtifacts.js';
import type { CheckArtifactsConfig, CheckRunResult } from './arenaTypes.js';

/** Сколько файлов обходить в одном источнике: `test-results` большого проекта бывает огромным. */
const WALK_FILE_LIMIT = 2000;
/** Ротация не чаще раза в 10 минут — обход хранилища не бесплатен. */
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;
/** Больше этого картинку в рендерер не отдаём (data URL). */
const MAX_INLINE_BYTES = DEFAULT_ARTIFACT_LIMITS.maxFileBytes;

export interface PreparedArtifactsDir {
  /** Путь внутри хранилища, с `/`. */
  relDir: string;
  absDir: string;
}

async function walkFiles(root: string, limit = WALK_FILE_LIMIT): Promise<Array<{ abs: string; bytes: number; mtimeMs: number }>> {
  const out: Array<{ abs: string; bytes: number; mtimeMs: number }> = [];
  const stack = [root];
  while (stack.length > 0 && out.length < limit) {
    const dir = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      // Ссылки не обходим: через них проверка могла бы вытащить файлы вне рабочего каталога.
      if (e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(abs);
      else if (e.isFile()) {
        try {
          const st = await fs.stat(abs);
          out.push({ abs, bytes: st.size, mtimeMs: st.mtimeMs });
        } catch {
          /* файл исчез между readdir и stat */
        }
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

const toPosix = (p: string) => p.split(path.sep).join('/');

export class VisualArtifactService {
  private lastPruneAt = 0;

  constructor(private readonly rootDir: () => string = () => path.join(getUserDataDir(), 'visual')) {}

  get root(): string {
    return this.rootDir();
  }

  /** Каталог сессии Swarm/Done-loop в хранилище. */
  swarmScope(sessionId: string): string {
    return `swarm-${safeSegment(sessionId)}`;
  }

  /** Пустой каталог проверки: прошлый прогон с тем же путём не смешивается с новым. */
  async prepare(parts: { scope: string; agentId?: string; run: string; checkId: string }): Promise<PreparedArtifactsDir> {
    const relDir = checkArtifactsRelDir(parts);
    const absDir = path.join(this.root, ...relDir.split('/'));
    await fs.rm(absDir, { recursive: true, force: true });
    await fs.mkdir(absDir, { recursive: true });
    return { relDir, absDir };
  }

  /**
   * Собирает артефакты после прогона и заполняет `result.artifacts`. Файлы из `from` копируются в
   * каталог проверки; всё, что не прошло лимиты, из каталога удаляется. Не бросает.
   */
  async collect(
    result: CheckRunResult,
    prepared: PreparedArtifactsDir,
    workdir: string,
    config: CheckArtifactsConfig | undefined
  ): Promise<void> {
    try {
      const own = await walkFiles(prepared.absDir);
      const candidates: ArtifactCandidate[] = own.map((f) => ({
        sourcePath: f.abs,
        name: toPosix(path.relative(prepared.absDir, f.abs)),
        bytes: f.bytes
      }));
      for (const source of resolveArtifactSources(workdir, config?.from)) {
        const st = await fs.stat(source).catch(() => null);
        if (!st) continue;
        const files = st.isDirectory() ? await walkFiles(source) : st.isFile() ? [{ abs: source, bytes: st.size, mtimeMs: st.mtimeMs }] : [];
        for (const f of files) candidates.push({ sourcePath: f.abs, name: toPosix(path.relative(workdir, f.abs)), bytes: f.bytes });
      }

      const { selected, truncated } = selectArtifacts(candidates, DEFAULT_ARTIFACT_LIMITS);
      const keep = new Set<string>();
      for (const item of selected) {
        const target = path.join(prepared.absDir, ...item.name.split('/'));
        keep.add(path.resolve(target));
        if (path.resolve(item.sourcePath) !== path.resolve(target)) {
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.copyFile(item.sourcePath, target);
        }
      }
      for (const f of own) {
        if (!keep.has(path.resolve(f.abs))) await fs.rm(f.abs, { force: true });
      }

      result.artifacts = selected.map((s) => ({ name: s.name, relPath: `${prepared.relDir}/${s.name}`, kind: s.kind, bytes: s.bytes }));
      if (truncated) result.artifactsTruncated = true;
    } catch (err) {
      console.warn('[VisualArtifacts] Не удалось собрать артефакты проверки:', err);
      result.artifacts = result.artifacts ?? [];
    }
    enforceMinScreenshots(result, config?.minScreenshots ?? DEFAULT_MIN_SCREENSHOTS);
  }

  /** Ротация по объёму и возрасту (не чаще раза в 10 минут); `keepScope` не удаляется. */
  async prune(keepScope?: string, force = false): Promise<string[]> {
    const now = Date.now();
    if (!force && now - this.lastPruneAt < PRUNE_INTERVAL_MS) return [];
    this.lastPruneAt = now;
    let dirs: import('node:fs').Dirent[];
    try {
      dirs = await fs.readdir(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const entries: StoreEntry[] = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const files = await walkFiles(path.join(this.root, d.name), 20_000);
      const st = await fs.stat(path.join(this.root, d.name)).catch(() => null);
      const mtimeMs = Math.max(st?.mtimeMs ?? 0, ...files.map((f) => f.mtimeMs));
      entries.push({ key: d.name, bytes: files.reduce((s, f) => s + f.bytes, 0), mtimeMs });
    }
    const remove = planStorePrune(entries, { ...DEFAULT_STORE_LIMITS, now, keep: new Set(keepScope ? [keepScope] : []) });
    for (const key of remove) await fs.rm(path.join(this.root, key), { recursive: true, force: true }).catch(() => {});
    if (remove.length > 0) console.log(`[VisualArtifacts] Ротация хранилища: удалено каталогов ${remove.length}`);
    return remove;
  }

  /** Каталог сессии удаляется вместе с сессией Swarm. */
  async removeScope(scope: string): Promise<void> {
    const abs = resolveArtifactReadPath(this.root, safeSegment(scope));
    if (abs) await fs.rm(abs, { recursive: true, force: true }).catch(() => {});
  }

  /** Картинка для рендерера как data URL; только из хранилища и только скриншоты. */
  async readImage(relPath: string): Promise<{ dataUrl: string; bytes: number } | { error: string }> {
    const abs = resolveArtifactReadPath(this.root, relPath);
    if (!abs) return { error: 'Путь вне хранилища артефактов' };
    const mime = mimeOfArtifact(abs);
    if (!mime.startsWith('image/')) return { error: 'Это не изображение' };
    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) return { error: 'Файл не найден' };
      if (st.size > MAX_INLINE_BYTES) return { error: 'Файл слишком большой для просмотра' };
      const data = await fs.readFile(abs);
      return { dataUrl: `data:${mime};base64,${data.toString('base64')}`, bytes: st.size };
    } catch {
      return { error: 'Файл не найден (удалён ротацией или вместе с сессией)' };
    }
  }

  /** Абсолютный путь для «показать в папке»; `null` — вне хранилища или файла нет. */
  async resolveExisting(relPath: string): Promise<string | null> {
    const abs = resolveArtifactReadPath(this.root, relPath);
    if (!abs) return null;
    const st = await fs.stat(abs).catch(() => null);
    return st ? abs : null;
  }
}

export const visualArtifactService = new VisualArtifactService();
