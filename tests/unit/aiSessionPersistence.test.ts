import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDebouncedStorage,
  LEGACY_STORAGE_KEY,
  migrateLegacySessions,
  SessionPersister
} from '../../src/store/aiSessionPersistence';
import type { AISession } from '../../src/types/electron';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  public writes = 0;
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.writes++;
    this.map.set(key, value);
  }
}

function session(id: string, content = 'x'): AISession {
  return { id, title: id, createdAt: 1, messages: [{ id: 'm', role: 'user', content, timestamp: '' }] };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  // @ts-expect-error тестовая заглушка
  delete globalThis.window;
});

describe('createDebouncedStorage (AC #1: настройки не пишутся на каждый чанк)', () => {
  it('схлопывает серию setItem в одну запись и не пишет одинаковые значения', () => {
    const target = new MemoryStorage();
    const storage = createDebouncedStorage(target, 1000);

    for (let i = 0; i < 50; i++) storage.setItem('k', JSON.stringify({ v: i }));
    expect(target.writes).toBe(0);
    expect(storage.getItem('k')).toBe(JSON.stringify({ v: 49 })); // до сброса читаем из буфера

    vi.advanceTimersByTime(1000);
    expect(target.writes).toBe(1);
    expect(target.getItem('k')).toBe(JSON.stringify({ v: 49 }));

    storage.setItem('k', JSON.stringify({ v: 49 }));
    vi.advanceTimersByTime(1000);
    expect(target.writes).toBe(1);
  });

  it('removeItem очищает и буфер, и хранилище', () => {
    const target = new MemoryStorage();
    const storage = createDebouncedStorage(target, 1000);
    storage.setItem('k', 'a');
    storage.removeItem('k');
    vi.advanceTimersByTime(1000);
    expect(target.getItem('k')).toBeNull();
  });
});

describe('SessionPersister (AC #1/#2: дебаунс записи сессий через IPC)', () => {
  function installApi() {
    const api = {
      saveAISession: vi.fn(async () => true),
      deleteAISession: vi.fn(async () => true)
    };
    // @ts-expect-error тестовая заглушка window
    globalThis.window = { api, addEventListener: () => undefined };
    return api;
  }

  it('50 обновлений одной сессии → одна запись после дебаунса, актуальная версия', async () => {
    const api = installApi();
    const persister = new SessionPersister(1500);
    let current = session('s1', 'v0');
    persister.setResolver(() => current);

    let prev: Record<string, AISession[]> = {};
    for (let i = 1; i <= 50; i++) {
      current = session('s1', `v${i}`);
      const next = { P: [current] };
      persister.track(prev, next);
      prev = next;
      vi.advanceTimersByTime(20);
    }
    expect(api.saveAISession).not.toHaveBeenCalled();
    expect(persister.hasPending()).toBe(true);

    vi.advanceTimersByTime(1500);
    await Promise.resolve();
    expect(api.saveAISession).toHaveBeenCalledTimes(1);
    expect(api.saveAISession.mock.calls[0][1].messages[0].content).toBe('v50');
  });

  it('flushNow пишет немедленно; загруженные с диска сессии не переписываются; удаление → deleteAISession', async () => {
    const api = installApi();
    const persister = new SessionPersister(1500);
    const fromDisk = [session('d1'), session('d2')];
    persister.markLoaded('P', fromDisk);
    persister.setResolver((_, id) => fromDisk.find((s) => s.id === id));

    persister.track({}, { P: fromDisk });
    expect(persister.hasPending()).toBe(false);

    persister.track({ P: fromDisk }, { P: [fromDisk[0]] });
    await persister.flushNow();
    expect(api.deleteAISession).toHaveBeenCalledWith('P', 'd2');
    expect(api.saveAISession).not.toHaveBeenCalled();
  });

  it('неизменённая ссылка после сохранения не считается грязной', async () => {
    const api = installApi();
    const persister = new SessionPersister(10);
    const s = session('s1');
    persister.setResolver(() => s);
    persister.track({}, { P: [s] });
    await persister.flushNow();
    expect(api.saveAISession).toHaveBeenCalledTimes(1);

    persister.track({ P: [s] }, { P: [s], Q: [] });
    await persister.flushNow();
    expect(api.saveAISession).toHaveBeenCalledTimes(1);
  });
});

describe('migrateLegacySessions (AC #4)', () => {
  it('переносит sessions через importAISessions и вырезает их из блоба, остальное сохраняя', async () => {
    const importAISessions = vi.fn(async () => 1);
    // @ts-expect-error тестовая заглушка window
    globalThis.window = { api: { importAISessions }, addEventListener: () => undefined };
    const storage = new MemoryStorage();
    storage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({
        state: { sessions: { P: [session('s1')], Empty: [] }, mode: 'agent', activeSessionId: { P: 's1' } },
        version: 0
      })
    );

    const migrated = await migrateLegacySessions(storage);
    expect(Object.keys(migrated)).toEqual(['P']);
    expect(importAISessions).toHaveBeenCalledWith({ P: [session('s1')] });
    const after = JSON.parse(storage.getItem(LEGACY_STORAGE_KEY)!);
    expect(after.state.sessions).toBeUndefined();
    expect(after.state.mode).toBe('agent');
    expect(after.state.activeSessionId).toEqual({ P: 's1' });

    // Повторный вызов — уже нечего переносить
    expect(await migrateLegacySessions(storage)).toEqual({});
    expect(importAISessions).toHaveBeenCalledTimes(1);
  });

  it('при ошибке импорта блоб не трогается, а сессии возвращаются для показа', async () => {
    // @ts-expect-error тестовая заглушка window
    globalThis.window = { api: { importAISessions: vi.fn(async () => { throw new Error('ipc'); }) }, addEventListener: () => undefined };
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ state: { sessions: { P: [session('s1')] } } }));
    const migrated = await migrateLegacySessions(storage);
    expect(migrated.P).toHaveLength(1);
    expect(JSON.parse(storage.getItem(LEGACY_STORAGE_KEY)!).state.sessions.P).toHaveLength(1);
  });

  it('пустое/битое хранилище → {}', async () => {
    const storage = new MemoryStorage();
    expect(await migrateLegacySessions(storage)).toEqual({});
    storage.setItem(LEGACY_STORAGE_KEY, '{bad');
    expect(await migrateLegacySessions(storage)).toEqual({});
    expect(await migrateLegacySessions(undefined)).toEqual({});
  });
});
