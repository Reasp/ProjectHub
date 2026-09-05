import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import type { AISession, AIMessage, AIToolCall } from '../../src/types/electron';

/**
 * Файловое хранилище истории диалогов AI Studio (TASK-35, аудит 3.1).
 *
 * Раньше рендерер держал все сессии всех проектов в `localStorage` через zustand `persist` и
 * пересериализовывал их на каждый стриминговый чанк. Теперь каждая сессия — отдельный файл
 * `~/.projecthub/sessions/<hash(projectPath)>/<sessionId>.json`, а запись инициируется
 * рендерером с дебаунсом. Тяжёлые поля (содержимое diff, вывод команд, аргументы инструментов)
 * усекаются при сохранении — полный текст живёт только в памяти текущей сессии.
 */

/** Лимиты усечения строк при записи на диск (в символах). */
export const STORAGE_LIMITS = {
  /** diff.oldContent / diff.patch */
  diffContent: 20_000,
  /** diff.newContent для уже применённых/отклонённых diff (pending остаётся целым — он нужен для применения). */
  diffNewContentResolved: 20_000,
  /** toolCall.result и строковые значения в toolCall.args */
  toolPayload: 8_000,
  /** Текст сообщения и рассуждения модели */
  messageText: 200_000
} as const;

/** Идентификатор сессии приходит из рендерера и становится именем файла — только безопасные символы. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

/** Стабильный хэш пути проекта: без учёта регистра и вида разделителей, чтобы `C:\A` и `c:/a/` совпадали. */
export function hashProjectPath(projectPath: string): string {
  const normalized = path
    .resolve(projectPath)
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const dropped = value.length - limit;
  return `${value.slice(0, limit)}\n…[усечено при сохранении: ещё ${dropped} символов]`;
}

function compactArgs(args: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!args || typeof args !== 'object') return args;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > STORAGE_LIMITS.toolPayload) {
      out[key] = truncate(value, STORAGE_LIMITS.toolPayload);
      changed = true;
    } else {
      out[key] = value;
    }
  }
  return changed ? out : args;
}

function compactResult(result: unknown): unknown {
  if (typeof result === 'string') return truncate(result, STORAGE_LIMITS.toolPayload);
  if (result && typeof result === 'object') {
    const json = JSON.stringify(result);
    if (json.length > STORAGE_LIMITS.toolPayload) return truncate(json, STORAGE_LIMITS.toolPayload);
  }
  return result;
}

export function compactToolCall(tc: AIToolCall): AIToolCall {
  const out: AIToolCall = { ...tc, args: compactArgs(tc.args) as Record<string, any> };
  if (tc.result !== undefined) out.result = compactResult(tc.result);
  if (tc.diff) {
    const pending = !tc.status || tc.status === 'pending';
    const diff = { ...tc.diff };
    let truncated = false;
    if (diff.oldContent.length > STORAGE_LIMITS.diffContent) {
      diff.oldContent = truncate(diff.oldContent, STORAGE_LIMITS.diffContent);
      truncated = true;
    }
    if (diff.patch.length > STORAGE_LIMITS.diffContent) {
      diff.patch = truncate(diff.patch, STORAGE_LIMITS.diffContent);
      truncated = true;
    }
    // Ожидающий diff после перезапуска всё ещё можно применить — его newContent не трогаем.
    if (!pending && diff.newContent.length > STORAGE_LIMITS.diffNewContentResolved) {
      diff.newContent = truncate(diff.newContent, STORAGE_LIMITS.diffNewContentResolved);
      truncated = true;
    }
    if (truncated) diff.truncated = true;
    out.diff = diff;
  }
  return out;
}

export function compactMessage(msg: AIMessage): AIMessage {
  const out: AIMessage = {
    ...msg,
    content: typeof msg.content === 'string' ? truncate(msg.content, STORAGE_LIMITS.messageText) : ''
  };
  if (msg.thought) out.thought = truncate(msg.thought, STORAGE_LIMITS.messageText);
  if (msg.toolCalls) out.toolCalls = msg.toolCalls.map(compactToolCall);
  return out;
}

/** Копия сессии, пригодная для записи на диск: усечённые тяжёлые поля, без служебных полей рендерера. */
export function compactSessionForStorage(session: AISession): AISession {
  return {
    id: session.id,
    title: typeof session.title === 'string' ? session.title.slice(0, 500) : '',
    createdAt: typeof session.createdAt === 'number' ? session.createdAt : Date.now(),
    messages: Array.isArray(session.messages) ? session.messages.map(compactMessage) : [],
    ...(session.claudeCliSessionId ? { claudeCliSessionId: session.claudeCliSessionId } : {})
  };
}

function isSessionLike(value: unknown): value is AISession {
  return (
    !!value &&
    typeof value === 'object' &&
    isValidSessionId((value as AISession).id) &&
    Array.isArray((value as AISession).messages)
  );
}

export class AISessionStore {
  constructor(private readonly baseDir: string = path.join(os.homedir(), '.projecthub', 'sessions')) {}

  public projectDir(projectPath: string): string {
    return path.join(this.baseDir, hashProjectPath(projectPath));
  }

  private sessionFile(projectPath: string, sessionId: string): string {
    return path.join(this.projectDir(projectPath), `${sessionId}.json`);
  }

  private async ensureProjectDir(projectPath: string): Promise<string> {
    const dir = this.projectDir(projectPath);
    await fs.mkdir(dir, { recursive: true });
    // Метка с исходным путём — чтобы каталог можно было сопоставить с проектом вручную.
    const marker = path.join(dir, 'project.json');
    try {
      await fs.access(marker);
    } catch {
      await fs.writeFile(marker, JSON.stringify({ projectPath }, null, 2), 'utf8').catch(() => undefined);
    }
    return dir;
  }

  /** Все сессии проекта, отсортированные по времени создания. Битые файлы пропускаются. */
  public async list(projectPath: string): Promise<AISession[]> {
    const dir = this.projectDir(projectPath);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }
    const sessions: AISession[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json') || name === 'project.json') continue;
      const id = name.slice(0, -'.json'.length);
      if (!isValidSessionId(id)) continue;
      try {
        const raw = await fs.readFile(path.join(dir, name), 'utf8');
        const parsed = JSON.parse(raw);
        if (isSessionLike(parsed) && parsed.id === id) sessions.push(parsed);
      } catch (e) {
        console.warn(`[AISessionStore] Пропущен повреждённый файл сессии ${name}:`, e);
      }
    }
    sessions.sort((a, b) => a.createdAt - b.createdAt);
    return sessions;
  }

  /** Атомарная запись (tmp + rename), чтобы падение посреди записи не оставило половину JSON. */
  public async save(projectPath: string, session: AISession): Promise<void> {
    if (!isValidSessionId(session?.id)) {
      throw new Error(`Недопустимый идентификатор сессии: ${String(session?.id)}`);
    }
    await this.ensureProjectDir(projectPath);
    const target = this.sessionFile(projectPath, session.id);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify(compactSessionForStorage(session));
    await fs.writeFile(tmp, payload, 'utf8');
    try {
      await fs.rename(tmp, target);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
  }

  public async delete(projectPath: string, sessionId: string): Promise<boolean> {
    if (!isValidSessionId(sessionId)) return false;
    try {
      await fs.rm(this.sessionFile(projectPath, sessionId), { force: true });
      return true;
    } catch (e) {
      console.warn(`[AISessionStore] Не удалось удалить сессию ${sessionId}:`, e);
      return false;
    }
  }

  /**
   * Миграция из старого localStorage-блоба (`sessions: projectPath -> AISession[]`).
   * Уже существующие на диске сессии не перезаписываются. Возвращает число импортированных.
   */
  public async importLegacy(sessionsByProject: Record<string, AISession[]>): Promise<number> {
    if (!sessionsByProject || typeof sessionsByProject !== 'object') return 0;
    let imported = 0;
    for (const [projectPath, list] of Object.entries(sessionsByProject)) {
      if (typeof projectPath !== 'string' || !projectPath.trim() || !Array.isArray(list)) continue;
      for (const session of list) {
        if (!isSessionLike(session)) continue;
        // Пустые «Новый диалог» без сообщений переносить незачем.
        if (session.messages.length === 0) continue;
        const target = this.sessionFile(projectPath, session.id);
        try {
          await fs.access(target);
          continue;
        } catch {
          /* файла нет — импортируем */
        }
        try {
          await this.save(projectPath, session);
          imported++;
        } catch (e) {
          console.warn(`[AISessionStore] Не удалось импортировать сессию ${session.id}:`, e);
        }
      }
    }
    return imported;
  }
}

export const aiSessionStore = new AISessionStore();
