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
import matter from 'gray-matter';

export interface McpServerStatus {
  isRunning: boolean;
  port: number;
  activeSessions: number;
  token: string;
  url: string;
}

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

class McpServerService {
  private server: http.Server | null = null;
  private mcpServer: McpServer | null = null;
  private sseSessions = new Map<string, SSEServerTransport>();
  private port = 42042;
  private token: string;
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
      url: `http://127.0.0.1:${this.port}/sse`
    };
  }

  public regenerateToken(): string {
    this.token = `ph_mcp_${crypto.randomBytes(12).toString('hex')}`;
    return this.token;
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
    this.initMcpServer();

    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      server.listen(this.port, '127.0.0.1', () => {
        console.log(`[MCPServer] ProjectHub Remote MCP Server running at http://127.0.0.1:${this.port}/sse`);
        this.server = server;
        resolve(true);
      });

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[MCPServer] Port ${this.port} is in use, trying ${this.port + 1}...`);
          this.port++;
          server.listen(this.port, '127.0.0.1');
        } else {
          console.error('[MCPServer] Failed to start HTTP server:', err);
          resolve(false);
        }
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;

    for (const [id, session] of this.sseSessions.entries()) {
      try {
        await session.close();
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

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, 500);

      srv.close(() => {
        clearTimeout(timer);
        console.log('[MCPServer] Remote MCP Server stopped');
        resolve();
      });
    });
  }

  private initMcpServer() {
    const server = new McpServer({
      name: 'projecthub-remote-control',
      version: '2.5.0'
    });

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

    this.mcpServer = server;
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const host = req.headers.host || `127.0.0.1:${this.port}`;
    const parsedUrl = new URL(req.url || '/', `http://${host}`);
    const pathname = parsedUrl.pathname;

    // 1. Status Endpoint: GET /api/status
    if (pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(this.getStatus(), null, 2));
      return;
    }

    // 2. Direct Action REST Endpoint: POST /api/action
    if (pathname === '/api/action' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const json = JSON.parse(body);
          this.dispatchToRenderer(json);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 3. MCP Config JSON snippet: GET /mcp.json
    if (pathname === '/mcp.json' && req.method === 'GET') {
      const configSnippet = {
        mcpServers: {
          projecthub: {
            url: `http://127.0.0.1:${this.port}/sse`,
            transport: 'sse',
            headers: {
              Authorization: `Bearer ${this.token}`
            }
          }
        }
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(configSnippet, null, 2));
      return;
    }

    // 4. SSE Stream: GET /sse
    if (pathname === '/sse' && req.method === 'GET') {
      if (!this.mcpServer) {
        res.writeHead(500).end('MCP Server not initialized');
        return;
      }

      console.log('[MCPServer] New client connected to SSE stream');
      const transport = new SSEServerTransport('/message', res);
      const sessionId = transport.sessionId;
      this.sseSessions.set(sessionId, transport);

      transport.onclose = () => {
        console.log(`[MCPServer] SSE Session ${sessionId} closed`);
        this.sseSessions.delete(sessionId);
      };

      this.mcpServer.connect(transport).catch((err) => {
        console.error('[MCPServer] Error connecting transport to MCP server:', err);
      });

      transport.start().catch((err) => {
        console.error('[MCPServer] Error starting transport:', err);
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

      const transport = this.sseSessions.get(sessionId);
      if (!transport) {
        res.writeHead(404).end(`Session ${sessionId} not found`);
        return;
      }

      transport.handlePostMessage(req as any, res).catch((err) => {
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
