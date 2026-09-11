/**
 * Каталог хостов федерации на relay-сервере (TASK-66, decision-11 п.2).
 *
 * Чистые функции без сети и сайд-эффектов — вынесены из `remote-relay-server.mjs`, чтобы
 * покрывать юнит-тестами без поднятия реального WS-сервера (как `remoteRelayAuth.mjs`).
 *
 * Модель: каждый хост при регистрации предъявляет `ownerId` — непрозрачный идентификатор
 * пользователя, выведенный на самом хосте из общего федеративного секрета
 * (`sha256('projecthub-federation-owner:' + secret)`). Секрет релею не передаётся, а хосты
 * разных пользователей не видят друг друга: каталог всегда фильтруется по `ownerId` той
 * сессии, которая его запрашивает. Хост без `ownerId` изолирован — видит только себя.
 */

/** Хост считается офлайн, если heartbeat не приходил дольше этого времени. */
export const HOST_STALE_MS = 90_000;
/** Допустимый формат `ownerId`: hex-хэш; проверяем, чтобы в каталог не попадал мусор. */
const OWNER_ID_RE = /^[a-f0-9]{16,128}$/;

/** Поля метаданных хоста, которые релею разрешено хранить и отдавать (остальное отбрасывается). */
const META_FIELDS = [
  'machineName',
  'platform',
  'appVersion',
  'protocolVersion',
  'tunnelUrl',
  'localIps',
  'port',
  'projects',
  'projectsCount',
  'activeProcessesCount',
  'activeAgentsCount',
  'hitlPendingCount'
];

/** Нормализует `ownerId` из query-параметра: '' — если не задан или не по формату. */
export function normalizeOwnerId(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return OWNER_ID_RE.test(value) ? value : '';
}

/**
 * Сливает метаданные хоста: берёт только известные поля из `patch`, сохраняет `hostId`/`ownerId`
 * базовой записи и проставляет свежий `lastSeen` (heartbeat).
 */
export function mergeHostMeta(base, patch, now = Date.now()) {
  const result = { ...(base || {}) };
  const incoming = patch && typeof patch === 'object' ? patch : {};

  for (const field of META_FIELDS) {
    if (incoming[field] !== undefined) result[field] = incoming[field];
  }

  // hostId/ownerId задаются при регистрации по подписанному ключу и не переписываются метаданными:
  // иначе хост мог бы объявить себя чужим или перепрыгнуть в каталог другого пользователя.
  if (base?.hostId) result.hostId = base.hostId;
  if (base?.ownerId !== undefined) result.ownerId = base.ownerId;

  result.lastSeen = now;
  result.isOnline = true;
  return result;
}

/** Свежий ли heartbeat хоста. */
export function isHeartbeatFresh(meta, now = Date.now(), staleMs = HOST_STALE_MS) {
  const lastSeen = Number(meta?.lastSeen) || 0;
  return now - lastSeen < staleMs;
}

/**
 * Строит каталог для запрашивающей сессии: только аутентифицированные хосты того же владельца
 * со свежим heartbeat. `ownerId` в выдачу не попадает — клиенту он не нужен и это лишняя утечка.
 *
 * @param sessions итерируемое множество сессий релея (`{ hostId, ownerId, authenticated, hostMeta, isOpen }`)
 * @param ownerId владелец запрашивающей стороны; пустой — каталог схлопывается до самого себя
 * @param options `{ now, requesterHostId, includeSelf }`
 */
export function buildCatalog(sessions, ownerId, options = {}) {
  const now = options.now ?? Date.now();
  const includeSelf = options.includeSelf !== false;
  const requesterHostId = options.requesterHostId || '';
  const owner = normalizeOwnerId(ownerId);
  const hosts = [];

  for (const session of sessions || []) {
    if (!session || !session.authenticated || session.isOpen === false) continue;
    if (!includeSelf && session.hostId === requesterHostId) continue;

    // Изоляция по владельцу: без ownerId хост видит только сам себя, чужих владельцев — никогда.
    const sessionOwner = normalizeOwnerId(session.ownerId);
    if (owner) {
      if (sessionOwner !== owner) continue;
    } else if (session.hostId !== requesterHostId) {
      continue;
    }

    const meta = session.hostMeta || {};
    if (!isHeartbeatFresh(meta, now)) continue;

    const { ownerId: _dropped, ...publicMeta } = meta;
    hosts.push({ ...publicMeta, hostId: session.hostId, isOnline: true });
  }

  hosts.sort((a, b) => String(a.machineName || a.hostId).localeCompare(String(b.machineName || b.hostId)));
  return hosts;
}
