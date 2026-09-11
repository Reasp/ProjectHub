import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs script, no type declarations
import { normalizeOwnerId, mergeHostMeta, isHeartbeatFresh, buildCatalog, HOST_STALE_MS } from '../../scripts/remoteRelayCatalog.mjs';

/**
 * Каталог хостов федерации на релее (TASK-66, AC #1/#6, decision-11 п.2): изоляция по владельцу,
 * heartbeat и защита метаданных от подмены `hostId`/`ownerId`. Логика вынесена в чистый модуль,
 * поэтому проверяется без поднятия WS-сервера.
 */

const OWNER_A = 'a'.repeat(64);
const OWNER_B = 'b'.repeat(64);

function session(hostId: string, ownerId: string, meta: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    hostId,
    ownerId,
    authenticated: true,
    isOpen: true,
    hostMeta: { hostId, ownerId, machineName: hostId, lastSeen: Date.now(), ...meta },
    ...extra
  };
}

describe('normalizeOwnerId', () => {
  it('принимает hex-идентификатор и приводит к нижнему регистру', () => {
    expect(normalizeOwnerId(OWNER_A.toUpperCase())).toBe(OWNER_A);
  });

  it('отбрасывает мусор, пустое и слишком короткое', () => {
    expect(normalizeOwnerId('')).toBe('');
    expect(normalizeOwnerId(null)).toBe('');
    expect(normalizeOwnerId('not-hex-value!')).toBe('');
    expect(normalizeOwnerId('abc')).toBe('');
  });
});

describe('mergeHostMeta', () => {
  it('обновляет разрешённые поля и проставляет heartbeat', () => {
    const base = { hostId: 'h1', ownerId: OWNER_A, machineName: 'PC-1', lastSeen: 1000 };
    const merged = mergeHostMeta(base, { projectsCount: 3, hitlPendingCount: 2 }, 5000);

    expect(merged).toMatchObject({ hostId: 'h1', machineName: 'PC-1', projectsCount: 3, hitlPendingCount: 2 });
    expect(merged.lastSeen).toBe(5000);
    expect(merged.isOnline).toBe(true);
  });

  it('игнорирует поля вне белого списка (произвольный мусор от хоста не попадает в каталог)', () => {
    const merged = mergeHostMeta({ hostId: 'h1', ownerId: OWNER_A }, { evil: 'payload', machineName: 'PC-2' });
    expect(merged.machineName).toBe('PC-2');
    expect((merged as Record<string, unknown>).evil).toBeUndefined();
  });

  it('не даёт подменить hostId и ownerId метаданными (захват чужой записи в каталоге)', () => {
    const merged = mergeHostMeta({ hostId: 'h1', ownerId: OWNER_A }, { hostId: 'h-victim', ownerId: OWNER_B });
    expect(merged.hostId).toBe('h1');
    expect(merged.ownerId).toBe(OWNER_A);
  });
});

describe('isHeartbeatFresh', () => {
  it('свежий heartbeat — онлайн, просроченный — нет', () => {
    const now = 1_000_000;
    expect(isHeartbeatFresh({ lastSeen: now - 1000 }, now)).toBe(true);
    expect(isHeartbeatFresh({ lastSeen: now - HOST_STALE_MS - 1 }, now)).toBe(false);
    expect(isHeartbeatFresh({}, now)).toBe(false);
  });
});

describe('buildCatalog', () => {
  it('отдаёт хосты того же владельца и скрывает чужих', () => {
    const sessions = [session('h1', OWNER_A), session('h2', OWNER_A), session('h3', OWNER_B)];
    const hosts = buildCatalog(sessions, OWNER_A, { requesterHostId: 'h1' });

    expect(hosts.map((h: { hostId: string }) => h.hostId).sort()).toEqual(['h1', 'h2']);
  });

  it('не раскрывает ownerId в выдаче', () => {
    const hosts = buildCatalog([session('h1', OWNER_A)], OWNER_A, { requesterHostId: 'h1' });
    expect(hosts[0].ownerId).toBeUndefined();
  });

  it('includeSelf:false убирает запрашивающий хост', () => {
    const sessions = [session('h1', OWNER_A), session('h2', OWNER_A)];
    const hosts = buildCatalog(sessions, OWNER_A, { requesterHostId: 'h1', includeSelf: false });
    expect(hosts.map((h: { hostId: string }) => h.hostId)).toEqual(['h2']);
  });

  it('хост без ownerId изолирован — видит только себя', () => {
    const sessions = [session('h1', ''), session('h2', OWNER_A)];
    const hosts = buildCatalog(sessions, '', { requesterHostId: 'h1' });
    expect(hosts.map((h: { hostId: string }) => h.hostId)).toEqual(['h1']);
  });

  it('исключает неаутентифицированные, закрытые и протухшие сессии', () => {
    const now = 1_000_000;
    const sessions = [
      session('ok', OWNER_A, { lastSeen: now - 1000 }),
      session('not-auth', OWNER_A, { lastSeen: now - 1000 }, { authenticated: false }),
      session('closed', OWNER_A, { lastSeen: now - 1000 }, { isOpen: false }),
      session('stale', OWNER_A, { lastSeen: now - HOST_STALE_MS - 1 })
    ];

    const hosts = buildCatalog(sessions, OWNER_A, { requesterHostId: 'ok', now });
    expect(hosts.map((h: { hostId: string }) => h.hostId)).toEqual(['ok']);
  });
});
