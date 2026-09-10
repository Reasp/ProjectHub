import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  SWARM_STORAGE_LIMITS,
  SWARM_STORE_VERSION,
  SwarmSessionStore,
  compactSwarmSessionForStorage,
  isValidAgentId,
  isValidSwarmId,
  migrateStoredSession
} from '../../electron/services/swarmSessionStore';
import type { AgentSlotState, SwarmSession } from '../../electron/services/swarmTypes';

let baseDir: string;
let store: SwarmSessionStore;

function makeAgent(id: string, extra: Partial<AgentSlotState> = {}): AgentSlotState {
  return {
    id,
    config: { id, name: `Agent ${id}`, engine: 'api', providerConfig: { provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk-secret' } },
    status: 'running',
    logs: ['a', 'b'],
    liveOutput: 'hello',
    metrics: { startTime: 1 },
    ...extra
  };
}

function makeSession(id: string, extra: Partial<SwarmSession> = {}): SwarmSession {
  return {
    id,
    projectPath: 'C:\\Projects\\Demo',
    mode: 'fan_out',
    prompt: 'задача',
    baseBranch: 'main',
    useWorktrees: true,
    status: 'running',
    createdAt: 1000,
    agents: [makeAgent('agent-1')],
    ...extra
  };
}

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-swarms-'));
  store = new SwarmSessionStore(baseDir, 20);
});

afterEach(async () => {
  await store.flush();
  await fs.rm(baseDir, { recursive: true, force: true });
});

describe('идентификаторы', () => {
  it('допускаются только безопасные символы (защита от path traversal)', () => {
    expect(isValidSwarmId('swarm-1725000000000-ab1c')).toBe(true);
    expect(isValidSwarmId('../x')).toBe(false);
    expect(isValidSwarmId('a/b')).toBe(false);
    expect(isValidAgentId('handoff-agent-1')).toBe(true);
    expect(isValidAgentId('')).toBe(false);
    expect(isValidAgentId(5)).toBe(false);
  });
});

describe('compactSwarmSessionForStorage', () => {
  it('добавляет version, усекает тяжёлые поля и убирает apiKey провайдера', () => {
    const big = 'x'.repeat(SWARM_STORAGE_LIMITS.liveOutput + 500);
    const session = makeSession('swarm-1', {
      agents: [
        makeAgent('agent-1', {
          liveOutput: big,
          finalOutput: 'y'.repeat(SWARM_STORAGE_LIMITS.finalOutput + 10),
          diffSummary: { filesChanged: 1, insertions: 1, deletions: 0, patch: 'z'.repeat(SWARM_STORAGE_LIMITS.diffPatch + 10) },
          logs: Array.from({ length: SWARM_STORAGE_LIMITS.logLines + 5 }, (_, i) => `l${i}`)
        })
      ]
    });
    const stored = compactSwarmSessionForStorage(session);
    expect(stored.version).toBe(SWARM_STORE_VERSION);
    const agent = stored.agents[0];
    expect(agent.liveOutput.length).toBeLessThan(big.length);
    expect(agent.liveOutput).toContain('усечено при сохранении');
    expect(agent.liveOutputTruncated).toBe(true);
    expect(agent.finalOutput!.length).toBeLessThan(SWARM_STORAGE_LIMITS.finalOutput + 100);
    expect(agent.diffSummary!.truncated).toBe(true);
    expect(agent.logs).toHaveLength(SWARM_STORAGE_LIMITS.logLines);
    expect(agent.logsDropped).toBe(5);
    expect(agent.config.providerConfig!.apiKey).toBeUndefined();
    // исходная сессия не мутирована
    expect(session.agents[0].liveOutput).toBe(big);
    expect(session.agents[0].config.providerConfig!.apiKey).toBe('sk-secret');
  });
});

describe('migrateStoredSession', () => {
  it('версия 0 (без version) получает дефолты для logs/metrics/status', () => {
    const migrated = migrateStoredSession({
      id: 'swarm-old',
      projectPath: 'C:\\p',
      agents: [{ id: 'a1', config: { id: 'a1', name: 'A', engine: 'api' } }]
    });
    expect(migrated).not.toBeNull();
    expect(migrated!.mode).toBe('fan_out');
    expect(migrated!.status).toBe('interrupted');
    expect(migrated!.useWorktrees).toBe(true);
    expect(migrated!.agents[0]).toMatchObject({ id: 'a1', status: 'interrupted', logs: [], liveOutput: '' });
    expect(migrated!.agents[0].metrics.startTime).toBe(0);
    expect((migrated as any).version).toBeUndefined();
  });

  it('отклоняет мусор', () => {
    expect(migrateStoredSession(null)).toBeNull();
    expect(migrateStoredSession({ id: '../x', projectPath: 'p', agents: [] })).toBeNull();
    expect(migrateStoredSession({ id: 'ok', projectPath: 'p' })).toBeNull();
  });
});

describe('SwarmSessionStore: save / list / delete', () => {
  it('сохраняет в <id>.json атомарно и читает обратно с миграцией', async () => {
    const session = makeSession('swarm-1', { createdAt: 1000 });
    await store.save(session);
    const file = store.sessionFile('swarm-1');
    await expect(fs.access(file)).resolves.toBeUndefined();
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(raw.version).toBe(SWARM_STORE_VERSION);

    await store.save(makeSession('swarm-2', { createdAt: 2000 }));
    await fs.writeFile(path.join(baseDir, 'swarm-broken.json'), '{ nope', 'utf8');
    await fs.writeFile(path.join(baseDir, 'notes.txt'), 'x', 'utf8');

    const list = await store.list();
    expect(list.map((s) => s.id)).toEqual(['swarm-2', 'swarm-1']);
    expect((list[1] as any).version).toBeUndefined();
    expect(list[1].agents[0].liveOutput).toBe('hello');
    // временных файлов не осталось
    const entries = await fs.readdir(baseDir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });

  it('save отклоняет недопустимый id; list по пустому каталогу → []', async () => {
    await expect(store.save(makeSession('../evil'))).rejects.toThrow();
    expect(await new SwarmSessionStore(path.join(baseDir, 'missing')).list()).toEqual([]);
  });

  it('scheduleSave троттлит запись: несколько вызовов → один файл с последним состоянием', async () => {
    const session = makeSession('swarm-t');
    store.scheduleSave(session);
    session.status = 'completed';
    store.scheduleSave(session);
    await new Promise((r) => setTimeout(r, 60));
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('completed');
  });

  it('flush записывает отложенное немедленно', async () => {
    const session = makeSession('swarm-f');
    store.scheduleSave(session);
    await store.flush();
    await expect(fs.access(store.sessionFile('swarm-f'))).resolves.toBeUndefined();
  });

  it('delete удаляет json и каталог транскриптов', async () => {
    const session = makeSession('swarm-d');
    await store.save(session);
    await store.appendTranscript('swarm-d', 'agent-1', 'log');
    expect(await store.delete('swarm-d')).toBe(true);
    await expect(fs.access(store.sessionFile('swarm-d'))).rejects.toThrow();
    await expect(fs.access(store.transcriptDir('swarm-d'))).rejects.toThrow();
    expect(await store.delete('../x')).toBe(false);
  });
});

describe('SwarmSessionStore: транскрипты', () => {
  it('appendTranscript сериализует чанки, readTranscript отдаёт хвост', async () => {
    await Promise.all([
      store.appendTranscript('swarm-x', 'agent-1', 'one '),
      store.appendTranscript('swarm-x', 'agent-1', 'two '),
      store.appendTranscript('swarm-x', 'agent-1', 'three')
    ]);
    const full = await store.readTranscript('swarm-x', 'agent-1');
    expect(full).not.toBeNull();
    expect(full!.content).toBe('one two three');
    expect(full!.truncated).toBe(false);
    expect(full!.sizeBytes).toBe(Buffer.byteLength('one two three'));

    const tail = await store.readTranscript('swarm-x', 'agent-1', 5);
    expect(tail!.content).toBe('three');
    expect(tail!.truncated).toBe(true);

    expect(await store.readTranscript('swarm-x', 'nope')).toBeNull();
    expect(await store.readTranscript('../x', 'agent-1')).toBeNull();
  });
});
