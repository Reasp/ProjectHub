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
  type StartDoneLoopOptions,
  type StartHandoffOptions,
  type SwarmExportFormat
} from '../services/agentFleetService';
import { loadDoneLoopSettings } from '../services/doneLoopService';
import { assertRegisteredProject } from '../services/projectPathGuard';
import type { RunJudgeOptions } from '../services/arenaJudgeService';
import { loadArenaConfig, saveArenaConfig } from '../services/arenaConfig';
import type { ArenaSettings } from '../services/actionConfigService';
import type { CheckDefinition, ComposeSelection } from '../services/arenaTypes';
import { buildAgentContext } from '../services/contextBuilder';
import { llmProfileService } from '../services/llmProfileService';
import { llmModelCatalogService } from '../services/llmModelCatalogService';
import { LLM_PROVIDER_PRESETS, profileFromLegacyConfig } from '../services/llmProfiles';
import { pricingService } from '../services/pricingService';
import { modelTierService } from '../services/modelTierService';
import { providerErrorInfoOf } from '../services/providerErrors';
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

  // Профили OpenAI-совместимых провайдеров и их каталог моделей (TASK-70.1, TASK-70.2, decision-39).
  // Ключ профиля в renderer не возвращается: только признак hasApiKey.
  ipcMain.handle('llmProfiles:presets', () => LLM_PROVIDER_PRESETS);
  ipcMain.handle('llmProfiles:list', () => llmProfileService.listProfiles());
  ipcMain.handle('llmProfiles:save', (_event, input: { profile: unknown; apiKey?: string | null }) =>
    llmProfileService.saveProfile({ profile: input?.profile, apiKey: input?.apiKey })
  );
  ipcMain.handle('llmProfiles:delete', async (_event, id: string) => {
    const removed = await llmProfileService.deleteProfile(String(id));
    if (removed) await llmModelCatalogService.forget(String(id)).catch(() => undefined);
    return removed;
  });
  // Ручной перенос прежнего провайдера AI Studio в профиль (decision-40): ключ берётся из сохранённых
  // настроек в main-процессе, сам ai-config.json не меняется — провайдера переключает пользователь.
  ipcMain.handle('llmProfiles:importLegacy', async (_event, expectedProvider: string) => {
    const config = await aiAgentService.getConfig();
    if (config.provider !== expectedProvider) {
      throw new Error('Сначала сохраните настройки AI Studio с этим провайдером, затем перенесите его в профиль.');
    }
    const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const profile = profileFromLegacyConfig(config, id);
    return llmProfileService.saveProfile({ profile, apiKey: config.apiKey?.trim() || undefined });
  });
  ipcMain.handle('llmProfiles:listModels', (_event, id: string, refresh?: boolean) =>
    llmModelCatalogService.listModels(String(id), { refresh: refresh === true })
  );

  // Таблица цен агентов (TASK-70.4, decision-42): встроенная + переопределения agent-pricing.json.
  // Сохранение сразу применяется в Swarm и AI Studio. Импорт OpenRouter — только по кнопке и ничего не пишет.
  void pricingService.ensureLoaded();
  ipcMain.handle('pricing:get', () => pricingService.getState());
  ipcMain.handle('pricing:save', (_event, overrides: unknown) => pricingService.saveOverrides(overrides));
  ipcMain.handle('pricing:fetchOpenRouter', () => pricingService.fetchOpenRouterPrices());

  // Тиры моделей (TASK-79, decision-44): таблица <userData>/model-tiers.json. «Заполнить из настроенного»
  // ничего не пишет — черновик сохраняется отдельной кнопкой.
  ipcMain.handle('modelTiers:get', () => modelTierService.getState());
  ipcMain.handle('modelTiers:save', (_event, settings: unknown) => modelTierService.save(settings));
  ipcMain.handle('modelTiers:seed', (_event, draft?: unknown) => modelTierService.seed(draft));

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
    const send = (channel: string, payload: unknown, extra?: unknown) => {
      if (!targetWin.isDestroyed()) {
        if (extra === undefined) targetWin.webContents.send(channel, payload);
        else targetWin.webContents.send(channel, payload, extra);
      }
    };

    try {
      await claudeBridgeService.runAgentTask(
        req,
        (chunk) => send(`ai:chunk:${req.sessionId}`, chunk),
        (fullMsg) => send(`ai:complete:${req.sessionId}`, fullMsg),
        // Второй аргумент — снимок ошибки провайдера (decision-43): renderer строит по нему локализованную карточку.
        (err, info) => send(`ai:error:${req.sessionId}`, err, info)
      );
    } catch (err: any) {
      const info = providerErrorInfoOf(err);
      const message = info?.message || err?.message || String(err);
      console.error(`[Main] ai:streamChat failed for session ${req.sessionId}: ${message}`);
      claudeBridgeService.setProjectStatus(req.projectPath, 'error', message);
      send(`ai:error:${req.sessionId}`, message, info);
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
    // Вызов идёт из окна ProjectHub через preload — источник указываем явно (TASK-86).
    return claudeBridgeService.sendApprovalResponse(requestId, response, { kind: 'local' });
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

  // Цикл «до готовности» (TASK-75, decision-28)
  ipcMain.handle('swarm:startDoneLoop', async (_event, options: StartDoneLoopOptions) => {
    const safeProject = await assertRegisteredProject(options.projectPath);
    try {
      return await agentFleetService.startDoneLoop({ ...options, projectPath: safeProject });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('doneLoop:getConfig', async (_event, projectPath: string) => {
    const safeProject = await assertRegisteredProject(projectPath);
    return await loadDoneLoopSettings(safeProject);
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

  // Автосудья арены (TASK-61, decision-12)
  ipcMain.handle('swarm:runJudge', async (_event, swarmId: string, options?: RunJudgeOptions) => {
    if (typeof swarmId !== 'string') return { success: false, error: 'Invalid swarm id' };
    const state = await agentFleetService.runJudge(swarmId, {
      rerunChecks: options?.rerunChecks === true,
      skipReview: options?.skipReview === true
    });
    if (!state) return { success: false, error: 'Сессия не найдена или не является ареной (fan-out)' };
    return { success: true, state };
  });

  ipcMain.handle('swarm:cancelJudge', async (_event, swarmId: string) => {
    if (typeof swarmId !== 'string') return false;
    return agentFleetService.cancelJudge(swarmId);
  });

  ipcMain.handle('swarm:compose', async (_event, swarmId: string, selections: ComposeSelection[]) => {
    if (typeof swarmId !== 'string') return { success: false, error: 'Invalid swarm id' };
    if (!Array.isArray(selections)) return { success: false, error: 'Не передан список файлов' };
    return await agentFleetService.composeFromCandidates(swarmId, selections);
  });

  ipcMain.handle('arena:getConfig', async (_event, projectPath: string) => {
    const safeProject = await assertRegisteredProject(projectPath);
    return await loadArenaConfig(safeProject);
  });

  ipcMain.handle(
    'arena:saveConfig',
    async (_event, projectPath: string, patch: { checks?: CheckDefinition[]; arena?: ArenaSettings }) => {
      const safeProject = await assertRegisteredProject(projectPath);
      const ok = await saveArenaConfig(safeProject, patch ?? {});
      return { success: ok, config: ok ? await loadArenaConfig(safeProject) : undefined };
    }
  );

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

  // Таймлайн, откат к чекпоинту, продолжение агента и трасса JSONL (TASK-72, decision-45)
  ipcMain.handle('swarm:getTimeline', async (_event, swarmId: string, agentId: string) => {
    if (typeof swarmId !== 'string' || typeof agentId !== 'string') return null;
    return await agentFleetService.getTimeline(swarmId, agentId);
  });

  ipcMain.handle('swarm:rewind', async (_event, swarmId: string, agentId: string, checkpoint: number) => {
    if (typeof swarmId !== 'string' || typeof agentId !== 'string' || !Number.isInteger(checkpoint)) {
      return { success: false, error: 'Invalid arguments' };
    }
    return await agentFleetService.rewindAgent(swarmId, agentId, checkpoint);
  });

  ipcMain.handle('swarm:continueAgent', async (_event, swarmId: string, agentId: string, instruction?: string) => {
    if (typeof swarmId !== 'string' || typeof agentId !== 'string') return { success: false, error: 'Invalid arguments' };
    return await agentFleetService.continueAgent(swarmId, agentId, typeof instruction === 'string' ? instruction : undefined);
  });

  ipcMain.handle('swarm:exportTrace', async (_event, swarmId: string, agentId?: string) => {
    if (typeof swarmId !== 'string') return { success: false, error: 'Invalid swarm id' };
    const content = await agentFleetService.exportTrace(swarmId, typeof agentId === 'string' ? agentId : undefined);
    if (content === null) return { success: false, error: `Трасса сессии ${swarmId} не найдена` };
    const win = ctx.getMainWindow();
    const dialogOptions = {
      title: 'Экспорт трассы агента',
      defaultPath: `${swarmId}${typeof agentId === 'string' ? `-${agentId}` : ''}.trace.jsonl`,
      filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }]
    };
    const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    try {
      await fs.writeFile(result.filePath, content, 'utf-8');
      return { success: true, path: result.filePath };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
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
