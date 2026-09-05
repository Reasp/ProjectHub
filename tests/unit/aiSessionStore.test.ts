import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AISessionStore,
  compactSessionForStorage,
  compactToolCall,
  hashProjectPath,
  isValidSessionId,
  STORAGE_LIMITS
} from '../../electron/services/aiSessionStore';
import type { AISession, AIToolCall } from '../../src/types/electron';

let baseDir: string;
let store: AISessionStore;
const PROJECT = 'C:\\Projects\\Demo';

function makeSession(id: string, extra: Partial<AISession> = {}): AISession {
  return {
    id,
    title: 'Тест',
    createdAt: Date.now(),
    messages: [{ id: 'm1', role: 'user', content: 'привет', timestamp: new Date().toISOString() }],
    ...extra
  };
}

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-sessions-'));
  store = new AISessionStore(baseDir);
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe('hashProjectPath / isValidSessionId', () => {
  it('хэш не зависит от регистра, разделителей и хвостового слэша', () => {
    expect(hashProjectPath('C:\\Projects\\Demo')).toBe(hashProjectPath('c:/projects/demo/'));
    expect(hashProjectPath('C:\\Projects\\Demo')).not.toBe(hashProjectPath('C:\\Projects\\Demo2'));
    expect(hashProjectPath(PROJECT)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('идентификатор сессии — только безопасные символы (защита от path traversal)', () => {
    expect(isValidSessionId('session-1725000000000-ab12c')).toBe(true);
    expect(isValidSessionId('../secrets')).toBe(false);
    expect(isValidSessionId('a/b')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId(42)).toBe(false);
  });
});

describe('AISessionStore: save / list / delete', () => {
  it('сохраняет сессию в <hash>/<id>.json и читает обратно', async () => {
    const s = makeSession('session-1', { claudeCliSessionId: 'cli-1' });
    await store.save(PROJECT, s);

    const file = path.join(baseDir, hashProjectPath(PROJECT), 'session-1.json');
    await expect(fs.access(file)).resolves.toBeUndefined();
    await expect(fs.access(path.join(baseDir, hashProjectPath(PROJECT), 'project.json'))).resolves.toBeUndefined();

    const list = await store.list(PROJECT);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'session-1', title: 'Тест', claudeCliSessionId: 'cli-1' });
    expect(list[0].messages[0].content).toBe('привет');
  });

  it('list сортирует по createdAt, пропускает битые и чужие файлы, пустой проект → []', async () => {
    await store.save(PROJECT, makeSession('session-b', { createdAt: 2000 }));
    await store.save(PROJECT, makeSession('session-a', { createdAt: 1000 }));
    const dir = store.projectDir(PROJECT);
    await fs.writeFile(path.join(dir, 'session-broken.json'), '{ not json', 'utf8');
    await fs.writeFile(path.join(dir, 'notes.txt'), 'x', 'utf8');

    expect((await store.list(PROJECT)).map((s) => s.id)).toEqual(['session-a', 'session-b']);
    expect(await store.list('D:\\Other')).toEqual([]);
  });

  it('delete удаляет файл; недопустимый id отклоняется без обращения к диску', async () => {
    await store.save(PROJECT, makeSession('session-1'));
    expect(await store.delete(PROJECT, 'session-1')).toBe(true);
    expect(await store.list(PROJECT)).toEqual([]);
    expect(await store.delete(PROJECT, '../../etc')).toBe(false);
    await expect(store.save(PROJECT, makeSession('../evil'))).rejects.toThrow(/Недопустимый идентификатор/);
  });

  it('не оставляет tmp-файлов после записи', async () => {
    await store.save(PROJECT, makeSession('session-1'));
    const names = await fs.readdir(store.projectDir(PROJECT));
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});

describe('усечение тяжёлых полей (AC #3)', () => {
  const big = 'x'.repeat(STORAGE_LIMITS.diffContent + 5000);

  it('oldContent/patch усекаются, pending newContent остаётся целым, ставится флаг truncated', () => {
    const tc: AIToolCall = {
      id: 't1',
      name: 'write_file',
      args: { path: 'a.ts', content: big },
      status: 'pending',
      diff: { filePath: 'a.ts', oldContent: big, newContent: big, patch: big }
    };
    const out = compactToolCall(tc);
    expect(out.diff!.oldContent.length).toBeLessThan(big.length);
    expect(out.diff!.oldContent).toContain('усечено при сохранении');
    expect(out.diff!.patch.length).toBeLessThan(big.length);
    expect(out.diff!.newContent).toBe(big);
    expect(out.diff!.truncated).toBe(true);
    expect((out.args.content as string).length).toBeLessThan(big.length);
    // Исходный объект не мутируется — полный вывод доступен в живой сессии
    expect(tc.diff!.oldContent).toBe(big);
    expect(tc.args.content).toBe(big);
  });

  it('у принятого diff усекается и newContent; результат команды обрезается до лимита', () => {
    const tc: AIToolCall = {
      id: 't2',
      name: 'run_command',
      args: { command: 'npm test' },
      status: 'accepted',
      result: 'y'.repeat(STORAGE_LIMITS.toolPayload * 3),
      diff: { filePath: 'a.ts', oldContent: '', newContent: big, patch: '' }
    };
    const out = compactToolCall(tc);
    expect(out.diff!.newContent.length).toBeLessThan(big.length);
    expect((out.result as string).length).toBeLessThan(STORAGE_LIMITS.toolPayload + 100);
    expect(out.args).toBe(tc.args); // без изменений — та же ссылка
  });

  it('короткие поля не трогаются и флаг truncated не выставляется', () => {
    const tc: AIToolCall = {
      id: 't3',
      name: 'read_file',
      args: { path: 'a.ts' },
      status: 'done',
      result: 'ok',
      diff: { filePath: 'a.ts', oldContent: 'a', newContent: 'b', patch: '-a\n+b' }
    };
    const out = compactToolCall(tc);
    expect(out.diff).toEqual({ filePath: 'a.ts', oldContent: 'a', newContent: 'b', patch: '-a\n+b' });
    expect(out.result).toBe('ok');
  });

  it('save пишет усечённую копию, list возвращает её', async () => {
    const s = makeSession('session-1');
    s.messages.push({
      id: 'm2',
      role: 'assistant',
      content: 'готово',
      timestamp: new Date().toISOString(),
      toolCalls: [{ id: 't', name: 'run_command', args: {}, status: 'done', result: 'z'.repeat(50_000) }]
    });
    await store.save(PROJECT, s);
    const [loaded] = await store.list(PROJECT);
    expect((loaded.messages[1].toolCalls![0].result as string).length).toBeLessThan(10_000);
    const compact = compactSessionForStorage(s);
    expect(compact.messages).toHaveLength(2);
  });
});

describe('importLegacy (AC #4)', () => {
  it('переносит непустые сессии, не перезаписывает существующие, пропускает мусор', async () => {
    await store.save(PROJECT, makeSession('session-1', { title: 'на диске' }));
    const imported = await store.importLegacy({
      [PROJECT]: [
        makeSession('session-1', { title: 'из localStorage' }),
        makeSession('session-2'),
        makeSession('session-empty', { messages: [] }),
        { id: '../evil', messages: [] } as any,
        null as any
      ],
      'D:\\Other': [makeSession('session-9')],
      '': [makeSession('session-x')]
    });
    expect(imported).toBe(2);
    const list = await store.list(PROJECT);
    expect(list.map((s) => [s.id, s.title])).toEqual([
      ['session-1', 'на диске'],
      ['session-2', 'Тест']
    ]);
    expect((await store.list('D:\\Other')).map((s) => s.id)).toEqual(['session-9']);
    expect(await store.importLegacy(null as any)).toBe(0);
  });
});
