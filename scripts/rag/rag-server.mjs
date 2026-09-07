import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { connect } from '@lancedb/lancedb';
import { embedQuery, readIndexModel } from './embed.mjs';
import { PROJECT_ROOT, requireFeature } from '../config.mjs';

requireFeature('docsRag');

const ROOT = PROJECT_ROOT;
const INDEX_DIR = path.join(ROOT, '.rag-index');
const TABLE_NAME = 'docs';

async function openTable() {
  if (!fs.existsSync(INDEX_DIR)) {
    throw new Error('Индекс не найден. Сначала выполните: npm run index-docs');
  }
  const db = await connect(INDEX_DIR);
  return db.openTable(TABLE_NAME);
}

// Запрос кодируем той же моделью (и с тем же префиксом), которой собран индекс — см. meta.json.
function indexModel() {
  const model = readIndexModel(INDEX_DIR);
  if (!model) throw new Error('В .rag-index/meta.json нет модели. Пересобери индекс: npm run index-docs');
  return model;
}

const server = new McpServer({ name: 'docs-rag', version: '0.1.0' });

server.registerTool(
  'search_docs',
  {
    title: 'Поиск по документации проекта',
    description:
      'Смысловой (векторный) поиск по markdown-документации проекта (backlog/docs/, ' +
      'backlog/decisions/). Использовать перед ответом на вопросы про архитектуру, конвенции ' +
      'и устройство подсистем — вместо того чтобы полагаться только на память. Не индексирует ' +
      'код — для кода используйте GitNexus.',
    inputSchema: {
      query: z.string().describe('Поисковый запрос на естественном языке'),
      topK: z.number().int().min(1).max(20).optional().describe('Число результатов (по умолчанию 5)'),
    },
  },
  async ({ query, topK }) => {
    const table = await openTable();
    const vector = await embedQuery(query, indexModel());
    const results = await table.search(vector).limit(topK ?? 5).toArray();

    if (results.length === 0) {
      return { content: [{ type: 'text', text: 'Ничего не найдено.' }] };
    }

    const text = results
      .map(
        (r) =>
          `### ${r.file} — "${r.heading || '(без заголовка)'}" (чанк ${r.chunk_index})\n${r.text}`,
      )
      .join('\n\n---\n\n');
    return { content: [{ type: 'text', text }] };
  },
);

server.registerTool(
  'list_docs',
  {
    title: 'Список проиндексированных документов',
    description: 'Возвращает список всех файлов документации, попавших в векторный индекс.',
    inputSchema: {},
  },
  async () => {
    const metaPath = path.join(INDEX_DIR, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      throw new Error('Индекс не найден. Сначала выполните: npm run index-docs');
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return { content: [{ type: 'text', text: meta.files.join('\n') }] };
  },
);

server.registerTool(
  'get_doc',
  {
    title: 'Прочитать документ целиком',
    description:
      'Возвращает полное содержимое одного файла документации по относительному пути ' +
      '(как в результатах search_docs/list_docs), когда фрагмента из поиска недостаточно.',
    inputSchema: {
      file: z.string().describe('Относительный путь к файлу, например backlog/docs/rag-guide.md'),
    },
  },
  async ({ file }) => {
    const abs = path.resolve(ROOT, file);
    if (!abs.startsWith(ROOT) || !fs.existsSync(abs)) {
      throw new Error(`Файл не найден: ${file}`);
    }
    return { content: [{ type: 'text', text: fs.readFileSync(abs, 'utf-8') }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
