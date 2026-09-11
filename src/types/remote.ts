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
  /**
   * Общий секрет федерации (TASK-66): задаётся одинаковым на всех машинах пользователя, из него
   * выводится `ownerId` каталога на релее. Хранится в safeStorage, не в plaintext-конфиге.
   */
  federationSecret?: string;
  /**
   * Автозапуск задач, назначенных на этот хост (`agent:<role>@<hostId>`), когда их файл приехал
   * через git (TASK-66). Выключено по умолчанию: агент стартует сам, без нажатия человека.
   */
  autoStartAssignedTasks?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramBotUsername?: string;
  telegramMiniAppUrl?: string;
}

/**
 * Проект удалённого хоста в каталоге федерации (TASK-66). Наружу уходит имя и хэш пути
 * (`pathHash`), а не сам путь: каталог проходит через чужой релей. `path` заполняется только
 * для локального хоста, где он и так известен.
 */
export interface FederationProject {
  id: string;
  name: string;
  path?: string;
  pathHash?: string;
}

/** Откуда узнали о хосте: сам себя, каталог релея, LAN-обнаружение (TASK-66). */
export type FederationHostSource = 'self' | 'relay' | 'lan' | 'manual';

export interface FederationHost {
  hostId: string;
  machineName: string;
  platform: 'win32' | 'darwin' | 'linux';
  tunnelUrl?: string;
  localIps?: string[];
  /** Порт локального HTTP/WS-сервера хоста — нужен для прямого LAN-подключения без релея. */
  port?: number;
  isOnline: boolean;
  projectsCount: number;
  activeProcessesCount: number;
  projects?: FederationProject[];
  lastSeen: number;
  /** Версия приложения на хосте (для диагностики несовместимостей). */
  appVersion?: string;
  /** Сколько агентов сейчас работает на хосте (fan-out + AI Studio). */
  activeAgentsCount?: number;
  /** Длина очереди HITL — видно, что хост чего-то ждёт от человека. */
  hitlPendingCount?: number;
  /** Источник записи: сам хост, каталог релея или LAN-обнаружение. */
  source?: FederationHostSource;
  /**
   * Версия протокола федерации (TASK-58, задел для TASK-66). Хосты со старой/новой несовместимой
   * версией отклоняются при регистрации с понятной ошибкой вместо молчаливой порчи данных.
   */
  protocolVersion?: number;
  /** Заполняется на принимающей стороне, если версия хоста несовместима с локальной. */
  protocolIncompatible?: boolean;
}

/** Транспорт подключения к удалённому ProjectHub в hub-режиме (TASK-66). */
export type FederationTransport = 'lan' | 'relay';

export type FederationPeerStatus = 'idle' | 'connecting' | 'connected' | 'offline' | 'error';

/**
 * Состояние подключения к удалённому хосту в hub-режиме (TASK-66, decision-11 п.4).
 * Секреты (E2EE-ключ, per-device токен) сюда не попадают — только факт сопряжения.
 */
export interface FederationPeerState {
  hostId: string;
  machineName: string;
  transport: FederationTransport;
  address: string;
  status: FederationPeerStatus;
  /** Понятная причина ошибки, включая несовместимость версии протокола. */
  error?: string;
  /** Права, выданные нам удалённым хостом (его per-device токен). */
  rights?: DeviceRights;
  readOnly?: boolean;
  protocolVersion?: number;
  lastEventId: number;
  connectedAt?: number;
  /** Токен получен — переподключение больше не требует PIN. */
  paired: boolean;
  autoConnect: boolean;
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
  /** Задан общий федеративный секрет — хост участвует в каталоге пользователя (TASK-66). */
  federationEnabled?: boolean;
  /** Включён автозапуск задач, назначенных на этот хост. */
  autoStartAssignedTasks?: boolean;
  /** Производный от секрета идентификатор владельца каталога (сам секрет из него не выводится). */
  federationOwnerId?: string;
  /** Секрет федерации — показывается в настройках, чтобы перенести его на другую машину. */
  federationSecret?: string;
  /** Понятная ошибка федерации (например, несовместимая версия протокола релея). */
  federationError?: string | null;
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
  | 'get_events_since'
  // Hub-режим федерации (TASK-66, decision-11 п.4): ПК как клиент другого ПК
  | 'get_roles'
  | 'get_swarms'
  | 'start_assigned_agent'
  | 'stop_swarm';

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
