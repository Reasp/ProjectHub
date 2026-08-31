import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { simpleGit } from 'simple-git';
import type { CreateProjectOptions, ProjectInfo } from '../../src/types/electron';
import { projectRegistry } from './projectRegistry';
import { inspectProject } from './projectScanner';

const DEFAULT_TEMPLATE_PATH = 'F:\\ProjectTemplate';

const IGNORED_COPY_NAMES = new Set([
  'node_modules',
  '.git',
  '.rag-index',
  '.rag-cache',
  '.env-state',
  '.lightrag-index',
  '.claude/scheduled_tasks.lock',
  '.claude/worktrees',
  'dist',
  'dist-electron',
  'build'
]);

async function copyDirectoryRecursive(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const lowerName = entry.name.toLowerCase();

    if (IGNORED_COPY_NAMES.has(lowerName)) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

export async function checkTemplateAvailable(customSource?: string): Promise<{ available: boolean; path: string }> {
  const source = customSource || DEFAULT_TEMPLATE_PATH;
  const isAvailable = existsSync(source);
  return { available: isAvailable, path: source };
}

export async function createProjectFromTemplate(options: CreateProjectOptions): Promise<ProjectInfo> {
  const templateSource = options.templateSource || DEFAULT_TEMPLATE_PATH;

  if (!existsSync(templateSource)) {
    throw new Error(`Директория шаблона не найдена: ${templateSource}`);
  }

  const targetDir = path.normalize(options.targetDir);

  if (existsSync(targetDir)) {
    const existing = await fs.readdir(targetDir);
    if (existing.length > 0) {
      throw new Error(`Целевая директория уже существует и не пуста: ${targetDir}`);
    }
  } else {
    await fs.mkdir(targetDir, { recursive: true });
  }

  // 1. Copy template files
  await copyDirectoryRecursive(templateSource, targetDir);

  // 2. Parametrize package.json
  const pkgPath = path.join(targetDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const rawPkg = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(rawPkg);
      pkg.name = options.name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      pkg.version = '0.1.0';
      pkg.description = `Проект ${options.name} на базе ProjectTemplate`;
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to parametrize package.json:', e);
    }
  }

  // 3. Parametrize infra.config.json
  const infraConfigPath = path.join(targetDir, 'infra.config.json');
  if (existsSync(infraConfigPath)) {
    try {
      const rawConfig = await fs.readFile(infraConfigPath, 'utf-8');
      const config = JSON.parse(rawConfig);
      config.projectRoot = '.';
      config.features = {
        ...config.features,
        ...options.features
      };
      await fs.writeFile(infraConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to parametrize infra.config.json:', e);
    }
  }

  // 4. Parametrize backlog/config.yml
  const backlogConfigPath = path.join(targetDir, 'backlog', 'config.yml');
  if (existsSync(backlogConfigPath)) {
    try {
      let rawBacklog = await fs.readFile(backlogConfigPath, 'utf-8');
      rawBacklog = rawBacklog.replace(/project_name:\s*["']?([^"'\r\n]+)["']?/, `project_name: "${options.name}"`);
      await fs.writeFile(backlogConfigPath, rawBacklog, 'utf-8');
    } catch (e) {
      console.error('Failed to parametrize backlog/config.yml:', e);
    }
  }

  // 5. Initialize Git if requested
  if (options.initGit) {
    try {
      const git = simpleGit(targetDir);
      await git.init();
    } catch (e) {
      console.error('Failed to init git:', e);
    }
  }

  // 6. Run node scripts/setup.mjs to sync configs if script exists
  const setupScriptPath = path.join(targetDir, 'scripts', 'setup.mjs');
  if (existsSync(setupScriptPath)) {
    try {
      await new Promise<void>((resolve) => {
        const proc = spawn(process.execPath, [setupScriptPath], {
          cwd: targetDir,
          shell: true
        });
        proc.on('close', () => resolve());
        proc.on('error', () => resolve());
      });
    } catch (e) {
      console.error('Setup script execution warning:', e);
    }
  }

  // 7. Register in ProjectHub registry
  await projectRegistry.addProject(targetDir, true);

  const inspected = await inspectProject(targetDir);
  if (!inspected) {
    throw new Error('Не удалось проинспектировать созданный проект.');
  }

  return inspected;
}
