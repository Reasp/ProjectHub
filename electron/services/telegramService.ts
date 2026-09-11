import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { processManager } from './processManager.js';
import { getUserDataDir, getWorkerScriptCandidates } from './appPaths.js';
import { formatTelegramMessage } from './notificationRules.js';
import type { AppNotification } from './notificationTypes.js';
import { logger } from './logger.js';

/**
 * Telegram-канал уведомлений и жизненный цикл бота (TASK-63, decision-13 п.5).
 *
 * Две разные роли:
 * 1. **Push** — main шлёт сообщение через Bot API сам (`sendNotification`). Для запросов HITL к
 *    сообщению прикрепляются inline-кнопки «Разрешить/Отклонить» с `callback_data`
 *    `hitl:<allow|deny>:<requestId>`; когда решение принято любым каналом, кнопки снимаются, а
 *    в текст дописывается итог (`resolveRequest`) — «решение с одного канала закрывает
 *    уведомление на других».
 * 2. **Бот-демон** — `electron/workers/telegramBot.mjs` под управлением `processManager`
 *    (виден в менеджере процессов, останавливается вместе с приложением). Он ловит нажатия
 *    кнопок и команды и применяет решения через HTTP-эндпоинт Remote Control по `requestId`.
 *
 * Учётные данные не хранятся здесь: их отдаёт провайдер, который ставит `main.ts` поверх
 * `remoteControlService` (там же они лежат в `safeStorage`), — так нет ни дублирования
 * секретов, ни циклического импорта.
 */

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
  allowedUsers?: string;
  miniAppUrl?: string;
  /** Мастер-ключ Remote Control: с ним бот ходит в `/api/hitl/*` этого хоста. */
  hostToken: string;
  hubPort: number;
}

/** Имя процесса бота в менеджере процессов. */
export const TELEGRAM_BOT_PROCESS_NAME = 'Telegram Bot';

/**
 * Каталог, от имени которого запускаются собственные служебные процессы ProjectHub.
 * Вкладка «Процессы» показывает их отдельной секцией — они не принадлежат ни одному проекту.
 */
export function getServiceProcessesRoot(): string {
  return path.join(getUserDataDir(), 'services');
}

/** Сколько сообщений с кнопками помним, чтобы позже снять с них клавиатуру. */
const TRACKED_MESSAGES_LIMIT = 200;

interface TrackedMessage {
  chatId: string;
  messageId: number;
  text: string;
}

class TelegramService {
  private getCredentials: (() => TelegramCredentials | null) | null = null;
  private readonly messagesByRequest = new Map<string, TrackedMessage>();
  private botProcessId: string | null = null;
  private startingBot: Promise<void> | null = null;

  public configure(provider: () => TelegramCredentials | null): void {
    this.getCredentials = provider;
  }

  private credentials(): TelegramCredentials | null {
    if (!this.getCredentials) return null;
    try {
      const creds = this.getCredentials();
      if (!creds?.botToken) return null;
      return creds;
    } catch (err) {
      logger.warn(`[Telegram] Credentials provider failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  public get isConfigured(): boolean {
    const creds = this.credentials();
    return Boolean(creds?.botToken && creds.chatId);
  }

  private async api<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
    const creds = this.credentials();
    if (!creds) return null;
    try {
      const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = (await res.json()) as { ok?: boolean; result?: T; description?: string };
      if (!data?.ok) {
        logger.warn(`[Telegram] ${method} failed: ${data?.description || 'unknown error'}`);
        return null;
      }
      return (data.result ?? null) as T | null;
    } catch (err) {
      logger.warn(`[Telegram] ${method} request failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** Отправка уведомления; для HITL — с кнопками решения. */
  public async sendNotification(notification: AppNotification): Promise<boolean> {
    const creds = this.credentials();
    if (!creds?.chatId) return false;

    const text = formatTelegramMessage(notification);
    const body: Record<string, unknown> = {
      chat_id: creds.chatId,
      text,
      parse_mode: 'Markdown'
    };

    if (notification.requestId) {
      body.reply_markup = {
        inline_keyboard: [
          [
            { text: '✅ Разрешить', callback_data: `hitl:allow:${notification.requestId}` },
            { text: '⛔ Отклонить', callback_data: `hitl:deny:${notification.requestId}` }
          ]
        ]
      };
    }

    const result = await this.api<{ message_id?: number }>('sendMessage', body);
    if (!result) return false;

    if (notification.requestId && typeof result.message_id === 'number') {
      this.messagesByRequest.set(notification.requestId, {
        chatId: creds.chatId,
        messageId: result.message_id,
        text
      });
      this.enforceTrackedLimit();
    }
    return true;
  }

  /** Произвольное сообщение (тест из настроек, сервисные уведомления). */
  public async sendMessage(text: string): Promise<boolean> {
    const creds = this.credentials();
    if (!creds?.chatId) return false;
    const result = await this.api('sendMessage', { chat_id: creds.chatId, text, parse_mode: 'Markdown' });
    return result !== null;
  }

  /**
   * Запрос решён (где угодно): снимаем кнопки у отправленного сообщения и дописываем исход,
   * чтобы в Telegram не оставалось «живой» кнопки на уже закрытый запрос.
   */
  public async resolveRequest(requestId: string, outcome: string): Promise<void> {
    const tracked = this.messagesByRequest.get(requestId);
    if (!tracked) return;
    this.messagesByRequest.delete(requestId);
    await this.api('editMessageText', {
      chat_id: tracked.chatId,
      message_id: tracked.messageId,
      text: `${tracked.text}\n\n— ${outcome}`,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [] }
    });
  }

  private enforceTrackedLimit(): void {
    while (this.messagesByRequest.size > TRACKED_MESSAGES_LIMIT) {
      const oldest = this.messagesByRequest.keys().next();
      if (oldest.done) break;
      this.messagesByRequest.delete(oldest.value);
    }
  }

  // ───────────────────────────── Бот-демон ─────────────────────────────

  public get isBotRunning(): boolean {
    return this.botProcessId !== null && processManager.isRunning(this.botProcessId);
  }

  public get processId(): string | null {
    return this.botProcessId;
  }

  /**
   * Привести состояние бота к желаемому: `shouldRun` и наличие токена — запущен, иначе остановлен.
   * Вызывается при старте приложения и при смене настроек/токена.
   */
  public async sync(shouldRun: boolean): Promise<void> {
    const creds = this.credentials();
    const wanted = shouldRun && Boolean(creds?.botToken);
    if (wanted && !this.isBotRunning) {
      await this.startBot();
    } else if (!wanted && this.isBotRunning) {
      await this.stopBot();
    }
  }

  public async startBot(): Promise<{ ok: boolean; error?: string }> {
    if (this.startingBot) {
      await this.startingBot;
      return { ok: this.isBotRunning };
    }
    const creds = this.credentials();
    if (!creds?.botToken) return { ok: false, error: 'Токен Telegram-бота не задан' };
    if (this.isBotRunning) return { ok: true };

    const script = getWorkerScriptCandidates('telegramBot.mjs').find((candidate) => existsSync(candidate));
    if (!script) return { ok: false, error: 'Скрипт бота telegramBot.mjs не найден' };

    const run = (async () => {
      const cwd = getServiceProcessesRoot();
      await fs.mkdir(cwd, { recursive: true });
      // Бот запускается тем же бинарником Electron в режиме Node: в упакованном приложении
      // системного `node` может не быть вовсе (TASK-43).
      const command = `"${process.execPath}" "${script}"`;
      const proc = await processManager.startProcess(cwd, command, TELEGRAM_BOT_PROCESS_NAME, {
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          TELEGRAM_BOT_TOKEN: creds.botToken,
          TELEGRAM_ALLOWED_USERS: creds.allowedUsers || '',
          TELEGRAM_CHAT_ID: creds.chatId || '',
          PROJECTHUB_MINIAPP_URL: creds.miniAppUrl || '',
          PROJECTHUB_PORT: String(creds.hubPort || 42050),
          PROJECTHUB_HOST: '127.0.0.1',
          PROJECTHUB_HOST_TOKEN: creds.hostToken || '',
          // Конфиг из текущего каталога бот не читает: секреты приходят только окружением.
          PROJECTHUB_BOT_ENV_ONLY: '1'
        }
      });
      this.botProcessId = proc.id;
      logger.info(`[Telegram] Bot daemon started (pid ${proc.pid ?? '?'})`);
    })();

    this.startingBot = run.then(
      () => undefined,
      () => undefined
    );
    try {
      await run;
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[Telegram] Failed to start bot daemon: ${message}`);
      return { ok: false, error: message };
    } finally {
      this.startingBot = null;
    }
  }

  public async stopBot(): Promise<boolean> {
    if (!this.botProcessId) return false;
    const id = this.botProcessId;
    this.botProcessId = null;
    try {
      const stopped = await processManager.stopProcess(id);
      logger.info('[Telegram] Bot daemon stopped');
      return stopped;
    } catch (err) {
      logger.warn(`[Telegram] Failed to stop bot daemon: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}

export const telegramService = new TelegramService();
