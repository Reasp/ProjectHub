import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import matter from 'gray-matter';
import { simpleGit } from 'simple-git';
import type { ProjectInfo, BacklogTask, GitCommit, ScanOptions, AISession } from '../src/types/electron';
import { projectRegistry } from './services/projectRegistry';
import { inspectProject, scanDirectories } from './services/projectScanner';
import { claudeBridgeService } from './services/claudeBridgeService';
import { localWhisperService } from './services/localWhisperService';
import { secretStorageService } from './services/secretStorageService';
import { mcpServerService } from './services/mcpServerService';
import { processManager } from './services/processManager';
import { ptyService } from './services/ptyService';
import { gitService } from './services/gitService';
import { windowStateService } from './services/windowStateService';
import { aiSessionStore } from './services/aiSessionStore';
import { assertInsideRegisteredProject, assertRegisteredProject } from './services/projectPathGuard';

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
// Каталог собранного рендерера: единственное место, откуда окнам разрешено грузить file://-страницы.
const RENDERER_DIST_DIR = path.resolve(__dirname, '../dist');

function isExternalHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isOpenExternalAllowed(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
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

// Разрешения Chromium: только захват микрофона/медиа (и запись в буфер обмена для кнопок «Копировать»)
// и только для собственных окон приложения, загруженных с dist/dev-сервера. Всё остальное — отказ.
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
    // Видео с камеры приложению не нужно — только аудио.
    return details.mediaTypes.every((t) => t === 'audio');
  }
  return true;
}

// Глобальная страховка main-процесса: необработанные ошибки логируются, но не завершают приложение
// и не показывают системный диалог Electron "A JavaScript error occurred in the main process".
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

  // Log renderer console messages to stdout
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer Console: ${level}] ${message} (${sourceId}:${line})`);
  });

  // Toggle DevTools with F12 or Ctrl+Shift+I
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

  // Ensure full application exit and graceful shutdown when main window is closed
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

// ----------------------------------------------------
// IPC HANDLERS: SYSTEM VOICE OVERLAY
// ----------------------------------------------------
ipcMain.on('voice:overlay-sync', (_event, state) => {
  const shouldBeVisible = Boolean(state?.isListening || state?.isPaused);

  if (shouldBeVisible) {
    if (!voiceOverlayWin || voiceOverlayWin.isDestroyed()) {
      createVoiceOverlayWindow();
    }
  }

  if (voiceOverlayWin && !voiceOverlayWin.isDestroyed()) {
    if (shouldBeVisible) {
      if (!voiceOverlayWin.isVisible()) {
        voiceOverlayWin.showInactive();
      }
    } else {
      if (voiceOverlayWin.isVisible()) {
        voiceOverlayWin.hide();
      }
    }

    if (!voiceOverlayWin.webContents.isLoading()) {
      voiceOverlayWin.webContents.send('voice:overlay-update', state);
    } else {
      voiceOverlayWin.webContents.once('did-finish-load', () => {
        voiceOverlayWin?.webContents.send('voice:overlay-update', state);
      });
    }
  }
});

ipcMain.on('voice:overlay-action', (_event, action) => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('voice:external-control', action);
  }
});

// ----------------------------------------------------
// IPC HANDLERS: PROJECTS & REGISTRY
// ----------------------------------------------------

// 1. List registered projects with fresh metadata
ipcMain.handle('projects:list', async () => {
  const registered = await projectRegistry.getProjects();
  const results: ProjectInfo[] = [];

  for (const entry of registered) {
    const details = await inspectProject(entry.path);
    if (details) {
      details.favorite = Boolean(entry.favorite);
      details.addedAt = entry.addedAt;
      results.push(details);
    }
  }

  return results;
});

// 2. Scan directories and auto-register discovered projects
ipcMain.handle('projects:scan', async (_event, options?: ScanOptions) => {
  const roots = options?.roots && options.roots.length > 0
    ? options.roots
    : await projectRegistry.getScanRoots();

  const depth = options?.depth ?? 2;
  const discovered = await scanDirectories(roots, depth);
  return discovered;
});

// 3. Add project by path manually
ipcMain.handle('projects:add', async (_event, folderPath: string) => {
  const details = await inspectProject(folderPath);
  if (!details) {
    return null;
  }
  await projectRegistry.addProject(details.path, false);
  return details;
});

// 4. Remove project from registry
ipcMain.handle('projects:remove', async (_event, projectPath: string) => {
  // Удалённый из реестра проект больше не должен держать FS-вотчеры (TASK-34).
  gitService.unwatchProjectGit(projectPath);
  return await projectRegistry.removeProject(projectPath);
});

// 5. Refresh single project
ipcMain.handle('projects:refresh', async (_event, projectPath: string) => {
  return await inspectProject(projectPath);
});

// 6. Toggle Favorite status
ipcMain.handle('projects:toggleFavorite', async (_event, projectPath: string) => {
  return await projectRegistry.toggleFavorite(projectPath);
});

// 6.1 Set Voice Alias
ipcMain.handle('projects:setVoiceAlias', async (_event, { projectPath, alias }: { projectPath: string; alias: string }) => {
  return await projectRegistry.setVoiceAlias(projectPath, alias);
});

// 7. Get/Set Scan Roots
ipcMain.handle('projects:getScanRoots', async () => {
  return await projectRegistry.getScanRoots();
});

ipcMain.handle('projects:setScanRoots', async (_event, roots: string[]) => {
  return await projectRegistry.setScanRoots(roots);
});

ipcMain.handle('projects:getDetails', async (_event, projectPath: string) => {
  return await inspectProject(projectPath);
});

// Dialog: Select Directory
ipcMain.handle('dialog:selectDirectory', async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Выберите папку проекта с Backlog.md или репозиторием'
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});


// System open actions
ipcMain.handle('system:openInExplorer', async (_event, targetPath: string) => {
  await shell.openPath(targetPath);
});

ipcMain.handle('system:openInCode', async (_event, targetPath: string) => {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'code.cmd' : 'code';
  spawn(cmd, [targetPath], { shell: true, detached: true });
});

ipcMain.handle('system:openTerminal', async (_event, targetPath: string) => {
  const isWin = process.platform === 'win32';
  if (isWin) {
    spawn('cmd.exe', ['/c', 'start', 'powershell.exe'], { cwd: targetPath, shell: true, detached: true });
  } else {
    spawn('open', ['-a', 'Terminal', targetPath], { detached: true });
  }
});

import { backlogWatcher } from './services/backlogWatcher';
import {
  parseTaskBody,
  applyDescription,
  applyCriteria,
  toggleCriterionInContent,
  buildTaskBody,
  sanitizeTaskFileTitle,
  taskNumberFromName,
  nowBacklogTimestamp,
  normalizeFrontmatter,
  withUpdatedDate
} from './services/backlogTaskFormat';

// 2. Backlog Tasks & File Watcher
ipcMain.handle('backlog:watchProject', async (_event, projectPath: string) => {
  backlogWatcher.watch(projectPath, win);
});

/** Строковое значение из frontmatter: Date (незакавыченная дата в YAML) → 'YYYY-MM-DD', остальное → String(). */
function fmString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  return String(value);
}

function fmStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(fmString).filter((v): v is string => v !== undefined);
}

/** Разбор файла задачи: frontmatter + тело. Переводы строк нормализуются к `\n`, исходный EOL запоминается. */
function parseTaskFile(raw: string) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const parsed = matter(raw.replace(/\r\n/g, '\n'));
  // gray-matter кэширует результат разбора по строке — копируем data, чтобы не мутировать кэш.
  return { eol, data: { ...parsed.data } as Record<string, unknown>, content: parsed.content };
}

/** Сборка файла задачи: frontmatter приводится к строкам (правило 16), EOL восстанавливается. */
function serializeTaskFile(content: string, data: Record<string, unknown>, eol: string): string {
  const text = matter.stringify(content, normalizeFrontmatter(data));
  return eol === '\n' ? text : text.replace(/\n/g, eol);
}

function taskIdFromFile(data: Record<string, unknown>, filePath: string): string {
  const fromFrontmatter = fmString(data.id);
  if (fromFrontmatter) return fromFrontmatter;
  const base = path.basename(filePath, '.md');
  const n = taskNumberFromName(base);
  return n !== null ? `TASK-${n}` : base.split(' - ')[0].trim();
}

ipcMain.handle('backlog:getTasks', async (_event, projectPath: string) => {
  const tasksDir = path.join(projectPath, 'backlog', 'tasks');
  if (!existsSync(tasksDir)) return [];

  // Also ensure watcher is active for this project
  backlogWatcher.watch(projectPath, win);

  const taskList: BacklogTask[] = [];
  try {
    const files = await fs.readdir(tasksDir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        const fullPath = path.join(tasksDir, file);
        const raw = await fs.readFile(fullPath, 'utf-8');
        const { data, content } = parseTaskFile(raw);
        const { criteria, description } = parseTaskBody(content);

        taskList.push({
          // Frontmatter-значения приводим к строкам: незакавыченная дата в YAML — это объект Date,
          // и React падает (error #31), если такой объект попадёт в разметку.
          id: taskIdFromFile(data, fullPath),
          title: fmString(data.title) || path.basename(file, '.md'),
          status: (fmString(data.status) as any) || 'To Do',
          labels: fmStringList(data.labels),
          milestone: fmString(data.milestone) || fmString(data.milestone_id) || undefined,
          created: fmString(data.created_date) || fmString(data.created) || undefined,
          filePath: fullPath,
          content,
          description,
          acceptanceCriteria: criteria
        });
      }
    }
  } catch (err) {
    console.error(`Error reading tasks from ${tasksDir}:`, err);
  }

  return taskList;
});

// Все обработчики ниже получают абсолютный filePath от рендерера; перед чтением/записью
// проверяем, что путь лежит внутри зарегистрированного проекта (TASK-32). Нарушение — исключение.
ipcMain.handle('backlog:updateTaskStatus', async (_event, rawFilePath: string, newStatus: string) => {
  const filePath = await assertInsideRegisteredProject(rawFilePath);
  try {
    if (!existsSync(filePath)) return false;
    const { eol, data, content } = parseTaskFile(await fs.readFile(filePath, 'utf-8'));
    data.status = newStatus;
    await fs.writeFile(filePath, serializeTaskFile(content, withUpdatedDate(data), eol), 'utf-8');
    return true;
  } catch (err) {
    console.error(`Failed to update status for ${filePath}:`, err);
    return false;
  }
});

ipcMain.handle('backlog:toggleCriterion', async (_event, rawFilePath: string, index: number, completed: boolean) => {
  const filePath = await assertInsideRegisteredProject(rawFilePath);
  try {
    if (!existsSync(filePath)) return false;
    const { eol, data, content } = parseTaskFile(await fs.readFile(filePath, 'utf-8'));
    // Переключаем только чекбоксы внутри блока AC:BEGIN/AC:END — чекбоксы в описании не считаются.
    const updated = toggleCriterionInContent(content, index, completed);
    if (updated === null) return false;
    await fs.writeFile(filePath, serializeTaskFile(updated, withUpdatedDate(data), eol), 'utf-8');
    return true;
  } catch (err) {
    console.error(`Failed to toggle criterion in ${filePath}:`, err);
    return false;
  }
});

ipcMain.handle('backlog:saveFullTask', async (_event, rawFilePath: string, data: {
  title: string;
  status: BacklogTask['status'];
  labels: string[];
  milestone?: string;
  description: string;
  criteria?: Array<{ text: string; completed: boolean }>;
}) => {
  const filePath = await assertInsideRegisteredProject(rawFilePath);
  try {
    if (!existsSync(filePath)) return false;
    const { eol, data: frontmatter, content } = parseTaskFile(await fs.readFile(filePath, 'utf-8'));

    // Меняем только поля, которые редактирует GUI; остальные (assignee, priority, type, ordinal,
    // dependencies, references, ...) остаются как есть.
    frontmatter.title = data.title;
    frontmatter.status = data.status;
    frontmatter.labels = data.labels;
    if (data.milestone) {
      frontmatter.milestone = data.milestone;
    } else {
      delete frontmatter.milestone;
      delete frontmatter.milestone_id;
    }

    // Тело: точечно заменяем описание и критерии внутри маркеров; план, заметки, итог и прочие
    // секции не трогаем. Критерии перенумеровываются #1..#N.
    let body = applyDescription(content, data.description || '');
    body = applyCriteria(body, data.criteria || []);

    await fs.writeFile(filePath, serializeTaskFile(body, withUpdatedDate(frontmatter), eol), 'utf-8');
    return true;
  } catch (err) {
    console.error(`Failed to save full task ${filePath}:`, err);
    return false;
  }
});

ipcMain.handle('backlog:deleteTask', async (_event, rawFilePath: string) => {
  const filePath = await assertInsideRegisteredProject(rawFilePath);
  try {
    if (!existsSync(filePath)) return false;
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    console.error(`Failed to delete task ${filePath}:`, err);
    return false;
  }
});

ipcMain.handle('backlog:saveTask', async (_event, rawFilePath: string, content: string) => {
  const filePath = await assertInsideRegisteredProject(rawFilePath);
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return true;
  } catch (err) {
    console.error(`Failed to save task ${filePath}:`, err);
    return false;
  }
});

ipcMain.handle('backlog:createTask', async (_event, projectPath: string, task: {
  title: string;
  description: string;
  labels: string[];
  type?: string;
  priority?: string;
  milestone?: string;
}) => {
  await assertRegisteredProject(projectPath);
  try {
    const backlogDir = path.join(projectPath, 'backlog');
    const tasksDir = path.join(backlogDir, 'tasks');
    if (!existsSync(tasksDir)) {
      await fs.mkdir(tasksDir, { recursive: true });
    }

    // Следующий номер — максимум по всем каталогам задач Backlog.md (активные, завершённые,
    // черновики, архив), чтобы не переиспользовать id, как это делает CLI.
    let maxId = 0;
    for (const dir of ['tasks', 'completed', 'drafts', path.join('archive', 'tasks')]) {
      const full = path.join(backlogDir, dir);
      if (!existsSync(full)) continue;
      for (const f of await fs.readdir(full)) {
        const n = taskNumberFromName(f);
        if (n !== null && n > maxId) maxId = n;
      }
    }

    const number = maxId + 1;
    const id = `TASK-${number}`;
    const fileName = `task-${number} - ${sanitizeTaskFileTitle(task.title) || 'task'}.md`;
    const fullPath = path.join(tasksDir, fileName);
    const createdDate = nowBacklogTimestamp();
    const labels = task.labels || [];

    // Порядок ключей — как у CLI Backlog.md.
    const frontmatter: Record<string, unknown> = {
      id,
      title: task.title,
      status: 'To Do',
      assignee: [],
      created_date: createdDate,
      labels,
      dependencies: [],
      ...(task.milestone ? { milestone: task.milestone } : {}),
      ...(task.priority ? { priority: task.priority } : {}),
      type: task.type || 'task'
    };

    const body = buildTaskBody(task.description || '');
    // flag 'wx' — не перезаписывать, если файл с таким номером уже появился.
    await fs.writeFile(fullPath, matter.stringify(body, frontmatter), { encoding: 'utf-8', flag: 'wx' });
    const { criteria, description } = parseTaskBody(body);

    return {
      id,
      title: task.title,
      status: 'To Do' as const,
      labels,
      milestone: task.milestone,
      created: createdDate,
      filePath: fullPath,
      content: body,
      description,
      acceptanceCriteria: criteria
    };
  } catch (err) {
    console.error('Failed to create task:', err);
    return null;
  }
});


// 3. Project Template Wizard
import { createProjectFromTemplate, checkTemplateAvailable } from './services/templateWizard';
import type { CreateProjectOptions } from '../src/types/electron';

ipcMain.handle('template:createProject', async (_event, options: CreateProjectOptions) => {
  return await createProjectFromTemplate(options);
});

ipcMain.handle('template:checkAvailable', async (_event, customSource?: string) => {
  return await checkTemplateAvailable(customSource);
});

// 4. Background Processes & Terminal
ipcMain.handle('process:start', async (_event, projectPath: string, command: string, name: string) => {
  return await processManager.startProcess(projectPath, command, name);
});

ipcMain.handle('process:stop', async (_event, processId: string) => {
  return await processManager.stopProcess(processId);
});

ipcMain.handle('process:list', async (_event, projectPath: string) => {
  return await processManager.listProcessesForProject(projectPath);
});

ipcMain.handle('process:tailLog', async (_event, projectPath: string, processName: string, lines = 100) => {
  return await processManager.tailProjectLog(projectPath, processName, lines);
});

// 4b. Action Runner & Script Configuration (.projecthub.json)
import { actionConfigService, type ProjectActionConfig } from './services/actionConfigService';

ipcMain.handle('actions:getConfig', async (_event, projectPath: string) => {
  return await actionConfigService.getConfig(projectPath);
});

ipcMain.handle('actions:saveConfig', async (_event, projectPath: string, config: ProjectActionConfig) => {
  return await actionConfigService.saveConfig(projectPath, config);
});

// 5. Vector RAG & Knowledge Search
import { searchProjectDocs, getProjectRagStats } from './services/ragSearch';
import type { RagSearchOptions } from '../src/types/electron';

ipcMain.handle('rag:search', async (_event, options: RagSearchOptions) => {
  return await searchProjectDocs(options);
});

ipcMain.handle('rag:getStats', async (_event, projectPath: string) => {
  return await getProjectRagStats(projectPath);
});

// 6. Git
ipcMain.handle('git:getLog', async (_event, projectPath: string, maxCount: number = 30) => {
  try {
    if (!existsSync(path.join(projectPath, '.git'))) return [];
    const git = simpleGit(projectPath);
    const log = await git.log({ maxCount });
    return log.all.map((c) => ({
      hash: c.hash,
      date: c.date,
      message: c.message,
      author_name: c.author_name,
      author_email: c.author_email
    }));
  } catch (e) {
    console.error(`Git log error for ${projectPath}:`, e);
    return [];
  }
});

ipcMain.handle('git:getStatus', async (_event, projectPath: string) => {
  try {
    if (!existsSync(path.join(projectPath, '.git'))) return null;
    const git = simpleGit(projectPath);
    return await git.status();
  } catch (e) {
    console.error(`Git status error for ${projectPath}:`, e);
    return null;
  }
});

// 6b. Git — Extended Operations (via gitService)

ipcMain.handle('git:getRepoDetails', async (_event, projectPath: string) => {
  return await gitService.getRepoDetails(projectPath);
});

// Закрытие вкладки проекта в рендерере: снимаем вотчеры git этого проекта (TASK-34).
ipcMain.handle('git:unwatch', async (_event, projectPath: string) => {
  gitService.unwatchProjectGit(await assertRegisteredProject(projectPath));
  return true;
});

ipcMain.handle('git:checkout', async (_event, projectPath: string, branchName: string, createNew = false) => {
  return await gitService.checkoutBranch(projectPath, branchName, createNew);
});

ipcMain.handle('git:createBranch', async (_event, projectPath: string, branchName: string) => {
  return await gitService.createBranch(projectPath, branchName);
});

ipcMain.handle('git:stageFile', async (_event, projectPath: string, filePath: string) => {
  return await gitService.stageFile(projectPath, filePath);
});

ipcMain.handle('git:unstageFile', async (_event, projectPath: string, filePath: string) => {
  return await gitService.unstageFile(projectPath, filePath);
});

ipcMain.handle('git:stageAll', async (_event, projectPath: string) => {
  return await gitService.stageAll(projectPath);
});

ipcMain.handle('git:commit', async (_event, projectPath: string, message: string, stageAll = false) => {
  return await gitService.commitChanges(projectPath, message, stageAll);
});

ipcMain.handle('git:getFileDiff', async (_event, projectPath: string, filePath: string, staged = false) => {
  return await gitService.getFileDiff(projectPath, filePath, staged);
});

ipcMain.handle('git:deleteBranch', async (_event, projectPath: string, branchName: string, force = false) => {
  return await gitService.deleteBranch(projectPath, branchName, force);
});

ipcMain.handle('git:mergeBranch', async (_event, projectPath: string, branchName: string) => {
  return await gitService.mergeBranch(projectPath, branchName);
});

ipcMain.handle('git:fetchRemote', async (_event, projectPath: string) => {
  return await gitService.fetchRemote(projectPath);
});

ipcMain.handle('git:pullRemote', async (_event, projectPath: string) => {
  return await gitService.pullRemote(projectPath);
});

ipcMain.handle('git:pushRemote', async (_event, projectPath: string) => {
  return await gitService.pushRemote(projectPath);
});

ipcMain.handle('git:discardFileChanges', async (_event, projectPath: string, filePath: string) => {
  return await gitService.discardFileChanges(projectPath, filePath);
});

ipcMain.handle('git:getDiffBetween', async (_event, projectPath: string, targetA: string, targetB?: string, filePath?: string) => {
  return await gitService.getDiffBetween(projectPath, targetA, targetB, filePath);
});

// 7. Pull & Merge Requests
import { prService } from './services/prService';
import type { PRCreateOptions } from '../src/types/electron';

ipcMain.handle('pr:getProviderInfo', async (_event, projectPath: string) => {
  return await prService.getProviderInfo(projectPath);
});

ipcMain.handle('pr:list', async (_event, projectPath: string, state?: 'all' | 'open' | 'closed' | 'merged') => {
  return await prService.listPullRequests(projectPath, state);
});

ipcMain.handle('pr:create', async (_event, projectPath: string, options: PRCreateOptions) => {
  return await prService.createPullRequest(projectPath, options);
});

ipcMain.handle('pr:getDiff', async (_event, projectPath: string, prNumber: number) => {
  return await prService.getPRDiff(projectPath, prNumber);
});

// 8. Documentation & ADR Decisions
import { listProjectDocs, readDocFile, saveDocFile, createProjectDoc } from './services/docsService';
import type { CreateDocParams } from '../src/types/electron';

ipcMain.handle('docs:list', async (_event, projectPath: string) => {
  return await listProjectDocs(projectPath);
});

ipcMain.handle('docs:read', async (_event, filePath: string) => {
  return await readDocFile(await assertInsideRegisteredProject(filePath));
});

ipcMain.handle('docs:save', async (_event, filePath: string, content: string) => {
  return await saveDocFile(await assertInsideRegisteredProject(filePath), content);
});

ipcMain.handle('docs:create', async (_event, projectPath: string, params: CreateDocParams) => {
  return await createProjectDoc(await assertRegisteredProject(projectPath), params);
});

// 9. Milestones & Roadmap
import { listMilestones, createMilestone, saveMilestone, deleteMilestone } from './services/milestoneService';
import type { CreateMilestoneParams } from '../src/types/electron';

ipcMain.handle('milestones:list', async (_event, projectPath: string) => {
  return await listMilestones(projectPath);
});

ipcMain.handle('milestones:create', async (_event, projectPath: string, params: CreateMilestoneParams) => {
  return await createMilestone(await assertRegisteredProject(projectPath), params);
});

ipcMain.handle('milestones:save', async (_event, filePath: string, params: Partial<CreateMilestoneParams>) => {
  return await saveMilestone(await assertInsideRegisteredProject(filePath), params);
});

ipcMain.handle('milestones:delete', async (_event, filePath: string) => {
  return await deleteMilestone(await assertInsideRegisteredProject(filePath));
});

// 10. Interactive PTY Terminals (Claude Code & Multi-tab Shell)
import type { CreatePtyOptions } from '../src/types/electron';
import {
  aiAgentService,
  PROJECT_HUB_CLAUDE_DIR,
  type AIProviderConfig,
  type AIStreamRequest
} from './services/aiAgentService';

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

// 11. AI Studio & Multi-provider Agent
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

ipcMain.handle('ai:abortStream', async (_event, sessionId: string) => {
  aiAgentService.abortStream(sessionId);
  claudeBridgeService.abortSession(sessionId);
  return true;
});

// Закрытие/очистка диалога в UI: отклонить ожидающие одобрения, убить процессы сессии,
// забыть resume-id Claude CLI и подагентов (TASK-33).
ipcMain.handle('ai:clearSession', async (_event, sessionId: string) => {
  if (typeof sessionId !== 'string' || !sessionId) return false;
  claudeBridgeService.clearSession(sessionId);
  return true;
});

ipcMain.handle('ai:applyDiff', async (_event, projectPath: string, relativePath: string, newContent: string) => {
  return await aiAgentService.applyDiff(projectPath, relativePath, newContent);
});

// История диалогов AI Studio в файлах ~/.projecthub/sessions/<hash(projectPath)>/<id>.json (TASK-35).
// projectPath не используется как путь на диске (только хэшируется), sessionId проверяется в сервисе.
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

ipcMain.handle('ai:streamChat', async (_event, req: AIStreamRequest) => {
  if (!win) return;
  const targetWin = win;
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
    // Исключение вне внутренних try/catch сервиса: не даём ему стать unhandled rejection,
    // а сообщаем в UI как обычную ошибку сессии.
    const message = err?.message || String(err);
    console.error(`[Main] ai:streamChat failed for session ${req.sessionId}:`, err);
    claudeBridgeService.setProjectStatus(req.projectPath, 'error', message);
    send(`ai:error:${req.sessionId}`, message);
  }
});

// Claude Bridge & Subagents Handlers
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

import { claudeUsageService } from './services/claudeUsageService';

ipcMain.handle('claudeBridge:getUsage', async (_event, forceRefresh = false) => {
  return await claudeUsageService.getUsage(forceRefresh);
});

// 12. File System Helpers for AI & Explorer
import { fileService } from './services/fileService';

// projectPath приходит от рендерера — принимаем только корни из реестра (TASK-32); относительный
// путь дополнительно проверяется внутри fileService (выход за корень через `..` запрещён).
ipcMain.handle('files:readTree', async (_event, projectPath: string, subDir = '', maxDepth = 6) => {
  return await fileService.readTree(await assertRegisteredProject(projectPath), subDir, maxDepth);
});

ipcMain.handle('files:readContent', async (_event, projectPath: string, relativePath: string) => {
  return await fileService.readFileContent(await assertRegisteredProject(projectPath), relativePath);
});

ipcMain.handle('files:saveContent', async (_event, projectPath: string, relativePath: string, content: string) => {
  return await fileService.saveFileContent(await assertRegisteredProject(projectPath), relativePath, content);
});

ipcMain.handle('files:create', async (_event, projectPath: string, relativePath: string, isDirectory = false) => {
  return await fileService.createFileOrFolder(await assertRegisteredProject(projectPath), relativePath, isDirectory);
});

ipcMain.handle('files:delete', async (_event, projectPath: string, relativePath: string) => {
  return await fileService.deleteFileOrFolder(await assertRegisteredProject(projectPath), relativePath);
});

ipcMain.handle('file:readFile', async (_event, projectPath: string, relativePath: string) => {
  return await fileService.readFileContent(await assertRegisteredProject(projectPath), relativePath);
});

ipcMain.handle('file:writeFile', async (_event, projectPath: string, relativePath: string, content: string) => {
  return await fileService.saveFileContent(await assertRegisteredProject(projectPath), relativePath, content);
});

ipcMain.handle('file:listFiles', async (_event, projectPath: string, subDir?: string) => {
  const tree = await fileService.readTree(await assertRegisteredProject(projectPath), subDir || '', 1);
  return tree.map((t) => ({
    name: t.name,
    isDirectory: t.isDirectory,
    relativePath: t.relativePath
  }));
});

ipcMain.handle('voice:transcribeLocal', async (_event, { audioData, language }) => {
  return await localWhisperService.transcribe(audioData, language);
});

ipcMain.handle('voice:getLocalWhisperStatus', async () => {
  return localWhisperService.getState();
});

ipcMain.handle('system:getPlatform', async () => {
  return process.platform;
});

// SafeStorage & Secret Encryption IPC Handlers
ipcMain.handle('secrets:isEncryptionAvailable', async () => {
  return secretStorageService.isEncryptionAvailable();
});

ipcMain.handle('secrets:encrypt', async (_event, text: string) => {
  return secretStorageService.encrypt(text);
});

ipcMain.handle('secrets:decrypt', async (_event, cipherText: string) => {
  return secretStorageService.decrypt(cipherText);
});

ipcMain.handle('secrets:setSecret', async (_event, { key, value }: { key: string; value: string }) => {
  await secretStorageService.setSecret(key, value);
  return true;
});

ipcMain.handle('secrets:getSecret', async (_event, key: string) => {
  return await secretStorageService.getSecret(key);
});

ipcMain.handle('secrets:deleteSecret', async (_event, key: string) => {
  return await secretStorageService.deleteSecret(key);
});

// Remote MCP Server IPC Handlers
// Открытие внешних ссылок из рендерера: только http/https/mailto, всегда в системном браузере
ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  if (typeof url !== 'string' || !isOpenExternalAllowed(url)) {
    console.warn(`[Security] shell:openExternal rejected URL: ${String(url).slice(0, 200)}`);
    return false;
  }
  try {
    await shell.openExternal(url);
    return true;
  } catch (err) {
    console.error('[Security] shell.openExternal failed:', err);
    return false;
  }
});

ipcMain.handle('mcp:getStatus', async () => {
  return mcpServerService.getStatus();
});

ipcMain.handle('mcp:toggleServer', async (_event, enable: boolean) => {
  if (enable) {
    await mcpServerService.start();
  } else {
    await mcpServerService.stop();
  }
  return mcpServerService.getStatus();
});

ipcMain.handle('mcp:regenerateToken', async () => {
  return mcpServerService.regenerateToken();
});

ipcMain.handle('mcp:setAppState', async (_event, state: { activeProject?: any; activeTab?: string }) => {
  mcpServerService.setAppState(state);
  return true;
});

let isCleaningUp = false;

async function performGracefulShutdown() {
  if (isCleaningUp) return;
  isCleaningUp = true;

  console.log('[Main] Performing graceful shutdown of all processes and resources...');

  // 1. Destroy overlay window if still alive
  if (voiceOverlayWin && !voiceOverlayWin.isDestroyed()) {
    try {
      voiceOverlayWin.destroy();
    } catch {}
    voiceOverlayWin = null;
  }

  // 2. Stop Git watchers
  try {
    gitService.cleanupAll();
  } catch (e) {
    console.warn('[Main] Error cleaning up git watchers:', e);
  }

  // 3. Stop background dev processes, agent sessions (Claude CLI + команды агента) and terminals
  try {
    processManager.cleanupAll();
  } catch (e) {
    console.warn('[Main] Error cleaning up processes:', e);
  }

  try {
    claudeBridgeService.killAll();
  } catch (e) {
    console.warn('[Main] Error cleaning up agent sessions:', e);
  }

  try {
    ptyService.cleanupAll();
  } catch (e) {
    console.warn('[Main] Error cleaning up pty:', e);
  }

  // 4. Dispose Whisper Worker and release ONNX runtime threads
  try {
    await localWhisperService.dispose();
  } catch (e) {
    console.warn('[Main] Error disposing whisper service:', e);
  }

  // 5. Stop Remote MCP Server and close listening HTTP socket
  try {
    await mcpServerService.stop();
  } catch (e) {
    console.warn('[Main] Error stopping MCP server:', e);
  }

  console.log('[Main] Graceful shutdown completed successfully.');
  app.exit(0);
  process.exit(0);
}

app.on('before-quit', (event) => {
  if (!isCleaningUp) {
    event.preventDefault();
    performGracefulShutdown();
    // Safety guard: if any native dependency hangs during exit, force exit after 1.5s
    setTimeout(() => {
      console.warn('[Main] Force exiting after 1.5s shutdown timeout.');
      app.exit(0);
      process.exit(0);
    }, 1500).unref();
  }
});

app.whenReady().then(() => {
  // Разрешения только для собственных окон и только media/audioCapture (см. isPermissionAllowed)
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
  // Initialize Local Whisper in non-blocking background task
  localWhisperService.initBackground();
  // Human-in-the-loop для Claude CLI: разрешения запрашиваются через встроенный MCP-сервер (TASK-42)
  claudeBridgeService.setCliPermissionBroker({
    ensureEndpoint: () => mcpServerService.ensurePermissionEndpoint()
  });
  // Start Built-in Remote Control MCP Server on 127.0.0.1:42042
  mcpServerService.start().catch((err) => {
    console.error('[Main] Failed to auto-start Remote MCP server:', err);
  });
});




