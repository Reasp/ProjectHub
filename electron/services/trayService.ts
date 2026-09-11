import { Menu, Tray, app, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { getTrayIcon } from './trayIcons.js';
import type { NotificationAction, TrayState } from './notificationTypes.js';
import type { HitlRequest } from './hitlTypes.js';
import { logger } from './logger.js';

/**
 * Системный трей (TASK-63, decision-13 п.2, п.4).
 *
 * Иконка отражает состояние приложения (idle / working / needs-attention), меню показывает
 * очередь HITL и активные сессии агентов и даёт быстрые действия. Закрытие окна сворачивает
 * приложение в трей, полный выход — только через меню и с подтверждением, если агенты работают.
 *
 * Сервис ничего не знает о hitlService и agentFleetService: данные и обработчики приходят
 * через {@link TrayHandlers}, чтобы не заводить циклических импортов (их ставит `main.ts`).
 */

export interface TrayActiveSession {
  id: string;
  title: string;
  projectPath?: string;
  /** Сколько агентов сессии ещё работает. */
  activeAgents: number;
}

export interface TrayHandlers {
  getPendingHitl: () => HitlRequest[];
  getActiveSessions: () => TrayActiveSession[];
  /** Показать и сфокусировать главное окно. */
  showWindow: () => void;
  /** Открыть окно и отправить рендереру действие (Центр решений, Swarm, процессы…). */
  navigate: (action: NotificationAction) => void;
  /** Полный выход; трей уже спросил подтверждение, если были активные агенты. */
  quit: () => void;
  /** Подтверждение выхода при активных агентах; `true` — выходим. */
  confirmQuit: (activeAgents: number) => Promise<boolean>;
}

/** Сколько строк очереди и сессий показывать в меню, чтобы оно не уезжало за экран. */
const MENU_LIST_LIMIT = 5;

const STATE_LABEL: Record<TrayState, string> = {
  idle: 'Простой: активных агентов нет',
  working: 'Агенты работают',
  attention: 'Требуется решение человека'
};

class TrayService {
  private tray: Tray | null = null;
  private handlers: TrayHandlers | null = null;
  private state: TrayState = 'idle';
  private isQuitting = false;

  public configure(handlers: TrayHandlers): void {
    this.handlers = handlers;
  }

  public get isAvailable(): boolean {
    return this.tray !== null && !this.tray.isDestroyed();
  }

  public init(): void {
    if (this.tray) return;
    try {
      this.tray = new Tray(getTrayIcon(this.state));
      this.tray.setToolTip('ProjectHub');
      this.tray.on('click', () => this.handlers?.showWindow());
      this.tray.on('double-click', () => this.handlers?.showWindow());
      this.refresh();
      logger.info('[Tray] System tray initialised');
    } catch (err) {
      // На Linux без системного трея (или в headless CI) Tray бросает — приложение работает дальше.
      this.tray = null;
      logger.warn(`[Tray] Failed to create system tray: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public setState(state: TrayState): void {
    if (!this.tray || this.tray.isDestroyed()) return;
    if (state !== this.state) {
      this.state = state;
      try {
        this.tray.setImage(getTrayIcon(state));
      } catch (err) {
        logger.warn(`[Tray] Failed to set icon: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.refresh();
  }

  /** Пересобрать меню и подсказку: очередь и список сессий меняются на каждом событии шины. */
  public refresh(): void {
    if (!this.tray || this.tray.isDestroyed() || !this.handlers) return;
    const pending = safeCall(this.handlers.getPendingHitl, []);
    const sessions = safeCall(this.handlers.getActiveSessions, []);

    const tooltipParts = ['ProjectHub', STATE_LABEL[this.state]];
    if (pending.length) tooltipParts.push(`Ожидают решения: ${pending.length}`);
    if (sessions.length) tooltipParts.push(`Активных сессий: ${sessions.length}`);
    try {
      this.tray.setToolTip(tooltipParts.join(' — '));
    } catch {
      // ignore
    }

    const template: MenuItemConstructorOptions[] = [
      { label: `ProjectHub — ${STATE_LABEL[this.state]}`, enabled: false },
      { type: 'separator' },
      { label: 'Открыть ProjectHub', click: () => this.handlers?.showWindow() }
    ];

    template.push({ type: 'separator' });
    if (pending.length) {
      template.push({ label: `Ожидают решения (${pending.length})`, enabled: false });
      for (const request of pending.slice(0, MENU_LIST_LIMIT)) {
        template.push({
          label: `  ${truncate(request.title, 48)} — ${projectLabel(request.projectPath)}`,
          click: () => this.handlers?.navigate({ type: 'openHitl', requestId: request.id })
        });
      }
      if (pending.length > MENU_LIST_LIMIT) {
        template.push({ label: `  …и ещё ${pending.length - MENU_LIST_LIMIT}`, enabled: false });
      }
      template.push({ label: 'Центр решений…', click: () => this.handlers?.navigate({ type: 'openHitl' }) });
    } else {
      template.push({ label: 'Запросов на решение нет', enabled: false });
    }

    template.push({ type: 'separator' });
    if (sessions.length) {
      template.push({ label: `Активные сессии (${sessions.length})`, enabled: false });
      for (const session of sessions.slice(0, MENU_LIST_LIMIT)) {
        template.push({
          label: `  ${truncate(session.title, 40)} — ${session.activeAgents} агент(ов)`,
          click: () =>
            this.handlers?.navigate({ type: 'openSwarm', projectPath: session.projectPath, sessionId: session.id })
        });
      }
      if (sessions.length > MENU_LIST_LIMIT) {
        template.push({ label: `  …и ещё ${sessions.length - MENU_LIST_LIMIT}`, enabled: false });
      }
    } else {
      template.push({ label: 'Активных сессий нет', enabled: false });
    }

    template.push(
      { type: 'separator' },
      { label: 'Процессы', click: () => this.handlers?.navigate({ type: 'openProcesses' }) },
      { label: 'Удалённый доступ', click: () => this.handlers?.navigate({ type: 'openRemote' }) },
      { type: 'separator' },
      { label: 'Выход', click: () => void this.requestQuit() }
    );

    try {
      this.tray.setContextMenu(Menu.buildFromTemplate(template));
    } catch (err) {
      logger.warn(`[Tray] Failed to build context menu: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Выход из меню трея: если агенты ещё работают, спрашиваем подтверждение — иначе их
   * прерывание было бы «тихим» (окно свёрнуто, пользователь не видит, что он что-то обрывает).
   */
  public async requestQuit(): Promise<void> {
    if (this.isQuitting || !this.handlers) return;
    const sessions = safeCall(this.handlers.getActiveSessions, []);
    const activeAgents = sessions.reduce((sum, s) => sum + s.activeAgents, 0);
    if (activeAgents > 0) {
      this.handlers.showWindow();
      const confirmed = await this.handlers.confirmQuit(activeAgents);
      if (!confirmed) return;
    }
    this.isQuitting = true;
    this.handlers.quit();
  }

  public destroy(): void {
    if (this.tray && !this.tray.isDestroyed()) {
      try {
        this.tray.destroy();
      } catch {
        // ignore
      }
    }
    this.tray = null;
  }
}

function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    logger.warn(`[Tray] Data provider failed: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

function truncate(value: string, limit: number): string {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text || '—';
}

function projectLabel(projectPath?: string): string {
  if (!projectPath) return app?.getName?.() ?? 'ProjectHub';
  return path.basename(projectPath.replace(/[\\/]+$/, '')) || projectPath;
}

export const trayService = new TrayService();
