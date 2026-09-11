import type { EncryptedPacket, FederationTransport, PlainPacket } from '../../src/types/remote.js';
import { encryptPayload, decryptPayload } from '../../src/utils/remoteCryptoNode.js';

/**
 * Чистая часть hub-режима федерации (TASK-66, decision-11 п.4): сборка адреса подключения к
 * другому ProjectHub, проверка версии протокола, backoff переподключения и разбор входящих
 * пакетов. Без сокетов и Electron — покрыто unit-тестами (`tests/unit/federationProtocol.test.ts`).
 */

/** Версия протокола федерации; должна совпадать с `REMOTE_FEDERATION_PROTOCOL_VERSION` хоста. */
export const FEDERATION_PROTOCOL_VERSION = 1;

/** Как hub подключается к удалённому хосту: напрямую в LAN или через релей. */
export type PeerTransport = FederationTransport;

export interface PeerConnectOptions {
  /** hostId удалённого ProjectHub. */
  hostId: string;
  transport: PeerTransport;
  /** Для `lan` — `host:port` или полный ws/http URL хоста; для `relay` — URL релея. */
  address: string;
  /** Идентификатор этой машины как устройства на удалённом хосте (его `hostId`). */
  deviceId: string;
  deviceName: string;
  /** E2EE-ключ удалённого хоста (его `secretKey`), получаем при сопряжении. */
  secretKey?: string;
  /** PIN сопряжения — нужен только при первом подключении, дальше работает `deviceToken`. */
  pin?: string;
  /** Ранее выданный удалённым хостом per-device токен. */
  deviceToken?: string;
}

/**
 * Строит URL сокета к удалённому хосту.
 *
 * LAN: клиент аутентифицируется query-параметрами (как мобильный клиент в `setupLocalWebSocketServer`).
 * Relay: в query только маршрутизация (`role=client&hostId=...`) — PIN/ключ/токен уходят
 * отдельным зашифрованным пакетом `handshake`, потому что релей чужой (decision-11 п.3).
 */
export function buildPeerSocketUrl(options: PeerConnectOptions): string {
  const base = normalizeWsBase(options.address);
  const url = new URL(base);

  if (options.transport === 'relay') {
    url.searchParams.set('role', 'client');
    url.searchParams.set('hostId', options.hostId);
    url.searchParams.set('clientId', options.deviceId);
    url.searchParams.set('name', options.deviceName);
    return url.toString();
  }

  url.searchParams.set('deviceId', options.deviceId);
  url.searchParams.set('name', options.deviceName);
  if (options.secretKey) url.searchParams.set('key', options.secretKey);
  if (options.deviceToken) url.searchParams.set('token', options.deviceToken);
  else if (options.pin) url.searchParams.set('pin', options.pin);
  return url.toString();
}

/** Приводит адрес (`host:port`, `http://…`, `ws://…`) к ws-URL без пути. */
export function normalizeWsBase(address: string): string {
  const value = String(address || '').trim();
  if (!value) throw new Error('Адрес хоста не задан');

  let withScheme = value;
  if (!/^[a-z]+:\/\//i.test(value)) withScheme = `ws://${value}`;
  withScheme = withScheme.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');

  const url = new URL(withScheme);
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Неподдерживаемый протокол адреса: ${url.protocol}`);
  }
  return `${url.protocol}//${url.host}${url.pathname === '/' ? '/' : url.pathname}`;
}

export interface ProtocolCheckResult {
  compatible: boolean;
  peerVersion: number;
  error?: string;
}

/**
 * Проверяет версию протокола удалённого хоста из `handshake_ack` (AC #5). Хост старой сборки
 * версию не присылает — считаем её 1 и сверяем так же, чтобы расхождение не проходило молча.
 */
export function checkPeerProtocol(ack: { protocolVersion?: number } | null | undefined): ProtocolCheckResult {
  const peerVersion = Number(ack?.protocolVersion ?? 1) || 1;
  if (peerVersion === FEDERATION_PROTOCOL_VERSION) {
    return { compatible: true, peerVersion };
  }
  return {
    compatible: false,
    peerVersion,
    error:
      `Версия протокола удалённого хоста (${peerVersion}) несовместима с локальной `
      + `(${FEDERATION_PROTOCOL_VERSION}). Обновите ProjectHub на обеих машинах.`
  };
}

/** Экспоненциальный backoff переподключения к пиру (decision-11 п.6): 1с → 30с максимум. */
export function nextBackoffDelay(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(maxMs, baseMs * Math.pow(2, safeAttempt));
}

/** Готовит исходящий пакет: шифрует, если у нас есть E2EE-ключ хоста. */
export function framePacket(payload: PlainPacket, secretKey?: string): PlainPacket | EncryptedPacket {
  return secretKey ? encryptPayload(payload, secretKey) : payload;
}

/**
 * Разбирает входящий пакет: расшифровывает при `e2ee`, иначе возвращает как есть.
 * Возвращает `null`, если пакет не разобрался (чужой ключ, мусор) — соединение при этом не рвём.
 */
export function parseIncomingPacket(raw: string, secretKey?: string): PlainPacket | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const candidate = parsed as Record<string, unknown>;
  if (candidate.e2ee) {
    if (!secretKey) return null;
    try {
      return decryptPayload(candidate as unknown as EncryptedPacket, secretKey) as PlainPacket;
    } catch {
      return null;
    }
  }
  return candidate as unknown as PlainPacket;
}
