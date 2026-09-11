import type { FederationHost } from '../../src/types/remote.js';

/**
 * Формат анонса LAN-обнаружения федерации (TASK-66, AC #1: «и в LAN без релея»).
 *
 * Вместо mDNS-библиотеки — собственный UDP-multicast анонс на `node:dgram`: нужен ровно один
 * тип записи, а лишняя нативная зависимость в Electron-сборке дороже, чем 40 строк протокола.
 * Чужие машины отсекаются по `ownerId` (тот же хэш общего секрета, что и в каталоге релея):
 * в общей сети (коворкинг, общежитие) чужой ProjectHub не должен появляться в списке хостов.
 */

export const LAN_DISCOVERY_MULTICAST_ADDR = '239.255.42.56';
export const LAN_DISCOVERY_PORT = 42056;
export const LAN_DISCOVERY_MAGIC = 'projecthub-federation';
export const LAN_ANNOUNCE_INTERVAL_MS = 15_000;

export interface LanAnnouncePayload {
  hostId: string;
  ownerId: string;
  machineName: string;
  platform: string;
  port: number;
  appVersion?: string;
  protocolVersion: number;
  projectsCount?: number;
  activeAgentsCount?: number;
  hitlPendingCount?: number;
}

/** Сериализует анонс для отправки в multicast-группу. */
export function encodeAnnounce(payload: LanAnnouncePayload): string {
  return JSON.stringify({ magic: LAN_DISCOVERY_MAGIC, ...payload });
}

/**
 * Разбирает входящий анонс в запись каталога. Возвращает `null` для мусора, чужого владельца и
 * собственных анонсов (multicast возвращается и отправителю).
 *
 * `senderAddress` берётся из UDP-пакета, а не из его содержимого: адрес для прямого LAN-подключения
 * не должен зависеть от того, что о себе написал отправитель.
 */
export function parseAnnounce(
  raw: string | Buffer,
  context: { localOwnerId: string; localHostId: string; senderAddress?: string }
): FederationHost | null {
  if (!context.localOwnerId) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(String(raw));
  } catch {
    return null;
  }

  if (!data || data.magic !== LAN_DISCOVERY_MAGIC) return null;

  const hostId = typeof data.hostId === 'string' ? data.hostId : '';
  const ownerId = typeof data.ownerId === 'string' ? data.ownerId : '';
  if (!hostId || hostId === context.localHostId) return null;
  if (ownerId !== context.localOwnerId) return null;

  const port = Number(data.port) || 0;
  const address = context.senderAddress || '';

  return {
    hostId,
    machineName: typeof data.machineName === 'string' && data.machineName ? data.machineName : hostId,
    platform: (typeof data.platform === 'string' ? data.platform : 'linux') as FederationHost['platform'],
    localIps: address ? [address] : [],
    port,
    isOnline: true,
    projectsCount: Number(data.projectsCount) || 0,
    activeProcessesCount: 0,
    activeAgentsCount: Number(data.activeAgentsCount) || 0,
    hitlPendingCount: Number(data.hitlPendingCount) || 0,
    appVersion: typeof data.appVersion === 'string' ? data.appVersion : undefined,
    protocolVersion: Number(data.protocolVersion) || 1,
    lastSeen: Date.now(),
    source: 'lan'
  };
}
