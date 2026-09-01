import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import path from 'node:path';
import { projectRegistry } from './projectRegistry.js';
import { inspectProject } from './projectScanner.js';
import { gitService } from './gitService.js';
import { processManager } from './processManager.js';
import { fileService } from './fileService.js';
import { actionConfigService } from './actionConfigService.js';

export function createProjectHubMcpServer() {
  const server = new Server(
    {
      name: 'projecthub-server',
      version: '2.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'projecthub_list_projects',
          description: 'Получить список всех проектов, зарегистрированных в ProjectHub, с их метаданными, ветками Git и статусами задач.',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'projecthub_get_project_details',
          description: 'Получить подробную информацию о конкретном проекте (Git статус, бэклог, процессы).',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Абсолютный путь к каталогу проекта' }
            },
            required: ['projectPath']
          }
        },
        {
          name: 'projecthub_run_action',
          description: 'Запустить действие (run, deploy, test) или произвольную команду в контексте проекта через Process Manager.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Абсолютный путь к проекту' },
              actionType: { type: 'string', enum: ['run', 'deploy', 'test', 'custom'], description: 'Тип действия из .projecthub.json или custom' },
              customCommand: { type: 'string', description: 'Произвольная команда (если actionType=custom)' },
              processName: { type: 'string', description: 'Имя процесса для отображения в терминале' }
            },
            required: ['projectPath', 'actionType']
          }
        },
        {
          name: 'projecthub_stop_process',
          description: 'Остановить запущенный процесс по его ID.',
          inputSchema: {
            type: 'object',
            properties: {
              processId: { type: 'string', description: 'ID процесса' }
            },
            required: ['processId']
          }
        },
        {
          name: 'projecthub_get_process_logs',
          description: 'Прочитать последние строки лога процесса.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Путь к проекту' },
              processName: { type: 'string', description: 'Имя процесса' },
              lines: { type: 'number', description: 'Количество последних строк (по умолчанию 50)' }
            },
            required: ['projectPath', 'processName']
          }
        },
        {
          name: 'projecthub_git_status',
          description: 'Получить Git статус репозитория: текущая ветка, список измененных, подготовленных и неотслеживаемых файлов.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Путь к репозиторию' }
            },
            required: ['projectPath']
          }
        },
        {
          name: 'projecthub_git_diff',
          description: 'Получить Git Diff для отдельного файла или между ветками.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Путь к репозиторию' },
              filePath: { type: 'string', description: 'Относительный путь к файлу (опционально)' },
              staged: { type: 'boolean', description: 'Только staged изменения' },
              targetA: { type: 'string', description: 'Ветка/коммит А для сравнения' },
              targetB: { type: 'string', description: 'Ветка/коммит B для сравнения' }
            },
            required: ['projectPath']
          }
        },
        {
          name: 'projecthub_git_commit',
          description: 'Создать коммит изменений с сообщением.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Путь к репозиторию' },
              message: { type: 'string', description: 'Сообщение коммита' },
              stageAll: { type: 'boolean', description: 'Добавить все файлы в stage перед коммитом' }
            },
            required: ['projectPath', 'message']
          }
        },
        {
          name: 'projecthub_git_branch',
          description: 'Операции с ветками Git: создание новой ветки, переключение (checkout) или слияние (merge).',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Путь к проекту' },
              action: { type: 'string', enum: ['checkout', 'create', 'merge', 'delete'], description: 'Действие' },
              branchName: { type: 'string', description: 'Имя ветки' }
            },
            required: ['projectPath', 'action', 'branchName']
          }
        },
        {
          name: 'projecthub_read_file',
          description: 'Безопасное чтение содержимого файла внутри проекта.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Путь к проекту' },
              relativePath: { type: 'string', description: 'Относительный путь к файлу' }
            },
            required: ['projectPath', 'relativePath']
          }
        },
        {
          name: 'projecthub_write_file',
          description: 'Безопасная запись содержимого в файл внутри проекта.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: { type: 'string', description: 'Путь к проекту' },
              relativePath: { type: 'string', description: 'Относительный путь к файлу' },
              content: { type: 'string', description: 'Новое содержимое файла' }
            },
            required: ['projectPath', 'relativePath', 'content']
          }
        }
      ]
    };
  });

  // Call Tool Handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args || {}) as any;

    try {
      switch (name) {
        case 'projecthub_list_projects': {
          const registered = await projectRegistry.getProjects();
          const list = [];
          for (const p of registered) {
            const details = await inspectProject(p.path);
            if (details) list.push(details);
          }
          return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
        }

        case 'projecthub_get_project_details': {
          const details = await inspectProject(a.projectPath);
          const git = await gitService.getRepoDetails(a.projectPath);
          return { content: [{ type: 'text', text: JSON.stringify({ details, git }, null, 2) }] };
        }

        case 'projecthub_run_action': {
          let command = a.customCommand || '';
          let procName = a.processName || a.actionType;

          if (a.actionType !== 'custom') {
            const config = await actionConfigService.getConfig(a.projectPath);
            if (a.actionType === 'run') {
              command = config.run.command;
              procName = config.run.name;
            } else if (a.actionType === 'deploy') {
              command = config.deploy.command;
              procName = config.deploy.name;
            } else if (a.actionType === 'test') {
              command = config.test.command;
              procName = config.test.name;
            }
          }

          if (!command) {
            throw new Error(`Command not found for action ${a.actionType}`);
          }

          const proc = await processManager.startProcess(a.projectPath, command, procName);
          return { content: [{ type: 'text', text: JSON.stringify(proc, null, 2) }] };
        }

        case 'projecthub_stop_process': {
          const ok = await processManager.stopProcess(a.processId);
          return { content: [{ type: 'text', text: JSON.stringify({ success: ok }) }] };
        }

        case 'projecthub_get_process_logs': {
          const logs = await processManager.tailProjectLog(a.projectPath, a.processName, a.lines || 50);
          return { content: [{ type: 'text', text: logs }] };
        }

        case 'projecthub_git_status': {
          const details = await gitService.getRepoDetails(a.projectPath);
          return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }] };
        }

        case 'projecthub_git_diff': {
          if (a.targetA) {
            const diff = await gitService.getDiffBetween(a.projectPath, a.targetA, a.targetB, a.filePath);
            return { content: [{ type: 'text', text: diff || 'No diff found' }] };
          }
          const diff = await gitService.getFileDiff(a.projectPath, a.filePath || '', Boolean(a.staged));
          return { content: [{ type: 'text', text: diff || 'No diff found' }] };
        }

        case 'projecthub_git_commit': {
          const ok = await gitService.commitChanges(a.projectPath, a.message, Boolean(a.stageAll));
          return { content: [{ type: 'text', text: JSON.stringify({ success: ok }) }] };
        }

        case 'projecthub_git_branch': {
          if (a.action === 'checkout') {
            const ok = await gitService.checkoutBranch(a.projectPath, a.branchName);
            return { content: [{ type: 'text', text: JSON.stringify({ success: ok }) }] };
          }
          if (a.action === 'create') {
            const ok = await gitService.createBranch(a.projectPath, a.branchName);
            return { content: [{ type: 'text', text: JSON.stringify({ success: ok }) }] };
          }
          if (a.action === 'merge') {
            const res = await gitService.mergeBranch(a.projectPath, a.branchName);
            return { content: [{ type: 'text', text: JSON.stringify(res) }] };
          }
          if (a.action === 'delete') {
            const ok = await gitService.deleteBranch(a.projectPath, a.branchName, true);
            return { content: [{ type: 'text', text: JSON.stringify({ success: ok }) }] };
          }
          throw new Error(`Unknown git branch action: ${a.action}`);
        }

        case 'projecthub_read_file': {
          const content = await fileService.readFileContent(a.projectPath, a.relativePath);
          return { content: [{ type: 'text', text: content }] };
        }

        case 'projecthub_write_file': {
          const ok = await fileService.saveFileContent(a.projectPath, a.relativePath, a.content);
          return { content: [{ type: 'text', text: JSON.stringify({ success: ok }) }] };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error?.message || String(error)}` }],
        isError: true
      };
    }
  });

  return server;
}

export async function startMcpStdio() {
  const server = createProjectHubMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[ProjectHub MCP] Server running on stdio');
}
