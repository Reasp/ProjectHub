/** LAN Direct и Relay (decision-11 п.2) — WebRTC выведен из scope, `RTCPeerConnection` в коде не было. */
export type RemoteConnectionMode = 'lan' | 'relay';

/** Права per-device токена (TASK-65, decision-11 п.1). */
export type DeviceRights = 'readOnly' | 'hitl' | 'full';

export interface RemoteDevice {
  id: string;
  name: string;
  ip: string;
  mode: RemoteConnectionMode;
  connectedAt: number;
  lastSeenAt: number;
  userAgent: string;
  isApproved: boolean;
  /** Права выданного при сопряжении токена; отсутствует, пока устройство не прошло сопряжение. */
  rights?: DeviceRights;
}

/**
 * Спаренное устройство (per-device токен) — видно в UI даже когда устройство офлайн: права
 * назначаются и отзываются между сессиями, а не только у подключённых прямо сейчас (TASK-65).
 */
export interface PairedDevice {
  deviceId: string;
  name: string;
  rights: DeviceRights;
  createdAt: number;
  /** Права заданы вручную из UI — пересопряжение по PIN их не перетирает глобальным `readOnly`. */
  rightsExplicit?: boolean;
  connected: boolean;
}

export interface RemoteControlConfig {
  enabled: boolean;
  port: number;
  mode: RemoteConnectionMode;
  relayServerUrl: string;
  requireApproval: boolean;
  readOnly: boolean;
  /** Производное поле статуса (не часть конфига): `mode === 'relay'`. */
  useRelay?: boolean;
  machineName?: string;
  autoStart?: boolean;
  tunnelUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramBotUsername?: string;
  telegramMiniAppUrl?: string;
}

export interface FederationHost {
  hostId: string;
  machineName: string;
  platform: 'win32' | 'darwin' | 'linux';
  tunnelUrl?: string;
  localIps?: string[];
  isOnline: boolean;
  projectsCount: number;
  activeProcessesCount: number;
  projects?: Array<{ id: string; name: string; path: string }>;
  lastSeen: number;
  /**
   * Версия протокола федерации (TASK-58, задел для TASK-66). Хосты со старой/новой несовместимой
   * версией отклоняются при регистрации с понятной ошибкой вместо молчаливой порчи данных.
   */
  protocolVersion?: number;
  /** Заполняется на принимающей стороне, если версия хоста несовместима с локальной. */
  protocolIncompatible?: boolean;
}

export interface RemoteControlStatus {
  enabled: boolean;
  port: number;
  mode: RemoteConnectionMode;
  relayServerUrl: string;
  relayConnected: boolean;
  hostId: string;
  machineName: string;
  pairingPin: string;
  secretKey: string;
  localIps: string[];
  connectedDevices: RemoteDevice[];
  /** Все устройства с выданным per-device токеном (включая офлайн), с правами и временем выдачи. */
  pairedDevices: PairedDevice[];
  requireApproval: boolean;
  readOnly: boolean;
  lastError: string | null;
  autoStart: boolean;
  tunnelUrl: string;
  tunnelStatus: 'idle' | 'starting' | 'active' | 'error';
  tunnelError: string | null;
  federationHosts: FederationHost[];
  useRelay?: boolean;
  localAddresses?: string[];
  secretToken?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramBotUsername?: string;
  telegramMiniAppUrl?: string;
}

export interface EncryptedPacket {
  e2ee: true;
  iv: string; // hex
  tag: string; // hex
  data: string; // hex
}

export interface PlainPacket {
  e2ee?: false;
  type: 'rpc_req' | 'rpc_res' | 'event' | 'handshake' | 'handshake_ack' | 'ping' | 'pong';
  id?: string;
  method?: string;
  params?: any;
  result?: any;
  error?: string;
  event?: string;
  data?: any;
  /**
   * Монотонный id события (только для `type:'event'`): клиент запоминает последний увиденный и
   * после переподключения догоняет пропущенное через RPC `get_events_since` (decision-11 п.6).
   */
  eventId?: number;
}

export type RemotePacket = PlainPacket | EncryptedPacket;

export type RemoteRpcMethod =
  | 'get_status'
  | 'get_projects'
  | 'select_project'
  | 'get_processes'
  | 'start_process'
  | 'stop_process'
  | 'restart_process'
  | 'get_process_logs'
  | 'get_tasks'
  | 'update_task_status'
  | 'toggle_task_criterion'
  | 'create_task'
  | 'get_git_status'
  | 'git_commit'
  | 'git_pull'
  | 'git_push'
  | 'send_ai_prompt'
  | 'hitl_decision'
  | 'get_pending_approvals'
  | 'run_action'
  | 'get_federation_hosts'
  | 'get_events_since';

export interface RemoteEventPayloads {
  'process:logChunk': { processId: string; text: string };
  'process:statusChanged': any;
  'ai:chunk': { sessionId: string; text?: string };
  'ai:complete': { sessionId: string; message: unknown };
  'ai:error': { sessionId: string; error: string };
  /** Запрос HITL (TASK-57): решение отправляется RPC `hitl_decision` строго с `requestId`. */
  'ai:hitl': {
    requestId: string;
    sessionId: string;
    projectPath: string;
    origin?: string;
    agentName?: string;
    role?: string;
    tool: string;
    type?: string;
    description: string;
    details?: string;
    command?: string;
    filePath?: string;
    expiresAt?: number;
  };
  'ai:hitlDecided': { requestId: string; sessionId: string; approved: boolean; by: string };
  'projects:changed': void;
  'backlog:changed': { projectPath: string };
}
