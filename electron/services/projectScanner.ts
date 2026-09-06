import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import { simpleGit } from 'simple-git';
import type { ProjectInfo, RagStatus, ProcessStatus, RunningProcess, GitLastCommit } from '../../src/types/electron';
import { projectRegistry } from './projectRegistry';
import { isFilesystemRoot } from './appPaths';

const IGNORED_FOLDERS = new Set([
  'node_modules',
  '.git',
  '.agents',
  '.claude',
  '.gemini',
  'dist',
  'dist-electron',
  'build',
  '.next',
  '.nuxt',
  '$recycle.bin',
  'system volume information',
  'appdata',
  'windows'
]);

export interface InspectProjectOptions {
  /**
   * Не запускать git-команды (status/log) — только проверка маркеров и чтение файлов.
   * Используется при сканировании каталогов: git в каждой папке-кандидате делал скан
   * многоминутным (аудит 5.10). Git-статус вычисляется при добавлении проекта в реестр
   * и при обычном обновлении списка (projects:list / projects:refresh).
   */
  skipGit?: boolean;
}

export async function inspectProject(folderPath: string, options: InspectProjectOptions = {}): Promise<ProjectInfo | null> {
  try {
    const normalizedPath = path.normalize(folderPath);
    if (!existsSync(normalizedPath)) return null;

    const stat = await fs.stat(normalizedPath);
    if (!stat.isDirectory()) return null;

    const hasBacklog = existsSync(path.join(normalizedPath, 'backlog'));
    const hasInfraConfig = existsSync(path.join(normalizedPath, 'infra.config.json'));
    const hasGit = existsSync(path.join(normalizedPath, '.git'));
    const hasPackageJson = existsSync(path.join(normalizedPath, 'package.json'));

    // Must have at least one ProjectTemplate marker or package.json with git
    if (!hasBacklog && !hasInfraConfig && !(hasGit && hasPackageJson)) {
      return null;
    }

    let projectName = path.basename(normalizedPath);
    let projectDescription: string | undefined;
    let projectVersion: string | undefined;
    let features: ProjectInfo['features'] = undefined;

    // 1. Read infra.config.json if available
    if (hasInfraConfig) {
      try {
        const rawConfig = await fs.readFile(path.join(normalizedPath, 'infra.config.json'), 'utf-8');
        const parsed = JSON.parse(rawConfig);
        features = parsed.features;
      } catch (e) {
        // ignore
      }
    }

    // 2. Read package.json if available
    if (hasPackageJson) {
      try {
        const rawPkg = await fs.readFile(path.join(normalizedPath, 'package.json'), 'utf-8');
        const pkg = JSON.parse(rawPkg);
        if (pkg.name) projectName = pkg.name;
        if (pkg.description) projectDescription = pkg.description;
        if (pkg.version) projectVersion = pkg.version;
      } catch (e) {
        // ignore
      }
    }

    // 3. Read backlog/config.yml if available (takes precedence for display name)
    if (hasBacklog && existsSync(path.join(normalizedPath, 'backlog', 'config.yml'))) {
      try {
        const rawBacklog = await fs.readFile(path.join(normalizedPath, 'backlog', 'config.yml'), 'utf-8');
        const match = rawBacklog.match(/project_name:\s*["']?([^"'\r\n]+)["']?/);
        if (match && match[1]) {
          projectName = match[1].trim();
        }
      } catch (e) {
        // ignore
      }
    }

    // 4. Calculate Backlog task counts
    let taskCounts = { total: 0, todo: 0, inProgress: 0, review: 0, done: 0 };
    if (hasBacklog && existsSync(path.join(normalizedPath, 'backlog', 'tasks'))) {
      try {
        const taskFiles = await fs.readdir(path.join(normalizedPath, 'backlog', 'tasks'));
        for (const file of taskFiles) {
          if (file.endsWith('.md')) {
            taskCounts.total++;
            try {
              const content = await fs.readFile(path.join(normalizedPath, 'backlog', 'tasks', file), 'utf-8');
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

    // 5. Git status & last commit
    let gitBranch: string | undefined;
    let gitClean: boolean | undefined;
    let uncommittedCount = 0;
    let gitAhead = 0;
    let gitBehind = 0;
    let lastCommit: GitLastCommit | undefined;

    if (hasGit && !options.skipGit) {
      try {
        const git = simpleGit(normalizedPath);
        const status = await git.status();
        gitBranch = status.current || 'detached';
        gitClean = status.isClean();
        uncommittedCount = status.files.length;
        gitAhead = status.ahead || 0;
        gitBehind = status.behind || 0;

        const logs = await git.log({ maxCount: 1 });
        if (logs.latest) {
          lastCommit = {
            hash: logs.latest.hash,
            message: logs.latest.message,
            date: logs.latest.date,
            author: logs.latest.author_name
          };
        }
      } catch (e) {
        // Git error or detached HEAD
      }
    }

    // 6. RAG Status
    let ragStatus: RagStatus | undefined;
    const ragMetaPath = path.join(normalizedPath, '.rag-index', 'meta.json');
    if (existsSync(ragMetaPath)) {
      try {
        const rawMeta = await fs.readFile(ragMetaPath, 'utf-8');
        const meta = JSON.parse(rawMeta);
        ragStatus = {
          ready: true,
          chunksCount: meta.chunks || 0,
          filesCount: meta.files?.length || 0,
          builtAt: meta.builtAt,
          model: meta.model
        };
      } catch (e) {
        ragStatus = { ready: true };
      }
    } else if (existsSync(path.join(normalizedPath, 'scripts', 'rag')) || (features && features.docsRag)) {
      ragStatus = { ready: false };
    }

    // 7. Process Status (.env-state/processes.json)
    let processStatus: ProcessStatus = { runningCount: 0, processes: [] };
    const envStatePath = path.join(normalizedPath, '.env-state', 'processes.json');
    if (existsSync(envStatePath)) {
      try {
        const rawEnv = await fs.readFile(envStatePath, 'utf-8');
        const procMap: Record<string, any> = JSON.parse(rawEnv);
        const running: RunningProcess[] = [];

        for (const [name, info] of Object.entries(procMap)) {
          if (info && info.pid) {
            let alive = false;
            try {
              process.kill(info.pid, 0);
              alive = true;
            } catch {
              alive = false;
            }
            if (alive) {
              running.push({
                name,
                pid: info.pid,
                command: info.command,
                startedAt: info.startedAt
              });
            }
          }
        }
        processStatus = {
          runningCount: running.length,
          processes: running
        };
      } catch (e) {
        // ignore
      }
    }

    const isFav = await projectRegistry.isFavorite(normalizedPath);
    const voiceAlias = await projectRegistry.getVoiceAlias(normalizedPath);

    return {
      name: projectName,
      path: normalizedPath,
      description: projectDescription,
      version: projectVersion,
      favorite: isFav,
      voiceAlias,
      hasBacklog,
      hasInfraConfig,
      hasGit,
      gitBranch,
      gitClean,
      gitAhead,
      gitBehind,
      uncommittedCount,
      lastCommit,
      taskCounts,
      ragStatus,
      processStatus,
      features,
      lastScannedAt: new Date().toISOString()
    };
  } catch (err) {
    console.error(`Error inspecting project at ${folderPath}:`, err);
    return null;
  }
}

/**
 * Recursively scans directories up to the given maxDepth.
 *
 * Корни-диски (`C:\`, `/`) пропускаются: обход диска с глубиной 2 задевает Program Files,
 * Windows и AppData и длится минуты; корни автопоиска должны указывать на каталоги с проектами.
 */
export async function scanDirectories(
  rootDirs: string[],
  maxDepth = 2
): Promise<ProjectInfo[]> {
  const discoveredMap = new Map<string, ProjectInfo>();

  async function scanLevel(currentDir: string, currentDepth: number) {
    if (currentDepth > maxDepth) return;
    try {
      if (!existsSync(currentDir)) return;
      const stat = await fs.stat(currentDir);
      if (!stat.isDirectory()) return;

      // 1. Check if currentDir itself is a project (только маркеры, без git — TASK-43)
      const info = await inspectProject(currentDir, { skipGit: true });
      if (info) {
        discoveredMap.set(path.normalize(info.path).toLowerCase(), info);
        // If it's a project root, we typically don't scan deep inside it (e.g. sub-repos)
        if (currentDepth > 0) return;
      }

      // 2. Scan immediate subdirectories
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const lowerName = entry.name.toLowerCase();
          if (IGNORED_FOLDERS.has(lowerName) || lowerName.startsWith('.')) {
            continue;
          }
          const subPath = path.join(currentDir, entry.name);
          await scanLevel(subPath, currentDepth + 1);
        }
      }
    } catch (e) {
      // Permission denied or inaccessible folder, skip quietly
    }
  }

  for (const root of rootDirs) {
    if (isFilesystemRoot(root)) {
      console.warn(`[Scanner] Skipping filesystem root "${root}": add a projects folder instead of a whole drive`);
      continue;
    }
    await scanLevel(path.normalize(root), 0);
  }

  // Register newly discovered projects into persistent store and compute git status
  // for them once (при добавлении в реестр, а не в каждой папке-кандидате при обходе)
  const results: ProjectInfo[] = [];
  for (const proj of discoveredMap.values()) {
    await projectRegistry.addProject(proj.path, Boolean(proj.favorite));
    const full = await inspectProject(proj.path);
    results.push(full ?? proj);
  }

  return results;
}
