#!/usr/bin/env node
// stdio-мост к инструментам управления компьютером ProjectHub (TASK-82, decision-27 п. 2).
//
// Подключается к встроенному MCP-серверу ProjectHub (HTTP/SSE, Bearer-токен) и отдаёт агенту по
// stdio только инструменты computer_*. Политика, HITL, allowlist, аудит и kill-switch применяются
// в ProjectHub — мост ничего не решает сам. Так фича шаблона computerUse одинаково работает в
// Claude Code (.mcp.json) и Google Antigravity (.agents/mcp_config.json), а токен не попадает в
// коммитящийся конфиг.
//
// Окружение:
//   PROJECTHUB_MCP_TOKEN — Bearer-токен (ProjectHub → бейдж MCP → «Сессионный токен доступа»), обязателен;
//   PROJECTHUB_MCP_URL   — адрес SSE, по умолчанию http://127.0.0.1:42042/sse.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolListChangedNotificationSchema
} from '@modelcontextprotocol/sdk/types.js';

const PREFIX = 'computer_';
const url = process.env.PROJECTHUB_MCP_URL || 'http://127.0.0.1:42042/sse';
const token = process.env.PROJECTHUB_MCP_TOKEN || '';

const log = (...args) => console.error('[computer-use-bridge]', ...args);

const server = new Server(
  { name: 'projecthub-computer', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true } } }
);

let upstream = null;
let upstreamError = token
  ? null
  : 'Не задан PROJECTHUB_MCP_TOKEN: скопируйте токен в ProjectHub (бейдж MCP) и передайте его мосту через переменную окружения.';

async function connectUpstream() {
  if (upstream || !token) return upstream;
  const headers = { Authorization: `Bearer ${token}` };
  const transport = new SSEClientTransport(new URL(url), {
    requestInit: { headers },
    eventSourceInit: { fetch: (input, init) => fetch(input, { ...init, headers: { ...(init?.headers || {}), ...headers } }) }
  });
  const client = new Client({ name: 'projecthub-computer-bridge', version: '1.0.0' });
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    server.sendToolListChanged().catch(() => undefined);
  });
  transport.onclose = () => {
    upstream = null;
  };
  try {
    await client.connect(transport);
    upstream = client;
    upstreamError = null;
    return client;
  } catch (err) {
    upstreamError = `ProjectHub недоступен по ${url}: ${err?.message || err}. Запустите ProjectHub и включите MCP-сервер и управление компьютером.`;
    log(upstreamError);
    return null;
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const client = await connectUpstream();
  if (!client) return { tools: [] };
  const { tools } = await client.listTools();
  return { tools: tools.filter((t) => t.name.startsWith(PREFIX)) };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (!name.startsWith(PREFIX)) {
    return { isError: true, content: [{ type: 'text', text: `Мост отдаёт только инструменты ${PREFIX}*` }] };
  }
  const client = await connectUpstream();
  if (!client) return { isError: true, content: [{ type: 'text', text: upstreamError || 'ProjectHub недоступен' }] };
  // Подтверждение человека может ждать долго — таймаут как у MCP_TOOL_TIMEOUT Claude CLI (24 ч).
  return client.callTool({ name, arguments: args ?? {} }, undefined, { timeout: 24 * 60 * 60_000, resetTimeoutOnProgress: true });
});

await server.connect(new StdioServerTransport());
if (upstreamError) log(upstreamError);
