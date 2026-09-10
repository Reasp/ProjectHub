import { app, BrowserWindow, shell, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { claudeBridgeService } from './services/claudeBridgeService';
import { localWhisperService } from './services/localWhisperService';
import { mcpServerService } from './services/mcpServerService';
import { remoteControlService } from './services/remoteControlService';
import { processManager } from './services/processManager';
import { ptyService } from './services/ptyService';
import { gitService } from './services/gitService';
import { windowStateService } from './services/windowStateService';
import { agentFleetService } from './services/agentFleetService';
import { invalidateInspectCache } from './services/projectScanner';
import { logger, parseLogLevel } from './services/logger';
import { getUserDataDir } from './services/appPaths';
import { hitlService } from './services/hitlService';
import { registerAllIpc } from './ipc';

// Логи main-процесса: stdout + файл userData/logs/main.log с ротацией (TASK-49).
logger.init({
  dir: path.join(getUserDataDir(), 'logs'),
  minLevel: parseLogLevel(process.env.PROJECTHUB_LOG_LEVEL, app.isPackaged ? 'info' : 'debug')
});
logger.captureConsole();

// Automatically approve media capture requests in Chromium without blocking UI dialogs
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The built directory structure
process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(__dirname, '../public');

let win: BrowserWindow | null = null;
let voiceOverlayWin: BrowserWindow | null = null;
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// ───────────────────────────── Защита рендерера (TASK-30) ─────────────────────────────
const RENDERER_DIST_DIR = path.resolve(__dirname, '../dist');

function isExternalHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** URL принадлежит самому приложению: dev-сервер Vite или file:// внутри dist. */
function isAppUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'about:' && parsed.href === 'about:blank') return true;
  if (VITE_DEV_SERVER_URL) {
    try {
      if (parsed.origin === new URL(VITE_DEV_SERVER_URL).origin) return true;
    } catch {}
  }
  if (parsed.protocol === 'file:') {
    try {
      const filePath = path.resolve(fileURLToPath(parsed));
      const rel = path.relative(RENDERER_DIST_DIR, filePath);
      return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    } catch {
      return false;
    }
  }
  return false;
}

function isOwnWindowContents(contents: Electron.WebContents): boolean {
  const own = [win, voiceOverlayWin].filter(
    (w): w is BrowserWindow => Boolean(w) && !w!.isDestroyed()
  );
  return own.some((w) => w.webContents.id === contents.id);
}

/**
 * Общая политика для всех окон приложения: новые окна не создаются (http/https уходят в системный
 * браузер), навигация за пределы dist/dev-сервера блокируется, <webview> запрещён.
 */
function hardenWebContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      shell.openExternal(url).catch((err) => {
        console.error('[Security] shell.openExternal failed:', err);
      });
    } else {
      console.warn(`[Security] Blocked window.open to non-http URL: ${url}`);
    }
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    console.warn(`[Security] Blocked navigation to: ${url}`);
  });

  contents.on('will-redirect', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    console.warn(`[Security] Blocked redirect to: ${url}`);
  });

  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    console.warn('[Security] Blocked <webview> attachment');
  });
}

// Разрешения Chromium: только захват микрофона/медиа и запись в буфер обмена для собственных окон
const ALLOWED_PERMISSIONS = new Set(['media', 'audioCapture', 'clipboard-sanitized-write']);

function isPermissionAllowed(
  contents: Electron.WebContents | null,
  permission: string,
  requestingUrl?: string,
  details?: { mediaTypes?: string[] }
): boolean {
  if (!ALLOWED_PERMISSIONS.has(permission)) return false;
  if (!contents || !isOwnWindowContents(contents)) return false;
  const url = requestingUrl || contents.getURL();
  if (!isAppUrl(url)) return false;
  if (permission === 'media' && details?.mediaTypes?.length) {
    return details.mediaTypes.every((t) => t === 'audio');
  }
  return true;
}

// Глобальная страховка main-процесса
process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err);
});

// Forward claudeBridge status events to renderer
claudeBridgeService.on('statusChanged', (status) => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('claudeBridge:statusChanged', status);
  }
});

claudeBridgeService.on('subagentUpdated', (subagent) => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('claudeBridge:subagentUpdated', subagent);
  }
});

function createWindow() {
  const distPath = path.join(__dirname, '../dist');
  const indexPath = path.join(distPath, 'index.html');

  const preloadCjs = path.join(__dirname, 'preload.cjs');
  const preloadJs = path.join(__dirname, 'preload.js');
  const preloadPath = existsSync(preloadCjs) ? preloadCjs : preloadJs;

  const iconPng = path.join(__dirname, '../public/icon.png');
  const iconBuild = path.join(__dirname, '../build/icon.png');
  const appIcon = existsSync(iconPng) ? iconPng : iconBuild;

  const windowState = windowStateService.getInitialState();

  win = new BrowserWindow({
    title: 'ProjectHub — Панель управления проектами',
    icon: appIcon,
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  if (windowState.isMaximized) {
    win.maximize();
  }

  windowStateService.trackWindow(win);
  hardenWebContents(win.webContents);

  win.webContents.on('console-message', (event) => {
    const { level, message, lineNumber, sourceId } = event;
    const text = `[Renderer] ${message} (${sourceId || '?'}:${lineNumber})`;
    if (level === 'error') logger.error(text);
    else if (level === 'warning') logger.warn(text);
    else logger.debug(text);
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Electron] Failed to load ${validatedURL}: [${errorCode}] ${errorDescription}`);
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(indexPath);
  }

  win.on('close', (e) => {
    if (!isCleaningUp) {
      e.preventDefault();
      performGracefulShutdown();
      setTimeout(() => {
        app.exit(0);
        process.exit(0);
      }, 1500).unref();
    }
  });

  win.on('closed', () => {
    win = null;
    if (voiceOverlayWin && !voiceOverlayWin.isDestroyed()) {
      try {
        voiceOverlayWin.destroy();
      } catch {}
      voiceOverlayWin = null;
    }
  });
}

function createVoiceOverlayWindow(): BrowserWindow {
  if (voiceOverlayWin && !voiceOverlayWin.isDestroyed()) {
    return voiceOverlayWin;
  }

  const distPath = path.join(__dirname, '../dist');
  const indexPath = path.join(distPath, 'index.html');
  const preloadCjs = path.join(__dirname, 'preload.cjs');
  const preloadJs = path.join(__dirname, 'preload.js');
  const preloadPath = existsSync(preloadCjs) ? preloadCjs : preloadJs;

  voiceOverlayWin = new BrowserWindow({
    width: 320,
    height: 54,
    x: 24,
    y: 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  voiceOverlayWin.setAlwaysOnTop(true, 'screen-saver');
  hardenWebContents(voiceOverlayWin.webContents);

  if (VITE_DEV_SERVER_URL) {
    voiceOverlayWin.loadURL(`${VITE_DEV_SERVER_URL}#/voice-overlay`);
  } else {
    voiceOverlayWin.loadFile(indexPath, { hash: '/voice-overlay' });
  }

  voiceOverlayWin.on('closed', () => {
    voiceOverlayWin = null;
  });

  return voiceOverlayWin;
}

// Регистрация всех доменных IPC обработчиков (TASK-46)
registerAllIpc({
  getMainWindow: () => win,
  getVoiceOverlayWindow: () => voiceOverlayWin,
  createVoiceOverlayWindow
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
    voiceOverlayWin = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

let isCleaningUp = false;

async function performGracefulShutdown() {
  if (isCleaningUp) return;
  isCleaningUp = true;

  console.log('[Main] Performing graceful shutdown of all processes and resources...');

  if (voiceOverlayWin && !voiceOverlayWin.isDestroyed()) {
    try {
      voiceOverlayWin.destroy();
    } catch {}
    voiceOverlayWin = null;
  }

  try {
    gitService.cleanupAll();
  } catch (e) {
    console.warn('[Main] Error cleaning up git watchers:', e);
  }

  try {
    processManager.cleanupAll();
  } catch (e) {
    console.warn('[Main] Error cleaning up processes:', e);
  }

  try {
    // Очередь HITL остаётся на диске (orphaned) и восстанавливается после перезапуска (TASK-57).
    await hitlService.shutdown();
  } catch (e) {
    console.warn('[Main] Error persisting HITL queue:', e);
  }

  try {
    claudeBridgeService.killAll();
  } catch (e) {
    console.warn('[Main] Error cleaning up agent sessions:', e);
  }

  try {
    // Активные swarm-сессии помечаются interrupted и сбрасываются на диск (TASK-56)
    await agentFleetService.shutdown();
  } catch (e) {
    console.warn('[Main] Error cleaning up swarm sessions:', e);
    try { agentFleetService.killAll(); } catch { /* ignore */ }
  }

  try {
    ptyService.cleanupAll();
  } catch (e) {
    console.warn('[Main] Error cleaning up pty:', e);
  }

  try {
    await localWhisperService.dispose();
  } catch (e) {
    console.warn('[Main] Error disposing whisper service:', e);
  }

  try {
    await mcpServerService.stop();
  } catch (e) {
    console.warn('[Main] Error stopping MCP server:', e);
  }

  try {
    await remoteControlService.stop();
  } catch (e) {
    console.warn('[Main] Error stopping Remote Control service:', e);
  }

  console.log('[Main] Graceful shutdown completed successfully.');
  app.exit(0);
  process.exit(0);
}

app.on('before-quit', (event) => {
  if (!isCleaningUp) {
    event.preventDefault();
    performGracefulShutdown();
    setTimeout(() => {
      console.warn('[Main] Force exiting after 1.5s shutdown timeout.');
      app.exit(0);
      process.exit(0);
    }, 1500).unref();
  }
});

// Сброс кэша осмотра проекта при внешних изменениях git (TASK-44)
gitService.onGitChanged((projectPath) => invalidateInspectCache(projectPath));

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = isPermissionAllowed(
      webContents,
      permission,
      (details as { requestingUrl?: string }).requestingUrl,
      details as { mediaTypes?: string[] }
    );
    if (!allowed) {
      console.warn(`[Security] Denied permission request "${permission}" for ${webContents?.getURL() ?? 'unknown'}`);
    }
    callback(allowed);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return isPermissionAllowed(
      webContents,
      permission,
      (details as { requestingUrl?: string }).requestingUrl ?? requestingOrigin,
      details as { mediaTypes?: string[] }
    );
  });

  createWindow();

  // Восстановление swarm-сессий с диска: незавершённые помечаются interrupted (TASK-56)
  void agentFleetService.init();

  // Единый HITL-контур: очередь <userData>/hitl/pending.json и аудит <userData>/audit (TASK-57)
  hitlService.configure({ hostId: remoteControlService.getHostId() });
  hitlService
    .init({ dir: path.join(getUserDataDir(), 'hitl'), auditDir: path.join(getUserDataDir(), 'audit') })
    .catch((err) => {
      console.error('[Main] Failed to init HITL service:', err);
    });

  claudeBridgeService.setCliPermissionBroker({
    ensureEndpoint: () => mcpServerService.ensurePermissionEndpoint()
  });

  mcpServerService.start().catch((err) => {
    console.error('[Main] Failed to auto-start Remote MCP server:', err);
  });

  remoteControlService.initOnStartup().catch((err) => {
    console.error('[Main] Failed to auto-start Remote Control service:', err);
  });
});
