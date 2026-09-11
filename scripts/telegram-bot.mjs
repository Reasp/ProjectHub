#!/usr/bin/env node
/**
 * ProjectHub Telegram Bot & Mini App Server
 *
 * Автономный бот на чистом Node.js (без тяжелых внешних зависимостей, нативный fetch),
 * предоставляющий запуск Telegram Mini App и уведомления владельца о событиях в ProjectHub.
 */
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_FILE = path.join(process.cwd(), '.projecthub-telegram.json');

function loadConfig() {
  let cfg = {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedUsers: process.env.TELEGRAM_ALLOWED_USERS || '',
    miniAppUrl: process.env.PROJECTHUB_MINIAPP_URL || '',
    hubPort: Number(process.env.PROJECTHUB_PORT || 42050),
    hubHost: process.env.PROJECTHUB_HOST || '127.0.0.1',
    // Мастер-ключ Remote Control этого хоста (тот же `secretToken` из бейджа Remote Control) —
    // требуется для /api/federation/* с TASK-65 (decision-5 п.5: аутентификация на каждом
    // сетевом эндпоинте). Без него доступен только урезанный публичный /api/status.
    hostToken: process.env.PROJECTHUB_HOST_TOKEN || ''
  };

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      cfg = { ...cfg, ...saved };
    } catch (e) {
      console.warn('[TelegramBot] Ошибка чтения .projecthub-telegram.json:', e.message);
    }
  }

  return cfg;
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
function fetchHub(pathname) {
  const headers = config.hostToken ? { Authorization: `Bearer ${config.hostToken}` } : undefined;
  return fetch(`http://${config.hubHost}:${config.hubPort}${pathname}`, { headers });
}

function isUserAllowed(from) {
  if (!config.allowedUsers) return true;
  const allowed = config.allowedUsers.split(',').map((s) => s.trim().toLowerCase().replace(/^@/, ''));
  if (from.id && allowed.includes(String(from.id))) return true;
  if (from.username && allowed.includes(from.username.toLowerCase())) return true;
  return false;
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
            { text: '📊 Статус хоста', callback_data: 'status' }
          ]
        ]
      }
    });
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

async function handleCallbackQuery(query) {
  const chatId = query.message?.chat?.id;
  const data = query.data;
  if (!chatId) return;

  if (data === 'status') {
    try {
      const res = await fetch(`http://${config.hubHost}:${config.hubPort}/api/status`);
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
    } catch (e) {
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
