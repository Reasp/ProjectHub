/**
 * Исходник скрипта `.projecthub/hooks/projecthub-hook.mjs`, который синхронизация кладёт в проект
 * (TASK-77, decision-54 п. 3, 8). Скрипт не содержит политики: пересылает вход хука встроенному серверу
 * ProjectHub и печатает готовый ответ. При недоступном ProjectHub — fail-open (по умолчанию) или fail-closed.
 *
 * Текст хранится как `String.raw` без обратных кавычек и `${`, чтобы экранирование совпадало с файлом.
 */
import { withMarker } from './roleExport.js';

export const HOOK_SCRIPT_SOURCE = String.raw`// Хук терминальной сессии Claude Code / Codex → ProjectHub (TASK-77, decision-54).
// Пересылает вход хука встроенному серверу ProjectHub и печатает готовый ответ движку. Политики здесь нет:
// решения принимает ProjectHub (политика роли, очередь HITL, аудит).
//
// Окружение (в файлы проекта не пишется):
//   PROJECTHUB_HOOK_URL        адрес встроенного сервера, по умолчанию http://127.0.0.1:42042
//   PROJECTHUB_HOOK_TOKEN      токен хуков (ProjectHub → Роли → Синхронизация); подходит и PROJECTHUB_MCP_TOKEN
//   PROJECTHUB_HOOK_FAIL_MODE  open (по умолчанию) — при недоступном ProjectHub не мешать работе;
//                              closed — отклонять вызовы инструментов, пока ProjectHub недоступен
//   PROJECTHUB_HOOK_LOG        файл лога, по умолчанию <tmp>/projecthub-hook.log (ротация 1 МБ)
// Нужен Node.js 18+, зависимостей нет. Аргументы: <claude|codex> --budget <тайм-аут хука, с>.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const engine = argv[0] === 'codex' ? 'codex' : 'claude';
const budgetIndex = argv.indexOf('--budget');
const budgetSec = budgetIndex >= 0 ? Number(argv[budgetIndex + 1]) : 600;
// Ответ — за 15 с до тайм-аута хука: по тайм-ауту движок выполнил бы инструмент без решения.
const budgetMs = Math.max((Number.isFinite(budgetSec) && budgetSec > 0 ? budgetSec : 600) * 1000 - 15000, 5000);
const baseUrl = (process.env.PROJECTHUB_HOOK_URL || 'http://127.0.0.1:42042').replace(/\/+$/, '');
const token = process.env.PROJECTHUB_HOOK_TOKEN || process.env.PROJECTHUB_MCP_TOKEN || '';
const failMode = process.env.PROJECTHUB_HOOK_FAIL_MODE === 'closed' ? 'closed' : 'open';
const logFile = process.env.PROJECTHUB_HOOK_LOG || path.join(os.tmpdir(), 'projecthub-hook.log');

function log(message) {
  try {
    try {
      if (fs.statSync(logFile).size > 1048576) fs.renameSync(logFile, logFile + '.1');
    } catch {}
    fs.appendFileSync(logFile, new Date().toISOString() + ' [' + engine + '] ' + message + '\n');
  } catch {}
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function finish(out) {
  if (out && out.stdout) process.stdout.write(String(out.stdout));
  if (out && out.stderr) process.stderr.write(String(out.stderr) + '\n');
  process.exitCode = out && typeof out.exitCode === 'number' ? out.exitCode : 0;
}

function denyOutput(eventName, reason) {
  if (eventName !== 'PreToolUse') return { exitCode: 0 };
  if (engine === 'codex') return { exitCode: 2, stderr: reason };
  return {
    exitCode: 0,
    stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })
  };
}

function unavailable(eventName, reason) {
  log('ProjectHub недоступен (' + (eventName || '?') + ', режим ' + failMode + '): ' + reason);
  if (failMode === 'closed') return denyOutput(eventName, 'ProjectHub недоступен (режим fail-closed): ' + reason);
  return { exitCode: 0 };
}

const raw = await readStdin();
let payload = null;
try {
  payload = JSON.parse(raw);
} catch {
  payload = null;
}
const eventName = payload && typeof payload.hook_event_name === 'string' ? payload.hook_event_name : '';

if (!payload || typeof payload !== 'object') {
  log('вход хука не JSON — пропущено');
  finish({ exitCode: 0 });
} else if (!token) {
  finish(unavailable(eventName, 'не задан PROJECTHUB_HOOK_TOKEN'));
} else {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  try {
    const res = await fetch(baseUrl + '/api/hooks/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ engine, projectDir, payload, budgetMs }),
      signal: AbortSignal.timeout(budgetMs)
    });
    if (res.status === 401) finish(unavailable(eventName, 'токен хуков не подходит (HTTP 401)'));
    else if (!res.ok) finish(unavailable(eventName, 'HTTP ' + res.status));
    else finish(await res.json());
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // Сервер принял запрос, но решения нет в срок: это отказ, а не недоступность (decision-10 п. 2).
      log('нет ответа за ' + Math.round(budgetMs / 1000) + ' с (' + (eventName || '?') + ') — отказ');
      finish(denyOutput(eventName, 'ProjectHub: нет решения за ' + Math.round(budgetMs / 1000) + ' с — вызов отклонён'));
    } else {
      const code = (err && err.cause && err.cause.code) || (err && err.message) || String(err);
      finish(unavailable(eventName, String(code)));
    }
  }
}
`;

/** Содержимое файла скрипта с маркером генерации. */
export function hookScriptFile(): string {
  return withMarker(HOOK_SCRIPT_SOURCE, '//');
}
