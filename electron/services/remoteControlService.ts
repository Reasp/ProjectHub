import http, { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { BrowserWindow } from 'electron';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  RemoteConnectionMode,
  RemoteControlConfig,
  RemoteControlStatus,
  RemoteDevice,
  RemotePacket,
  EncryptedPacket,
  PlainPacket
} from '../../src/types/remote.js';
import { generateSecretKey, generatePairingPin, encryptPayload, decryptPayload } from '../../src/utils/remoteCryptoNode.js';
import { projectRegistry } from './projectRegistry.js';
import { processManager } from './processManager.js';
import { gitService } from './gitService.js';
import { claudeBridgeService } from './claudeBridgeService.js';
import { logger } from './logger.js';
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

interface ClientConnection {
  id: string;
  ws: WebSocket;
  device: RemoteDevice;
  isEncrypted: boolean;
}

class RemoteControlService {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private relayWs: WebSocket | null = null;
  private relayConnected = false;
  private relayReconnectTimer: NodeJS.Timeout | null = null;

  private enabled = false;
  private port = 42050;
  private mode: RemoteConnectionMode = 'lan';
  private relayServerUrl = 'ws://127.0.0.1:42055';
  private requireApproval = true;
  private readOnly = false;

  private hostId: string;
  private pairingPin: string;
  private secretKey: string;
  private lastError: string | null = null;

  private connectedDevices = new Map<string, RemoteDevice>();
  private localClients = new Map<string, ClientConnection>();
  private activeProjectPath: string | null = null;

  constructor() {
    this.hostId = `ph_host_${crypto.randomBytes(6).toString('hex')}`;
    this.pairingPin = generatePairingPin();
    this.secretKey = generateSecretKey();

    // Подписка на стриминг логов фоновых процессов
    this.setupProcessLogStreaming();
  }

  public setActiveProject(projectPath: string | null) {
    this.activeProjectPath = projectPath;
  }

  public getStatus(): RemoteControlStatus {
    return {
      enabled: this.enabled,
      port: this.port,
      mode: this.mode,
      relayServerUrl: this.relayServerUrl,
      relayConnected: this.relayConnected,
      hostId: this.hostId,
      pairingPin: this.pairingPin,
      secretKey: this.secretKey,
      localIps: getLocalIpAddresses(),
      connectedDevices: Array.from(this.connectedDevices.values()),
      requireApproval: this.requireApproval,
      readOnly: this.readOnly,
      lastError: this.lastError
    };
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

    if (this.enabled && restartRequired) {
      await this.stop();
      await this.start();
    }

    this.notifyStatusChanged();
    return this.getStatus();
  }

  public regenerateToken(): RemoteControlStatus {
    this.pairingPin = generatePairingPin();
    this.secretKey = generateSecretKey();

    // Отключаем все текущие устройства при смене ключа
    for (const client of this.localClients.values()) {
      try {
        client.ws.close(1008, 'Token regenerated');
      } catch {
        // ignore
      }
    }
    this.localClients.clear();
    this.connectedDevices.clear();

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
        result: { approved: true, readOnly: this.readOnly }
      });
    }
    return this.getStatus();
  }

  public async start(): Promise<void> {
    if (this.server && this.server.listening) {
      return;
    }

    this.lastError = null;

    try {
      await this.startLocalHttpAndWsServer();
      this.enabled = true;

      if (this.mode === 'relay' || this.relayServerUrl) {
        this.connectToRelay();
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
   * Обработка HTTP запросов (отдача веб-клиента и публичного статуса).
   */
  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // GET /api/status - публичная информация
    if (url.pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'ProjectHub-Remote',
          hostId: this.hostId,
          mode: this.mode,
          requireApproval: this.requireApproval,
          localIps: getLocalIpAddresses(),
          port: this.port
        })
      );
      return;
    }

    // GET /api/qr - данные для быстрого сканирования в локальной сети
    if (url.pathname === '/api/qr') {
      const localIps = getLocalIpAddresses();
      const ip = localIps[0] || '127.0.0.1';
      const remoteUrl = `http://${ip}:${this.port}/remote#pin=${this.pairingPin}&key=${this.secretKey}&host=${this.hostId}&mode=${this.mode}`;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          url: remoteUrl,
          pin: this.pairingPin,
          hostId: this.hostId
        })
      );
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
      const deviceId = url.searchParams.get('deviceId') || `dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const deviceName = url.searchParams.get('name') || 'Mobile Client';
      const userAgent = req.headers['user-agent'] || 'Unknown Device';
      const ip = req.socket.remoteAddress || '127.0.0.1';

      // Проверка пин-кода или ключа
      const isPinValid = pin === this.pairingPin;
      const isKeyValid = key === this.secretKey;

      if (!isPinValid && !isKeyValid) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid pairing PIN or secret key' }));
        ws.close(1008, 'Authentication failed');
        return;
      }

      const isApproved = !this.requireApproval;
      const device: RemoteDevice = {
        id: deviceId,
        name: deviceName,
        ip,
        mode: this.mode === 'webrtc' ? 'webrtc' : 'lan',
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
        userAgent,
        isApproved
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

      // Подтверждение клиенту
      ws.send(
        JSON.stringify({
          type: 'handshake_ack',
          result: {
            approved: isApproved,
            readOnly: this.readOnly,
            hostId: this.hostId
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
   * Подключение к внешнему Relay серверу.
   */
  private connectToRelay() {
    this.disconnectFromRelay();

    try {
      const relayUrl = new URL(this.relayServerUrl);
      relayUrl.searchParams.set('role', 'host');
      relayUrl.searchParams.set('hostId', this.hostId);

      const ws = new WebSocket(relayUrl.toString());
      this.relayWs = ws;

      ws.on('open', () => {
        this.relayConnected = true;
        logger.info(`[RemoteControl] Connected to Relay Server: ${this.relayServerUrl}`);
        this.notifyStatusChanged();
      });

      ws.on('message', async (raw: any) => {
        try {
          const msg = JSON.parse(raw.toString());

          // Обработка системных сообщений от релея
          if (msg.type === 'client_connected') {
            const dev: RemoteDevice = {
              id: msg.clientId,
              name: msg.name || 'Remote Client (Relay)',
              ip: msg.ip || 'relay',
              mode: 'relay',
              connectedAt: Date.now(),
              lastSeenAt: Date.now(),
              userAgent: msg.userAgent || 'Web/Mobile',
              isApproved: !this.requireApproval
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

    this.relayReconnectTimer = setTimeout(() => {
      if (this.enabled && this.mode === 'relay' && !this.relayConnected) {
        this.connectToRelay();
      }
    }, 5000);
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

    // Ping / Pong
    if (packet.type === 'ping') {
      reply({ type: 'pong', id: packet.id });
      return;
    }

    // WebRTC Signaling passthrough
    if (packet.type === 'event' && packet.event === 'signal') {
      this.broadcastEvent('signal', { ...packet.data, fromDeviceId: deviceId });
      return;
    }

    // RPC Request
    if (packet.type === 'rpc_req') {
      const req = packet as PlainPacket;
      try {
        const result = await this.dispatchRpc(req.method || '', req.params, device);
        const resPayload: PlainPacket = {
          type: 'rpc_res',
          id: req.id,
          result
        };

        if (isEncrypted) {
          reply(encryptPayload(resPayload, this.secretKey));
        } else {
          reply(resPayload);
        }
      } catch (err: any) {
        const errPayload: PlainPacket = {
          type: 'rpc_res',
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

    const activePath = params.projectPath || this.activeProjectPath;

    switch (method) {
      case 'get_status': {
        const projects = await projectRegistry.getProjects();
        return {
          activeProjectPath: this.activeProjectPath,
          projectsCount: projects.length,
          runningProcesses: processManager.getActiveProcessCount(),
          readOnly: this.readOnly
        };
      }

      case 'get_projects':
        return await projectRegistry.getProjects();

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
        // Подтверждение/отклонение Human-In-The-Loop решения из удаленного клиента
        if (!params.sessionId) throw new Error('sessionId is required');
        // Передаем решение в claudeBridgeService
        const decision = params.decision === 'allow' || params.decision === 'approve';
        this.notifyRenderer('remote:hitlDecisionMade', {
          sessionId: params.sessionId,
          approved: decision,
          byDevice: device.name
        });
        return { ok: true, decision };
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
    });
  }

  /**
   * Отправка push-события всем подключенным клиентам.
   */
  public broadcastEvent(event: string, data: any) {
    if (!this.enabled) return;

    const payload: PlainPacket = {
      type: 'event',
      event,
      data
    };

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

    // Чтение параметров из URL hash (#pin=...&key=...&host=...)
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const pinParam = hashParams.get('pin');
    const keyParam = hashParams.get('key');
    const modeParam = hashParams.get('mode') || 'lan';

    if (pinParam) document.getElementById('pinInput').value = pinParam;
    if (keyParam) document.getElementById('keyInput').value = keyParam;

    document.getElementById('connectBtn').addEventListener('click', connect);

    function connect() {
      const pin = document.getElementById('pinInput').value.trim();
      const key = document.getElementById('keyInput').value.trim();

      const loc = window.location;
      const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = \`\${wsProto}//\${loc.host}/?pin=\${encodeURIComponent(pin)}&key=\${encodeURIComponent(key)}&name=Mobile+Browser\`;

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        document.getElementById('statusDot').classList.add('connected');
        document.getElementById('pairingSection').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';
        document.getElementById('navBar').style.display = 'flex';
        fetchProjects();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleMessage(msg);
        } catch (e) {
          console.error(e);
        }
      };

      ws.onclose = () => {
        document.getElementById('statusDot').classList.remove('connected');
        appendLog('\\n[Соединение разорвано. Переподключение...]\\n');
        setTimeout(connect, 4000);
      };

      ws.onerror = (err) => {
        console.error('WS Error:', err);
      };
    }

    function sendRpc(method, params = {}) {
      return new Promise((resolve) => {
        const id = 'req_' + Math.random().toString(36).slice(2, 9);
        const listener = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'rpc_res' && msg.id === id) {
              ws.removeEventListener('message', listener);
              resolve(msg.result);
            }
          } catch {}
        };
        ws.addEventListener('message', listener);
        ws.send(JSON.stringify({ type: 'rpc_req', id, method, params }));
      });
    }

    function handleMessage(msg) {
      if (msg.type === 'event') {
        if (msg.event === 'process:logChunk') {
          appendLog(msg.data.text);
        } else if (msg.event === 'ai:hitl') {
          showHitlRequest(msg.data);
        } else if (msg.event === 'backlog:changed') {
          fetchTasks();
        }
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

    function showHitlRequest(data) {
      activeSessionId = data.sessionId;
      document.getElementById('hitlDescription').textContent = data.description || 'Требуется подтверждение';
      document.getElementById('hitlAlert').style.display = 'block';
    }

    document.getElementById('hitlApproveBtn').onclick = () => {
      if (activeSessionId) {
        sendRpc('hitl_decision', { sessionId: activeSessionId, decision: 'allow' });
        document.getElementById('hitlAlert').style.display = 'none';
      }
    };

    document.getElementById('hitlDenyBtn').onclick = () => {
      if (activeSessionId) {
        sendRpc('hitl_decision', { sessionId: activeSessionId, decision: 'deny' });
        document.getElementById('hitlAlert').style.display = 'none';
      }
    };

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
}

export const remoteControlService = new RemoteControlService();
