import http, { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { BrowserWindow } from 'electron';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { projectRegistry } from './projectRegistry.js';
import { processManager } from './processManager.js';
import {
  claudeBridgeService,
  CLI_HITL_PERMISSION_TOOL,
  CLI_HITL_QUERY_PARAM,
  type CliPermissionDecision,
  type CliPermissionEndpoint
} from './claudeBridgeService.js';
import matter from 'gray-matter';

export interface McpServerStatus {
  isRunning: boolean;
  port: number;
  activeSessions: number;
  token: string;
  url: string;
  /** Последняя ошибка запуска (например, не удалось подобрать свободный порт). */
  lastError: string | null;
}

/** Публичная часть статуса, отдаваемая по HTTP без аутентификации (без токена). */
export type McpServerPublicStatus = Omit<McpServerStatus, 'token'>;

const REMOTE_ACTION_TYPES: ReadonlySet<RemoteActionPayload['type']> = new Set([
  'switch_project',
  'switch_tab',
  'send_studio_prompt',
  'approve_action',
  'open_terminal',
  'refresh_tasks'
]);

/** Сколько последовательных портов пробовать при EADDRINUSE, прежде чем сдаться. */
const MAX_PORT_ATTEMPTS = 10;

export interface RemoteActionPayload {
  type:
    | 'switch_project'
    | 'switch_tab'
    | 'send_studio_prompt'
    | 'approve_action'
    | 'open_terminal'
    | 'refresh_tasks';
  payload: any;
}

interface SseSession {
  transport: SSEServerTransport;
  /** Свой McpServer на подключение: SDK привязывает ответы к последнему подключённому транспорту. */
  mcpServer: McpServer;
  /** Сессия AI Studio, для которой Claude CLI запрашивает разрешения (query-параметр SSE-URL). */
  hitlSessionId?: string;
}

class McpServerService {
  private server: http.Server | null = null;
  private sseSessions = new Map<string, SseSession>();
  private port = 42042;
  private token: string;
  private lastError: string | null = null;
  private currentAppState = {
    activeProject: null as any,
    activeTab: 'kanban'
  };

  constructor() {
    this.token = `ph_mcp_${crypto.randomBytes(12).toString('hex')}`;
  }

  public setAppState(state: { activeProject?: any; activeTab?: string }) {
    if (state.activeProject !== undefined) this.currentAppState.activeProject = state.activeProject;
    if (state.activeTab !== undefined) this.currentAppState.activeTab = state.activeTab;
  }

  public getStatus(): McpServerStatus {
    return {
      isRunning: Boolean(this.server && this.server.listening),
      port: this.port,
      activeSessions: this.sseSessions.size,
      token: this.token,
      url: `http://127.0.0.1:${this.port}/sse`,
      lastError: this.lastError
    };
  }

  /** Статус без секретов — для неаутентифицированного GET /api/status. */
  public getPublicStatus(): McpServerPublicStatus {
    const { token: _token, ...publicStatus } = this.getStatus();
    return publicStatus;
  }

  public regenerateToken(): string {
    this.token = `ph_mcp_${crypto.randomBytes(12).toString('hex')}`;
    this.broadcastStatus();
    return this.token;
  }

  /**
   * Push-статус в рендерер (`mcp:statusChanged`) при старте/остановке сервера, смене токена
   * и подключении/отключении SSE-сессий — вместо опроса `mcp:getStatus` по таймеру (аудит 3.9).
   */
  private broadcastStatus() {
    const status = this.getStatus();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('mcp:statusChanged', status);
      }
    }
  }

  /**
   * Адрес для --permission-prompt-tool Claude CLI (TASK-42): поднимает сервер, если он не
   * запущен. null — запустить не удалось (см. lastError).
   */
  public async ensurePermissionEndpoint(): Promise<CliPermissionEndpoint | null> {
    if (!(this.server && this.server.listening)) {
      const ok = await this.start(this.port);
      if (!ok) return null;
    }
    return { url: `http://127.0.0.1:${this.port}/sse`, token: this.token };
  }

  private dispatchToRenderer(action: RemoteActionPayload) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('mcp:remoteAction', action);
      }
    }
  }

  public async start(customPort = 42042): Promise<boolean> {
    if (this.server && this.server.listening) return true;

    this.port = customPort;
    this.lastError = null;

    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      let attempts = 0;
      let settled = false;

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        this.lastError = message;
        console.error(`[MCPServer] ${message}`);
        try {
          server.close();
        } catch {}
        this.broadcastStatus();
        resolve(false);
      };

      server.on('listening', () => {
        if (settled) return;
        settled = true;
        console.log(`[MCPServer] ProjectHub Remote MCP Server running at http://127.0.0.1:${this.port}/sse`);
        this.server = server;
        this.broadcastStatus();
        resolve(true);
      });

      server.on('error', (err: any) => {
        if (settled) {
          // Ошибка уже работающего сервера — не трогаем результат start(), только логируем.
          console.error('[MCPServer] HTTP server error:', err);
          return;
        }
        if (err?.code === 'EADDRINUSE') {
          attempts++;
          if (attempts >= MAX_PORT_ATTEMPTS) {
            fail(
              `Не удалось найти свободный порт: заняты ${customPort}–${this.port} (${MAX_PORT_ATTEMPTS} попыток)`
            );
            return;
          }
          console.warn(`[MCPServer] Port ${this.port} is in use, trying ${this.port + 1}...`);
          this.port++;
          server.listen(this.port, '127.0.0.1');
          return;
        }
        fail(`Не удалось запустить HTTP-сервер: ${err?.message || String(err)}`);
      });

      server.listen(this.port, '127.0.0.1');
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;

    for (const session of this.sseSessions.values()) {
      try {
        await session.mcpServer.close();
      } catch {}
      try {
        await session.transport.close();
      } catch {}
    }
    this.sseSessions.clear();

    const srv = this.server;
    this.server = null;

    if (typeof srv.closeAllConnections === 'function') {
      try {
        srv.closeAllConnections();
      } catch {}
    }

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, 500);

      srv.close(() => {
        clearTimeout(timer);
        console.log('[MCPServer] Remote MCP Server stopped');
        resolve();
      });
    }).then(() => this.broadcastStatus());
  }

  /**
   * Создаёт McpServer для одного SSE-подключения. `hitlSessionId` задан, если подключился
   * Claude CLI сессии AI Studio (URL /sse?phSession=...): тогда инструмент разрешений
   * отвечает от имени именно этой сессии.
   */
  private createMcpServer(hitlSessionId?: string): McpServer {
    const server = new McpServer({
      name: 'projecthub-remote-control',
      version: '2.5.0'
    });

    // ─────────────────────────────────────────────────────────────
    // 0. Permission prompt tool для Claude CLI (--permission-prompt-tool, TASK-42)
    // ─────────────────────────────────────────────────────────────
    server.registerTool(
      CLI_HITL_PERMISSION_TOOL,
      {
        title: 'Запрос разрешения Claude Code (Human-in-the-Loop)',
        description:
          'Служебный инструмент для флага --permission-prompt-tool Claude CLI: показывает карточку одобрения '
          + 'в AI Studio ProjectHub и возвращает решение пользователя. Не предназначен для вызова моделью.',
        inputSchema: {
          tool_name: z.string().describe('Имя инструмента Claude Code (Bash, Edit, Write, AskUserQuestion …)'),
          input: z.record(z.any()).optional().describe('Вход инструмента'),
          tool_use_id: z.string().optional()
        }
      },
      async ({ tool_name, input, tool_use_id }) => {
        let decision: CliPermissionDecision;
        if (!hitlSessionId) {
          decision = {
            behavior: 'deny',
            message: `ProjectHub: подключение не привязано к сессии AI Studio (нет параметра ${CLI_HITL_QUERY_PARAM} в URL SSE).`
          };
        } else {
          try {
            decision = await claudeBridgeService.handleCliPermissionRequest(hitlSessionId, {
              tool_name,
              input: input ?? {},
              tool_use_id
            });
          } catch (err: any) {
            console.error('[MCPServer] permission_prompt failed:', err);
            decision = { behavior: 'deny', message: `ProjectHub: ошибка обработки запроса разрешения: ${err?.message || String(err)}` };
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(decision) }] };
      }
    );

    // ─────────────────────────────────────────────────────────────
    // 1. Get Application & GUI State
    // ─────────────────────────────────────────────────────────────
    server.registerTool(
      'projecthub_get_app_state',
      {
        title: 'Текущее состояние ProjectHub GUI',
        description: 'Возвращает текущее состояние приложения: открытый проект, экранную вкладку и статус.',
        inputSchema: {}
      },
      async () => {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  activeProject: this.currentAppState.activeProject,
                  activeTab: this.currentAppState.activeTab,
                  mcpServer: this.getStatus()
                },
                null,
                2
              )
            }
          ]
        };
      }
    );

    // ─────────────────────────────────────────────────────────────
    // 2. List Projects
    // ─────────────────────────────────────────────────────────────
    server.registerTool(
      'projecthub_list_projects',
      {
        title: 'Список проектов в ProjectHub',
        description: 'Возвращает реестр всех добавленных проектов с метаданными и путями на диске.',
        inputSchema: {}
      },
      async () => {
        const config = await projectRegistry.getConfig();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(config.projects, null, 2)
            }
          ]
        };
      }
    );

    // ─────────────────────────────────────────────────────────────
    // 3. Switch Project in GUI
    // ─────────────────────────────────────────────────────────────
    server.registerTool(
      'projecthub_switch_project',
      {
        title: 'Переключить проект в окне ProjectHub',
        description: 'Выбирает проект и открывает его в графическом интерфейсе приложения.',
        inputSchema: {
          projectPath: z.string().describe('Абсолютный путь к каталогу проекта или его имя')
        }
      },
      async ({ projectPath }) => {
        this.dispatchToRenderer({
          type: 'switch_project',
          payload: { query: projectPath }
        });
        return {
          content: [
            {
              type: 'text',
              text: `Команда переключения проекта на "${projectPath}" успешно передана в интерфейс ProjectHub.`
            }
          ]
        };
      }
    );

    // ─────────────────────────────────────────────────────────────
    // 4. Switch Tab in GUI
    // ─────────────────────────────────────────────────────────────
    server.registerTool(
      'projecthub_switch_tab',
      {
        title: 'Переключить вкладку в ProjectHub',
        description: 'Переключает видимую вкладку в приложении (ai, kanban, git, docs, terminal).',
        inputSchema: {
          tab: z.enum(['ai', 'kanban', 'git', 'docs', 'terminal', 'analytics']).describe('Название вкладки')
        }
      },
      async ({ tab }) => {
        this.dispatchToRenderer({
          type: 'switch_tab',
          payload: { tab }
        });
        return {
          content: [
            {
              type: 'text',
              text: `Вкладка приложения переключена на "${tab}".`
            }
          ]
        };
      }
    );

    // ─────────────────────────────────────────────────────────────
    // 5. Send Prompt to Claude Studio
    // ─────────────────────────────────────────────────────────────
    server.registerTool(
      'projecthub_send_studio_prompt',
      {
        title: 'Отправить промпт в Claude AI Studio',
        description: 'Вставляет или отправляет задачу AI-агенту в Claude Studio открытого проекта.',
        inputSchema: {
          prompt: z.string().describe('Текст задачи/промпта для агента'),
          sendImmediately: z.boolean().optional().describe('Отправить сразу (true) или только вставить в поле ввода (false)')
        }
      },
      async ({ prompt, sendImmediately = true }) => {
        this.dispatchToRenderer({
          type: 'send_studio_prompt',
          payload: { prompt, sendImmediately }
        });
        return {
          content: [
            {
              type: 'text',
              text: `Промпт успешно передан в Claude AI Studio (${sendImmediately ? 'отправлен' : 'вставлен'}).`
            }
          ]
        };
      }
    );

    // ─────────────────────────────────────────────────────────────
    // 6. Approve / Reject Human-in-the-Loop Action
    // ─────────────────────────────────────────────────────────────
    server.registerTool(
      'projecthub_approve_action',
      {
        title: 'Одобрить или отклонить действие агента',
        description: 'Отвечает на активный запрос подтверждения (Human-in-the-Loop) в карточке одобрений.',
        inputSchema: {
          requestId: z.string().optional().describe('ID запроса (если опущен, берется первый активный)'),
          approved: z.boolean().describe('Одобрить (true) или отклонить (false)'),
          reason: z.string().optional().describe('Опциональное текстовое пояснение или выбранный вариант')
        }
      },
      async ({ requestId, approved, reason }) => {
        this.dispatchToRenderer({
          type: 'approve_action',
          payload: { requestId, approved, reason }
        });
        return {
          content: [
            {
              type: 'text',
              text: `Решение "${approved ? 'Одобрено' : 'Отклонено'}" отправлено агенту.`
            }
          ]
        };
      }
    );

    // ─────────────────────────────────────────────────────────────
    // 7. Run Background Process
    // ─────────────────────────────────────────────────────────────
    server.registerTool(
      'projecthub_run_process',
      {
        title: 'Запустить фоновый процесс',
        description: 'Запускает команду (dev-сервер, тесты, сборку) с отслеживанием в Process Manager.',
        inputSchema: {
          projectPath: z.string().describe('Абсолютный путь к каталогу проекта'),
          command: z.string().describe('Строка запускаемой команды'),
          name: z.string().describe('Уникальное имя процесса (например, "dev", "test")')
        }
      },
      async ({ projectPath, command, name }) => {
        const proc = await processManager.startProcess(projectPath, command, name);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(proc, null, 2)
            }
          ]
        };
      }
    );

    // ─────────────────────────────────────────────────────────────
    // 8. Stop Background Process
    // ─────────────────────────────────────────────────────────────
    server.registerTool(
      'projecthub_stop_process',
      {
        title: 'Остановить фоновый процесс',
        description: 'Останавливает процесс по его ID или имени.',
        inputSchema: {
          processId: z.string().describe('ID процесса вида path::name')
        }
      },
      async ({ processId }) => {
        const stopped = await processManager.stopProcess(processId);
        return {
          content: [
            {
              type: 'text',
              text: stopped ? `Процесс ${processId} остановлен.` : `Процесс ${processId} не найден.`
            }
          ]
        };
      }
    );

    // ─────────────────────────────────────────────────────────────
    // 9. Get Process Logs
    // ─────────────────────────────────────────────────────────────
    server.registerTool(
      'projecthub_get_process_logs',
      {
        title: 'Получить логи процесса',
        description: 'Возвращает буфер последних строк вывода процесса.',
        inputSchema: {
          processId: z.string().describe('ID процесса вида path::name'),
          lines: z.number().optional().describe('Количество последних строк (по умолчанию 50)')
        }
      },
      async ({ processId, lines = 50 }) => {
        const allLogs = processManager.getLogs(processId);
        const tail = allLogs.slice(-lines);
        return {
          content: [
            {
              type: 'text',
              text: tail.join('') || 'Нет вывода'
            }
          ]
        };
      }
    );

    // ─────────────────────────────────────────────────────────────
    // 10. List Backlog Tasks
    // ─────────────────────────────────────────────────────────────
    server.registerTool(
      'projecthub_list_tasks',
      {
        title: 'Список задач бэклога',
        description: 'Возвращает список задач из папки backlog/tasks/ проекта.',
        inputSchema: {
          projectPath: z.string().describe('Путь к проекту'),
          status: z.string().optional().describe('Фильтр по статусу (To Do, In Progress, Review, Done)')
        }
      },
      async ({ projectPath, status }) => {
        const tasksDir = path.join(projectPath, 'backlog', 'tasks');
        const list: any[] = [];
        if (existsSync(tasksDir)) {
          const files = await fs.readdir(tasksDir);
          for (const f of files) {
            if (f.endsWith('.md')) {
              try {
                const raw = await fs.readFile(path.join(tasksDir, f), 'utf-8');
                const parsed = matter(raw);
                if (!status || parsed.data.status?.toLowerCase() === status.toLowerCase()) {
                  list.push({
                    file: f,
                    id: parsed.data.id || f.split(' - ')[0],
                    title: parsed.data.title,
                    status: parsed.data.status,
                    priority: parsed.data.priority,
                    labels: parsed.data.labels
                  });
                }
              } catch {}
            }
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(list, null, 2)
            }
          ]
        };
      }
    );

    return server;
  }

  /**
   * Host должен указывать на loopback — защита от DNS rebinding
   * (страница на evil.com с A-записью 127.0.0.1 присылает Host: evil.com).
   */
  private isLoopbackHost(hostHeader: string | undefined): boolean {
    if (!hostHeader) return false;
    let hostname: string;
    try {
      hostname = new URL(`http://${hostHeader}`).hostname;
    } catch {
      return false;
    }
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
  }

  /** Сравнение Bearer-токена за константное время. */
  private isAuthorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization;
    if (!header || Array.isArray(header)) return false;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) return false;
    const presented = Buffer.from(match[1].trim(), 'utf8');
    const expected = Buffer.from(this.token, 'utf8');
    if (presented.length !== expected.length) return false;
    return crypto.timingSafeEqual(presented, expected);
  }

  private sendJson(res: ServerResponse, statusCode: number, body: unknown, extraHeaders: Record<string, string> = {}) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
    res.end(JSON.stringify(body, null, 2));
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
    // CORS-заголовки не выставляются вовсе: сервер предназначен только для локальных
    // CLI/десктоп-клиентов (Claude Code, Cursor и т.п.), а не для браузерных страниц.
    // Любой запрос с заголовком Origin — это браузер (в т.ч. preflight OPTIONS), отклоняем.
    if (req.headers.origin !== undefined) {
      this.sendJson(res, 403, { error: 'Browser origins are not allowed' });
      return;
    }

    if (!this.isLoopbackHost(req.headers.host)) {
      this.sendJson(res, 403, { error: 'Invalid Host header' });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);
    const pathname = parsedUrl.pathname;

    // 1. Status Endpoint: GET /api/status — единственный маршрут без аутентификации, без токена в ответе.
    if (pathname === '/api/status' && req.method === 'GET') {
      this.sendJson(res, 200, this.getPublicStatus());
      return;
    }

    // Все остальные маршруты требуют Authorization: Bearer <token>.
    if (!this.isAuthorized(req)) {
      this.sendJson(res, 401, { error: 'Unauthorized: valid Bearer token required' }, {
        'WWW-Authenticate': 'Bearer realm="ProjectHub MCP"'
      });
      return;
    }

    // 2. Direct Action REST Endpoint: POST /api/action
    if (pathname === '/api/action' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (!json || typeof json !== 'object' || !REMOTE_ACTION_TYPES.has(json.type)) {
            this.sendJson(res, 400, { error: `Unknown action type; allowed: ${[...REMOTE_ACTION_TYPES].join(', ')}` });
            return;
          }
          this.dispatchToRenderer({ type: json.type, payload: json.payload ?? {} });
          this.sendJson(res, 200, { ok: true });
        } catch (e: any) {
          this.sendJson(res, 400, { error: e.message });
        }
      });
      return;
    }

    // 3. /mcp.json намеренно удалён: конфиг-сниппет с токеном копируется только из UI (McpServerStatusBadge).

    // 4. SSE Stream: GET /sse
    if (pathname === '/sse' && req.method === 'GET') {
      const hitlSessionId = parsedUrl.searchParams.get(CLI_HITL_QUERY_PARAM) || undefined;
      console.log(`[MCPServer] New client connected to SSE stream${hitlSessionId ? ` (HITL для сессии ${hitlSessionId})` : ''}`);
      const transport = new SSEServerTransport('/message', res);
      const sessionId = transport.sessionId;
      const mcpServer = this.createMcpServer(hitlSessionId);
      this.sseSessions.set(sessionId, { transport, mcpServer, hitlSessionId });
      this.broadcastStatus();

      transport.onclose = () => {
        console.log(`[MCPServer] SSE Session ${sessionId} closed`);
        this.sseSessions.delete(sessionId);
        this.broadcastStatus();
      };

      // connect() сам вызывает transport.start(); повторный явный start() давал
      // ошибку "SSEServerTransport already started" в логе на каждое подключение.
      mcpServer.connect(transport).catch((err) => {
        console.error('[MCPServer] Error connecting transport to MCP server:', err);
      });
      return;
    }

    // 5. SSE POST Message: POST /message?sessionId=...
    if (pathname === '/message' && req.method === 'POST') {
      const sessionId = parsedUrl.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400).end('Missing sessionId query param');
        return;
      }

      const session = this.sseSessions.get(sessionId);
      if (!session) {
        res.writeHead(404).end(`Session ${sessionId} not found`);
        return;
      }

      session.transport.handlePostMessage(req as any, res).catch((err) => {
        console.error('[MCPServer] Error handling POST message:', err);
        if (!res.headersSent) {
          res.writeHead(500).end(err.message);
        }
      });
      return;
    }

    // 404 Fallback
    res.writeHead(404).end('Not found');
  }
}

export const mcpServerService = new McpServerService();
