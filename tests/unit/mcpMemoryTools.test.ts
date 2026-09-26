import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

/**
 * Инструменты памяти во встроенном MCP-сервере (TASK-76.2, decision-51 п. 4): внешний MCP-клиент видит
 * memory_* в tools/list и пишет факт в зарегистрированный проект; путь вне реестра отклоняется.
 * Сервер слушает только 127.0.0.1 — настоящий сокет в тесте безопасен.
 */

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-mcp-mem-'));
const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-mcp-mem-proj-'));
const strangerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-mcp-mem-other-'));

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir, isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: async () => true }
}));

const { mcpServerService } = await import('../../electron/services/mcpServerService');
const { projectRegistry } = await import('../../electron/services/projectRegistry');

let client: Client;

beforeAll(async () => {
  await projectRegistry.addProject(projectDir);
  expect(await mcpServerService.start(43171)).toBe(true);
  const { port, token } = mcpServerService.getStatus();
  const auth = { Authorization: `Bearer ${token}` };
  const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${port}/sse`), {
    requestInit: { headers: auth },
    eventSourceInit: {
      fetch: (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), ...auth } })
    }
  });
  client = new Client({ name: 'memory-test', version: '1.0.0' });
  await client.connect(transport);
});

afterAll(async () => {
  await client?.close().catch(() => undefined);
  await mcpServerService.stop();
  for (const dir of [userDataDir, projectDir, strangerDir]) await fs.rm(dir, { recursive: true, force: true });
});

const text = (res: Awaited<ReturnType<Client['callTool']>>) =>
  (res.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? '').join('\n');

describe('MCP: инструменты памяти', () => {
  it('memory_* есть в tools/list с описанием и схемой', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['memory_write', 'memory_search', 'memory_delete']));
    const write = tools.find((t) => t.name === 'memory_write')!;
    expect(write.inputSchema.required).toEqual(expect.arrayContaining(['title', 'description', 'body', 'type']));
  });

  it('внешний клиент пишет и находит факт в зарегистрированном проекте', async () => {
    const res = await client.callTool({
      name: 'memory_write',
      arguments: {
        projectPath: projectDir,
        title: 'Сборка падает при открытом exe',
        description: 'Закрыть ProjectHub.exe перед pack:win',
        body: 'electron-builder не перезапишет занятый файл.',
        type: 'project'
      }
    });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('Сохранено: mem-1');
    const files = await fs.readdir(path.join(projectDir, 'backlog', 'memory'));
    expect(files.sort()).toEqual(['MEMORY.md', 'mem-1 - Сборка-падает-при-открытом-exe.md']);

    const found = await client.callTool({ name: 'memory_search', arguments: { projectPath: projectDir, query: 'exe сборка' } });
    expect(text(found)).toContain('mem-1: Сборка падает при открытом exe');
  });

  it('путь вне реестра и секрет отклоняются', async () => {
    const outside = await client.callTool({
      name: 'memory_write',
      arguments: { projectPath: strangerDir, title: 't', description: 'd', body: 'b', type: 'project' }
    });
    expect(outside.isError).toBe(true);
    expect(text(outside)).toContain('зарегистрированному проекту');

    const secret = await client.callTool({
      name: 'memory_write',
      arguments: { projectPath: projectDir, title: 'Ключ OpenRouter', description: 'ключ', body: 'sk-or-v1-0123456789abcdef0123', type: 'reference' }
    });
    expect(secret.isError).toBe(true);
    expect(text(secret)).not.toContain('0123456789abcdef0123');
  });
});
