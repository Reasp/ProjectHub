import { describe, expect, it } from 'vitest';
import {
  buildPeerSocketUrl,
  normalizeWsBase,
  checkPeerProtocol,
  nextBackoffDelay,
  framePacket,
  parseIncomingPacket,
  FEDERATION_PROTOCOL_VERSION
} from '../../electron/services/federationProtocol';
import { generateSecretKey } from '../../src/utils/remoteCryptoNode';

/**
 * Протокол hub-режима (TASK-66, AC #2/#5/#6, decision-11 п.4/п.6): адрес подключения к другому
 * ProjectHub, сверка версий, backoff и E2EE-обёртка пакетов.
 */

describe('normalizeWsBase', () => {
  it('достраивает схему для голого host:port', () => {
    expect(normalizeWsBase('192.168.1.50:42050')).toBe('ws://192.168.1.50:42050/');
  });

  it('переводит http/https в ws/wss', () => {
    expect(normalizeWsBase('http://pc-1:42050')).toBe('ws://pc-1:42050/');
    expect(normalizeWsBase('https://relay.example.com')).toBe('wss://relay.example.com/');
  });

  it('оставляет ws/wss как есть', () => {
    expect(normalizeWsBase('wss://relay.example.com:8443')).toBe('wss://relay.example.com:8443/');
  });

  it('падает на пустом и неподдерживаемом адресе', () => {
    expect(() => normalizeWsBase('')).toThrow();
    expect(() => normalizeWsBase('ftp://pc-1')).toThrow();
  });
});

describe('buildPeerSocketUrl', () => {
  const base = {
    hostId: 'ph_host_remote1',
    deviceId: 'ph_host_local1',
    deviceName: 'PC-HUB'
  };

  it('relay: в query только маршрутизация, без PIN/ключа/токена', () => {
    const url = new URL(
      buildPeerSocketUrl({ ...base, transport: 'relay', address: 'wss://relay.example.com', secretKey: 'k'.repeat(64), pin: '123456' })
    );

    expect(url.searchParams.get('role')).toBe('client');
    expect(url.searchParams.get('hostId')).toBe('ph_host_remote1');
    expect(url.searchParams.get('clientId')).toBe('ph_host_local1');
    // Секреты через чужой релей в открытом query уходить не должны (decision-11 п.3).
    expect(url.searchParams.get('key')).toBeNull();
    expect(url.searchParams.get('pin')).toBeNull();
    expect(url.searchParams.get('token')).toBeNull();
  });

  it('lan: учётные данные идут в query, как у мобильного клиента', () => {
    const url = new URL(
      buildPeerSocketUrl({ ...base, transport: 'lan', address: '192.168.1.50:42050', secretKey: 'abc', pin: '123456' })
    );

    expect(url.searchParams.get('deviceId')).toBe('ph_host_local1');
    expect(url.searchParams.get('key')).toBe('abc');
    expect(url.searchParams.get('pin')).toBe('123456');
  });

  it('lan: при наличии токена PIN не отправляется', () => {
    const url = new URL(
      buildPeerSocketUrl({ ...base, transport: 'lan', address: '192.168.1.50:42050', pin: '123456', deviceToken: 'tok' })
    );

    expect(url.searchParams.get('token')).toBe('tok');
    expect(url.searchParams.get('pin')).toBeNull();
  });
});

describe('checkPeerProtocol', () => {
  it('совпадающая версия совместима', () => {
    expect(checkPeerProtocol({ protocolVersion: FEDERATION_PROTOCOL_VERSION })).toMatchObject({ compatible: true });
  });

  it('другая версия даёт понятную ошибку с обоими номерами', () => {
    const result = checkPeerProtocol({ protocolVersion: 99 });
    expect(result.compatible).toBe(false);
    expect(result.peerVersion).toBe(99);
    expect(result.error).toContain('99');
    expect(result.error).toContain(String(FEDERATION_PROTOCOL_VERSION));
  });

  it('хост без поля версии считается версией 1', () => {
    expect(checkPeerProtocol({}).peerVersion).toBe(1);
    expect(checkPeerProtocol(null).peerVersion).toBe(1);
  });
});

describe('nextBackoffDelay', () => {
  it('растёт экспоненциально и упирается в потолок', () => {
    expect(nextBackoffDelay(0)).toBe(1000);
    expect(nextBackoffDelay(1)).toBe(2000);
    expect(nextBackoffDelay(4)).toBe(16000);
    expect(nextBackoffDelay(10)).toBe(30000);
  });

  it('отрицательная попытка не ломает расчёт', () => {
    expect(nextBackoffDelay(-5)).toBe(1000);
  });
});

describe('framePacket / parseIncomingPacket', () => {
  it('с ключом пакет шифруется и расшифровывается обратно', () => {
    const key = generateSecretKey();
    const framed = framePacket({ type: 'rpc_req', id: '1', method: 'get_status' }, key);

    expect((framed as { e2ee?: boolean }).e2ee).toBe(true);
    expect(JSON.stringify(framed)).not.toContain('get_status');
    expect(parseIncomingPacket(JSON.stringify(framed), key)).toMatchObject({ type: 'rpc_req', method: 'get_status' });
  });

  it('без ключа пакет уходит как есть', () => {
    const framed = framePacket({ type: 'ping', id: '1' });
    expect((framed as { e2ee?: boolean }).e2ee).toBeUndefined();
  });

  it('чужой ключ и мусор дают null, а не исключение', () => {
    const framed = framePacket({ type: 'ping' }, generateSecretKey());
    expect(parseIncomingPacket(JSON.stringify(framed), generateSecretKey())).toBeNull();
    expect(parseIncomingPacket('not json', 'k')).toBeNull();
    expect(parseIncomingPacket('123', 'k')).toBeNull();
  });

  it('зашифрованный пакет без ключа не разбирается', () => {
    const framed = framePacket({ type: 'ping' }, generateSecretKey());
    expect(parseIncomingPacket(JSON.stringify(framed))).toBeNull();
  });
});
