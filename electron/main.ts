import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import matter from 'gray-matter';
import { simpleGit } from 'simple-git';
import type { ProjectInfo, BacklogTask, GitCommit } from '../src/types/electron';

// The built directory structure
process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(__dirname, '../public');

let win: BrowserWindow | null = null;
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f1117',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f1117',
      symbolColor: '#94a3b8',
      height: 38
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString());
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    // win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(process.env.DIST ?? path.join(__dirname, '../dist'), 'index.html'));
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

// Helper to inspect a single project directory
async function inspectProject(folderPath: string): Promise<ProjectInfo | null> {
  try {
    const hasBacklog = existsSync(path.join(folderPath, 'backlog'));
    const hasInfraConfig = existsSync(path.join(folderPath, 'infra.config.json'));
    const hasGit = existsSync(path.join(folderPath, '.git'));

    if (!hasBacklog && !hasInfraConfig && !hasGit) {
      return null;
    }

    let projectName = path.basename(folderPath);
    let features: ProjectInfo['features'] = undefined;

    // Read infra.config.json if available
    if (hasInfraConfig) {
      try {
        const rawConfig = await fs.readFile(path.join(folderPath, 'infra.config.json'), 'utf-8');
        const parsed = JSON.parse(rawConfig);
        features = parsed.features;
      } catch (e) {
        // ignore
      }
    }

    // Read backlog/config.yml if available
    if (hasBacklog && existsSync(path.join(folderPath, 'backlog', 'config.yml'))) {
      try {
        const rawBacklog = await fs.readFile(path.join(folderPath, 'backlog', 'config.yml'), 'utf-8');
        const match = rawBacklog.match(/project_name:\s*["']?([^"'\r\n]+)["']?/);
        if (match && match[1]) {
          projectName = match[1];
        }
      } catch (e) {
        // ignore
      }
    }

    // Calculate Backlog task counts
    let taskCounts = { total: 0, todo: 0, inProgress: 0, review: 0, done: 0 };
    if (hasBacklog && existsSync(path.join(folderPath, 'backlog', 'tasks'))) {
      try {
        const taskFiles = await fs.readdir(path.join(folderPath, 'backlog', 'tasks'));
        for (const file of taskFiles) {
          if (file.endsWith('.md')) {
            taskCounts.total++;
            try {
              const content = await fs.readFile(path.join(folderPath, 'backlog', 'tasks', file), 'utf-8');
              const { data } = matter(content);
              const status = data.status || 'To Do';
              if (status === 'To Do') taskCounts.todo++;
              else if (status === 'In Progress') taskCounts.inProgress++;
              else if (status === 'Review') taskCounts.review++;
              else if (status === 'Done') taskCounts.done++;
            } catch (e) {
              taskCounts.todo++;
            }
          }
        }
      } catch (e) {
        // ignore
      }
    }

    // Git inspection
    let gitBranch: string | undefined;
    let gitClean = true;
    let uncommittedCount = 0;

    if (hasGit) {
      try {
        const git = simpleGit(folderPath);
        const status = await git.status();
        gitBranch = status.current || 'unknown';
        gitClean = status.isClean();
        uncommittedCount = status.files.length;
      } catch (e) {
        // Git error or detached
      }
    }

    return {
      name: projectName,
      path: folderPath,
      hasBacklog,
      hasInfraConfig,
      hasGit,
      gitBranch,
      gitClean,
      uncommittedCount,
      taskCounts,
      features
    };
  } catch (err) {
    console.error(`Error inspecting ${folderPath}:`, err);
    return null;
  }
}

// ----------------------------------------------------
// IPC HANDLERS
// ----------------------------------------------------

// 1. Projects Scan
ipcMain.handle('projects:scan', async (_event, rootPaths?: string[]) => {
  const scanDirs = rootPaths && rootPaths.length > 0
    ? rootPaths
    : ['F:\\', 'D:\\', process.cwd()];

  const discovered: ProjectInfo[] = [];

  for (const rootDir of scanDirs) {
    try {
      if (!existsSync(rootDir)) continue;
      const stat = await fs.stat(rootDir);
      if (!stat.isDirectory()) continue;

      // Check root directory itself
      const rootInfo = await inspectProject(rootDir);
      if (rootInfo) {
        discovered.push(rootInfo);
      }

      // Check immediate subdirectories
      const entries = await fs.readdir(rootDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== '$RECYCLE.BIN' && entry.name !== 'System Volume Information') {
          const subPath = path.join(rootDir, entry.name);
          const info = await inspectProject(subPath);
          if (info) {
            discovered.push(info);
          }
        }
      }
    } catch (e) {
      console.error(`Failed to scan root: ${rootDir}`, e);
    }
  }

  // Deduplicate by path
  const uniqueMap = new Map<string, ProjectInfo>();
  for (const p of discovered) {
    uniqueMap.set(path.normalize(p.path).toLowerCase(), p);
  }

  return Array.from(uniqueMap.values());
});

ipcMain.handle('projects:getDetails', async (_event, projectPath: string) => {
  return inspectProject(projectPath);
});

// Dialog: Select Directory
ipcMain.handle('dialog:selectDirectory', async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory']
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

// 2. Backlog Tasks
ipcMain.handle('backlog:getTasks', async (_event, projectPath: string) => {
  const tasksDir = path.join(projectPath, 'backlog', 'tasks');
  if (!existsSync(tasksDir)) return [];

  const taskList: BacklogTask[] = [];
  try {
    const files = await fs.readdir(tasksDir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        const fullPath = path.join(tasksDir, file);
        const raw = await fs.readFile(fullPath, 'utf-8');
        const parsed = matter(raw);

        taskList.push({
          id: (parsed.data.id as string) || path.basename(file, '.md').split('-')[0].trim(),
          title: (parsed.data.title as string) || path.basename(file, '.md'),
          status: (parsed.data.status as any) || 'To Do',
          labels: (parsed.data.labels as string[]) || [],
          created: parsed.data.created ? String(parsed.data.created) : undefined,
          filePath: fullPath,
          content: parsed.content
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

// 3. Git
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

ipcMain.handle('system:getPlatform', async () => {
  return process.platform;
});

app.whenReady().then(createWindow);
