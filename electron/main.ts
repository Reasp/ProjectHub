import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import matter from 'gray-matter';
import { simpleGit } from 'simple-git';
import type { ProjectInfo, BacklogTask, GitCommit, ScanOptions } from '../src/types/electron';
import { projectRegistry } from './services/projectRegistry';
import { inspectProject, scanDirectories } from './services/projectScanner';
import { claudeBridgeService } from './services/claudeBridgeService';
import { localWhisperService } from './services/localWhisperService';
import { secretStorageService } from './services/secretStorageService';
import { mcpServerService } from './services/mcpServerService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The built directory structure
process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(__dirname, '../public');

let win: BrowserWindow | null = null;
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

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

  win = new BrowserWindow({
    title: 'ProjectHub — Панель управления проектами',
    icon: appIcon,
    width: 1400,
    height: 900,
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
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
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

// 2. Backlog Tasks & File Watcher
ipcMain.handle('backlog:watchProject', async (_event, projectPath: string) => {
  backlogWatcher.watch(projectPath, win);
});

function parseTaskDetails(rawContent: string) {
  const criteria: Array<{ text: string; completed: boolean }> = [];
  const lines = rawContent.split('\n');
  let inCriteriaSection = false;
  let descLines: string[] = [];
  let inDescSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## Acceptance Criteria')) {
      inCriteriaSection = true;
      inDescSection = false;
      continue;
    } else if (trimmed.startsWith('## Description')) {
      inDescSection = true;
      inCriteriaSection = false;
      continue;
    } else if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
      inCriteriaSection = false;
      inDescSection = false;
    }

    if (inCriteriaSection) {
      const match = trimmed.match(/^-\s*\[([ xX])\]\s*(.*)$/);
      if (match) {
        criteria.push({
          completed: match[1].toLowerCase() === 'x',
          text: match[2].trim()
        });
      }
    } else if (inDescSection) {
      descLines.push(line);
    }
  }

  const description = descLines.join('\n').trim();
  return { criteria, description };
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
        const parsed = matter(raw);
        const { criteria, description } = parseTaskDetails(parsed.content);

        taskList.push({
          id: (parsed.data.id as string) || path.basename(file, '.md').split('-')[0].trim(),
          title: (parsed.data.title as string) || path.basename(file, '.md'),
          status: (parsed.data.status as any) || 'To Do',
          labels: (parsed.data.labels as string[]) || [],
          milestone: (parsed.data.milestone as string) || (parsed.data.milestone_id as string) || undefined,
          created: parsed.data.created ? String(parsed.data.created) : undefined,
          filePath: fullPath,
          content: parsed.content,
          description: description || parsed.content,
          acceptanceCriteria: criteria
        });
      }
    }
  } catch (err) {
    console.error(`Error reading tasks from ${tasksDir}:`, err);
  }

  return taskList;
});

ipcMain.handle('backlog:updateTaskStatus', async (_event, filePath: string, newStatus: string) => {
  try {
    if (!existsSync(filePath)) return false;
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(raw);
    parsed.data.status = newStatus;
    const updatedContent = matter.stringify(parsed.content, parsed.data);
    await fs.writeFile(filePath, updatedContent, 'utf-8');
    return true;
  } catch (err) {
    console.error(`Failed to update status for ${filePath}:`, err);
    return false;
  }
});

ipcMain.handle('backlog:toggleCriterion', async (_event, filePath: string, index: number, completed: boolean) => {
  try {
    if (!existsSync(filePath)) return false;
    const raw = await fs.readFile(filePath, 'utf-8');
    let currentIndex = 0;
    const lines = raw.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(\s*-\s*\[)([ xX])(\]\s*.*)$/);
      if (match) {
        if (currentIndex === index) {
          lines[i] = `${match[1]}${completed ? 'x' : ' '}${match[3]}`;
          modified = true;
          break;
        }
        currentIndex++;
      }
    }

    if (modified) {
      await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
      return true;
    }
    return false;
  } catch (err) {
    console.error(`Failed to toggle criterion in ${filePath}:`, err);
    return false;
  }
});

ipcMain.handle('backlog:saveFullTask', async (_event, filePath: string, data: {
  title: string;
  status: BacklogTask['status'];
  labels: string[];
  milestone?: string;
  description: string;
  criteria?: Array<{ text: string; completed: boolean }>;
}) => {
  try {
    if (!existsSync(filePath)) return false;
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(raw);

    parsed.data.title = data.title;
    parsed.data.status = data.status;
    parsed.data.labels = data.labels;
    if (data.milestone) {
      parsed.data.milestone = data.milestone;
    } else {
      delete parsed.data.milestone;
      delete parsed.data.milestone_id;
    }

    const taskId = parsed.data.id || path.basename(filePath, '.md').split('-')[0].trim();
    let body = `\n# ${taskId}: ${data.title}\n\n## Description\n${data.description || 'Описание задачи'}\n\n## Acceptance Criteria\n`;

    if (data.criteria && data.criteria.length > 0) {
      for (const crit of data.criteria) {
        body += `- [${crit.completed ? 'x' : ' '}] ${crit.text}\n`;
      }
    } else {
      body += `- [ ] Критерий 1\n`;
    }

    const updatedContent = matter.stringify(body, parsed.data);
    await fs.writeFile(filePath, updatedContent, 'utf-8');
    return true;
  } catch (err) {
    console.error(`Failed to save full task ${filePath}:`, err);
    return false;
  }
});

ipcMain.handle('backlog:deleteTask', async (_event, filePath: string) => {
  try {
    if (!existsSync(filePath)) return false;
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    console.error(`Failed to delete task ${filePath}:`, err);
    return false;
  }
});

ipcMain.handle('backlog:saveTask', async (_event, filePath: string, content: string) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return true;
  } catch (err) {
    console.error(`Failed to save task ${filePath}:`, err);
    return false;
  }
});

ipcMain.handle('backlog:createTask', async (_event, projectPath: string, task: { title: string; description: string; labels: string[] }) => {
  try {
    const tasksDir = path.join(projectPath, 'backlog', 'tasks');
    if (!existsSync(tasksDir)) {
      await fs.mkdir(tasksDir, { recursive: true });
    }

    // Determine next task number
    const existing = await fs.readdir(tasksDir);
    let maxId = 0;
    for (const f of existing) {
      const match = f.match(/task-(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxId) maxId = num;
      }
    }

    const nextId = `task-${maxId + 1}`;
    const sanitizedTitle = task.title.replace(/[\\/:*?"<>|]/g, '-').trim();
    const fileName = `${nextId} - ${sanitizedTitle}.md`;
    const fullPath = path.join(tasksDir, fileName);

    const today = new Date().toISOString().split('T')[0];
    const frontmatter = {
      id: nextId,
      title: task.title,
      status: 'To Do',
      labels: task.labels || [],
      created: today
    };

    const fileBody = `\n# ${nextId}: ${task.title}\n\n## Description\n${task.description || 'Описание задачи'}\n\n## Acceptance Criteria\n- [ ] Критерий 1\n`;
    const finalContent = matter.stringify(fileBody, frontmatter);

    await fs.writeFile(fullPath, finalContent, 'utf-8');

    return {
      id: nextId,
      title: task.title,
      status: 'To Do' as const,
      labels: task.labels || [],
      created: today,
      filePath: fullPath,
      content: fileBody
    };
  } catch (err) {
    console.error('Failed to create task:', err);
    return null;
  }
});


// 3. Project Template Wizard
import { createProjectFromTemplate, checkTemplateAvailable } from './services/templateWizard';
import { processManager } from './services/processManager';
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
import { gitService } from './services/gitService';

ipcMain.handle('git:getRepoDetails', async (_event, projectPath: string) => {
  return await gitService.getRepoDetails(projectPath);
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
  return await readDocFile(filePath);
});

ipcMain.handle('docs:save', async (_event, filePath: string, content: string) => {
  return await saveDocFile(filePath, content);
});

ipcMain.handle('docs:create', async (_event, projectPath: string, params: CreateDocParams) => {
  return await createProjectDoc(projectPath, params);
});

// 9. Milestones & Roadmap
import { listMilestones, createMilestone, saveMilestone, deleteMilestone } from './services/milestoneService';
import type { CreateMilestoneParams } from '../src/types/electron';

ipcMain.handle('milestones:list', async (_event, projectPath: string) => {
  return await listMilestones(projectPath);
});

ipcMain.handle('milestones:create', async (_event, projectPath: string, params: CreateMilestoneParams) => {
  return await createMilestone(projectPath, params);
});

ipcMain.handle('milestones:save', async (_event, filePath: string, params: Partial<CreateMilestoneParams>) => {
  return await saveMilestone(filePath, params);
});

ipcMain.handle('milestones:delete', async (_event, filePath: string) => {
  return await deleteMilestone(filePath);
});

// 10. Interactive PTY Terminals (Claude Code & Multi-tab Shell)
import { ptyService } from './services/ptyService';
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

ipcMain.handle('ai:applyDiff', async (_event, projectPath: string, relativePath: string, newContent: string) => {
  return await aiAgentService.applyDiff(projectPath, relativePath, newContent);
});

ipcMain.handle('ai:streamChat', async (_event, req: AIStreamRequest) => {
  if (!win) return;
  const targetWin = win;

  claudeBridgeService.runAgentTask(
    req,
    (chunk) => {
      if (!targetWin.isDestroyed()) {
        targetWin.webContents.send(`ai:chunk:${req.sessionId}`, chunk);
      }
    },
    (fullMsg) => {
      if (!targetWin.isDestroyed()) {
        targetWin.webContents.send(`ai:complete:${req.sessionId}`, fullMsg);
      }
    },
    (err) => {
      if (!targetWin.isDestroyed()) {
        targetWin.webContents.send(`ai:error:${req.sessionId}`, err);
      }
    }
  );
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

ipcMain.handle('files:readTree', async (_event, projectPath: string, subDir = '', maxDepth = 6) => {
  return await fileService.readTree(projectPath, subDir, maxDepth);
});

ipcMain.handle('files:readContent', async (_event, projectPath: string, relativePath: string) => {
  return await fileService.readFileContent(projectPath, relativePath);
});

ipcMain.handle('files:saveContent', async (_event, projectPath: string, relativePath: string, content: string) => {
  return await fileService.saveFileContent(projectPath, relativePath, content);
});

ipcMain.handle('files:create', async (_event, projectPath: string, relativePath: string, isDirectory = false) => {
  return await fileService.createFileOrFolder(projectPath, relativePath, isDirectory);
});

ipcMain.handle('files:delete', async (_event, projectPath: string, relativePath: string) => {
  return await fileService.deleteFileOrFolder(projectPath, relativePath);
});

ipcMain.handle('file:readFile', async (_event, projectPath: string, relativePath: string) => {
  return await fileService.readFileContent(projectPath, relativePath);
});

ipcMain.handle('file:writeFile', async (_event, projectPath: string, relativePath: string, content: string) => {
  return await fileService.saveFileContent(projectPath, relativePath, content);
});

ipcMain.handle('file:listFiles', async (_event, projectPath: string, subDir?: string) => {
  const tree = await fileService.readTree(projectPath, subDir || '', 1);
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

app.on('before-quit', () => {
  processManager.cleanupAll();
  ptyService.cleanupAll();
  mcpServerService.stop().catch(() => {});
});

app.whenReady().then(() => {
  createWindow();
  // Initialize Local Whisper in non-blocking background task
  localWhisperService.initBackground();
  // Start Built-in Remote Control MCP Server on 127.0.0.1:42042
  mcpServerService.start().catch((err) => {
    console.error('[Main] Failed to auto-start Remote MCP server:', err);
  });
});




