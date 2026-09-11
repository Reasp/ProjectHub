import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

export interface ActionDefinition {
  name: string;
  command: string;
  autoOpenUrl?: string;
  /** Задержка автооткрытия URL (мс), если сервер не напечатал адрес в лог; 0 — только по логу. */
  autoOpenDelayMs?: number;
  requiresConfirmation?: boolean;
  env?: Record<string, string>;
  cwd?: string;
  /**
   * `fixed` (по умолчанию) — порт как записан в команде; `auto` — ProjectHub подбирает
   * свободный порт, кладёт его в `PORT` и подставляет вместо `${port}` в команде и
   * `autoOpenUrl` (TASK-62, decision-15).
   */
  portStrategy?: 'fixed' | 'auto';
  /** Порт, с которого начинать поиск при `portStrategy: 'auto'`. */
  port?: number;
}

/** Политика инициализации нового worktree (TASK-62). */
export interface WorktreeInitPolicy {
  /** Команды, выполняемые в новом worktree после создания (например `npm ci`). */
  commands?: string[];
  /** Связать `node_modules` worktree с основным деревом вместо установки зависимостей. */
  linkNodeModules?: boolean;
}

export interface ProjectActionConfig {
  run: ActionDefinition;
  deploy: ActionDefinition;
  test: ActionDefinition;
  customActions?: Array<ActionDefinition & { id: string }>;
  worktreeInit?: WorktreeInitPolicy;
}

const CONFIG_FILENAME = '.projecthub.json';

class ActionConfigService {
  private detectDefaultCommands(projectPath: string): ProjectActionConfig {
    const hasPackageJson = existsSync(path.join(projectPath, 'package.json'));
    const hasCargoToml = existsSync(path.join(projectPath, 'Cargo.toml'));
    const hasPyProject = existsSync(path.join(projectPath, 'pyproject.toml')) || existsSync(path.join(projectPath, 'requirements.txt'));

    if (hasCargoToml) {
      return {
        run: { name: 'Cargo Run', command: 'cargo run' },
        deploy: { name: 'Release Build', command: 'cargo build --release', requiresConfirmation: true },
        test: { name: 'Cargo Test', command: 'cargo test' },
        customActions: []
      };
    }

    if (hasPyProject) {
      return {
        run: { name: 'Python Server', command: 'python main.py', autoOpenUrl: 'http://localhost:8000' },
        deploy: { name: 'Deploy App', command: 'docker compose up -d --build', requiresConfirmation: true },
        test: { name: 'Pytest', command: 'pytest' },
        customActions: []
      };
    }

    // Default Node / Web project
    return {
      run: {
        name: 'Dev Server',
        command: hasPackageJson ? 'npm run dev' : 'npm start',
        autoOpenUrl: 'http://localhost:5173'
      },
      deploy: {
        name: 'Production Deploy',
        command: hasPackageJson ? 'npm run build && npm run deploy' : 'npm run build',
        requiresConfirmation: true
      },
      test: {
        name: 'Unit Tests',
        command: hasPackageJson ? 'npm test' : 'npm test'
      },
      customActions: []
    };
  }

  async getConfig(projectPath: string): Promise<ProjectActionConfig> {
    const configPath = path.join(projectPath, CONFIG_FILENAME);
    if (existsSync(configPath)) {
      try {
        const raw = await fs.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          ...this.detectDefaultCommands(projectPath),
          ...parsed
        };
      } catch (err) {
        console.error(`Failed to parse ${configPath}:`, err);
      }
    }
    return this.detectDefaultCommands(projectPath);
  }

  async saveConfig(projectPath: string, config: ProjectActionConfig): Promise<boolean> {
    const configPath = path.join(projectPath, CONFIG_FILENAME);
    try {
      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error(`Failed to save ${configPath}:`, err);
      return false;
    }
  }
}

export const actionConfigService = new ActionConfigService();
