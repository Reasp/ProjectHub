import http, { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { BrowserWindow } from 'electron';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  RemoteConnectionMode,
  RemoteControlConfig,
  RemoteControlStatus,
  RemoteDevice,
  PairedDevice,
  DeviceRights,
  RemotePacket,
  EncryptedPacket,
  PlainPacket,
  FederationHost
} from '../../src/types/remote.js';
import { generateSecretKey, generatePairingPin, encryptPayload, decryptPayload } from '../../src/utils/remoteCryptoNode.js';
import { projectRegistry } from './projectRegistry.js';
import { processManager } from './processManager.js';
import { gitService } from './gitService.js';
import { claudeBridgeService } from './claudeBridgeService.js';
import { aiAgentService } from './aiAgentService.js';
import { actionConfigService, type ActionDefinition } from './actionConfigService.js';
import { createBacklogTaskFile } from './backlogTaskCreate.js';
import { hitlService } from './hitlService.js';
import { secretStorageService } from './secretStorageService.js';
import { appEventBus } from './eventBus.js';
import { logger } from './logger.js';
import { getUserDataDir, getDevRepoRoot, getAppRootDir } from './appPaths.js';
import matter from 'gray-matter';

/**
 * Получение списка локальных IPv4 адресов машины для прямого подключения (LAN).
 */
export function getLocalIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

/**
 * Версия протокола федерации/Remote Control (TASK-58, задел для TASK-66). Увеличивается при
 * несовместимом изменении формата `FederationHost`/RPC. Хосты сверяют версию при регистрации
 * (`/api/federation/register`) и получают понятную ошибку вместо тихой порчи данных при рассинхроне.
 */
export const REMOTE_FEDERATION_PROTOCOL_VERSION = 1;

interface ClientConnection {
  id: string;
  ws: WebSocket;
  device: RemoteDevice;
  isEncrypted: boolean;
}

interface DeviceTokenRecord {
  token: string;
  rights: DeviceRights;
  deviceName: string;
  createdAt: number;
  /** Права назначены вручную из UI: пересопряжение по PIN их не сбрасывает (TASK-65). */
  rightsExplicit?: boolean;
}

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 5 * 60 * 1000;
const EVENT_LOG_MAX = 200;
const RPC_IDEMPOTENCY_TTL_MS = 60 * 1000;

class RemoteControlService {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private relayWs: WebSocket | null = null;
  private relayConnected = false;
  private relayReconnectTimer: NodeJS.Timeout | null = null;
  private relayReconnectAttempt = 0;

  private enabled = false;
  private port = 42050;
  private mode: RemoteConnectionMode = 'lan';
  private relayServerUrl = 'ws://127.0.0.1:42055';
  private requireApproval = true;
  private readOnly = false;
  private machineName = os.hostname();
  private autoStart = false;

  private telegramBotToken = '';
  private telegramChatId = '';
  private telegramBotUsername = '';
  private telegramMiniAppUrl = '';

  private tunnelProcess: ChildProcess | null = null;
  private tunnelUrl = '';
  private tunnelStatus: 'idle' | 'starting' | 'active' | 'error' = 'idle';
  private tunnelError: string | null = null;

  private hostId: string;
  private pairingPin: string;
  private secretKey: string;
  private lastError: string | null = null;

  /** Ed25519-identity хоста (decision-11 п.1); приватный ключ — только через secretStorageService. */
  private identityPrivateKeyPem: string | null = null;
  private identityPublicKeyPem: string | null = null;
  private identityReady: Promise<void> | null = null;

  /** Per-device токены выданные при сопряжении: deviceId -> запись (TASK-65). */
  private deviceTokens = new Map<string, DeviceTokenRecord>();
  /** Rate-limit подбора PIN/ключа по IP (decision-5 п.5). */
  private pinAttempts = new Map<string, { count: number; lockedUntil: number }>();
  /** Кольцевой буфер последних событий для догона по `lastEventId` (decision-11 п.6). */
  private eventLog: Array<{ id: number; event: string; data: any }> = [];
  private eventLogNextId = 1;
  /** Идемпотентность RPC по `requestId` (decision-11 п.6): повтор в течение TTL возвращает
   *  закэшированный ответ вместо повторного выполнения. */
  private recentRpcResponses = new Map<string, { result?: any; error?: string; expiresAt: number }>();
  /** Значения `secretKey`/`pairingPin`/`telegramBotToken`, найденные в legacy-plaintext конфиге при
   *  первом запуске после TASK-65 — переносятся в secretStorageService и никогда больше не
   *  пишутся в `remote-control.json` (decision-5 п.4). */
  private legacySecretsToMigrate: { secretKey?: string; pairingPin?: string; telegramBotToken?: string } = {};

  private connectedDevices = new Map<string, RemoteDevice>();
  private localClients = new Map<string, ClientConnection>();
  private activeProjectPath: string | null = null;
  private knownFederationHosts = new Map<string, FederationHost>();
  private cachedLocalProjects: Array<{ id: string; name: string; path: string }> = [];

  constructor() {
    this.hostId = `ph_host_${crypto.randomBytes(6).toString('hex')}`;
    this.pairingPin = generatePairingPin();
    this.secretKey = generateSecretKey();

    // Загрузка сохраненной конфигурации (постоянный hostId, machineName, telegramBotToken)
    this.loadConfig();

    // Инициализация локальных проектов для федерации
    this.refreshLocalProjects().catch(() => {});

    // Подписка на стриминг логов фоновых процессов
    this.setupProcessLogStreaming();
  }

  /**
   * Секреты (`secretKey`, `pairingPin`, `telegramBotToken`, приватный ключ identity, per-device
   * токены) — только через `secretStorageService` (safeStorage/DPAPI), никогда plaintext-JSON
   * (decision-5 п.4). Разово переносит значения, найденные в старом `remote-control.json`.
   * Вызывается из `initOnStartup()`; при отсутствии вызова (юнит-тесты) сервис остаётся на
   * значениях по умолчанию из конструктора — функционально корректно, просто не персистентно.
   */
  private async loadPersistedSecrets(): Promise<void> {
    try {
      const [storedKey, storedPin, storedBotToken, storedTokens] = await Promise.all([
        secretStorageService.getSecret('remoteControl.secretKey'),
        secretStorageService.getSecret('remoteControl.pairingPin'),
        secretStorageService.getSecret('remoteControl.telegramBotToken'),
        secretStorageService.getSecret('remoteControl.deviceTokens')
      ]);

      this.secretKey = storedKey || this.legacySecretsToMigrate.secretKey || this.secretKey;
      this.pairingPin = storedPin || this.legacySecretsToMigrate.pairingPin || this.pairingPin;
      this.telegramBotToken = storedBotToken || this.legacySecretsToMigrate.telegramBotToken || this.telegramBotToken;

      if (!storedKey) await secretStorageService.setSecret('remoteControl.secretKey', this.secretKey);
      if (!storedPin) await secretStorageService.setSecret('remoteControl.pairingPin', this.pairingPin);
      if (!storedBotToken && this.telegramBotToken) {
        await secretStorageService.setSecret('remoteControl.telegramBotToken', this.telegramBotToken);
      }

      if (storedTokens) {
        try {
          const parsed = JSON.parse(storedTokens) as Record<string, DeviceTokenRecord>;
          for (const [deviceId, rec] of Object.entries(parsed)) this.deviceTokens.set(deviceId, rec);
        } catch {
          // ignore corrupt device-tokens blob
        }
      }

      this.legacySecretsToMigrate = {};
      // Legacy-поля больше не пишутся saveConfig() — следующий вызов очистит их из JSON на диске.
      this.saveConfig();
    } catch (err: any) {
      logger.warn(`[RemoteControl] Failed to load persisted secrets: ${err?.message || err}`);
    }
  }

  private async persistDeviceTokens(): Promise<void> {
    try {
      const obj: Record<string, DeviceTokenRecord> = {};
      for (const [deviceId, rec] of this.deviceTokens.entries()) obj[deviceId] = rec;
      await secretStorageService.setSecret('remoteControl.deviceTokens', JSON.stringify(obj));
    } catch (err: any) {
      logger.warn(`[RemoteControl] Failed to persist device tokens: ${err?.message || err}`);
    }
  }

  /** Ed25519-keypair хоста (decision-11 п.1), генерируется один раз, приватный ключ — в secretStorageService. */
  private async ensureIdentity(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
    if (this.identityPrivateKeyPem && this.identityPublicKeyPem) {
      return { privateKeyPem: this.identityPrivateKeyPem, publicKeyPem: this.identityPublicKeyPem };
    }
    if (!this.identityReady) {
      this.identityReady = (async () => {
        const stored = await secretStorageService.getSecret('remoteControl.identityPrivateKey');
        if (stored) {
          this.identityPrivateKeyPem = stored;
          this.identityPublicKeyPem = crypto.createPublicKey(stored).export({ type: 'spki', format: 'pem' }).toString();
          return;
        }
        const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
        this.identityPrivateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        this.identityPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
        await secretStorageService.setSecret('remoteControl.identityPrivateKey', this.identityPrivateKeyPem);
      })();
    }
    await this.identityReady;
    return { privateKeyPem: this.identityPrivateKeyPem!, publicKeyPem: this.identityPublicKeyPem! };
  }

  /** Публичный ключ identity хоста (base64 SPKI) — для предъявления релею/пирам при регистрации. */
  public async getIdentityPublicKey(): Promise<string> {
    const { publicKeyPem } = await this.ensureIdentity();
    return publicKeyPem;
  }

  /** Подпись произвольных данных приватным ключом identity хоста (hex) — challenge-response релея. */
  public async signWithIdentity(data: string): Promise<string> {
    const { privateKeyPem } = await this.ensureIdentity();
    const key = crypto.createPrivateKey(privateKeyPem);
    return crypto.sign(null, Buffer.from(data, 'utf8'), key).toString('hex');
  }

  private constantTimeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /** Rate-limit подбора PIN/ключа (decision-5 п.5): 5 неудачных попыток -> блокировка на 5 минут. */
  private checkPinRateLimit(ip: string): { allowed: boolean; retryAfterMs?: number } {
    const entry = this.pinAttempts.get(ip);
    if (!entry) return { allowed: true };
    if (entry.lockedUntil > Date.now()) return { allowed: false, retryAfterMs: entry.lockedUntil - Date.now() };
    return { allowed: true };
  }

  private recordPinFailure(ip: string): void {
    const entry = this.pinAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= PIN_MAX_ATTEMPTS) {
      entry.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
      entry.count = 0;
    }
    this.pinAttempts.set(ip, entry);
  }

  private recordPinSuccess(ip: string): void {
    this.pinAttempts.delete(ip);
  }

  /**
   * Новый per-device токен при первом сопряжении (PIN/ключ); переподключения — уже по токену.
   * Права, назначенные вручную из UI (`setDeviceRights`), переживают пересопряжение — иначе
   * достаточно было бы переподключиться с PIN, чтобы вернуть себе полный доступ.
   */
  private issueDeviceToken(deviceId: string, deviceName: string): DeviceTokenRecord {
    const previous = this.deviceTokens.get(deviceId);
    const rights: DeviceRights = previous?.rightsExplicit ? previous.rights : this.readOnly ? 'readOnly' : 'full';
    const record: DeviceTokenRecord = {
      token: crypto.randomBytes(32).toString('hex'),
      rights,
      deviceName,
      createdAt: Date.now(),
      ...(previous?.rightsExplicit ? { rightsExplicit: true } : {})
    };
    this.deviceTokens.set(deviceId, record);
    this.persistDeviceTokens().catch(() => {});
    return record;
  }

  private validateDeviceToken(deviceId: string, token: string): DeviceTokenRecord | null {
    const record = this.deviceTokens.get(deviceId);
    if (!record) return null;
    return this.constantTimeEqual(record.token, token) ? record : null;
  }

  /** Отзыв токена конкретного устройства (в отличие от `regenerateToken`, не трогает остальных). */
  public revokeDeviceToken(deviceId: string): void {
    if (this.deviceTokens.delete(deviceId)) {
      this.persistDeviceTokens().catch(() => {});
    }
  }

  /**
   * Назначение прав конкретному устройству (TASK-65, decision-11 п.1): раньше права выводились
   * только из глобального `readOnly` в момент выдачи токена, то есть одному устройству нельзя было
   * дать более узкий доступ (например, только решения HITL), чем у хоста в целом.
   * Права применяются сразу и к уже открытой сессии устройства, и к его сохранённому токену.
   */
  public setDeviceRights(deviceId: string, rights: DeviceRights): RemoteControlStatus {
    const record = this.deviceTokens.get(deviceId);
    if (record) {
      record.rights = rights;
      record.rightsExplicit = true;
      this.persistDeviceTokens().catch(() => {});
    }

    const device = this.connectedDevices.get(deviceId);
    if (device) {
      device.rights = rights;
      // Клиент обновляет свой индикатор прав тем же пакетом, что и при сопряжении.
      this.sendToDevice(deviceId, {
        type: 'handshake_ack',
        result: { approved: device.isApproved, readOnly: this.readOnly, hostId: this.hostId, rights, lastEventId: this.eventLogNextId - 1 }
      });
    }

    this.notifyStatusChanged();
    return this.getStatus();
  }

  /** Спаренные устройства (по выданным токенам), включая офлайн — для UI управления правами. */
  public getPairedDevices(): PairedDevice[] {
    return Array.from(this.deviceTokens.entries()).map(([deviceId, record]) => ({
      deviceId,
      name: record.deviceName,
      rights: record.rights,
      createdAt: record.createdAt,
      rightsExplicit: record.rightsExplicit,
      connected: this.connectedDevices.has(deviceId)
    }));
  }

  public async refreshLocalProjects(): Promise<void> {
    try {
      const list = await projectRegistry.getProjects();
      this.cachedLocalProjects = list.map((p) => ({
        id: p.path,
        name: path.basename(p.path),
        path: p.path
      }));
    } catch {
      // ignore
    }
  }

  private getConfigFilePath(): string {
    return path.join(getUserDataDir(), 'remote-control.json');
  }

  private loadConfig() {
    try {
      const cfgPath = this.getConfigFilePath();
      if (existsSync(cfgPath)) {
        const raw = readFileSync(cfgPath, 'utf8');
        const data = JSON.parse(raw);
        if (data.hostId) this.hostId = data.hostId;
        if (data.machineName) this.machineName = data.machineName;
        // Legacy plaintext secretKey/pairingPin/telegramBotToken (до TASK-65) — переносятся в
        // secretStorageService в loadPersistedSecrets(), больше не читаются/пишутся отсюда напрямую.
        if (data.pairingPin) this.legacySecretsToMigrate.pairingPin = data.pairingPin;
        if (data.secretKey) this.legacySecretsToMigrate.secretKey = data.secretKey;
        if (data.telegramBotToken) this.legacySecretsToMigrate.telegramBotToken = data.telegramBotToken;
        if (typeof data.port === 'number') this.port = data.port;
        if (data.mode) this.mode = data.mode;
        if (data.relayServerUrl) this.relayServerUrl = data.relayServerUrl;
        if (typeof data.requireApproval === 'boolean') this.requireApproval = data.requireApproval;
        if (typeof data.readOnly === 'boolean') this.readOnly = data.readOnly;
        if (typeof data.autoStart === 'boolean') this.autoStart = data.autoStart;
        if (data.telegramChatId) this.telegramChatId = data.telegramChatId;
        if (data.telegramBotUsername) this.telegramBotUsername = data.telegramBotUsername;
        if (data.telegramMiniAppUrl) this.telegramMiniAppUrl = data.telegramMiniAppUrl;
      }
    } catch (err: any) {
      logger.warn(`[RemoteControl] Failed to load config: ${err?.message || err}`);
    }
  }

  private saveConfig() {
    try {
      const cfgPath = this.getConfigFilePath();
      // secretKey/pairingPin/telegramBotToken НЕ пишутся сюда (decision-5 п.4) — только через
      // secretStorageService (loadPersistedSecrets/updateConfig).
      const data = {
        hostId: this.hostId,
        machineName: this.machineName,
        port: this.port,
        mode: this.mode,
        relayServerUrl: this.relayServerUrl,
        requireApproval: this.requireApproval,
        readOnly: this.readOnly,
        autoStart: this.autoStart,
        telegramChatId: this.telegramChatId,
        telegramBotUsername: this.telegramBotUsername,
        telegramMiniAppUrl: this.telegramMiniAppUrl
      };
      writeFileSync(cfgPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err: any) {
      logger.warn(`[RemoteControl] Failed to save config: ${err?.message || err}`);
    }
  }

  /**
   * Подписка на шину событий (TASK-57): запросы и решения HITL уходят доверенным устройствам как
   * `ai:hitl` / `ai:hitlDecided`, события агентов — как `agent:*`. Без диффов и содержимого файлов.
   */
  private subscribeToEventBus(): void {
    if (this.busUnsubscribe) return;
    this.busUnsubscribe = appEventBus.subscribe((event) => {
      if (!this.enabled) return;
      if (event.type === 'hitl:requested') {
        const r = event.request;
        this.broadcastEvent('ai:hitl', {
          requestId: r.id,
          sessionId: r.sessionId,
          projectPath: r.projectPath,
          origin: r.origin,
          agentName: r.agentName,
          role: r.role,
          tool: r.tool || r.type,
          type: r.type,
          description: r.title,
          details: r.details,
          command: r.command,
          filePath: r.filePath,
          expiresAt: r.expiresAt
        });
      } else if (event.type === 'hitl:decided' || event.type === 'hitl:expired' || event.type === 'hitl:cancelled') {
        this.broadcastEvent('ai:hitlDecided', {
          requestId: event.request.id,
          sessionId: event.request.sessionId,
          approved: event.type === 'hitl:decided' ? event.approved : false,
          by: event.type === 'hitl:decided' ? event.source.kind : event.type.replace('hitl:', '')
        });
      } else if (event.type.startsWith('agent:')) {
        this.broadcastEvent(event.type, event);
      }
    });
  }

  private busUnsubscribe: (() => void) | null = null;

  public async initOnStartup(): Promise<void> {
    this.subscribeToEventBus();
    await this.loadPersistedSecrets();
    // Если включен autoStart или задан Telegram Bot Token, сервис и туннель стартуют автоматически
    if (this.autoStart || Boolean(this.telegramBotToken)) {
      try {
        await this.start();
        logger.info('[RemoteControl] Service auto-started successfully on application launch');
      } catch (err: any) {
        logger.warn(`[RemoteControl] Failed to auto-start service: ${err?.message || err}`);
      }
    }
  }

  public setActiveProject(projectPath: string | null) {
    this.activeProjectPath = projectPath;
  }

  /** Постоянный идентификатор этого хоста (decision-11); используется очередью HITL и аудитом. */
  public getHostId(): string {
    return this.hostId;
  }

  /** PIN или секретный ключ подходят для сопряжения нового устройства (TASK-58: вынесено для unit-тестов). */
  public isValidPairingCredentials(pin: string | null | undefined, key: string | null | undefined): boolean {
    return (
      (Boolean(pin) && this.constantTimeEqual(pin as string, this.pairingPin)) ||
      (Boolean(key) && this.constantTimeEqual(key as string, this.secretKey))
    );
  }

  public getStatus(): RemoteControlStatus {
    const localIps = getLocalIpAddresses();
    return {
      enabled: this.enabled,
      port: this.port,
      mode: this.mode,
      relayServerUrl: this.relayServerUrl,
      relayConnected: this.relayConnected,
      hostId: this.hostId,
      machineName: this.machineName,
      pairingPin: this.pairingPin,
      secretKey: this.secretKey,
      localIps,
      connectedDevices: Array.from(this.connectedDevices.values()),
      pairedDevices: this.getPairedDevices(),
      requireApproval: this.requireApproval,
      readOnly: this.readOnly,
      lastError: this.lastError,
      autoStart: this.autoStart,
      tunnelUrl: this.tunnelUrl,
      tunnelStatus: this.tunnelStatus,
      tunnelError: this.tunnelError,
      federationHosts: this.getFederationHostsList(),
      localAddresses: localIps,
      secretToken: this.secretKey,
      useRelay: this.mode === 'relay' || Boolean(this.relayServerUrl),
      telegramBotToken: this.telegramBotToken,
      telegramChatId: this.telegramChatId,
      telegramBotUsername: this.telegramBotUsername,
      telegramMiniAppUrl: this.telegramMiniAppUrl || (this.tunnelUrl ? `${this.tunnelUrl}/telegram` : '')
    };
  }

  public async sendTelegramNotification(text: string): Promise<boolean> {
    if (!this.telegramBotToken || !this.telegramChatId) return false;
    try {
      const url = `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.telegramChatId,
          text,
          parse_mode: 'Markdown'
        })
      });
      const data = await res.json() as any;
      return Boolean(data?.ok);
    } catch (err: any) {
      logger.warn(`[RemoteControl] Failed to send Telegram notification: ${err?.message || err}`);
      return false;
    }
  }

  public async toggle(targetState?: boolean): Promise<RemoteControlStatus> {
    const next = targetState !== undefined ? targetState : !this.enabled;
    if (next) {
      await this.start();
    } else {
      await this.stop();
    }
    this.notifyStatusChanged();
    return this.getStatus();
  }

  public async updateConfig(patch: Partial<RemoteControlConfig>): Promise<RemoteControlStatus> {
    let restartRequired = false;

    if (patch.port !== undefined && patch.port !== this.port) {
      this.port = patch.port;
      restartRequired = true;
    }
    if (patch.mode !== undefined && patch.mode !== this.mode) {
      this.mode = patch.mode;
      restartRequired = true;
    }
    if (patch.relayServerUrl !== undefined && patch.relayServerUrl !== this.relayServerUrl) {
      this.relayServerUrl = patch.relayServerUrl;
      restartRequired = true;
    }
    if (patch.requireApproval !== undefined) {
      this.requireApproval = patch.requireApproval;
    }
    if (patch.readOnly !== undefined) {
      this.readOnly = patch.readOnly;
    }
    if (patch.machineName !== undefined && patch.machineName.trim()) {
      this.machineName = patch.machineName.trim();
    }
    if (patch.autoStart !== undefined) {
      this.autoStart = patch.autoStart;
    }
    if (patch.tunnelUrl !== undefined) {
      this.tunnelUrl = patch.tunnelUrl;
    }
    if (patch.telegramBotToken !== undefined) {
      this.telegramBotToken = patch.telegramBotToken;
      await secretStorageService.setSecret('remoteControl.telegramBotToken', patch.telegramBotToken);
    }
    if (patch.telegramChatId !== undefined) {
      this.telegramChatId = patch.telegramChatId;
    }
    if (patch.telegramBotUsername !== undefined) {
      this.telegramBotUsername = patch.telegramBotUsername;
    }
    if (patch.telegramMiniAppUrl !== undefined) {
      this.telegramMiniAppUrl = patch.telegramMiniAppUrl;
    }

    // Сохраняем обновленные настройки на диск
    this.saveConfig();

    if (this.enabled && restartRequired) {
      await this.stop();
      await this.start();
    } else if (this.enabled && patch.telegramBotToken && this.tunnelUrl) {
      this.registerTelegramMenuButton(`${this.tunnelUrl}/telegram`).catch(() => {});
    }

    this.notifyStatusChanged();
    return this.getStatus();
  }

  public async regenerateToken(): Promise<RemoteControlStatus> {
    this.pairingPin = generatePairingPin();
    this.secretKey = generateSecretKey();
    await Promise.all([
      secretStorageService.setSecret('remoteControl.secretKey', this.secretKey),
      secretStorageService.setSecret('remoteControl.pairingPin', this.pairingPin)
    ]);

    // Отключаем все текущие устройства и отзываем их токены при смене мастер-ключа
    for (const client of this.localClients.values()) {
      try {
        client.ws.close(1008, 'Token regenerated');
      } catch {
        // ignore
      }
    }
    this.localClients.clear();
    this.connectedDevices.clear();
    this.deviceTokens.clear();
    await this.persistDeviceTokens();

    this.notifyStatusChanged();
    return this.getStatus();
  }

  public disconnectDevice(deviceId: string): RemoteControlStatus {
    const client = this.localClients.get(deviceId);
    if (client) {
      try {
        client.ws.close(1000, 'Disconnected by host');
      } catch {
        // ignore
      }
      this.localClients.delete(deviceId);
    }
    this.connectedDevices.delete(deviceId);
    this.revokeDeviceToken(deviceId);
    this.notifyStatusChanged();
    return this.getStatus();
  }

  public approveDevice(deviceId: string): RemoteControlStatus {
    const dev = this.connectedDevices.get(deviceId);
    if (dev) {
      dev.isApproved = true;
      this.notifyStatusChanged();

      // Оповещаем клиента о разрешении доступа
      this.sendToDevice(deviceId, {
        type: 'handshake_ack',
        result: { approved: true, readOnly: this.readOnly, hostId: this.hostId, rights: dev.rights, lastEventId: this.eventLogNextId - 1 }
      });
    }
    return this.getStatus();
  }

  public getHostFederationInfo(): FederationHost {
    const projects = this.cachedLocalProjects;
    const running = processManager.getAllRunningProcesses();
    const localIps = getLocalIpAddresses();
    return {
      hostId: this.hostId,
      machineName: this.machineName || os.hostname(),
      platform: process.platform as 'win32' | 'darwin' | 'linux',
      tunnelUrl: this.tunnelUrl || (this.telegramMiniAppUrl ? this.telegramMiniAppUrl.replace(/\/telegram\/?$/, '') : ''),
      localIps,
      isOnline: true,
      projectsCount: projects.length,
      activeProcessesCount: running.length,
      projects: projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
      lastSeen: Date.now(),
      protocolVersion: REMOTE_FEDERATION_PROTOCOL_VERSION
    };
  }

  /** Совместима ли версия протокола удалённого хоста с локальной (TASK-58, задел для TASK-66). */
  public isProtocolCompatible(peer: Pick<FederationHost, 'protocolVersion'>): boolean {
    return (peer.protocolVersion ?? 1) === REMOTE_FEDERATION_PROTOCOL_VERSION;
  }

  public getFederationHostsList(): FederationHost[] {
    const current = this.getHostFederationInfo();
    const list: FederationHost[] = [current];
    const now = Date.now();

    for (const [id, host] of this.knownFederationHosts.entries()) {
      if (id !== this.hostId) {
        const isOnline = now - host.lastSeen < 90000;
        list.push({ ...host, isOnline });
      }
    }
    return list;
  }

  public registerPeerHost(peer: FederationHost) {
    if (peer.hostId && peer.hostId !== this.hostId) {
      peer.lastSeen = Date.now();
      peer.isOnline = true;
      peer.protocolIncompatible = !this.isProtocolCompatible(peer);
      this.knownFederationHosts.set(peer.hostId, peer);
      this.notifyStatusChanged();
    }
  }

  public async registerTelegramMenuButton(webAppUrl: string): Promise<boolean> {
    if (!this.telegramBotToken) return false;
    try {
      const url = `https://api.telegram.org/bot${this.telegramBotToken}/setChatMenuButton`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menu_button: {
            type: 'web_app',
            text: 'ProjectHub',
            web_app: { url: webAppUrl }
          }
        })
      });
      const data = (await res.json()) as any;
      if (data?.ok) {
        logger.info(`[RemoteControl] Telegram Menu Button registered successfully with URL: ${webAppUrl}`);
        return true;
      } else {
        logger.warn(`[RemoteControl] Telegram setChatMenuButton error: ${data?.description || 'unknown'}`);
        return false;
      }
    } catch (err: any) {
      logger.warn(`[RemoteControl] Failed to set Telegram Menu Button: ${err?.message || err}`);
      return false;
    }
  }

  public async startTunnel(): Promise<string> {
    if (this.tunnelUrl && this.tunnelStatus === 'active') {
      return this.tunnelUrl;
    }

    // Если в настройках вручную задан готовый https URL mini app, используем его
    if (this.telegramMiniAppUrl && this.telegramMiniAppUrl.startsWith('https://')) {
      this.tunnelUrl = this.telegramMiniAppUrl.replace(/\/telegram\/?$/, '');
      this.tunnelStatus = 'active';
      this.tunnelError = null;
      logger.info(`[RemoteControl] Using configured custom HTTPS tunnel: ${this.tunnelUrl}`);
      if (this.telegramBotToken) {
        await this.registerTelegramMenuButton(`${this.tunnelUrl}/telegram`);
      }
      this.notifyStatusChanged();
      return this.tunnelUrl;
    }

    this.stopTunnel();
    this.tunnelStatus = 'starting';
    this.tunnelError = null;
    this.notifyStatusChanged();

    logger.info(`[RemoteControl] Starting automatic Cloudflare Quick Tunnel for port ${this.port}...`);

    return new Promise((resolve) => {
      let resolved = false;
      const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const args = ['--yes', 'cloudflared', 'tunnel', '--url', `http://127.0.0.1:${this.port}`];

      try {
        const child = spawn(cmd, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        });

        this.tunnelProcess = child;

        const onOutput = (data: Buffer) => {
          const text = data.toString();
          // Ищем URL вида https://[...].trycloudflare.com
          const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
          if (match && !resolved) {
            resolved = true;
            this.tunnelUrl = match[0];
            this.tunnelStatus = 'active';
            this.tunnelError = null;
            logger.info(`[RemoteControl] Cloudflare Quick Tunnel established: ${this.tunnelUrl}`);

            if (this.telegramBotToken) {
              this.registerTelegramMenuButton(`${this.tunnelUrl}/telegram`).catch(() => {});
            }
            this.notifyStatusChanged();
            resolve(this.tunnelUrl);
          }
        };

        child.stdout.on('data', onOutput);
        child.stderr.on('data', onOutput);

        child.on('error', (err) => {
          logger.warn(`[RemoteControl] Cloudflare tunnel process error: ${err.message}`);
          this.tunnelStatus = 'error';
          this.tunnelError = err.message;
          this.notifyStatusChanged();
          if (!resolved) {
            resolved = true;
            resolve('');
          }
        });

        child.on('exit', (code) => {
          logger.info(`[RemoteControl] Cloudflare tunnel process exited with code ${code}`);
          if (this.tunnelStatus === 'active') {
            this.tunnelStatus = 'idle';
            this.tunnelUrl = '';
            this.notifyStatusChanged();
          }
        });

        // Таймаут ожидания инициализации туннеля (30с)
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            if (this.tunnelStatus === 'starting') {
              this.tunnelStatus = 'error';
              this.tunnelError = 'Таймаут подключения туннеля Cloudflare (30s)';
              this.notifyStatusChanged();
            }
            resolve(this.tunnelUrl);
          }
        }, 30000);
      } catch (err: any) {
        this.tunnelStatus = 'error';
        this.tunnelError = err?.message || String(err);
        this.notifyStatusChanged();
        if (!resolved) {
          resolved = true;
          resolve('');
        }
      }
    });
  }

  public stopTunnel() {
    if (this.tunnelProcess) {
      try {
        this.tunnelProcess.kill('SIGTERM');
      } catch {
        // ignore
      }
      this.tunnelProcess = null;
    }
    this.tunnelUrl = '';
    this.tunnelStatus = 'idle';
    this.tunnelError = null;
  }

  public async start(): Promise<void> {
    if (this.server && this.server.listening) {
      return;
    }

    this.lastError = null;

    try {
      await this.refreshLocalProjects();
      await this.startLocalHttpAndWsServer();
      this.enabled = true;

      if (this.mode === 'relay' || this.relayServerUrl) {
        this.connectToRelay();
      }

      // Если задан Telegram Bot Token или включен autoStart, автоматически поднимаем HTTPS-туннель
      if (this.telegramBotToken || this.autoStart) {
        this.startTunnel().catch((err) => {
          logger.warn(`[RemoteControl] Tunnel background startup failed: ${err?.message || err}`);
        });
      }

      logger.info(`[RemoteControl] Service started on port ${this.port} (mode: ${this.mode})`);
    } catch (err: any) {
      this.lastError = err?.message || String(err);
      logger.error(`[RemoteControl] Failed to start: ${this.lastError}`);
      await this.stop();
      throw err;
    }
  }

  public async stop(): Promise<void> {
    this.enabled = false;
    this.disconnectFromRelay();
    this.stopTunnel();

    // Закрываем локальные клиенты
    for (const client of this.localClients.values()) {
      try {
        client.ws.close(1001, 'Remote server stopped');
      } catch {
        // ignore
      }
    }
    this.localClients.clear();
    this.connectedDevices.clear();

    if (this.wss) {
      try {
        this.wss.close();
      } catch {
        // ignore
      }
      this.wss = null;
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }

    logger.info('[RemoteControl] Service stopped');
    this.notifyStatusChanged();
  }

  /**
   * Запуск локального HTTP сервера и WebSocket сервера.
   */
  private async startLocalHttpAndWsServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
        this.handleHttpRequest(req, res);
      });

      server.on('error', (err: any) => {
        reject(err);
      });

      server.listen(this.port, '0.0.0.0', () => {
        this.server = server;
        this.wss = new WebSocketServer({ server });
        this.setupLocalWebSocketServer(this.wss);
        resolve();
      });
    });
  }

  /**
   * Аутентификация `/api/*` (decision-5 п.5): Bearer-токен (заголовок или `?token=`) должен
   * совпадать с мастер-ключом хоста либо с одним из выданных per-device токенов. `/api/qr`
   * удалён (отдавал секрет без всякой проверки — единственный потребитель, встроенный клиент,
   * уже получает пейринг-данные через IPC/QR на стороне рендерера).
   */
  private isAuthorizedApiRequest(req: IncomingMessage, url: URL): boolean {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const presented = bearer || url.searchParams.get('token') || '';
    if (!presented) return false;
    if (this.constantTimeEqual(presented, this.secretKey)) return true;
    for (const record of this.deviceTokens.values()) {
      if (this.constantTimeEqual(presented, record.token)) return true;
    }
    return false;
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // GET /api/status - минимальная публичная информация для обнаружения хоста (без имени
    // машины и локальных IP — см. decision-5 п.5, "не раскрывать... без токена").
    if (url.pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'ProjectHub-Remote',
          hostId: this.hostId,
          mode: this.mode,
          requireApproval: this.requireApproval,
          port: this.port
        })
      );
      return;
    }

    // GET /api/federation/info, /api/federation/hosts, POST /api/federation/register —
    // раскрывают пути проектов/имя машины/список хостов, требуют токен (decision-5 п.5).
    if (url.pathname.startsWith('/api/federation/')) {
      if (!this.isAuthorizedApiRequest(req, url)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      if (url.pathname === '/api/federation/info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.getHostFederationInfo()));
        return;
      }

      if (url.pathname === '/api/federation/hosts') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ hosts: this.getFederationHostsList() }));
        return;
      }

      if (url.pathname === '/api/federation/register' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const peer = JSON.parse(body) as FederationHost;
            if (!this.isProtocolCompatible(peer)) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: 'protocol_version_mismatch',
                  message:
                    `Версия протокола федерации хоста "${peer.machineName || peer.hostId}" (${peer.protocolVersion ?? 1}) `
                    + `несовместима с локальной (${REMOTE_FEDERATION_PROTOCOL_VERSION}). Обновите ProjectHub на обеих машинах.`,
                  localProtocolVersion: REMOTE_FEDERATION_PROTOCOL_VERSION,
                  peerProtocolVersion: peer.protocolVersion ?? 1
                })
              );
              return;
            }
            this.registerPeerHost(peer);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, hosts: this.getFederationHostsList() }));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }
    }

    // GET /remote-crypto.js - канонический браузерный E2EE-модуль (TASK-65, decision-11 п.3),
    // общий для Mini App и встроенного веб-клиента (оба без сборщика).
    if (url.pathname === '/remote-crypto.js') {
      const script = await this.readStaticAsset('remote-crypto.js');
      if (!script) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(script);
      return;
    }

    // GET /telegram или GET /telegram/ - отдача Telegram Mini App
    if (url.pathname === '/telegram' || url.pathname === '/telegram/' || url.pathname.startsWith('/telegram/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(await this.getTelegramMiniAppHtml());
      return;
    }

    // GET /remote или GET / - отдача встроенного HTML веб-клиента
    if (url.pathname === '/remote' || url.pathname === '/' || url.pathname.startsWith('/remote/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.getEmbeddedWebClientHtml());
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }

  /**
   * Настройка локального WebSocket сервера.
   */
  private setupLocalWebSocketServer(wss: WebSocketServer) {
    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pin = url.searchParams.get('pin');
      const key = url.searchParams.get('key');
      const token = url.searchParams.get('token');
      const deviceId = url.searchParams.get('deviceId') || `dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const deviceName = url.searchParams.get('name') || 'Mobile Client';
      const userAgent = req.headers['user-agent'] || 'Unknown Device';
      const ip = req.socket.remoteAddress || '127.0.0.1';

      // Переподключение уже спаренного устройства — по его собственному токену, без PIN/ключа
      // (decision-5 п.5: per-device токены с отзывом вместо одного общего секрета навсегда).
      let issuedToken: string | null = null;
      let rights: DeviceRights;
      const existingRecord = token ? this.validateDeviceToken(deviceId, token) : null;

      if (existingRecord) {
        rights = existingRecord.rights;
      } else {
        const rateLimit = this.checkPinRateLimit(ip);
        if (!rateLimit.allowed) {
          ws.send(JSON.stringify({ type: 'error', error: 'Too many failed attempts, try again later' }));
          ws.close(1008, 'Rate limited');
          return;
        }

        if (!this.isValidPairingCredentials(pin, key)) {
          this.recordPinFailure(ip);
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid pairing PIN or secret key' }));
          ws.close(1008, 'Authentication failed');
          return;
        }
        this.recordPinSuccess(ip);

        const issued = this.issueDeviceToken(deviceId, deviceName);
        issuedToken = issued.token;
        rights = issued.rights;
      }

      // Пакет шифруется ключом E2EE (`key`), общим для всех устройств (см. remoteCryptoNode/Web);
      // per-device токен — отдельный фактор аутентификации/прав, не участвует в шифровании.
      const isKeyValid = key === this.secretKey;

      const isApproved = !this.requireApproval || Boolean(existingRecord);
      const device: RemoteDevice = {
        id: deviceId,
        name: deviceName,
        ip,
        mode: 'lan',
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
        userAgent,
        isApproved,
        rights
      };

      const clientConn: ClientConnection = {
        id: deviceId,
        ws,
        device,
        isEncrypted: isKeyValid
      };

      this.connectedDevices.set(deviceId, device);
      this.localClients.set(deviceId, clientConn);
      this.notifyStatusChanged();

      // Подтверждение клиенту — новый токен выдаётся только при первом сопряжении.
      ws.send(
        JSON.stringify({
          type: 'handshake_ack',
          result: {
            approved: isApproved,
            readOnly: this.readOnly,
            hostId: this.hostId,
            rights,
            // Клиент запоминает точку в потоке событий, чтобы после разрыва догнать с неё, а не
            // проигрывать заново весь кольцевой буфер (decision-11 п.6).
            lastEventId: this.eventLogNextId - 1,
            ...(issuedToken ? { deviceToken: issuedToken } : {})
          }
        })
      );

      // Уведомление в десктоп
      this.notifyRenderer('remote:deviceConnected', device);

      ws.on('message', async (raw: any) => {
        device.lastSeenAt = Date.now();
        await this.handleIncomingClientMessage(deviceId, raw, (resp) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(typeof resp === 'string' ? resp : JSON.stringify(resp));
          }
        });
      });

      ws.on('close', () => {
        this.localClients.delete(deviceId);
        this.connectedDevices.delete(deviceId);
        this.notifyStatusChanged();
        this.notifyRenderer('remote:deviceDisconnected', { deviceId });
      });
    });
  }

  /**
   * Подключение к внешнему Relay серверу. Хост доказывает владение `hostId` подписью
   * challenge-nonce своим Ed25519-identity ключом (TASK-65, decision-11 п.2) — без этого релей
   * не зарегистрирует соединение (см. `remote-relay-server.mjs`).
   */
  private async connectToRelay() {
    this.disconnectFromRelay();

    try {
      const { publicKeyPem } = await this.ensureIdentity();
      const relayUrl = new URL(this.relayServerUrl);
      relayUrl.searchParams.set('role', 'host');
      relayUrl.searchParams.set('hostId', this.hostId);
      relayUrl.searchParams.set('machineName', this.machineName || os.hostname());
      relayUrl.searchParams.set('platform', process.platform);
      relayUrl.searchParams.set('pubkey', Buffer.from(publicKeyPem).toString('base64url'));

      const ws = new WebSocket(relayUrl.toString());
      this.relayWs = ws;

      ws.on('open', () => {
        logger.info(`[RemoteControl] Relay TCP connected, awaiting auth challenge: ${this.relayServerUrl}`);
      });

      ws.on('message', async (raw: any) => {
        try {
          const msg = JSON.parse(raw.toString());

          // Challenge-response при регистрации (см. remote-relay-server.mjs)
          if (msg.type === 'auth_challenge') {
            const signature = await this.signWithIdentity(msg.nonce);
            ws.send(JSON.stringify({ type: 'auth_response', signature }));
            return;
          }

          if (msg.type === 'relay_ack' && msg.role === 'host') {
            this.relayConnected = true;
            this.relayReconnectAttempt = 0;
            logger.info(`[RemoteControl] Authenticated with Relay Server: ${this.relayServerUrl}`);
            this.notifyStatusChanged();
            return;
          }

          // Обработка системных сообщений от релея. Клиент, пришедший через релей, ещё НЕ
          // аутентифицирован — в отличие от LAN (проверка PIN/ключа в query до апгрейда сокета),
          // релей лишь транспорт, поэтому isApproved всегда false, пока клиент не пройдёт
          // `handshake` внутри E2EE-пакета (decision-5 п.5: аутентификация на каждом интерфейсе).
          if (msg.type === 'client_connected') {
            const dev: RemoteDevice = {
              id: msg.clientId,
              name: msg.name || 'Remote Client (Relay)',
              ip: msg.ip || 'relay',
              mode: 'relay',
              connectedAt: Date.now(),
              lastSeenAt: Date.now(),
              userAgent: msg.userAgent || 'Web/Mobile',
              isApproved: false
            };
            this.connectedDevices.set(msg.clientId, dev);
            this.notifyStatusChanged();
            this.notifyRenderer('remote:deviceConnected', dev);
            return;
          }

          if (msg.type === 'client_disconnected') {
            this.connectedDevices.delete(msg.clientId);
            this.notifyStatusChanged();
            this.notifyRenderer('remote:deviceDisconnected', { deviceId: msg.clientId });
            return;
          }

          // Входящее сообщение от клиента через релей
          const fromClientId = msg.fromClientId;
          if (fromClientId) {
            await this.handleIncomingClientMessage(fromClientId, raw, (resp) => {
              if (ws.readyState === WebSocket.OPEN) {
                const packet = typeof resp === 'string' ? JSON.parse(resp) : resp;
                packet.targetClientId = fromClientId;
                ws.send(JSON.stringify(packet));
              }
            });
          }
        } catch (err) {
          logger.error('[RemoteControl] Relay message error:', err);
        }
      });

      ws.on('close', () => {
        this.relayConnected = false;
        this.notifyStatusChanged();
        this.scheduleRelayReconnect();
      });

      ws.on('error', (err) => {
        logger.warn(`[RemoteControl] Relay error: ${err.message}`);
        this.relayConnected = false;
        this.notifyStatusChanged();
      });
    } catch (err: any) {
      logger.error(`[RemoteControl] Failed to connect to relay: ${err?.message}`);
      this.scheduleRelayReconnect();
    }
  }

  private scheduleRelayReconnect() {
    if (!this.enabled || this.mode !== 'relay') return;
    if (this.relayReconnectTimer) clearTimeout(this.relayReconnectTimer);

    // Экспоненциальный backoff (TASK-65, decision-11 п.6), максимум 30с между попытками.
    const delay = Math.min(30000, 1000 * Math.pow(2, this.relayReconnectAttempt));
    this.relayReconnectAttempt++;
    this.relayReconnectTimer = setTimeout(() => {
      if (this.enabled && this.mode === 'relay' && !this.relayConnected) {
        this.connectToRelay();
      }
    }, delay);
  }

  private disconnectFromRelay() {
    if (this.relayReconnectTimer) {
      clearTimeout(this.relayReconnectTimer);
      this.relayReconnectTimer = null;
    }
    if (this.relayWs) {
      try {
        this.relayWs.close();
      } catch {
        // ignore
      }
      this.relayWs = null;
    }
    this.relayConnected = false;
  }

  /** Ответ клиенту в том же виде, в каком пришёл запрос: зашифрованным, если запрос был зашифрован. */
  private replyMaybeEncrypted(reply: (resp: RemotePacket) => void, isEncrypted: boolean, payload: PlainPacket): void {
    reply(isEncrypted ? encryptPayload(payload, this.secretKey) : payload);
  }

  /**
   * Обработка сообщения от клиента (распаковка E2EE при наличии и диспетчеризация RPC).
   */
  private async handleIncomingClientMessage(
    deviceId: string,
    raw: any,
    reply: (resp: any) => void
  ): Promise<void> {
    let packet: PlainPacket;
    let isEncrypted = false;

    try {
      const parsed = JSON.parse(raw.toString());
      if ('e2ee' in parsed && parsed.e2ee) {
        isEncrypted = true;
        packet = decryptPayload(parsed as EncryptedPacket, this.secretKey);
      } else {
        packet = parsed as PlainPacket;
      }
    } catch (err) {
      reply({ type: 'error', error: 'Malformed or decrypt failure' });
      return;
    }

    const device = this.connectedDevices.get(deviceId);
    if (!device || (!device.isApproved && packet.type !== 'handshake')) {
      reply({ type: 'error', error: 'Device not approved by host' });
      return;
    }

    // Handshake внутри E2EE-пакета (TASK-65, decision-5 п.5): единственный способ клиенту,
    // подключённому через релей, доказать PIN/ключ/токен — релей сам не проверяет ничего, кроме
    // identity хоста. LAN-клиенты уже прошли этот же контроль в query-параметрах при апгрейде
    // сокета (`setupLocalWebSocketServer`), но повторный handshake через пакет здесь тоже
    // поддерживается им (идемпотентно выдаёт новый токен).
    if (packet.type === 'handshake') {
      const data = (packet.data || {}) as { pin?: string; key?: string; token?: string };
      const rateKey = `relay:${deviceId}`;
      const existingRecord = data.token ? this.validateDeviceToken(deviceId, data.token) : null;

      if (existingRecord) {
        device.isApproved = !this.requireApproval || device.isApproved;
        device.rights = existingRecord.rights;
        this.replyMaybeEncrypted(reply, isEncrypted, {
          type: 'handshake_ack',
          result: {
            approved: device.isApproved,
            readOnly: this.readOnly,
            hostId: this.hostId,
            rights: device.rights,
            lastEventId: this.eventLogNextId - 1
          }
        });
        this.notifyStatusChanged();
        return;
      }

      const rateLimit = this.checkPinRateLimit(rateKey);
      if (!rateLimit.allowed) {
        reply({ type: 'error', error: 'Too many failed attempts, try again later' });
        return;
      }
      if (!this.isValidPairingCredentials(data.pin, data.key)) {
        this.recordPinFailure(rateKey);
        reply({ type: 'error', error: 'Invalid pairing PIN or secret key' });
        return;
      }
      this.recordPinSuccess(rateKey);

      const issued = this.issueDeviceToken(deviceId, device.name);
      device.isApproved = !this.requireApproval;
      device.rights = issued.rights;
      // Ответ шифруется тем же ключом, что и запрос: через релей `deviceToken` иначе уехал бы
      // открытым текстом через чужой сервер (decision-11 п.3 — релей не видит содержимого).
      this.replyMaybeEncrypted(reply, isEncrypted, {
        type: 'handshake_ack',
        result: {
          approved: device.isApproved,
          readOnly: this.readOnly,
          hostId: this.hostId,
          rights: issued.rights,
          deviceToken: issued.token,
          lastEventId: this.eventLogNextId - 1
        }
      });
      this.notifyStatusChanged();
      return;
    }

    if (!device.isApproved) {
      reply({ type: 'error', error: 'Device not approved by host' });
      return;
    }

    // Ping / Pong
    if (packet.type === 'ping') {
      reply({ type: 'pong', id: packet.id });
      return;
    }

    // RPC Request (поддержка rpc_req и request из Telegram Mini App)
    if (packet.type === 'rpc_req' || (packet as any).type === 'request') {
      const req = packet as PlainPacket;
      const isReqType = (packet as any).type === 'request';
      const idemKey = req.id ? `${deviceId}:${req.id}` : null;
      const cached = idemKey ? this.recentRpcResponses.get(idemKey) : undefined;

      if (cached && cached.expiresAt > Date.now()) {
        const resPayload: any = { type: isReqType ? 'response' : 'rpc_res', id: req.id, result: cached.result, error: cached.error };
        reply(isEncrypted ? encryptPayload(resPayload, this.secretKey) : resPayload);
        return;
      }

      try {
        const result = await this.dispatchRpc(req.method || '', req.params, device);
        if (idemKey) this.recentRpcResponses.set(idemKey, { result, expiresAt: Date.now() + RPC_IDEMPOTENCY_TTL_MS });
        const resPayload: any = {
          type: isReqType ? 'response' : 'rpc_res',
          id: req.id,
          result
        };

        if (isEncrypted) {
          reply(encryptPayload(resPayload, this.secretKey));
        } else {
          reply(resPayload);
        }
      } catch (err: any) {
        if (idemKey) {
          this.recentRpcResponses.set(idemKey, { error: err?.message || String(err), expiresAt: Date.now() + RPC_IDEMPOTENCY_TTL_MS });
        }
        const errPayload: any = {
          type: isReqType ? 'response' : 'rpc_res',
          id: req.id,
          error: err?.message || String(err)
        };
        if (isEncrypted) {
          reply(encryptPayload(errPayload, this.secretKey));
        } else {
          reply(errPayload);
        }
      }
    }
  }

  /**
   * Диспетчер RPC методов.
   */
  private async dispatchRpc(method: string, params: any = {}, device: RemoteDevice): Promise<any> {
    // Проверка прав на модификацию в Read-Only режиме
    const writeMethods = new Set([
      'start_process',
      'stop_process',
      'restart_process',
      'update_task_status',
      'toggle_task_criterion',
      'create_task',
      'git_commit',
      'git_pull',
      'git_push',
      'send_ai_prompt',
      'hitl_decision',
      'run_action'
    ]);

    if (this.readOnly && writeMethods.has(method)) {
      throw new Error(`Method ${method} is forbidden in Read-Only mode`);
    }

    // Права per-device токена (TASK-65, decision-11 п.1): readOnly — только чтение, hitl — чтение
    // и решения HITL, full — без ограничений сверх глобального readOnly выше.
    if (writeMethods.has(method)) {
      const rights = device.rights ?? 'full';
      if (rights === 'readOnly') {
        throw new Error(`Method ${method} is forbidden for this device (readOnly rights)`);
      }
      if (rights === 'hitl' && method !== 'hitl_decision') {
        throw new Error(`Method ${method} is forbidden for this device (hitl-only rights)`);
      }
    }

    const activePath = params.projectPath || this.activeProjectPath;

    switch (method) {
      case 'get_status': {
        const projects = await projectRegistry.getProjects();
        return {
          hostId: this.hostId,
          machineName: this.machineName || os.hostname(),
          platform: process.platform,
          tunnelUrl: this.tunnelUrl,
          activeProjectPath: this.activeProjectPath,
          projectsCount: projects.length,
          runningProcesses: processManager.getActiveProcessCount(),
          readOnly: this.readOnly
        };
      }

      case 'get_federation_hosts': {
        return { hosts: this.getFederationHostsList() };
      }

      case 'get_projects': {
        const projects = await projectRegistry.getProjects();
        this.cachedLocalProjects = projects.map((p) => ({
          id: p.path,
          name: path.basename(p.path),
          path: p.path
        }));
        return projects;
      }

      case 'select_project': {
        this.activeProjectPath = params.projectPath;
        const projects = await projectRegistry.getProjects();
        const project = projects.find((p: any) => p.path === params.projectPath);
        return { activeProject: project || null };
      }

      case 'get_processes': {
        if (!activePath) return [];
        return await processManager.listProcessesForProject(activePath);
      }

      case 'start_process': {
        if (!activePath) throw new Error('No active project specified');
        const proc = await processManager.startProcess(activePath, params.command, params.name, params.options);
        return proc;
      }

      case 'stop_process': {
        const stopped = await processManager.stopProcess(params.processId);
        return { stopped };
      }

      case 'restart_process': {
        const restarted = await processManager.restartProcess(params.processId);
        return restarted;
      }

      case 'get_process_logs': {
        if (!activePath) return '';
        return await processManager.tailProjectLog(activePath, params.processName, params.lines || 100);
      }

      case 'get_tasks': {
        if (!activePath) return [];
        return await this.loadBacklogTasks(activePath);
      }

      case 'update_task_status': {
        if (!params.filePath || !params.newStatus) throw new Error('filePath and newStatus are required');
        await this.updateTaskStatusInFile(params.filePath, params.newStatus);
        this.broadcastEvent('backlog:changed', { projectPath: activePath });
        return { ok: true };
      }

      case 'toggle_task_criterion': {
        if (!params.filePath || params.index === undefined) throw new Error('filePath and index are required');
        await this.toggleCriterionInFile(params.filePath, params.index, params.completed);
        this.broadcastEvent('backlog:changed', { projectPath: activePath });
        return { ok: true };
      }

      case 'get_git_status': {
        if (!activePath) return null;
        return await gitService.getRepoDetails(activePath);
      }

      case 'git_commit': {
        if (!activePath || !params.message) throw new Error('message and projectPath are required');
        return await gitService.commitChanges(activePath, params.message, Boolean(params.stageAll));
      }

      case 'hitl_decision': {
        // Решение Human-in-the-Loop с удалённого устройства: строго по requestId через единый
        // hitlService.decide (TASK-57). Одобрение «верхнего в очереди» не поддерживается.
        const requestId = typeof params.requestId === 'string' ? params.requestId : '';
        if (!requestId) throw new Error('requestId is required');
        const approved = params.decision === 'allow' || params.decision === 'approve' || params.approved === true;
        const result = hitlService.decide(
          requestId,
          { approved, text: typeof params.reason === 'string' ? params.reason : undefined },
          { kind: 'remote', deviceId: device.id, deviceName: device.name }
        );
        if (!result.ok) {
          return { ok: false, decision: approved, reason: result.reason };
        }
        this.notifyRenderer('remote:hitlDecisionMade', {
          requestId,
          sessionId: result.request.sessionId,
          approved,
          byDevice: device.name
        });
        return { ok: true, decision: approved, sessionId: result.request.sessionId };
      }

      case 'create_task': {
        if (!activePath) throw new Error('No active project specified');
        if (!params.title) throw new Error('title is required');
        const created = await createBacklogTaskFile(activePath, {
          title: String(params.title),
          description: typeof params.description === 'string' ? params.description : '',
          labels: Array.isArray(params.labels) ? params.labels.map(String) : [],
          type: params.type ? String(params.type) : undefined,
          priority: params.priority ? String(params.priority) : undefined,
          milestone: params.milestone ? String(params.milestone) : undefined
        });
        if (!created) throw new Error('Failed to create task');
        this.broadcastEvent('backlog:changed', { projectPath: activePath });
        return created;
      }

      case 'git_pull': {
        if (!activePath) throw new Error('No active project specified');
        return await gitService.pullRemote(activePath);
      }

      case 'git_push': {
        if (!activePath) throw new Error('No active project specified');
        return await gitService.pushRemote(activePath);
      }

      case 'run_action': {
        if (!activePath) throw new Error('No active project specified');
        const actionId: string = typeof params.action === 'string' ? params.action : 'run';
        const config = await actionConfigService.getConfig(activePath);
        const builtin: Record<'run' | 'deploy' | 'test', ActionDefinition> = {
          run: config.run,
          deploy: config.deploy,
          test: config.test
        };
        const def: ActionDefinition | undefined =
          actionId in builtin ? builtin[actionId as 'run' | 'deploy' | 'test'] : config.customActions?.find((a) => a.id === actionId);
        if (!def) throw new Error(`Unknown action: ${actionId}`);
        return await processManager.startProcess(activePath, def.command, def.name, { cwd: def.cwd, env: def.env });
      }

      case 'send_ai_prompt': {
        if (!activePath) throw new Error('No active project specified');
        const prompt = typeof params.prompt === 'string' ? params.prompt : '';
        if (!prompt.trim()) throw new Error('prompt is required');
        const sessionId = typeof params.sessionId === 'string' && params.sessionId ? params.sessionId : `remote_${crypto.randomBytes(6).toString('hex')}`;
        const config = await aiAgentService.getConfig();
        const message = {
          id: `msg_${crypto.randomBytes(6).toString('hex')}`,
          role: 'user' as const,
          content: prompt,
          timestamp: new Date().toISOString()
        };

        claudeBridgeService
          .runAgentTask(
            {
              sessionId,
              projectPath: activePath,
              messages: [message],
              config,
              mode: params.mode === 'chat' || params.mode === 'architect' ? params.mode : 'agent',
              taskId: params.taskId ? String(params.taskId) : undefined
            },
            (chunk) => this.broadcastEvent('ai:chunk', { sessionId, ...chunk }),
            (fullMsg) => this.broadcastEvent('ai:complete', { sessionId, message: fullMsg }),
            (err) => this.broadcastEvent('ai:error', { sessionId, error: err })
          )
          .catch((err: any) => {
            this.broadcastEvent('ai:error', { sessionId, error: err?.message || String(err) });
          });

        return { sessionId, accepted: true };
      }

      case 'get_events_since': {
        const sinceId = Number(params.sinceId) || 0;
        return { events: this.eventLog.filter((e) => e.id > sinceId), lastEventId: this.eventLogNextId - 1 };
      }

      case 'get_pending_approvals': {
        return hitlService.listPending(params.projectPath ? { projectPath: String(params.projectPath) } : {}).map((r) => ({
          requestId: r.id,
          sessionId: r.sessionId,
          projectPath: r.projectPath,
          origin: r.origin,
          agentName: r.agentName,
          role: r.role,
          tool: r.tool,
          type: r.type,
          title: r.title,
          details: r.details,
          command: r.command,
          filePath: r.filePath,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
          orphaned: r.orphaned
        }));
      }

      default:
        throw new Error(`Unknown RPC method: ${method}`);
    }
  }

  /**
   * Загрузка списка задач Backlog.md из файловой системы.
   */
  private async loadBacklogTasks(projectPath: string): Promise<any[]> {
    const tasksDir = path.join(projectPath, 'backlog', 'tasks');
    if (!existsSync(tasksDir)) return [];

    const files = await fs.readdir(tasksDir);
    const tasks: any[] = [];

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(tasksDir, file);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const { data, content } = matter(raw);

        // Парсинг Acceptance Criteria
        const criteria: Array<{ text: string; completed: boolean }> = [];
        const lines = content.split(/\r?\n/);
        let inAc = false;
        for (const line of lines) {
          if (/^## Acceptance Criteria/i.test(line.trim())) {
            inAc = true;
            continue;
          }
          if (inAc && /^##\s+/.test(line.trim())) {
            break;
          }
          if (inAc) {
            const m = line.match(/^-\s*\[([ xX])\]\s*(.*)$/);
            if (m) {
              criteria.push({
                completed: m[1].toLowerCase() === 'x',
                text: m[2].trim()
              });
            }
          }
        }

        tasks.push({
          id: data.id || file.replace(/\.md$/, ''),
          title: data.title || file,
          status: data.status || 'To Do',
          priority: data.priority || 'medium',
          filePath,
          criteria
        });
      } catch (err) {
        // ignore single corrupt file
      }
    }

    return tasks;
  }

  private async updateTaskStatusInFile(filePath: string, newStatus: string): Promise<void> {
    const raw = await fs.readFile(filePath, 'utf8');
    const { data, content } = matter(raw);
    data.status = newStatus;
    data.updated = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const updated = matter.stringify(content, data);
    await fs.writeFile(filePath, updated, 'utf8');
  }

  private async toggleCriterionInFile(filePath: string, index: number, completed: boolean): Promise<void> {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    let acIdx = 0;
    let inAc = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^## Acceptance Criteria/i.test(line.trim())) {
        inAc = true;
        continue;
      }
      if (inAc && /^##\s+/.test(line.trim())) break;
      if (inAc) {
        const m = line.match(/^(-\s*\[)([ xX])(\]\s*.*)$/);
        if (m) {
          if (acIdx === index) {
            lines[i] = `${m[1]}${completed ? 'x' : ' '}${m[3]}`;
            break;
          }
          acIdx++;
        }
      }
    }

    await fs.writeFile(filePath, lines.join('\n'), 'utf8');
  }

  /**
   * Стриминг логов процессов клиентам.
   */
  private setupProcessLogStreaming() {
    processManager.onLog((data: { processId: string; text: string }) => {
      this.broadcastEvent('process:logChunk', data);
    });
    processManager.onStatusChanged((proc) => {
      this.broadcastEvent('process:statusChanged', proc);
      if (proc.status === 'stopped' && (proc as any).exitCode && (proc as any).exitCode !== 0) {
        this.sendTelegramNotification(`🚨 *Внимание!* Процесс \`${proc.name}\` аварийно завершился с кодом \`${(proc as any).exitCode}\`.`);
      }
    });
  }

  /**
   * Отправка push-события всем подключенным клиентам.
   */
  public broadcastEvent(event: string, data: any) {
    if (!this.enabled) return;

    // Догон пропущенных во время разрыва событий (TASK-65, decision-11 п.6): кольцевой буфер,
    // клиент запоминает `eventId` последнего полученного события и после переподключения
    // запрашивает `get_events_since` с ним — поэтому id едет и в самом live-пакете.
    const eventId = this.eventLogNextId++;
    const payload: PlainPacket = {
      type: 'event',
      event,
      data,
      eventId
    };

    this.eventLog.push({ id: eventId, event, data });
    if (this.eventLog.length > EVENT_LOG_MAX) this.eventLog.shift();

    // Отправка локальным клиентам
    for (const client of this.localClients.values()) {
      if (client.ws.readyState === WebSocket.OPEN && client.device.isApproved) {
        try {
          if (client.isEncrypted) {
            client.ws.send(JSON.stringify(encryptPayload(payload, this.secretKey)));
          } else {
            client.ws.send(JSON.stringify(payload));
          }
        } catch {
          // ignore
        }
      }
    }

    // Отправка через Relay
    if (this.relayWs && this.relayWs.readyState === WebSocket.OPEN) {
      try {
        const encrypted = encryptPayload(payload, this.secretKey);
        this.relayWs.send(JSON.stringify(encrypted));
      } catch {
        // ignore
      }
    }
  }

  private sendToDevice(deviceId: string, payload: PlainPacket) {
    const client = this.localClients.get(deviceId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        if (client.isEncrypted) {
          client.ws.send(JSON.stringify(encryptPayload(payload, this.secretKey)));
        } else {
          client.ws.send(JSON.stringify(payload));
        }
      } catch {
        // ignore
      }
      return;
    }

    if (this.relayWs && this.relayWs.readyState === WebSocket.OPEN) {
      const encrypted = encryptPayload(payload, this.secretKey);
      (encrypted as any).targetClientId = deviceId;
      this.relayWs.send(JSON.stringify(encrypted));
    }
  }

  private notifyStatusChanged() {
    this.notifyRenderer('remote:statusChanged', this.getStatus());
  }

  private notifyRenderer(channel: string, data: any) {
    const wins = BrowserWindow.getAllWindows();
    for (const w of wins) {
      if (!w.isDestroyed()) {
        w.webContents.send(channel, data);
      }
    }
  }

  /**
   * Встроенный легковесный адаптивный HTML веб-клиент для смартфонов.
   */
  private getEmbeddedWebClientHtml(): string {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>ProjectHub Remote</title>
  <meta name="theme-color" content="#0d1117">
  <script src="/remote-crypto.js"></script>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #131b2e;
      --border: #1f293d;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding-bottom: 70px; min-height: 100vh; }
    header { background: #0f172a; border-bottom: 1px solid var(--border); padding: 12px 16px; position: sticky; top: 0; z-index: 50; display: flex; align-items: center; justify-content: space-between; }
    .logo { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 16px; color: #818cf8; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); display: inline-block; }
    .status-dot.connected { background: var(--success); box-shadow: 0 0 8px var(--success); }
    .container { padding: 16px; max-width: 600px; margin: 0 auto; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 12px; }
    .card-title { font-size: 14px; font-weight: 600; color: #cbd5e1; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
    button { background: var(--primary); color: white; border: none; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: 0.2s; }
    button:active { transform: scale(0.98); }
    button.secondary { background: #1e293b; color: #94a3b8; border: 1px solid #334155; }
    button.danger { background: var(--danger); }
    button.success { background: var(--success); }
    select, input { width: 100%; background: #090d16; border: 1px solid #334155; color: white; padding: 10px; border-radius: 8px; font-size: 14px; margin-top: 6px; }
    .nav-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #0f172a; border-top: 1px solid var(--border); display: flex; justify-content: space-around; padding: 8px 0; z-index: 50; }
    .nav-btn { background: none; border: none; color: #64748b; font-size: 11px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px; }
    .nav-btn.active { color: #818cf8; font-weight: bold; }
    .terminal { background: #05070c; border: 1px solid #1e293b; border-radius: 8px; padding: 10px; font-family: monospace; font-size: 11px; color: #38bdf8; height: 260px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
    .badge { font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #1e293b; color: #94a3b8; }
    .badge.todo { background: #1e293b; color: #94a3b8; }
    .badge.progress { background: #312e81; color: #a5b4fc; }
    .badge.done { background: #064e3b; color: #6ee7b7; }
    .task-item { border-bottom: 1px solid #1e293b; padding: 8px 0; font-size: 13px; }
    .task-item:last-child { border-bottom: none; }
    .hitl-box { background: #2d1810; border: 1px solid #b45309; border-radius: 10px; padding: 12px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <header>
    <div class="logo">
      <div id="statusDot" class="status-dot"></div>
      <span>ProjectHub Remote</span>
    </div>
    <div id="modeBadge" class="badge">LAN</div>
  </header>

  <div class="container">
    <!-- Секция сопряжения (если не подключено) -->
    <div id="pairingSection" class="card">
      <div class="card-title">Сопряжение с ProjectHub</div>
      <p style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">
        Введите 6-значный PIN-код или откройте ссылку из QR-кода на десктопе.
      </p>
      <input type="text" id="pinInput" placeholder="PIN код (например, 123456)" maxlength="6">
      <input type="password" id="keyInput" placeholder="Секретный ключ (hex, опционально)">
      <button id="connectBtn" style="width: 100%; margin-top: 10px;">Подключиться</button>
    </div>

    <!-- Основной контент (при активном подключении) -->
    <div id="mainContent" style="display: none;">
      <!-- Вкладка: Обзор -->
      <div id="tabDashboard">
        <div class="card">
          <div class="card-title">Активный проект</div>
          <select id="projectSelect"></select>
        </div>

        <div id="hitlAlert" class="hitl-box" style="display: none;">
          <div style="font-weight: bold; color: #f59e0b; margin-bottom: 6px;">⚠️ Запрос разрешения (AI Studio)</div>
          <div id="hitlDescription" style="font-size: 12px; margin-bottom: 10px; color: #fde68a;"></div>
          <div style="display: flex; gap: 8px;">
            <button id="hitlApproveBtn" class="success" style="flex: 1;">Разрешить</button>
            <button id="hitlDenyBtn" class="danger" style="flex: 1;">Отклонить</button>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Фоновые процессы</div>
          <div id="processList" style="font-size: 13px; color: var(--muted);">Загрузка...</div>
        </div>
      </div>

      <!-- Вкладка: Процессы и Терминал -->
      <div id="tabTerminal" style="display: none;">
        <div class="card">
          <div class="card-title">Живые логи процессов</div>
          <div id="terminalLogs" class="terminal">Ожидание логов...</div>
          <button id="clearLogsBtn" class="secondary" style="margin-top: 8px; width: 100%;">Очистить терминал</button>
        </div>
      </div>

      <!-- Вкладка: Задачи Backlog -->
      <div id="tabTasks" style="display: none;">
        <div class="card">
          <div class="card-title">
            <span>Задачи проекта</span>
            <button id="refreshTasksBtn" class="secondary" style="padding: 4px 8px; font-size: 11px;">Обновить</button>
          </div>
          <div id="taskList">Загрузка задач...</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Нижняя навигация -->
  <nav id="navBar" class="nav-bar" style="display: none;">
    <button class="nav-btn active" onclick="switchTab('dashboard')">
      <span>📊</span>
      <span>Сводка</span>
    </button>
    <button class="nav-btn" onclick="switchTab('terminal')">
      <span>💻</span>
      <span>Терминал</span>
    </button>
    <button class="nav-btn" onclick="switchTab('tasks')">
      <span>📋</span>
      <span>Задачи</span>
    </button>
  </nav>

  <script>
    let ws = null;
    let currentTab = 'dashboard';
    let activeSessionId = null;
    let projects = [];

    // Значения самого хоста, отдавшего эту страницу: клиент умеет подключаться и напрямую, и через
    // relay к тому же hostId, не спрашивая их у пользователя (TASK-65, decision-11 п.2).
    const HOST_DEFAULTS = ${JSON.stringify({ hostId: this.hostId, relayUrl: this.relayServerUrl, mode: this.mode })};

    // Чтение параметров из URL hash (#pin=...&key=...&hostId=...&relay=...&mode=...)
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const pinParam = hashParams.get('pin');
    const keyParam = hashParams.get('key');
    const modeParam = hashParams.get('mode') || HOST_DEFAULTS.mode || 'lan';
    const hostIdParam = hashParams.get('hostId') || hashParams.get('host') || HOST_DEFAULTS.hostId;
    const relayParam = hashParams.get('relay') || HOST_DEFAULTS.relayUrl || '';
    const useRelay = modeParam === 'relay' && Boolean(relayParam) && Boolean(hostIdParam);

    if (pinParam) document.getElementById('pinInput').value = pinParam;
    if (keyParam) document.getElementById('keyInput').value = keyParam;
    document.getElementById('modeBadge').textContent = useRelay ? 'RELAY' : 'LAN';

    document.getElementById('connectBtn').addEventListener('click', () => { reconnectAttempt = 0; connect(); });

    let currentKey = '';
    let reconnectAttempt = 0;
    let reconnectTimer = null;
    let isReady = false;
    let awaitingApproval = false;

    // Идентичность и per-device токен переживают перезагрузку страницы: переподключение идёт по
    // токену, а не по PIN (TASK-65, decision-5 п.5).
    function storageGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
    function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    let deviceId = storageGet('ph_remote_device_id');
    if (!deviceId) {
      deviceId = 'web_' + Math.random().toString(36).slice(2, 10);
      storageSet('ph_remote_device_id', deviceId);
    }
    let deviceToken = storageGet('ph_remote_device_token');
    // Последнее увиденное событие: после разрыва клиент догоняет пропущенное (decision-11 п.6).
    let lastEventId = 0;

    // E2EE через общий канонический модуль (window.RemoteCrypto из /remote-crypto.js);
    // формат {e2ee:true, iv, tag, data} в hex (decision-11 п.3). Без ключа — plain JSON.
    async function encryptOut(data) {
      if (!currentKey) return data;
      return await RemoteCrypto.encryptPayloadWeb(data, currentKey);
    }
    async function decryptIn(packet) {
      if (!packet || !packet.e2ee || !currentKey) return packet;
      return await RemoteCrypto.decryptPayloadWeb(packet, currentKey);
    }

    function scheduleReconnect() {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempt));
      reconnectAttempt++;
      reconnectTimer = setTimeout(connect, delay);
    }

    /**
     * LAN: сокет открывается прямо к хосту, аутентификация — в query (PIN/ключ/токен).
     * Relay: сокет открывается к relay-серверу (?role=client&hostId=...), а PIN/ключ/токен уезжают
     * хосту отдельным зашифрованным пакетом handshake после relay_ack — сам relay ничего не
     * аутентифицирует и содержимого пакетов не видит (decision-11 п.2, п.3).
     */
    function buildWsUrl(pin, key) {
      if (useRelay) {
        const u = new URL(relayParam.replace(/^http/, 'ws'));
        u.searchParams.set('role', 'client');
        u.searchParams.set('hostId', hostIdParam);
        u.searchParams.set('clientId', deviceId);
        u.searchParams.set('name', 'Mobile Browser');
        return u.toString();
      }
      const loc = window.location;
      const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      const q = new URLSearchParams({ pin: pin, key: key, deviceId: deviceId, name: 'Mobile Browser' });
      if (deviceToken) q.set('token', deviceToken);
      return \`\${wsProto}//\${loc.host}/?\${q.toString()}\`;
    }

    function connect() {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      const pin = document.getElementById('pinInput').value.trim();
      const key = document.getElementById('keyInput').value.trim();
      currentKey = key;
      isReady = false;

      ws = new WebSocket(buildWsUrl(pin, key));

      ws.onopen = () => {
        reconnectAttempt = 0;
        document.getElementById('statusDot').classList.add('connected');
        // В LAN хост присылает handshake_ack сам по факту апгрейда сокета (в нём права и точка в
        // потоке событий); через relay сначала нужно дождаться relay_ack и предъявить PIN/ключ/
        // токен пакетом handshake. Фолбэк на случай хоста без handshake_ack — только для LAN, где
        // сокет открылся лишь после успешной проверки PIN/ключа в query.
        if (!useRelay) setTimeout(() => { if (!awaitingApproval) onConnectionReady(); }, 2000);
      };

      ws.onmessage = async (event) => {
        try {
          const raw = JSON.parse(event.data);

          // Служебные сообщения самого relay идут открытым текстом — он не знает ключа.
          if (raw && raw.type === 'relay_ack' && raw.role === 'client') {
            await sendHandshake();
            return;
          }
          if (raw && (raw.type === 'error' || raw.type === 'host_disconnected')) {
            appendLog('\\n[Relay] ' + (raw.error || 'Хост отключился') + '\\n');
            return;
          }

          const msg = await decryptIn(raw);
          handleMessage(msg);
        } catch (e) {
          console.error(e);
        }
      };

      ws.onclose = () => {
        isReady = false;
        document.getElementById('statusDot').classList.remove('connected');
        appendLog('\\n[Соединение разорвано. Переподключение через ' + Math.round(Math.min(30000, 1000 * Math.pow(2, reconnectAttempt)) / 1000) + 'с...]\\n');
        scheduleReconnect();
      };

      ws.onerror = (err) => {
        console.error('WS Error:', err);
      };
    }

    async function sendHandshake() {
      const data = { pin: document.getElementById('pinInput').value.trim(), key: currentKey };
      if (deviceToken) data.token = deviceToken;
      const packet = await encryptOut({ type: 'handshake', data: data });
      ws.send(JSON.stringify(packet));
    }

    function onConnectionReady() {
      if (isReady) return;
      isReady = true;
      document.getElementById('pairingSection').style.display = 'none';
      document.getElementById('mainContent').style.display = 'block';
      document.getElementById('navBar').style.display = 'flex';
      catchUpEvents().then(fetchProjects, fetchProjects);
    }

    /** Догон событий, пропущенных за время разрыва (кольцевой буфер хоста, decision-11 п.6). */
    async function catchUpEvents() {
      if (!lastEventId) return;
      try {
        const res = await sendRpc('get_events_since', { sinceId: lastEventId });
        if (!res) return;
        (res.events || []).forEach((e) => {
          if (e.id > lastEventId) lastEventId = e.id;
          applyEvent(e.event, e.data);
        });
        if (typeof res.lastEventId === 'number' && res.lastEventId > lastEventId) lastEventId = res.lastEventId;
      } catch (e) {
        console.error('Events catch-up failed:', e);
      }
    }

    function sendRpc(method, params = {}) {
      return new Promise((resolve) => {
        const id = 'req_' + Math.random().toString(36).slice(2, 9);
        // Хост может ответить не rpc_res, а ошибкой уровня соединения (например, устройство ещё не
        // одобрено) — без таймаута такой вызов повис бы навсегда и заблокировал загрузку UI.
        const timer = setTimeout(() => {
          ws.removeEventListener('message', listener);
          resolve(null);
        }, 15000);
        const listener = async (event) => {
          try {
            const raw = JSON.parse(event.data);
            const msg = await decryptIn(raw);
            if (msg.type === 'rpc_res' && msg.id === id) {
              clearTimeout(timer);
              ws.removeEventListener('message', listener);
              resolve(msg.result);
            }
          } catch {}
        };
        ws.addEventListener('message', listener);
        encryptOut({ type: 'rpc_req', id, method, params }).then((packet) => ws.send(JSON.stringify(packet)));
      });
    }

    function handleMessage(msg) {
      if (msg.type === 'handshake_ack') {
        const result = msg.result || {};
        if (result.deviceToken) {
          deviceToken = result.deviceToken;
          storageSet('ph_remote_device_token', deviceToken);
        }
        // Первое подключение — просто запоминаем точку в потоке событий (проигрывать историю
        // незачем); при последующих с неё догоняем пропущенное в onConnectionReady().
        if (!lastEventId && typeof result.lastEventId === 'number') lastEventId = result.lastEventId;
        if (result.approved === false) {
          awaitingApproval = true;
          appendLog('\\n[Ожидание подтверждения устройства на десктопе...]\\n');
          return;
        }
        awaitingApproval = false;
        onConnectionReady();
        return;
      }
      if (msg.type === 'event') {
        if (typeof msg.eventId === 'number' && msg.eventId > lastEventId) lastEventId = msg.eventId;
        applyEvent(msg.event, msg.data);
      }
    }

    function applyEvent(event, data) {
      if (event === 'process:logChunk') {
        appendLog(data.text);
      } else if (event === 'ai:hitl') {
        showHitlRequest(data);
      } else if (event === 'ai:hitlDecided') {
        dropHitl(data && data.requestId);
      } else if (event === 'backlog:changed') {
        fetchTasks();
      }
    }

    async function fetchProjects() {
      projects = await sendRpc('get_projects');
      const select = document.getElementById('projectSelect');
      select.innerHTML = '';
      projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.path;
        opt.textContent = p.name;
        select.appendChild(opt);
      });

      if (projects.length > 0) {
        select.value = projects[0].path;
        fetchProcesses();
        fetchTasks();
      }

      select.onchange = () => {
        sendRpc('select_project', { projectPath: select.value });
        fetchProcesses();
        fetchTasks();
      };
    }

    async function fetchProcesses() {
      const select = document.getElementById('projectSelect');
      const procs = await sendRpc('get_processes', { projectPath: select.value });
      const container = document.getElementById('processList');
      if (!procs || procs.length === 0) {
        container.innerHTML = '<div>Нет активных процессов</div>';
        return;
      }
      container.innerHTML = procs.map(pr => \`
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #1e293b;">
          <div>
            <div style="font-weight: 600; color: white;">\${pr.name}</div>
            <div style="font-size: 11px; color: #64748b;">PID: \${pr.pid}</div>
          </div>
          <button class="danger" style="padding: 4px 8px; font-size: 11px;" onclick="stopProcess('\${pr.id}')">Стоп</button>
        </div>
      \`).join('');
    }

    async function stopProcess(id) {
      await sendRpc('stop_process', { processId: id });
      fetchProcesses();
    }

    async function fetchTasks() {
      const select = document.getElementById('projectSelect');
      const tasks = await sendRpc('get_tasks', { projectPath: select.value });
      const container = document.getElementById('taskList');
      if (!tasks || tasks.length === 0) {
        container.innerHTML = '<div style="color: var(--muted); font-size: 13px;">Задачи не найдены</div>';
        return;
      }
      container.innerHTML = tasks.map(t => \`
        <div class="task-item">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="font-weight: 600; color: white;">\${t.title}</span>
            <span class="badge \${t.status === 'Done' ? 'done' : t.status === 'In Progress' ? 'progress' : 'todo'}">\${t.status}</span>
          </div>
          <div style="font-size: 11px; color: #64748b;">Критерии приемки: \${t.criteria.filter(c => c.completed).length}/\${t.criteria.length}</div>
        </div>
      \`).join('');
    }

    document.getElementById('refreshTasksBtn').onclick = fetchTasks;

    function appendLog(text) {
      const el = document.getElementById('terminalLogs');
      el.textContent += text;
      el.scrollTop = el.scrollHeight;
    }

    document.getElementById('clearLogsBtn').onclick = () => {
      document.getElementById('terminalLogs').textContent = '';
    };

    // Очередь запросов HITL (TASK-57): решение отправляется строго по requestId.
    const hitlQueue = [];
    function renderHitl() {
      const box = document.getElementById('hitlAlert');
      const current = hitlQueue[0];
      if (!current) { box.style.display = 'none'; return; }
      const who = current.agentName ? \` [\${current.agentName}\${current.role ? ' / ' + current.role : ''}]\` : '';
      const extra = current.command ? '\\n$ ' + current.command : current.filePath ? '\\n' + current.filePath : '';
      const rest = hitlQueue.length > 1 ? \` (+\${hitlQueue.length - 1} в очереди)\` : '';
      document.getElementById('hitlDescription').textContent = (current.description || 'Требуется подтверждение') + who + extra + rest;
      box.style.display = 'block';
    }
    function showHitlRequest(data) {
      if (!data || !data.requestId) return;
      activeSessionId = data.sessionId;
      if (!hitlQueue.some((r) => r.requestId === data.requestId)) hitlQueue.push(data);
      renderHitl();
    }
    function dropHitl(requestId) {
      const idx = hitlQueue.findIndex((r) => r.requestId === requestId);
      if (idx >= 0) hitlQueue.splice(idx, 1);
      renderHitl();
    }
    async function decideHitl(decision) {
      const current = hitlQueue[0];
      if (!current) return;
      dropHitl(current.requestId);
      try {
        const res = await sendRpc('hitl_decision', { requestId: current.requestId, sessionId: current.sessionId, decision });
        if (res && res.ok === false) appendLog('\\n[HITL] Запрос ' + current.requestId + ': ' + (res.reason === 'already_decided' ? 'уже решён' : 'не найден') + '\\n');
      } catch (e) {
        appendLog('\\n[HITL] Ошибка отправки решения: ' + (e && e.message ? e.message : e) + '\\n');
      }
    }

    document.getElementById('hitlApproveBtn').onclick = () => decideHitl('allow');
    document.getElementById('hitlDenyBtn').onclick = () => decideHitl('deny');

    window.switchTab = function(tab) {
      currentTab = tab;
      document.getElementById('tabDashboard').style.display = tab === 'dashboard' ? 'block' : 'none';
      document.getElementById('tabTerminal').style.display = tab === 'terminal' ? 'block' : 'none';
      document.getElementById('tabTasks').style.display = tab === 'tasks' ? 'block' : 'none';

      const btns = document.querySelectorAll('.nav-btn');
      btns.forEach((b, idx) => {
        b.classList.toggle('active', (idx === 0 && tab === 'dashboard') || (idx === 1 && tab === 'terminal') || (idx === 2 && tab === 'tasks'));
      });
    };

    // Автоподключение, если в URL уже есть pin
    if (pinParam) {
      connect();
    }
  </script>
</body>
</html>`;
  }

  /**
   * Кандидаты пути статического ассета Remote Control под именем `relPath`. Источник в
   * репозитории — `public/<relPath>` (Vite копирует `public/**` в `dist/` без изменений при
   * сборке, так ассет доезжает до packaged-приложения как `dist/<relPath>`, см. `files` в
   * `package.json`). Dev-режим (без сборки) и packaged — оба покрыты.
   */
  private staticAssetCandidates(relPath: string): string[] {
    const root = getDevRepoRoot() || getAppRootDir();
    return [
      path.join(root, 'public', relPath),
      path.join(root, 'dist', relPath),
      path.join(__dirname, relPath)
    ];
  }

  private async readStaticAsset(relPath: string): Promise<string | null> {
    for (const p of this.staticAssetCandidates(relPath)) {
      try {
        if (existsSync(p)) {
          return await fs.readFile(p, 'utf8');
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  /**
   * Получение HTML для Telegram Mini App (из `public/telegram-mini-app/index.html` или fallback).
   */
  private async getTelegramMiniAppHtml(): Promise<string> {
    const html = await this.readStaticAsset(path.join('telegram-mini-app', 'index.html'));
    // Fallback: встроенный веб-клиент
    return html ?? this.getEmbeddedWebClientHtml();
  }
}

export const remoteControlService = new RemoteControlService();
