import crypto from 'node:crypto';
import { BrowserWindow } from 'electron';
import { WebSocket } from 'ws';
import type { DeviceRights, FederationPeerState, FederationPeerStatus, PlainPacket } from '../../src/types/remote.js';
import {
  buildPeerSocketUrl,
  checkPeerProtocol,
  framePacket,
  nextBackoffDelay,
  parseIncomingPacket,
  type PeerTransport
} from './federationProtocol.js';
import { secretStorageService } from './secretStorageService.js';
import { logger } from './logger.js';
import { appEventBus } from './eventBus.js';

/**
 * Hub-режим федерации (TASK-66, decision-11 п.4): ProjectHub как КЛИЕНТ другого ProjectHub.
 *
 * Зеркало `remoteControlService` (тот принимает устройства), только в обратную сторону: этот
 * сервис открывает исходящие соединения к доверенным хостам пользователя, выполняет на них тот
 * же набор RPC, что и телефон, и транслирует их события в рендерер. Права ограничены per-device
 * токеном, который выдал удалённый хост, — hub не получает привилегий сверх своего устройства.
 */

/** Учётные данные пира: хранятся целиком в safeStorage (содержат E2EE-ключ и токен). */
interface PeerCredentials {
  hostId: string;
  machineName: string;
  transport: PeerTransport;
  /** LAN: `host:port`; relay: URL релея. */
  address: string;
  secretKey?: string;
  deviceToken?: string;
  /** Автоподключаться при старте приложения. */
  autoConnect?: boolean;
  addedAt: number;
}

export type PeerStatus = FederationPeerStatus;

export type { FederationPeerState };

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface PeerConnection {
  credentials: PeerCredentials;
  ws: WebSocket | null;
  status: PeerStatus;
  error?: string;
  rights?: DeviceRights;
  readOnly?: boolean;
  protocolVersion?: number;
  lastEventId: number;
  connectedAt?: number;
  pending: Map<string, PendingCall>;
  reconnectAttempt: number;
  reconnectTimer: NodeJS.Timeout | null;
  /** Пин первого сопряжения — держим только в памяти до выдачи токена. */
  pendingPin?: string;
  handshakeWaiters: Array<{ resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>;
  /** Пользователь отключил пира вручную — не переподключаться. */
  manualDisconnect: boolean;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const RPC_TIMEOUT_MS = 30_000;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const PEERS_SECRET_KEY = 'federation.peers';

class FederationClientService {
  private peers = new Map<string, PeerConnection>();
  private loaded: Promise<void> | null = null;
  /** Идентификатор и имя этой машины как устройства на удалённых хостах. */
  private localHostId = '';
  private localMachineName = 'ProjectHub';

  /** Вызывается из main после инициализации Remote Control: hub представляется своим hostId. */
  public configure(options: { hostId: string; machineName: string }): void {
    this.localHostId = options.hostId || this.localHostId;
    this.localMachineName = options.machineName || this.localMachineName;
  }

  public async init(): Promise<void> {
    await this.ensureLoaded();
    for (const peer of this.peers.values()) {
      if (peer.credentials.autoConnect && peer.credentials.deviceToken) {
        this.openConnection(peer).catch(() => {});
      }
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        try {
          const blob = await secretStorageService.getSecret(PEERS_SECRET_KEY);
          if (!blob) return;
          const parsed = JSON.parse(blob) as PeerCredentials[];
          for (const credentials of parsed) {
            if (!credentials?.hostId) continue;
            this.peers.set(credentials.hostId, this.emptyConnection(credentials));
          }
        } catch (err) {
          logger.warn(`[Federation] Failed to load peers: ${errorText(err)}`);
        }
      })();
    }
    await this.loaded;
  }

  private emptyConnection(credentials: PeerCredentials): PeerConnection {
    return {
      credentials,
      ws: null,
      status: 'idle',
      lastEventId: 0,
      pending: new Map(),
      reconnectAttempt: 0,
      reconnectTimer: null,
      handshakeWaiters: [],
      manualDisconnect: false
    };
  }

  private async persistPeers(): Promise<void> {
    try {
      const list = Array.from(this.peers.values()).map((p) => p.credentials);
      await secretStorageService.setSecret(PEERS_SECRET_KEY, JSON.stringify(list));
    } catch (err) {
      logger.warn(`[Federation] Failed to persist peers: ${errorText(err)}`);
    }
  }

  public async listPeers(): Promise<FederationPeerState[]> {
    await this.ensureLoaded();
    return Array.from(this.peers.values()).map((p) => this.toState(p));
  }

  private toState(peer: PeerConnection): FederationPeerState {
    return {
      hostId: peer.credentials.hostId,
      machineName: peer.credentials.machineName,
      transport: peer.credentials.transport,
      address: peer.credentials.address,
      status: peer.status,
      error: peer.error,
      rights: peer.rights,
      readOnly: peer.readOnly,
      protocolVersion: peer.protocolVersion,
      lastEventId: peer.lastEventId,
      connectedAt: peer.connectedAt,
      paired: Boolean(peer.credentials.deviceToken),
      autoConnect: Boolean(peer.credentials.autoConnect)
    };
  }

  /**
   * Добавляет (или обновляет) пира и сразу подключается: при первом сопряжении нужен PIN и
   * E2EE-ключ удалённого хоста, дальше хватает выданного им токена.
   */
  public async addPeer(options: {
    hostId: string;
    machineName?: string;
    transport: PeerTransport;
    address: string;
    secretKey?: string;
    pin?: string;
    autoConnect?: boolean;
  }): Promise<FederationPeerState> {
    await this.ensureLoaded();
    if (!options.hostId?.trim()) throw new Error('hostId удалённого хоста обязателен');
    if (options.hostId === this.localHostId) throw new Error('Нельзя добавить самого себя как удалённый хост');

    const existing = this.peers.get(options.hostId);
    const credentials: PeerCredentials = {
      hostId: options.hostId.trim(),
      machineName: options.machineName?.trim() || existing?.credentials.machineName || options.hostId.trim(),
      transport: options.transport,
      address: options.address.trim(),
      secretKey: options.secretKey?.trim() || existing?.credentials.secretKey,
      deviceToken: existing?.credentials.deviceToken,
      autoConnect: options.autoConnect ?? existing?.credentials.autoConnect ?? true,
      addedAt: existing?.credentials.addedAt || Date.now()
    };

    if (existing) {
      this.closeSocket(existing);
      existing.credentials = credentials;
      existing.pendingPin = options.pin;
      existing.manualDisconnect = false;
      await this.persistPeers();
      await this.openConnection(existing);
      return this.toState(existing);
    }

    const peer = this.emptyConnection(credentials);
    peer.pendingPin = options.pin;
    this.peers.set(credentials.hostId, peer);
    await this.persistPeers();
    await this.openConnection(peer);
    return this.toState(peer);
  }

  public async removePeer(hostId: string): Promise<void> {
    await this.ensureLoaded();
    const peer = this.peers.get(hostId);
    if (!peer) return;
    peer.manualDisconnect = true;
    this.closeSocket(peer);
    this.peers.delete(hostId);
    await this.persistPeers();
    this.notifyPeersChanged();
  }

  public async connectPeer(hostId: string): Promise<FederationPeerState> {
    await this.ensureLoaded();
    const peer = this.peers.get(hostId);
    if (!peer) throw new Error(`Хост ${hostId} не найден среди удалённых`);
    peer.manualDisconnect = false;
    await this.openConnection(peer);
    return this.toState(peer);
  }

  public async disconnectPeer(hostId: string): Promise<FederationPeerState> {
    await this.ensureLoaded();
    const peer = this.peers.get(hostId);
    if (!peer) throw new Error(`Хост ${hostId} не найден среди удалённых`);
    peer.manualDisconnect = true;
    this.closeSocket(peer);
    peer.status = 'idle';
    peer.error = undefined;
    this.notifyPeersChanged();
    return this.toState(peer);
  }

  /** Подключён ли пир прямо сейчас (для маршрутизации назначений между машинами). */
  public isConnected(hostId: string): boolean {
    const peer = this.peers.get(hostId);
    return Boolean(peer && peer.status === 'connected' && peer.ws?.readyState === WebSocket.OPEN);
  }

  /**
   * Выполняет RPC на удалённом хосте. Права проверяет сам хост по токену нашего устройства —
   * hub ничего не обходит, а лишь получает понятную ошибку, если прав не хватает.
   */
  public async call<T = unknown>(hostId: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.ensureLoaded();
    const peer = this.peers.get(hostId);
    if (!peer) throw new Error(`Хост ${hostId} не найден среди удалённых`);

    if (peer.status !== 'connected') {
      await this.openConnection(peer);
    }
    if (!peer.ws || peer.ws.readyState !== WebSocket.OPEN) {
      throw new Error(peer.error || `Хост ${peer.credentials.machineName} недоступен (${peer.status})`);
    }

    const id = `rpc_${crypto.randomBytes(8).toString('hex')}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        peer.pending.delete(id);
        reject(new Error(`Таймаут RPC ${method} на хосте ${peer.credentials.machineName}`));
      }, RPC_TIMEOUT_MS);

      peer.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.send(peer, { type: 'rpc_req', id, method, params });
    });
  }

  private send(peer: PeerConnection, payload: PlainPacket): void {
    if (!peer.ws || peer.ws.readyState !== WebSocket.OPEN) return;
    peer.ws.send(JSON.stringify(framePacket(payload, peer.credentials.secretKey)));
  }

  private closeSocket(peer: PeerConnection): void {
    if (peer.reconnectTimer) {
      clearTimeout(peer.reconnectTimer);
      peer.reconnectTimer = null;
    }
    if (peer.ws) {
      try {
        peer.ws.removeAllListeners();
        peer.ws.close();
      } catch {
        // сокет уже мёртв
      }
      peer.ws = null;
    }
    for (const [id, call] of peer.pending.entries()) {
      clearTimeout(call.timer);
      call.reject(new Error('Соединение с хостом закрыто'));
      peer.pending.delete(id);
    }
    this.rejectHandshakeWaiters(peer, new Error('Соединение с хостом закрыто'));
  }

  private rejectHandshakeWaiters(peer: PeerConnection, err: Error): void {
    const waiters = peer.handshakeWaiters.splice(0);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }

  private resolveHandshakeWaiters(peer: PeerConnection): void {
    const waiters = peer.handshakeWaiters.splice(0);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  /** Открывает соединение и ждёт `handshake_ack` — до него RPC отправлять нельзя. */
  private async openConnection(peer: PeerConnection): Promise<void> {
    if (peer.status === 'connected' && peer.ws?.readyState === WebSocket.OPEN) return;
    this.closeSocket(peer);

    peer.status = 'connecting';
    peer.error = undefined;
    this.notifyPeersChanged();

    const url = buildPeerSocketUrl({
      hostId: peer.credentials.hostId,
      transport: peer.credentials.transport,
      address: peer.credentials.address,
      deviceId: this.localHostId || 'projecthub-hub',
      deviceName: this.localMachineName,
      secretKey: peer.credentials.secretKey,
      pin: peer.pendingPin,
      deviceToken: peer.credentials.deviceToken
    });

    const ws = new WebSocket(url);
    peer.ws = ws;

    const handshakeDone = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Таймаут подключения к хосту ${peer.credentials.machineName}`));
      }, HANDSHAKE_TIMEOUT_MS);
      peer.handshakeWaiters.push({ resolve, reject, timer });
    });

    ws.on('open', () => {
      // LAN: учётные данные уже ушли в query, хост ответит `handshake_ack` сам.
      // Relay: ждём `relay_ack`, затем отправляем зашифрованный `handshake` (decision-11 п.3).
      if (peer.credentials.transport === 'lan') return;
    });

    ws.on('message', (raw: unknown) => {
      this.handlePeerMessage(peer, String(raw));
    });

    ws.on('close', () => {
      const wasConnected = peer.status === 'connected';
      peer.status = peer.manualDisconnect ? 'idle' : 'offline';
      peer.connectedAt = undefined;
      this.rejectHandshakeWaiters(peer, new Error(peer.error || 'Соединение с хостом закрыто'));
      for (const [id, call] of peer.pending.entries()) {
        clearTimeout(call.timer);
        call.reject(new Error('Соединение с хостом закрыто'));
        peer.pending.delete(id);
      }
      if (wasConnected) logger.info(`[Federation] Peer disconnected: ${peer.credentials.machineName}`);
      this.notifyPeersChanged();
      this.scheduleReconnect(peer);
    });

    ws.on('error', (err: Error) => {
      // Офлайн-хост — это статус, а не ошибка приложения (AC #5): сообщение кладём в состояние.
      peer.error = err?.message || 'Ошибка соединения';
      if (peer.status !== 'connected') peer.status = 'offline';
      this.notifyPeersChanged();
    });

    await handshakeDone;
  }

  private handlePeerMessage(peer: PeerConnection, raw: string): void {
    const packet = parseIncomingPacket(raw, peer.credentials.secretKey);
    if (!packet) return;

    const type = String((packet as PlainPacket).type || '');

    // Релей подтвердил маршрут — предъявляем хосту PIN/ключ/токен внутри E2EE-пакета.
    if (type === 'relay_ack') {
      this.send(peer, {
        type: 'handshake',
        data: {
          ...(peer.credentials.deviceToken ? { token: peer.credentials.deviceToken } : {}),
          ...(peer.pendingPin ? { pin: peer.pendingPin } : {}),
          ...(peer.credentials.secretKey ? { key: peer.credentials.secretKey } : {})
        }
      } as PlainPacket);
      return;
    }

    if (type === 'handshake_ack') {
      this.onHandshakeAck(peer, ((packet as PlainPacket).result || {}) as Record<string, unknown>);
      return;
    }

    if (type === 'error') {
      const message = String((packet as PlainPacket).error || 'Хост отклонил подключение');
      peer.error = message;
      peer.status = 'error';
      this.rejectHandshakeWaiters(peer, new Error(message));
      this.notifyPeersChanged();
      return;
    }

    if (type === 'host_disconnected') {
      peer.status = 'offline';
      peer.error = 'Хост отключился от релея';
      this.notifyPeersChanged();
      return;
    }

    if (type === 'rpc_res' || type === 'response') {
      const id = String((packet as PlainPacket).id || '');
      const call = peer.pending.get(id);
      if (!call) return;
      peer.pending.delete(id);
      clearTimeout(call.timer);
      const error = (packet as PlainPacket).error;
      if (error) call.reject(new Error(String(error)));
      else call.resolve((packet as PlainPacket).result);
      return;
    }

    if (type === 'event') {
      const eventId = Number((packet as PlainPacket).eventId) || 0;
      if (eventId > peer.lastEventId) peer.lastEventId = eventId;
      this.forwardPeerEvent(peer, String((packet as PlainPacket).event || ''), (packet as PlainPacket).data);
    }
  }

  private onHandshakeAck(peer: PeerConnection, result: Record<string, unknown>): void {
    const check = checkPeerProtocol(result as { protocolVersion?: number });
    peer.protocolVersion = check.peerVersion;

    if (!check.compatible) {
      peer.status = 'error';
      peer.error = check.error;
      logger.warn(`[Federation] ${check.error} (host ${peer.credentials.machineName})`);
      this.rejectHandshakeWaiters(peer, new Error(check.error || 'Несовместимая версия протокола'));
      this.closeSocket(peer);
      this.notifyPeersChanged();
      return;
    }

    if (result.approved === false) {
      peer.status = 'error';
      peer.error = 'Удалённый хост требует подтверждения устройства — подтвердите его в настройках того ПК';
      this.rejectHandshakeWaiters(peer, new Error(peer.error));
      this.notifyPeersChanged();
      return;
    }

    if (typeof result.deviceToken === 'string' && result.deviceToken) {
      peer.credentials.deviceToken = result.deviceToken;
      // PIN больше не нужен: дальше подключаемся по токену, который можно отозвать на том хосте.
      peer.pendingPin = undefined;
      void this.persistPeers();
    }

    peer.rights = (result.rights as DeviceRights) || peer.rights;
    peer.readOnly = Boolean(result.readOnly);
    peer.status = 'connected';
    peer.error = undefined;
    peer.connectedAt = Date.now();
    peer.reconnectAttempt = 0;

    const remoteLastEventId = Number(result.lastEventId) || 0;
    this.resolveHandshakeWaiters(peer);
    this.notifyPeersChanged();
    logger.info(`[Federation] Connected to peer ${peer.credentials.machineName} (${peer.credentials.transport})`);

    // Догон событий, пропущенных за время разрыва (decision-11 п.6).
    if (peer.lastEventId > 0 && remoteLastEventId > peer.lastEventId) {
      this.catchUpEvents(peer).catch((err) => {
        logger.warn(`[Federation] Event catch-up failed: ${errorText(err)}`);
      });
    } else if (peer.lastEventId === 0) {
      peer.lastEventId = remoteLastEventId;
    }
  }

  private async catchUpEvents(peer: PeerConnection): Promise<void> {
    const res = (await this.call<{ events?: Array<{ id: number; event: string; data: unknown }>; lastEventId?: number }>(
      peer.credentials.hostId,
      'get_events_since',
      { sinceId: peer.lastEventId }
    )) || {};

    for (const entry of res.events || []) {
      if (entry.id > peer.lastEventId) peer.lastEventId = entry.id;
      this.forwardPeerEvent(peer, entry.event, entry.data);
    }
    if (res.lastEventId && res.lastEventId > peer.lastEventId) peer.lastEventId = res.lastEventId;
  }

  /**
   * Событие удалённого хоста попадает в рендерер с явной пометкой хоста — интерфейс обязан
   * показывать, ЧЬЁ это событие, иначе очередь HITL двух машин сольётся в одну кашу.
   */
  private forwardPeerEvent(peer: PeerConnection, event: string, data: unknown): void {
    if (!event) return;
    const payload = { hostId: peer.credentials.hostId, machineName: peer.credentials.machineName, event, data };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('federation:event', payload);
    }
    appEventBus.publish({
      type: 'federation:peerEvent',
      hostId: peer.credentials.hostId,
      machineName: peer.credentials.machineName,
      event,
      at: Date.now()
    });
  }

  private scheduleReconnect(peer: PeerConnection): void {
    if (peer.manualDisconnect) return;
    if (!peer.credentials.deviceToken && !peer.pendingPin) return;
    if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer);

    const delay = nextBackoffDelay(peer.reconnectAttempt);
    peer.reconnectAttempt++;
    peer.reconnectTimer = setTimeout(() => {
      peer.reconnectTimer = null;
      if (peer.manualDisconnect) return;
      this.openConnection(peer).catch(() => {
        // следующая попытка будет запланирована из обработчика close
      });
    }, delay);
  }

  private notifyPeersChanged(): void {
    const states = Array.from(this.peers.values()).map((p) => this.toState(p));
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('federation:peersChanged', states);
    }
  }

  public shutdown(): void {
    for (const peer of this.peers.values()) {
      peer.manualDisconnect = true;
      this.closeSocket(peer);
    }
  }
}

export const federationClientService = new FederationClientService();
