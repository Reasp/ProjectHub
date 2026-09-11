#!/usr/bin/env node
/**
 * Обёртка `npm run telegram-bot` над воркером бота.
 *
 * Сама реализация лежит в `electron/workers/telegramBot.mjs`: только каталог воркеров попадает
 * в упакованное приложение (`dist-electron/workers`), откуда `telegramService` запускает бота
 * через `processManager` (TASK-63). Ручной запуск читает конфиг из `.projecthub-telegram.json`
 * рабочего каталога, как и раньше.
 */
import '../electron/workers/telegramBot.mjs';
