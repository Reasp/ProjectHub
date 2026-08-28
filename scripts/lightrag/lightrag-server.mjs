import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { requireFeature } from '../config.mjs';

requireFeature('lightrag');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENV_PYTHON =
  process.platform === 'win32'
    ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '.venv', 'bin', 'python');

function runPython(script, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      VENV_PYTHON,
      [path.join(__dirname, script), ...args],
      { cwd: __dirname, maxBuffer: 20 * 1024 * 1024, timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout.trim());
        }
      },
    );
  });
}

const server = new McpServer({ name: 'docs-graph', version: '0.1.0' });

server.registerTool(
  'search_docs_graph',
  {
    title: 'Графовый поиск по документации (LightRAG)',
    description:
      'Отвечает на вопрос, используя граф сущностей/связей документации (LightRAG), построенный ' +
      'локальной LLM через Ollama. В отличие от search_docs (простой смысловой поиск фрагментов), ' +
      'этот инструмент хорошо отвечает на вопросы про связи между понятиями ("как X связано с Y", ' +
      '"что зависит от Z"). Требует, чтобы граф уже был построен (reindex_docs_graph или ' +
      '`python scripts/lightrag/index_docs.py`) — иначе вернёт ошибку.',
    inputSchema: {
      query: z.string().describe('Вопрос на естественном языке'),
      mode: z
        .enum(['local', 'global', 'hybrid', 'naive', 'mix'])
        .optional()
        .describe('Режим поиска LightRAG, по умолчанию "mix" (граф + вектора)'),
    },
  },
  async ({ query, mode }) => {
    const answer = await runPython('query.py', [query, mode ?? 'mix'], 4 * 60 * 1000);
    return { content: [{ type: 'text', text: answer }] };
  },
);

server.registerTool(
  'reindex_docs_graph',
  {
    title: 'Перестроить граф документации (LightRAG)',
    description:
      'Запускает scripts/lightrag/index_docs.py — обходит backlog/docs/, backlog/decisions/ и ' +
      'извлекает сущности/связи через локальную LLM (Ollama). Медленно (минуты, не секунды — LLM-вызов ' +
      'на чанк), в отличие от reindex_docs у docs-rag. Использовать после заметных изменений в докам, ' +
      'не после каждой мелкой правки.',
    inputSchema: {},
  },
  async () => {
    const output = await runPython('index_docs.py', [], 30 * 60 * 1000);
    return { content: [{ type: 'text', text: output }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
