/**
 * Типы подсистемы уведомлений (TASK-63, decision-13).
 *
 * Модуль намеренно без зависимостей от Electron: его импортируют `notificationRules` (чистая
 * логика доставки, покрыта unit-тестами), `notificationService` (main) и рендерер через
 * `src/types/electron.d.ts`.
 */

/** Канал доставки уведомления. */
export type NotificationChannel =
  /** Иконка и меню системного трея. */
  | 'tray'
  /** Системное уведомление ОС (Electron Notification). */
  | 'os'
  /** Звуковой сигнал в окне приложения. */
  | 'sound'
  /** Push в Telegram владельцу. */
  | 'telegram'
  /** Рассылка доверенным устройствам Remote Control. */
  | 'remote';

export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['tray', 'os', 'sound', 'telegram', 'remote'];

/** Тип события с точки зрения пользователя: строка матрицы «событие × канал». */
export type NotificationKind =
  /** Агент ждёт решения человека. */
  | 'hitl'
  | 'agentFinished'
  | 'agentFailed'
  | 'swarmFinished'
  | 'processCrashed'
  | 'prCreated'
  | 'prChecksFailed'
  | 'deviceConnected';

export const NOTIFICATION_KINDS: NotificationKind[] = [
  'hitl',
  'agentFinished',
  'agentFailed',
  'swarmFinished',
  'processCrashed',
  'prCreated',
  'prChecksFailed',
  'deviceConnected'
];

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

/** Что открыть по клику на уведомлении. */
export type NotificationAction =
  | { type: 'openHitl'; requestId?: string }
  | { type: 'openSwarm'; projectPath?: string; sessionId?: string }
  | { type: 'openProcesses'; projectPath?: string }
  | { type: 'openPrs'; projectPath?: string; url?: string }
  | { type: 'openRemote' }
  | { type: 'openApp' };

/** Нормализованное уведомление — то, что шина событий превращает в доставку по каналам. */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  at: number;
  /** Ключ дедупликации: одно и то же событие не доставляется в канал дважды в окне дедупа. */
  dedupKey: string;
  projectPath?: string;
  projectName?: string;
  hostId?: string;
  /** Запрос HITL, если уведомление о нём: решение по нему снимает уведомление во всех каналах. */
  requestId?: string;
  sessionId?: string;
  action?: NotificationAction;
}

/** «Тихие часы»: в интервале доставляются только каналы без шума (трей) и, опционально, critical. */
export interface QuietHoursSettings {
  enabled: boolean;
  /** `HH:MM`, включительно. */
  from: string;
  /** `HH:MM`, исключительно. Меньше `from` — интервал через полночь. */
  to: string;
  /** Пропускать ли `critical` (HITL, падение агента) сквозь тихие часы. */
  allowCritical: boolean;
}

export interface NotificationSettings {
  /** Общий выключатель всех каналов, кроме трея. */
  enabled: boolean;
  /** Матрица «тип события × каналы». */
  channels: Record<NotificationKind, NotificationChannel[]>;
  quietHours: QuietHoursSettings;
  /** Громкость звукового сигнала, 0..1. */
  soundVolume: number;
  /** Окно дедупликации одного `dedupKey` в одном канале, мс. */
  dedupWindowMs: number;
  /** Закрытие окна сворачивает в трей вместо выхода (decision-13 п.4). */
  minimizeToTray: boolean;
  /** Держать бот Telegram запущенным, пока задан токен (decision-13 п.5). */
  telegramBotAutoStart: boolean;
}

/** Состояние иконки трея. */
export type TrayState = 'idle' | 'working' | 'attention';

/** Что main сообщает рендереру о доставке (звук, тост). */
export interface NotificationDelivery {
  notification: AppNotification;
  channels: NotificationChannel[];
}
