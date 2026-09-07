import type { StateStorage } from 'zustand/middleware';
import type { AISession } from '../types/electron';

/**
 * Персистентность AI Studio без записи на каждый чанк (TASK-35, аудит 3.1).
 *
 * - История диалогов уходит в файлы через main (`aiSessions:*`), а не в localStorage.
 * - Запись дебаунсится: во время стриминга не чаще раза в {@link SESSION_SAVE_DEBOUNCE_MS},
 *   по завершении ответа — немедленно (`flushNow`).
 * - Лёгкие настройки (config без ключа, mode, activeSessionId) остаются в localStorage,
 *   но тоже пишутся через дебаунс-обёртку и только если сериализация изменилась.
 */

export const SESSION_SAVE_DEBOUNCE_MS = 1500;
export const SETTINGS_SAVE_DEBOUNCE_MS = 1000;
export const LEGACY_STORAGE_KEY = 'projecthub-ai-studio-storage';

type SessionsMap = Record<string, AISession[]>;

/**
 * Обёртка над `localStorage` для zustand `persist`: setItem откладывается и схлопывается,
 * одинаковые значения не перезаписываются, при закрытии страницы буфер сбрасывается синхронно.
 */
export function createDebouncedStorage(
  target: Storage | undefined,
  delayMs: number = SETTINGS_SAVE_DEBOUNCE_MS
): StateStorage {
  const pending = new Map<string, string>();
  const lastWritten = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!target) return;
    for (const [key, value] of pending) {
      if (lastWritten.get(key) === value) continue;
      try {
        target.setItem(key, value);
        lastWritten.set(key, value);
      } catch (e) {
        console.warn('[AIStudio] Не удалось записать настройки в localStorage:', e);
      }
    }
    pending.clear();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
  }

  return {
    getItem: (name) => {
      if (pending.has(name)) return pending.get(name)!;
      const value = target?.getItem(name) ?? null;
      if (value !== null) lastWritten.set(name, value);
      return value;
    },
    setItem: (name, value) => {
      if (lastWritten.get(name) === value && !pending.has(name)) return;
      pending.set(name, value);
      if (!timer) timer = setTimeout(flush, delayMs);
    },
    removeItem: (name) => {
      pending.delete(name);
      lastWritten.delete(name);
      try {
        target?.removeItem(name);
      } catch {
        /* ignore */
      }
    }
  };
}

/**
 * Одноразовая миграция: старый persist-блоб хранил `state.sessions` всех проектов в localStorage.
 * Переносим их в файлы через main и вырезаем из блоба, чтобы он больше не раздувался.
 * Возвращает перенесённые сессии (для немедленного показа без повторного чтения с диска).
 */
export async function migrateLegacySessions(storage: Storage | undefined = safeLocalStorage()): Promise<SessionsMap> {
  if (!storage) return {};
  let raw: string | null;
  try {
    raw = storage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const legacy = parsed?.state?.sessions;
  if (!legacy || typeof legacy !== 'object') return {};

  const sessions: SessionsMap = {};
  for (const [projectPath, list] of Object.entries(legacy)) {
    if (Array.isArray(list) && list.length > 0) sessions[projectPath] = list as AISession[];
  }

  const api = typeof window !== 'undefined' ? window.api : undefined;
  if (api?.importAISessions && Object.keys(sessions).length > 0) {
    try {
      const imported = await api.importAISessions(sessions);
      console.info(`[AIStudio] Перенесено сессий из localStorage в файлы: ${imported}`);
    } catch (e) {
      console.error('[AIStudio] Миграция сессий из localStorage не удалась, блоб оставлен:', e);
      return sessions;
    }
  }

  // Вырезаем историю из блоба: дальше persist пишет только лёгкие настройки.
  try {
    delete parsed.state.sessions;
    storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(parsed));
  } catch (e) {
    console.warn('[AIStudio] Не удалось очистить старый блоб localStorage:', e);
  }
  return sessions;
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Следит за `sessions` в сторе и пишет изменившиеся сессии на диск с дебаунсом.
 * Сравнение по ссылке: любой `set()` создаёт новый объект сессии, поэтому достаточно
 * помнить, какая ссылка была записана последней.
 */
export class SessionPersister {
  private lastSaved = new Map<string, AISession>(); // sessionId -> записанная ссылка
  private owner = new Map<string, string>(); // sessionId -> projectPath
  private dirty = new Map<string, string>(); // sessionId -> projectPath
  private toDelete = new Map<string, string>(); // sessionId -> projectPath
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly delayMs: number = SESSION_SAVE_DEBOUNCE_MS) {
    if (typeof window !== 'undefined') {
      // На закрытии окна invoke может не успеть, но дебаунс всего 1.5 с, а завершение ответа
      // сбрасывается сразу — потеря ограничена хвостом текущего стрима.
      window.addEventListener('beforeunload', () => void this.flushNow());
    }
  }

  /** Сессии, только что прочитанные с диска: считаем их записанными, чтобы не переписывать сразу. */
  public markLoaded(projectPath: string, sessions: AISession[]): void {
    for (const s of sessions) {
      this.lastSaved.set(s.id, s);
      this.owner.set(s.id, projectPath);
    }
  }

  /** Сравнить предыдущее и новое состояние `sessions`, отметить изменившиеся/удалённые. */
  public track(prev: SessionsMap, next: SessionsMap): void {
    if (prev === next) return;
    for (const [projectPath, list] of Object.entries(next)) {
      if (prev[projectPath] === list) continue;
      const seen = new Set<string>();
      for (const session of list) {
        seen.add(session.id);
        this.owner.set(session.id, projectPath);
        if (this.lastSaved.get(session.id) !== session) {
          this.dirty.set(session.id, projectPath);
          this.toDelete.delete(session.id);
        }
      }
      for (const old of prev[projectPath] || []) {
        if (!seen.has(old.id)) this.scheduleDelete(projectPath, old.id);
      }
    }
    for (const [projectPath, list] of Object.entries(prev)) {
      if (!(projectPath in next)) {
        for (const old of list) this.scheduleDelete(projectPath, old.id);
      }
    }
    if (this.dirty.size || this.toDelete.size) this.schedule();
  }

  private scheduleDelete(projectPath: string, sessionId: string): void {
    this.dirty.delete(sessionId);
    this.lastSaved.delete(sessionId);
    this.owner.delete(sessionId);
    this.toDelete.set(sessionId, projectPath);
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushNow();
    }, this.delayMs);
  }

  /** Немедленно записать всё накопленное (после завершения ответа, при закрытии сессии). */
  public flushNow(resolveSessions?: (projectPath: string, sessionId: string) => AISession | undefined): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) {
      // Дождаться текущей записи и повторить: между ними могли появиться новые изменения.
      return this.inFlight.then(() => this.flushNow(resolveSessions));
    }
    if (!this.dirty.size && !this.toDelete.size) return Promise.resolve();

    const api = typeof window !== 'undefined' ? window.api : undefined;
    if (!api?.saveAISession) {
      this.dirty.clear();
      this.toDelete.clear();
      return Promise.resolve();
    }

    const deletes = [...this.toDelete];
    this.toDelete.clear();
    const saves: Array<[string, AISession]> = [];
    for (const [sessionId, projectPath] of this.dirty) {
      const session = this.resolve(projectPath, sessionId, resolveSessions);
      if (session) saves.push([projectPath, session]);
    }
    this.dirty.clear();

    this.inFlight = (async () => {
      for (const [sessionId, projectPath] of deletes) {
        try {
          await api.deleteAISession(projectPath, sessionId);
        } catch (e) {
          console.warn('[AIStudio] Не удалось удалить файл сессии:', e);
        }
      }
      for (const [projectPath, session] of saves) {
        try {
          const ok = await api.saveAISession(projectPath, session);
          if (ok) this.lastSaved.set(session.id, session);
        } catch (e) {
          console.warn('[AIStudio] Не удалось сохранить сессию:', e);
        }
      }
    })().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private resolver: ((projectPath: string, sessionId: string) => AISession | undefined) | null = null;

  /** Источник актуальных объектов сессий (замыкание на `getState()` стора). */
  public setResolver(fn: (projectPath: string, sessionId: string) => AISession | undefined): void {
    this.resolver = fn;
  }

  private resolve(
    projectPath: string,
    sessionId: string,
    fn?: (projectPath: string, sessionId: string) => AISession | undefined
  ): AISession | undefined {
    return (fn || this.resolver)?.(projectPath, sessionId);
  }

  /** Есть ли несброшенные изменения (для тестов и диагностики). */
  public hasPending(): boolean {
    return this.dirty.size > 0 || this.toDelete.size > 0;
  }
}
