import { describe, expect, it } from 'vitest';
import { encodeAnnounce, parseAnnounce, LAN_DISCOVERY_MAGIC } from '../../electron/services/lanDiscoveryMessage';

/**
 * LAN-обнаружение федерации без релея (TASK-66, AC #1/#6): анонс и его разбор, включая отсечение
 * чужих машин по `ownerId` и собственных анонсов (multicast возвращается отправителю).
 */

const OWNER = 'a'.repeat(64);
const OTHER_OWNER = 'b'.repeat(64);

const payload = {
  hostId: 'ph_host_remote1',
  ownerId: OWNER,
  machineName: 'PC-2',
  platform: 'win32',
  port: 42050,
  appVersion: '1.2.3',
  protocolVersion: 1,
  projectsCount: 4,
  activeAgentsCount: 2,
  hitlPendingCount: 1
};

describe('encodeAnnounce', () => {
  it('добавляет magic-маркер протокола', () => {
    expect(JSON.parse(encodeAnnounce(payload)).magic).toBe(LAN_DISCOVERY_MAGIC);
  });
});

describe('parseAnnounce', () => {
  const context = { localOwnerId: OWNER, localHostId: 'ph_host_local1', senderAddress: '192.168.1.77' };

  it('превращает анонс своей машины в запись каталога', () => {
    const host = parseAnnounce(encodeAnnounce(payload), context);

    expect(host).toMatchObject({
      hostId: 'ph_host_remote1',
      machineName: 'PC-2',
      platform: 'win32',
      port: 42050,
      isOnline: true,
      source: 'lan',
      activeAgentsCount: 2,
      hitlPendingCount: 1
    });
    // Адрес берём из UDP-пакета, а не из его содержимого.
    expect(host?.localIps).toEqual(['192.168.1.77']);
  });

  it('игнорирует анонс чужого владельца', () => {
    const foreign = encodeAnnounce({ ...payload, ownerId: OTHER_OWNER });
    expect(parseAnnounce(foreign, context)).toBeNull();
  });

  it('игнорирует собственный анонс', () => {
    const self = encodeAnnounce({ ...payload, hostId: context.localHostId });
    expect(parseAnnounce(self, context)).toBeNull();
  });

  it('игнорирует мусор и пакеты без magic', () => {
    expect(parseAnnounce('not json', context)).toBeNull();
    expect(parseAnnounce(JSON.stringify({ hostId: 'x', ownerId: OWNER }), context)).toBeNull();
  });

  it('без локального ownerId обнаружение выключено — любой анонс отбрасывается', () => {
    expect(parseAnnounce(encodeAnnounce(payload), { ...context, localOwnerId: '' })).toBeNull();
  });
});
