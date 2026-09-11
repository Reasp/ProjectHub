#!/usr/bin/env node
/**
 * ProjectHub Telegram Bot & Mini App Server
 *
 * Автономный бот на чистом Node.js (без внешних зависимостей, нативный fetch). Две задачи:
 * запуск Telegram Mini App и применение решений HITL, принятых нажатием inline-кнопки в push-е
 * (TASK-63, decision-13 п.5). Сам push отправляет main-процесс — бот его не дублирует.
 *
 * Живёт в `electron/workers/`, а не в `scripts/`: только оттуда файл попадает в упакованное
 * приложение (`dist-electron/workers`, см. `scripts/pack-win.mjs`) и может быть запущен
 * `telegramService` через `processManager`. `npm run telegram-bot` запускает этот же файл
 * через тонкую обёртку `scripts/telegram-bot.mjs`.
 *
 * Конфигурация приходит окружением. При `PROJECTHUB_BOT_ENV_ONLY=1` (так бот стартует из
 * приложения) файл `.projecthub-telegram.json` не читается вовсе — секреты живут в safeStorage,
 * а не в рабочем каталоге.
 */
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_FILE = path.join(process.cwd(), '.projecthub-telegram.json');

function loadConfig() {
  const fileCfg = {};
  if (process.env.PROJECTHUB_BOT_ENV_ONLY !== '1' && fs.existsSync(CONFIG_FILE)) {
    try {
      Object.assign(fileCfg, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
    } catch (e) {
      console.warn('[TelegramBot] Ошибка чтения .projecthub-telegram.json:', e.message);
    }
  }

  // Переменные окружения приоритетнее файла: приложение передаёт актуальные значения при старте.
  const pick = (envName, fileKey, fallback = '') =>
    process.env[envName] || fileCfg[fileKey] || fallback;

  return {
    botToken: pick('TELEGRAM_BOT_TOKEN', 'botToken'),
    allowedUsers: pick('TELEGRAM_ALLOWED_USERS', 'allowedUsers'),
    chatId: pick('TELEGRAM_CHAT_ID', 'chatId'),
    miniAppUrl: pick('PROJECTHUB_MINIAPP_URL', 'miniAppUrl'),
    hubPort: Number(pick('PROJECTHUB_PORT', 'hubPort', 42050)),
    hubHost: pick('PROJECTHUB_HOST', 'hubHost', '127.0.0.1'),
    // Мастер-ключ Remote Control этого хоста (тот же `secretToken` из бейджа Remote Control) —
    // требуется для /api/federation/* и /api/hitl/* (decision-5 п.5: аутентификация на каждом
    // сетевом эндпоинте). Без него доступен только урезанный публичный /api/status.
    hostToken: pick('PROJECTHUB_HOST_TOKEN', 'hostToken')
  };
}

const config = loadConfig();

if (!config.botToken) {
  console.log(`
[TelegramBot] ⚠️ Токен бота не указан.
Укажите TELEGRAM_BOT_TOKEN в переменных окружения или в файле .projecthub-telegram.json:
{
  "botToken": "123456789:ABC...",
  "allowedUsers": "username1,12345678",
  "miniAppUrl": "https://your-public-url.com/telegram",
  "hostToken": "<secretToken из бейджа Remote Control ProjectHub>"
}
`);
}

let isRunning = false;
let lastUpdateId = 0;

async function tgApi(method, body = {}) {
  const token = config.botToken;
  if (!token) return null;
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.description || `Telegram API error in ${method}`);
  }
  return data.result;
}

/** GET на локальный хаб ProjectHub с Bearer-токеном, если он настроен (TASK-65, decision-5 п.5). */
function fetchHub(pathname, init) {
  const headers = { ...(init?.headers || {}) };
  if (config.hostToken) headers.Authorization = `Bearer ${config.hostToken}`;
  return fetch(`http://${config.hubHost}:${config.hubPort}${pathname}`, { ...init, headers });
}

function isUserAllowed(from) {
  if (!config.allowedUsers) return true;
  const allowed = config.allowedUsers.split(',').map((s) => s.trim().toLowerCase().replace(/^@/, ''));
  if (from.id && allowed.includes(String(from.id))) return true;
  if (from.username && allowed.includes(from.username.toLowerCase())) return true;
  return false;
}

async function sendHitlQueue(chatId) {
  try {
    const res = await fetchHub('/api/hitl/pending');
    if (!res.ok) throw new Error(`hitl/pending HTTP ${res.status}`);
    const { pending } = await res.json();
    if (!pending?.length) {
      await tgApi('sendMessage', { chat_id: chatId, text: '✅ Запросов, ожидающих решения, нет.' });
      return;
    }
    for (const request of pending.slice(0, 10)) {
      const what = request.command
        ? `Команда: \`${request.command.slice(0, 160)}\``
        : request.filePath
          ? `Файл: \`${request.filePath.slice(0, 160)}\``
          : (request.details || '').slice(0, 160);
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: `🚨 *${request.title}*\n${request.agentName || 'Агент'}${request.role ? ` (${request.role})` : ''}\n${what}`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Разрешить', callback_data: `hitl:allow:${request.id}` },
              { text: '⛔ Отклонить', callback_data: `hitl:deny:${request.id}` }
            ]
          ]
        }
      });
    }
  } catch {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: '⚠️ Не удалось получить очередь решений. Убедитесь, что ProjectHub запущен и задан токен хоста.'
    }).catch(() => {});
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  const text = (msg.text || '').trim();
  const from = msg.from || {};

  if (!chatId) return;

  if (!isUserAllowed(from)) {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: '⛔ Доступ запрещен. Ваш ID или логин не указан в списке разрешенных пользователей ProjectHub.'
    }).catch(() => {});
    return;
  }

  if (text.startsWith('/start')) {
    const webAppUrl = config.miniAppUrl || `http://${config.hubHost}:${config.hubPort}/telegram`;
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: `👋 Привет, ${from.first_name || 'пользователь'}!\n\nДобро пожаловать в панель управления **ProjectHub**.\nНажмите кнопку ниже, чтобы открыть Mini App прямо в Telegram.`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🚀 Открыть ProjectHub Mini App',
              web_app: { url: webAppUrl }
            }
          ],
          [
            { text: '📊 Статус хоста', callback_data: 'status' },
            { text: '🚨 Очередь решений', callback_data: 'hitl:list' }
          ]
        ]
      }
    });
    return;
  }

  if (text.startsWith('/hitl') || text.startsWith('/approve')) {
    await sendHitlQueue(chatId);
    return;
  }

  if (text.startsWith('/status') || text.startsWith('/help')) {
    try {
      const res = await fetchHub('/api/federation/hosts');
      if (!res.ok) throw new Error(`federation/hosts HTTP ${res.status}`);
      const fed = await res.json();
      const hosts = fed.hosts || [];
      const onlineHosts = hosts.filter((h) => h.isOnline);

      let statusMsg = `🖥 **ProjectHub Federation — Единый Hub**\n\n`;
      statusMsg += `В сети: **${onlineHosts.length}** из ${hosts.length} компьютеров\n\n`;

      for (const h of hosts) {
        const icon = h.platform === 'darwin' ? '🍏' : h.platform === 'linux' ? '🐧' : '💻';
        const st = h.isOnline ? '🟢 Онлайн' : '⚪ Офлайн';
        statusMsg += `${icon} **${h.machineName}** (${st})\n`;
        statusMsg += `   • Проектов: ${h.projectsCount || 0} • Процессов: ${h.activeProcessesCount || 0}\n`;
        if (h.tunnelUrl) {
          statusMsg += `   • Туннель: \`${h.tunnelUrl}\`\n`;
        }
      }

      await tgApi('sendMessage', {
        chat_id: chatId,
        text: statusMsg,
        parse_mode: 'Markdown'
      });
    } catch {
      try {
        const res = await fetchHub('/api/status');
        const status = await res.json();
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: `🖥 **ProjectHub Host Status**\n\n- Хост: \`${status.machineName || status.hostId}\`\n- Статус: ${status.status === 'ok' ? '🟢 Онлайн' : '🔴 Ошибка'}\n- Режим: \`${status.mode}\`\n- Туннель: \`${status.tunnelUrl || 'локальный'}\``,
          parse_mode: 'Markdown'
        });
      } catch {
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: '⚠️ Не удалось получить статус ProjectHub хоста. Убедитесь, что приложение запущено.'
        });
      }
    }
  }
}

/**
 * Решение HITL по нажатию inline-кнопки. Применяется строго по `requestId` через тот же
 * `hitlService.decide`, что и окно приложения: первый ответ выигрывает, повтор получает 409
 * и «уже решено» (decision-10 п.5).
 */
async function applyHitlDecision(query, decision, requestId) {
  const approved = decision === 'allow';
  try {
    const res = await fetchHub('/api/hitl/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, approved, deviceName: `Telegram (${query.from?.username || query.from?.id || '?'})` })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      await tgApi('answerCallbackQuery', {
        callback_query_id: query.id,
        text: approved ? 'Разрешено' : 'Отклонено'
      });
      await editDecidedMessage(query, approved ? '✅ Разрешено из Telegram' : '⛔ Отклонено из Telegram');
    } else if (res.status === 409) {
      await tgApi('answerCallbackQuery', {
        callback_query_id: query.id,
        text: data.reason === 'already_decided' ? 'Запрос уже решён' : 'Запрос не найден',
        show_alert: true
      });
      await editDecidedMessage(query, '— запрос уже закрыт другим каналом');
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (e) {
    await tgApi('answerCallbackQuery', {
      callback_query_id: query.id,
      text: 'ProjectHub недоступен',
      show_alert: true
    }).catch(() => {});
    console.warn('[TelegramBot] Не удалось применить решение HITL:', e.message);
  }
}

/** Снять кнопки с карточки решения, чтобы по ней нельзя было ответить дважды. */
async function editDecidedMessage(query, suffix) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  if (!chatId || !messageId) return;
  const original = query.message.text || '';
  await tgApi('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: `${original}\n\n${suffix}`,
    reply_markup: { inline_keyboard: [] }
  }).catch(() => {});
}

async function handleCallbackQuery(query) {
  const chatId = query.message?.chat?.id;
  const data = query.data || '';
  if (!chatId) return;

  if (!isUserAllowed(query.from || {})) {
    await tgApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Доступ запрещён', show_alert: true }).catch(() => {});
    return;
  }

  if (data === 'hitl:list') {
    await tgApi('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
    await sendHitlQueue(chatId);
    return;
  }

  const hitlMatch = data.match(/^hitl:(allow|deny):(.+)$/);
  if (hitlMatch) {
    await applyHitlDecision(query, hitlMatch[1], hitlMatch[2]);
    return;
  }

  if (data === 'status') {
    try {
      const res = await fetchHub('/api/status');
      const status = await res.json();
      await tgApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Статус обновлен' });
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: `🖥 **ProjectHub Host Status**\n\n- Статус: ${status.status === 'ok' ? '🟢 Онлайн' : '🔴 Ошибка'}\n- Режим: \`${status.mode}\`\n- Порт: \`${status.port}\``,
        parse_mode: 'Markdown'
      });
    } catch {
      await tgApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Хост недоступен', show_alert: true });
    }
  }
}

async function pollUpdates() {
  while (isRunning) {
    try {
      const updates = await tgApi('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 25
      });

      if (Array.isArray(updates)) {
        for (const update of updates) {
          lastUpdateId = update.update_id;
          if (update.message) {
            await handleMessage(update.message);
          } else if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
          }
        }
      }
    } catch {
      if (isRunning) {
        // Задержка перед повторной попыткой при ошибке сети
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }
}

async function main() {
  if (!config.botToken) {
    process.exit(0);
  }

  isRunning = true;
  try {
    const me = await tgApi('getMe');
    console.log(`[TelegramBot] ✅ Бот @${me.username} успешно запущен! Ожидание сообщений...`);
    await pollUpdates();
  } catch (err) {
    console.error('[TelegramBot] ❌ Ошибка запуска бота:', err.message);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  isRunning = false;
  process.exit(0);
});

process.on('SIGTERM', () => {
  isRunning = false;
  process.exit(0);
});

main();
