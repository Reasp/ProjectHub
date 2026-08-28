import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { app } from 'electron';

export interface ProjectRegistryEntry {
  path: string;
  addedAt: string;
  favorite?: boolean;
  tags?: string[];
}

export interface RegistryConfig {
  version: number;
  scanRoots: string[];
  projects: ProjectRegistryEntry[];
  settings: {
    autoScanOnStartup: boolean;
    scanDepth: number;
  };
}

const DEFAULT_SCAN_ROOTS = process.platform === 'win32'
  ? ['F:\\', 'D:\\', path.join(os.homedir(), 'Projects')]
  : [path.join(os.homedir(), 'Projects'), path.join(os.homedir(), 'Developer')];

const DEFAULT_CONFIG: RegistryConfig = {
  version: 1,
  scanRoots: DEFAULT_SCAN_ROOTS.filter((p) => existsSync(p)),
  projects: [
    {
      path: process.cwd(),
      addedAt: new Date().toISOString(),
      favorite: true,
      tags: ['hub', 'core']
    }
  ],
  settings: {
    autoScanOnStartup: true,
    scanDepth: 2
  }
};

class ProjectRegistry {
  private configPath: string;
  private cachedConfig: RegistryConfig | null = null;

  constructor() {
    const homeDir = os.homedir();
    const hubDir = path.join(homeDir, '.projecthub');
    this.configPath = path.join(hubDir, 'projects.json');
  }

  private async ensureConfigFile(): Promise<string> {
    try {
      const dir = path.dirname(this.configPath);
      if (!existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }
      if (!existsSync(this.configPath)) {
        await fs.writeFile(this.configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
      }
      return this.configPath;
    } catch (e) {
      // Fallback to app userData if home dir fails
      const fallbackDir = app ? app.getPath('userData') : path.join(os.tmpdir(), '.projecthub');
      if (!existsSync(fallbackDir)) {
        await fs.mkdir(fallbackDir, { recursive: true });
      }
      this.configPath = path.join(fallbackDir, 'projects.json');
      if (!existsSync(this.configPath)) {
        await fs.writeFile(this.configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
      }
      return this.configPath;
    }
  }

  async getConfig(): Promise<RegistryConfig> {
    if (this.cachedConfig) return this.cachedConfig;
    await this.ensureConfigFile();
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      const parsed: RegistryConfig = JSON.parse(raw);
      this.cachedConfig = {
        ...DEFAULT_CONFIG,
        ...parsed,
        projects: parsed.projects || [],
        scanRoots: parsed.scanRoots || DEFAULT_CONFIG.scanRoots,
        settings: { ...DEFAULT_CONFIG.settings, ...parsed.settings }
      };
      return this.cachedConfig;
    } catch (e) {
      console.error('Failed to parse projects.json, restoring default config:', e);
      this.cachedConfig = DEFAULT_CONFIG;
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
}

export const projectRegistry = new ProjectRegistry();
