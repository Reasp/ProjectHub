import { ipcMain, shell, dialog } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import type { CreatePtyOptions, AISession } from '../../src/types/electron';
import { ptyService } from '../services/ptyService';
import {
  aiAgentService,
  PROJECT_HUB_CLAUDE_DIR,
  type AIProviderConfig,
  type AIStreamRequest
} from '../services/aiAgentService';
import { claudeBridgeService } from '../services/claudeBridgeService';
import { federationClientService } from '../services/federationClientService';
import { remoteControlService } from '../services/remoteControlService';
import { aiSessionStore } from '../services/aiSessionStore';
import { claudeUsageService } from '../services/claudeUsageService';
import {
  agentFleetService,
  type StartFanOutOptions,
  type StartHandoffOptions,
  type SwarmExportFormat
} from '../services/agentFleetService';
import { assertRegisteredProject } from '../services/projectPathGuard';
import { buildAgentContext } from '../services/contextBuilder';
import type { IpcContext } from './types';

export function registerAiIpc(ctx: IpcContext) {
  // PTY Terminals
  ipcMain.handle('pty:create', async (_event, options: CreatePtyOptions) => {
    return await ptyService.createSession(options);
  });

  ipcMain.handle('pty:write', async (_event, sessionId: string, data: string) => {
    return ptyService.write(sessionId, data);
  });

  ipcMain.handle('pty:resize', async (_event, sessionId: string, cols: number, rows: number) => {
    return ptyService.resize(sessionId, cols, rows);
  });

  ipcMain.handle('pty:kill', async (_event, sessionId: string) => {
    return ptyService.kill(sessionId);
  });

  ipcMain.handle('pty:list', async () => {
    return ptyService.listSessions();
  });

  // AI Config & Auth
  ipcMain.handle('ai:getConfig', async () => {
    return await aiAgentService.getConfig();
  });

  ipcMain.handle('ai:saveConfig', async (_event, config: AIProviderConfig) => {
    return await aiAgentService.saveConfig(config);
  });

  ipcMain.handle('ai:getClaudeAuthStatus', async () => {
    return await aiAgentService.getClaudeAuthStatus();
  });

  ipcMain.handle('ai:startClaudeLogin', async () => {
    try {
      const isWin = process.platform === 'win32';
      if (isWin) {
        spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', 'claude auth login'], {
          detached: true,
          shell: true,
          env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: PROJECT_HUB_CLAUDE_DIR
          }
        });
      } else {
        spawn('claude', ['auth', 'login'], {
          detached: true,
          shell: true,
          env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: PROJECT_HUB_CLAUDE_DIR
          }
        });
      }
      return true;
    } catch (e) {
      console.error('Failed to start claude auth login process:', e);
      shell.openExternal('https://claude.ai/login');
      return false;
    }
  });

  ipcMain.handle('ai:claudeLogout', async () => {
    return await aiAgentService.claudeLogout();
  });

  // Streaming & Session Lifecycle
  ipcMain.handle('ai:abortStream', async (_event, sessionId: string) => {
    aiAgentService.abortStream(sessionId);
    claudeBridgeService.abortSession(sessionId);
    return true;
  });

  ipcMain.handle('ai:clearSession', async (_event, sessionId: string) => {
    if (typeof sessionId !== 'string' || !sessionId) return false;
    claudeBridgeService.clearSession(sessionId);
    return true;
  });

  ipcMain.handle('ai:applyDiff', async (_event, projectPath: string, relativePath: string, newContent: string) => {
    return await aiAgentService.applyDiff(projectPath, relativePath, newContent);
  });

  // AI Session Store
  ipcMain.handle('aiSessions:list', async (_event, projectPath: string) => {
    if (typeof projectPath !== 'string' || !projectPath.trim()) return [];
    return aiSessionStore.list(projectPath);
  });

  ipcMain.handle('aiSessions:save', async (_event, projectPath: string, session: AISession) => {
    if (typeof projectPath !== 'string' || !projectPath.trim()) return false;
    try {
      await aiSessionStore.save(projectPath, session);
      return true;
    } catch (e) {
      console.error('[Main] aiSessions:save failed:', e);
      return false;
    }
  });

  ipcMain.handle('aiSessions:delete', async (_event, projectPath: string, sessionId: string) => {
    if (typeof projectPath !== 'string' || !projectPath.trim()) return false;
    return aiSessionStore.delete(projectPath, sessionId);
  });

  ipcMain.handle('aiSessions:import', async (_event, sessionsByProject: Record<string, AISession[]>) => {
    try {
      return await aiSessionStore.importLegacy(sessionsByProject);
    } catch (e) {
      console.error('[Main] aiSessions:import failed:', e);
      return 0;
    }
  });

  // AI Stream Chat
  ipcMain.handle('ai:streamChat', async (_event, req: AIStreamRequest) => {
    const targetWin = ctx.getMainWindow();
    if (!targetWin) return;
    const send = (channel: string, payload: unknown) => {
      if (!targetWin.isDestroyed()) {
        targetWin.webContents.send(channel, payload);
      }
    };

    try {
      await claudeBridgeService.runAgentTask(
        req,
        (chunk) => send(`ai:chunk:${req.sessionId}`, chunk),
        (fullMsg) => send(`ai:complete:${req.sessionId}`, fullMsg),
        (err) => send(`ai:error:${req.sessionId}`, err)
      );
    } catch (err: any) {
      const message = err?.message || String(err);
      console.error(`[Main] ai:streamChat failed for session ${req.sessionId}:`, err);
      claudeBridgeService.setProjectStatus(req.projectPath, 'error', message);
      send(`ai:error:${req.sessionId}`, message);
    }
  });

  // Предпросмотр контекста агента для карточки в AI Studio (TASK-64) — без запуска стрима.
  ipcMain.handle(
    'ai:previewContext',
    async (
      _event,
      projectPath: string,
      taskId: string,
      contextParts?: Partial<Record<'task' | 'rag' | 'gitnexus' | 'git', boolean>>
    ) => {
      const safeProject = await assertRegisteredProject(projectPath);
      return await buildAgentContext({ projectPath: safeProject, taskId, enabledParts: contextParts });
    }
  );

  // Claude Bridge Handlers
  ipcMain.handle('claudeBridge:getAllProjectStatuses', async () => {
    return claudeBridgeService.getAllProjectStatuses();
  });

  ipcMain.handle('claudeBridge:getProjectStatus', async (_event, projectPath: string) => {
    return claudeBridgeService.getProjectStatus(projectPath);
  });

  ipcMain.handle('claudeBridge:sendApprovalResponse', async (_event, requestId: string, response: { approved: boolean; text?: string }) => {
    return claudeBridgeService.sendApprovalResponse(requestId, response);
  });

  ipcMain.handle('claudeBridge:getSubagents', async (_event, projectPath: string) => {
    return claudeBridgeService.getSubagents(projectPath);
  });

  ipcMain.handle('claudeBridge:getAvailableModels', async () => {
    return claudeBridgeService.getAvailableModels();
  });

  ipcMain.handle('claudeBridge:getUsage', async (_event, forceRefresh = false) => {
    return await claudeUsageService.getUsage(forceRefresh);
  });

  // Multi-Agent Swarm (TASK-54)
  agentFleetService.on('swarmEvent', (event) => {
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('swarm:event', event);
    }
  });

  ipcMain.handle('swarm:startFanOut', async (_event, options: StartFanOutOptions) => {
    const safeProject = await assertRegisteredProject(options.projectPath);
    return await agentFleetService.startFanOut({ ...options, projectPath: safeProject });
  });

  ipcMain.handle('swarm:startHandoff', async (_event, options: StartHandoffOptions) => {
    const safeProject = await assertRegisteredProject(options.projectPath);
    return await agentFleetService.startHandoff({ ...options, projectPath: safeProject });
  });

  // Запуск агента, назначенного на задачу через assignee (decision-9 п.4, TASK-60)
  ipcMain.handle(
    'swarm:runAssigned',
    async (
      _event,
      options: { projectPath: string; taskId: string; taskTitle?: string; prompt: string; roleSlug: string; hostId?: string }
    ) => {
      const safeProject = await assertRegisteredProject(options.projectPath);

      // Назначение на другую машину (TASK-66, decision-11 п.5): запускаем агента там через
      // hub-соединение. Маршрутизация живёт здесь, а не в agentFleetService: тот отвечает за
      // локальных агентов и ничего не должен знать о федерации.
      const localHostId = remoteControlService.getHostId();
      if (options.hostId && options.hostId !== localHostId) {
        if (!federationClientService.isConnected(options.hostId)) {
          return { error: `Хост ${options.hostId} не подключён. Добавьте его в «Удалённые хосты» и дождитесь соединения.` };
        }
        try {
          const result = await federationClientService.call<{ swarmId: string; status: string; hostId: string }>(
            options.hostId,
            'start_assigned_agent',
            {
              projectPath: options.projectPath,
              taskId: options.taskId,
              taskTitle: options.taskTitle,
              prompt: options.prompt,
              roleSlug: options.roleSlug,
              hostId: options.hostId
            }
          );
          return { remote: true, hostId: options.hostId, swarmId: result?.swarmId, status: result?.status };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { error: `Не удалось запустить агента на хосте ${options.hostId}: ${message}` };
        }
      }

      return await agentFleetService.startAssignedAgent({ ...options, projectPath: safeProject });
    }
  );

  ipcMain.handle('swarm:stop', async (_event, swarmId: string) => {
    return agentFleetService.stopSwarm(swarmId);
  });

  ipcMain.handle('swarm:pickWinner', async (_event, swarmId: string, winnerAgentId: string, mergeIntoBase = true) => {
    return await agentFleetService.pickWinner(swarmId, winnerAgentId, mergeIntoBase);
  });

  ipcMain.handle('swarm:get', async (_event, swarmId: string) => {
    return agentFleetService.getSwarm(swarmId);
  });

  ipcMain.handle('swarm:list', async (_event, projectPath?: string) => {
    const safeProject = projectPath ? await assertRegisteredProject(projectPath) : undefined;
    await agentFleetService.ready;
    return agentFleetService.listSwarms(safeProject);
  });

  // Персистентность, транскрипты и экспорт swarm-сессий (TASK-56)
  ipcMain.handle('swarm:resume', async (_event, swarmId: string) => {
    if (typeof swarmId !== 'string') return { success: false, error: 'Invalid swarm id' };
    return await agentFleetService.resumeSwarm(swarmId);
  });

  ipcMain.handle('swarm:discard', async (_event, swarmId: string, cleanupWorktrees = true) => {
    if (typeof swarmId !== 'string') return { success: false, error: 'Invalid swarm id' };
    return await agentFleetService.discardSwarm(swarmId, cleanupWorktrees !== false);
  });

  ipcMain.handle('swarm:readTranscript', async (_event, swarmId: string, agentId: string) => {
    if (typeof swarmId !== 'string' || typeof agentId !== 'string') return null;
    return await agentFleetService.readTranscript(swarmId, agentId);
  });

  ipcMain.handle('swarm:export', async (_event, swarmId: string, format: SwarmExportFormat) => {
    if (typeof swarmId !== 'string') return null;
    return agentFleetService.exportSession(swarmId, format === 'json' ? 'json' : 'markdown');
  });

  ipcMain.handle('swarm:exportToFile', async (_event, swarmId: string, format: SwarmExportFormat) => {
    if (typeof swarmId !== 'string') return { success: false, error: 'Invalid swarm id' };
    const fmt: SwarmExportFormat = format === 'json' ? 'json' : 'markdown';
    const content = agentFleetService.exportSession(swarmId, fmt);
    if (content === null) return { success: false, error: `Swarm session ${swarmId} not found` };
    const win = ctx.getMainWindow();
    const ext = fmt === 'json' ? 'json' : 'md';
    const dialogOptions = {
      title: 'Экспорт swarm-сессии',
      defaultPath: `${swarmId}.${ext}`,
      filters: fmt === 'json' ? [{ name: 'JSON', extensions: ['json'] }] : [{ name: 'Markdown', extensions: ['md'] }]
    };
    const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    try {
      await fs.writeFile(result.filePath, content, 'utf-8');
      return { success: true, path: result.filePath };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });
}
