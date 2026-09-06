import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { getDevRepoRoot, getHomeDir, getUserDataDir } from './appPaths';

export interface ProjectRegistryEntry {
  path: string;
  addedAt: string;
  favorite?: boolean;
  voiceAlias?: string;
  tags?: string[];
}

export interface RegistryConfig {
  version: number;
  scanRoots: string[];
  projects: ProjectRegistryEntry[];
  settings: {
    autoScanOnStartup: boolean;
    scanDepth: number;
    /** Путь к шаблону ProjectTemplate для мастера создания проектов (TASK-43). */
    templatePath?: string;
  };
}

/**
 * Корни автопоиска по умолчанию — только типичные каталоги с проектами в домашней папке.
 * Корень диска (`C:\`) намеренно не включается: скан с глубиной 2 по всему диску
 * обходил Program Files/Windows/AppData и запускал git в каждой папке-кандидате (аудит 5.10).
 */
function getDefaultScanRoots(): string[] {
  const home = getHomeDir();
  const candidates = process.platform === 'win32'
    ? [
        path.join(home, 'Projects'),
        path.join(home, 'source', 'repos'),
        path.join(home, 'Developer'),
        path.join(home, 'Documents', 'Projects')
      ]
    : [path.join(home, 'Projects'), path.join(home, 'Developer'), path.join(home, 'src')];
  return Array.from(new Set(candidates.map((p) => path.normalize(p)))).filter((p) => existsSync(p));
}

/**
 * Конфиг по умолчанию. Реестр не добавляет `process.cwd()`: в упакованном приложении cwd произволен.
 * В dev-режиме (app.isPackaged=false) текущий репозиторий ProjectHub добавляется явно как «hub».
 */
function buildDefaultConfig(): RegistryConfig {
  const projects: ProjectRegistryEntry[] = [];
  const devRoot = getDevRepoRoot();
  if (devRoot) {
    projects.push({
      path: devRoot,
      addedAt: new Date().toISOString(),
      favorite: true,
      tags: ['hub', 'core']
    });
  }
  return {
    version: 1,
    scanRoots: getDefaultScanRoots(),
    projects,
    settings: {
      autoScanOnStartup: true,
      scanDepth: 2
    }
  };
}

class ProjectRegistry {
  private configPath: string;
  private cachedConfig: RegistryConfig | null = null;

  constructor() {
    const hubDir = path.join(getHomeDir(), '.projecthub');
    this.configPath = path.join(hubDir, 'projects.json');
  }

  private async writeDefaultConfig(): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(buildDefaultConfig(), null, 2), 'utf-8');
  }

  private async ensureConfigFile(): Promise<string> {
    try {
      const dir = path.dirname(this.configPath);
      if (!existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }
      if (!existsSync(this.configPath)) {
        await this.writeDefaultConfig();
      }
      return this.configPath;
    } catch (e) {
      // Fallback to app userData if home dir fails
      const fallbackDir = getUserDataDir();
      if (!existsSync(fallbackDir)) {
        await fs.mkdir(fallbackDir, { recursive: true });
      }
      this.configPath = path.join(fallbackDir, 'projects.json');
      if (!existsSync(this.configPath)) {
        await this.writeDefaultConfig();
      }
      return this.configPath;
    }
  }

  async getConfig(): Promise<RegistryConfig> {
    if (this.cachedConfig) return this.cachedConfig;
    await this.ensureConfigFile();
    const defaults = buildDefaultConfig();
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      const parsed: RegistryConfig = JSON.parse(raw);
      this.cachedConfig = {
        ...defaults,
        ...parsed,
        projects: parsed.projects || [],
        scanRoots: parsed.scanRoots || defaults.scanRoots,
        settings: { ...defaults.settings, ...parsed.settings }
      };
      return this.cachedConfig;
    } catch (e) {
      console.error('Failed to parse projects.json, restoring default config:', e);
      this.cachedConfig = defaults;
      await this.saveConfig(this.cachedConfig);
      return this.cachedConfig;
    }
  }

  async saveConfig(config: RegistryConfig): Promise<void> {
    this.cachedConfig = config;
    await this.ensureConfigFile();
    try {
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to save project registry:', e);
    }
  }

  async getScanRoots(): Promise<string[]> {
    const config = await this.getConfig();
    return config.scanRoots;
  }

  async setScanRoots(roots: string[]): Promise<boolean> {
    const config = await this.getConfig();
    config.scanRoots = Array.from(new Set(roots.map((r) => path.normalize(r))));
    await this.saveConfig(config);
    return true;
  }

  async getTemplatePath(): Promise<string | undefined> {
    const config = await this.getConfig();
    return config.settings.templatePath;
  }

  async setTemplatePath(templatePath: string | null): Promise<boolean> {
    const config = await this.getConfig();
    const trimmed = templatePath?.trim();
    config.settings.templatePath = trimmed ? path.normalize(trimmed) : undefined;
    await this.saveConfig(config);
    return true;
  }

  async getProjects(): Promise<ProjectRegistryEntry[]> {
    const config = await this.getConfig();
    return config.projects;
  }

  async addProject(projectPath: string, favorite = false): Promise<boolean> {
    const normalized = path.normalize(projectPath);
    const config = await this.getConfig();
    const existingIndex = config.projects.findIndex((p) => path.normalize(p.path).toLowerCase() === normalized.toLowerCase());

    if (existingIndex >= 0) {
      config.projects[existingIndex].favorite = favorite || config.projects[existingIndex].favorite;
    } else {
      config.projects.unshift({
        path: normalized,
        addedAt: new Date().toISOString(),
        favorite,
        tags: []
      });
    }

    await this.saveConfig(config);
    return true;
  }

  async removeProject(projectPath: string): Promise<boolean> {
    const normalized = path.normalize(projectPath).toLowerCase();
    const config = await this.getConfig();
    const beforeCount = config.projects.length;
    config.projects = config.projects.filter((p) => path.normalize(p.path).toLowerCase() !== normalized);

    if (config.projects.length !== beforeCount) {
      await this.saveConfig(config);
      return true;
    }
    return false;
  }

  async toggleFavorite(projectPath: string): Promise<boolean> {
    const normalized = path.normalize(projectPath).toLowerCase();
    const config = await this.getConfig();
    const target = config.projects.find((p) => path.normalize(p.path).toLowerCase() === normalized);

    if (target) {
      target.favorite = !target.favorite;
      await this.saveConfig(config);
      return target.favorite;
    }
    return false;
  }

  async isFavorite(projectPath: string): Promise<boolean> {
    const normalized = path.normalize(projectPath).toLowerCase();
    const config = await this.getConfig();
    const target = config.projects.find((p) => path.normalize(p.path).toLowerCase() === normalized);
    return Boolean(target?.favorite);
  }

  async setVoiceAlias(projectPath: string, alias: string): Promise<boolean> {
    const normalized = path.normalize(projectPath).toLowerCase();
    const config = await this.getConfig();
    let target = config.projects.find((p) => path.normalize(p.path).toLowerCase() === normalized);

    if (target) {
      target.voiceAlias = alias.trim() || undefined;
      await this.saveConfig(config);
      return true;
    } else {
      // If project not explicitly in registry yet, add it
      config.projects.push({
        path: projectPath,
        addedAt: new Date().toISOString(),
        voiceAlias: alias.trim() || undefined
      });
      await this.saveConfig(config);
      return true;
    }
  }

  async getVoiceAlias(projectPath: string): Promise<string | undefined> {
    const normalized = path.normalize(projectPath).toLowerCase();
    const config = await this.getConfig();
    const target = config.projects.find((p) => path.normalize(p.path).toLowerCase() === normalized);
    return target?.voiceAlias;
  }
}

export const projectRegistry = new ProjectRegistry();
