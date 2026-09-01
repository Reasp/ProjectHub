import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { simpleGit } from 'simple-git';

const server = new McpServer({
  name: 'projecthub-server',
  version: '2.0.0'
});

// 1. List projects
server.registerTool(
  'projecthub_list_projects',
  {
    title: 'Список проектов ProjectHub',
    description: 'Возвращает список всех зарегистрированных проектов с метаданными и статусами Git/Backlog.',
    inputSchema: {}
  },
  async () => {
    // Read projects registry
    const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME || '', 'Library/Application Support') : path.join(process.env.HOME || '', '.config'));
    const regFile = path.join(appData, 'ProjectHub', 'projects.json');
    let projects = [];
    if (existsSync(regFile)) {
      try {
        projects = JSON.parse(await fs.readFile(regFile, 'utf-8'));
      } catch {}
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }]
    };
  }
);

// 2. Git Status
server.registerTool(
  'projecthub_git_status',
  {
    title: 'Git статус проекта',
    description: 'Возвращает статус репозитория: ветку, измененные, staged и untracked файлы.',
    inputSchema: {
      projectPath: z.string().describe('Абсолютный путь к каталогу проекта')
    }
  },
  async ({ projectPath }) => {
    const git = simpleGit(projectPath);
    const [status, branches] = await Promise.all([git.status(), git.branchLocal()]);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              currentBranch: status.current,
              branches: branches.all,
              isClean: status.isClean(),
              modified: status.modified,
              created: status.created,
              deleted: status.deleted,
              not_added: status.not_added,
              staged: status.staged
            },
            null,
            2
          )
        }
      ]
    };
  }
);

// 3. Git Diff
server.registerTool(
  'projecthub_git_diff',
  {
    title: 'Git Diff',
    description: 'Получает diff изменений для файла или между ветками.',
    inputSchema: {
      projectPath: z.string().describe('Путь к проекту'),
      filePath: z.string().optional().describe('Относительный путь к файлу'),
      staged: z.boolean().optional().describe('Только staged изменения'),
      targetA: z.string().optional().describe('Ветка А для сравнения'),
      targetB: z.string().optional().describe('Ветка B для сравнения')
    }
  },
  async ({ projectPath, filePath, staged, targetA, targetB }) => {
    const git = simpleGit(projectPath);
    let diff = '';
    if (targetA) {
      const args = targetB ? [`${targetA}..${targetB}`] : [targetA];
      if (filePath) args.push('--', filePath);
      diff = await git.diff(args);
    } else if (staged) {
      diff = await git.diff(filePath ? ['--cached', filePath] : ['--cached']);
    } else {
      diff = await git.diff(filePath ? [filePath] : []);
    }
    return {
      content: [{ type: 'text', text: diff || 'Нет изменений (diff пуст).' }]
    };
  }
);

// 4. Git Branch Operation
server.registerTool(
  'projecthub_git_branch',
  {
    title: 'Операции с ветками Git',
    description: 'Создание, переключение (checkout) или слияние веток.',
    inputSchema: {
      projectPath: z.string().describe('Путь к проекту'),
      action: z.enum(['checkout', 'create', 'merge', 'delete']).describe('Действие с веткой'),
      branchName: z.string().describe('Имя ветки')
    }
  },
  async ({ projectPath, action, branchName }) => {
    const git = simpleGit(projectPath);
    if (action === 'checkout') {
      await git.checkout(branchName);
      return { content: [{ type: 'text', text: `Переключено на ветку ${branchName}` }] };
    }
    if (action === 'create') {
      await git.checkoutLocalBranch(branchName);
      return { content: [{ type: 'text', text: `Создана и активирована ветка ${branchName}` }] };
    }
    if (action === 'merge') {
      const res = await git.merge([branchName]);
      return { content: [{ type: 'text', text: `Слияние ветки ${branchName} завершено: ${JSON.stringify(res)}` }] };
    }
    if (action === 'delete') {
      await git.deleteLocalBranch(branchName, true);
      return { content: [{ type: 'text', text: `Ветка ${branchName} удалена.` }] };
    }
    return { content: [{ type: 'text', text: `Неизвестное действие: ${action}` }] };
  }
);

// 5. Git Commit
server.registerTool(
  'projecthub_git_commit',
  {
    title: 'Создание Git коммита',
    description: 'Добавляет файлы в stage и создает коммит.',
    inputSchema: {
      projectPath: z.string().describe('Путь к проекту'),
      message: z.string().describe('Сообщение коммита'),
      stageAll: z.boolean().optional().describe('Добавить все файлы в stage перед коммитом')
    }
  },
  async ({ projectPath, message, stageAll }) => {
    const git = simpleGit(projectPath);
    if (stageAll) {
      await git.add('.');
    }
    const res = await git.commit(message);
    return {
      content: [{ type: 'text', text: `Коммит создан успешно:\n${JSON.stringify(res, null, 2)}` }]
    };
  }
);

// 6. Read / Write Project Files
server.registerTool(
  'projecthub_read_file',
  {
    title: 'Чтение файла проекта',
    description: 'Безопасно читает файл внутри проекта.',
    inputSchema: {
      projectPath: z.string().describe('Путь к проекту'),
      relativePath: z.string().describe('Относительный путь к файлу')
    }
  },
  async ({ projectPath, relativePath }) => {
    const full = path.resolve(projectPath, relativePath);
    if (!full.startsWith(path.resolve(projectPath))) {
      throw new Error('Access denied: Path outside project root');
    }
    const content = await fs.readFile(full, 'utf-8');
    return { content: [{ type: 'text', text: content }] };
  }
);

server.registerTool(
  'projecthub_write_file',
  {
    title: 'Запись файла проекта',
    description: 'Безопасно записывает файл внутри проекта.',
    inputSchema: {
      projectPath: z.string().describe('Путь к проекту'),
      relativePath: z.string().describe('Относительный путь к файлу'),
      content: z.string().describe('Содержимое файла')
    }
  },
  async ({ projectPath, relativePath, content }) => {
    const full = path.resolve(projectPath, relativePath);
    if (!full.startsWith(path.resolve(projectPath))) {
      throw new Error('Access denied: Path outside project root');
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
    return { content: [{ type: 'text', text: `Файл ${relativePath} успешно сохранен.` }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
