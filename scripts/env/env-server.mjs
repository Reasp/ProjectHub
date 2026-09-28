import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { startProcess, stopProcess, listProcesses, tailLog } from './process-manager.mjs';
import { ROOT } from './state.mjs';
import { requireFeature } from '../config.mjs';

requireFeature('envTools');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = new McpServer({ name: 'env-tools', version: '0.1.0' });

server.registerTool(
  'start_process',
  {
    title: 'Запустить фоновый процесс проекта',
    description:
      'Запускает долгоживущий процесс (dev-сервер, вотчер и т.п.) в фоне, с трекингом pid и ' +
      'логов в .env-state/. Предпочтительнее произвольного фонового Bash-запуска — так процесс ' +
      'виден другим сессиям/агентам через list_processes, и не будет запущен дубликат на том же имени.',
    inputSchema: {
      name: z.string().describe('Уникальное имя процесса, например "dev-server"'),
      command: z.string().describe('Команда для запуска, например "npm run dev"'),
      cwd: z.string().optional().describe('Рабочая директория (по умолчанию корень проекта)'),
    },
  },
  async ({ name, command, cwd }) => {
    const entry = startProcess({ name, command, cwd });
    return {
      content: [{ type: 'text', text: `Запущен "${name}" (pid ${entry.pid}): ${entry.command}` }],
    };
  },
);

server.registerTool(
  'stop_process',
  {
    title: 'Остановить фоновый процесс проекта',
    description:
      'Останавливает процесс, ранее запущенный через start_process, по имени, и удаляет запись из реестра. ' +
      'Процесс убивается, только если его pid подтверждённо принадлежит этой записи (сверка времени старта); ' +
      'запись с переиспользованным или непроверяемым pid просто удаляется.',
    inputSchema: { name: z.string().describe('Имя процесса, как при запуске') },
  },
  async ({ name }) => {
    const { pid, status } = stopProcess({ name });
    const text = {
      running: `Остановлен: ${name} (pid ${pid})`,
      dead: `Процесс "${name}" уже не работал (pid ${pid} свободен или занят другим процессом); запись удалена.`,
      unknown:
        `Запись "${name}" удалена, процесс не останавливался: pid ${pid} занят, но запись без времени старта ` +
        `(создана до сверки идентичности) — это может быть чужой процесс. Если он ваш, остановите его вручную.`,
    }[status];
    return { content: [{ type: 'text', text }] };
  },
);

server.registerTool(
  'list_processes',
  {
    title: 'Список фоновых процессов проекта',
    description:
      'Показывает все процессы, запущенные через start_process, и живы ли они сейчас. ' +
      'Попутно удаляет из реестра записи, мёртвые без активности больше 7 дней.',
    inputSchema: {},
  },
  async () => {
    const { processes, pruned } = listProcesses();
    const label = {
      running: 'работает',
      dead: 'НЕ работает',
      unknown: 'неизвестно (pid занят, запись без времени старта — возможно, чужой процесс)',
    };
    const lines = processes.map((p) => `${p.name} — pid ${p.pid}, ${label[p.status]}, команда: ${p.command}`);
    if (lines.length === 0) lines.push('Нет отслеживаемых процессов.');
    if (pruned.length > 0) {
      const shown = pruned.slice(0, 10).join(', ') + (pruned.length > 10 ? ', …' : '');
      lines.push(`Удалены мёртвые записи старше 7 дней (${pruned.length}): ${shown}`);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

server.registerTool(
  'tail_log',
  {
    title: 'Прочитать хвост лога процесса',
    description: 'Возвращает последние строки лога процесса, запущенного через start_process.',
    inputSchema: {
      name: z.string().describe('Имя процесса'),
      lines: z.number().int().min(1).max(2000).optional().describe('Сколько строк с конца (по умолчанию 100)'),
    },
  },
  async ({ name, lines }) => {
    const text = tailLog({ name, lines: lines ?? 100 });
    return { content: [{ type: 'text', text: text || '(лог пуст)' }] };
  },
);

server.registerTool(
  'reindex_docs',
  {
    title: 'Пересобрать векторный индекс документации',
    description:
      'Запускает scripts/rag/index-docs.mjs синхронно и возвращает вывод. Использовать после ' +
      'заметных изменений в backlog/docs/**, backlog/decisions/**.',
    inputSchema: {},
  },
  async () => {
    const output = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [path.join(__dirname, '../rag/index-docs.mjs')],
        { cwd: ROOT, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          resolve(`${stdout}${stderr}${error ? `\n[ошибка] ${error.message}` : ''}`);
        },
      );
    });
    return { content: [{ type: 'text', text: output.trim() }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
