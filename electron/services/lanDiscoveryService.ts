import dgram from 'node:dgram';
import type { FederationHost } from '../../src/types/remote.js';
import {
  encodeAnnounce,
  parseAnnounce,
  LAN_ANNOUNCE_INTERVAL_MS,
  LAN_DISCOVERY_MULTICAST_ADDR,
  LAN_DISCOVERY_PORT,
  type LanAnnouncePayload
} from './lanDiscoveryMessage.js';
import { logger } from './logger.js';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * LAN-обнаружение хостов федерации (TASK-66, AC #1). Периодический UDP-multicast анонс и приём
 * чужих анонсов — чтобы две машины в одной сети видели друг друга без релея вообще.
 *
 * Запускается только когда задан общий секрет федерации: без `ownerId` нечем отличить свои
 * машины от чужих, а рассылать имя машины в широковещательный канал «на всякий случай» нельзя.
 */
class LanDiscoveryService {
  private socket: dgram.Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private getPayload: (() => LanAnnouncePayload | null) | null = null;
  private onHost: ((host: FederationHost) => void) | null = null;

  public configure(options: { getPayload: () => LanAnnouncePayload | null; onHost: (host: FederationHost) => void }): void {
    this.getPayload = options.getPayload;
    this.onHost = options.onHost;
  }

  public isRunning(): boolean {
    return Boolean(this.socket);
  }

  public start(): void {
    if (this.socket || !this.getPayload) return;

    const payload = this.getPayload();
    if (!payload?.ownerId) return;

    try {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.socket = socket;

      socket.on('error', (err) => {
        logger.warn(`[LanDiscovery] Socket error: ${err.message}`);
        this.stop();
      });

      socket.on('message', (msg, rinfo) => {
        const current = this.getPayload?.();
        if (!current?.ownerId) return;
        const host = parseAnnounce(msg, {
          localOwnerId: current.ownerId,
          localHostId: current.hostId,
          senderAddress: rinfo.address
        });
        if (host) this.onHost?.(host);
      });

      socket.bind(LAN_DISCOVERY_PORT, () => {
        try {
          socket.addMembership(LAN_DISCOVERY_MULTICAST_ADDR);
          socket.setMulticastTTL(1); // не выходим за пределы локального сегмента
        } catch (err) {
          logger.warn(`[LanDiscovery] Failed to join multicast group: ${errorText(err)}`);
        }
        this.announce();
        this.timer = setInterval(() => this.announce(), LAN_ANNOUNCE_INTERVAL_MS);
        logger.info('[LanDiscovery] LAN-обнаружение федерации запущено');
      });
    } catch (err) {
      logger.warn(`[LanDiscovery] Failed to start: ${errorText(err)}`);
      this.socket = null;
    }
  }

  private announce(): void {
    const payload = this.getPayload?.();
    if (!this.socket || !payload?.ownerId) return;
    const message = Buffer.from(encodeAnnounce(payload));
    this.socket.send(message, 0, message.length, LAN_DISCOVERY_PORT, LAN_DISCOVERY_MULTICAST_ADDR, (err) => {
      if (err) logger.warn(`[LanDiscovery] Announce failed: ${err.message}`);
    });
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // сокет уже закрыт
      }
      this.socket = null;
    }
  }
}

export const lanDiscoveryService = new LanDiscoveryService();
