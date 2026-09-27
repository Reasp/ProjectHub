import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * Маршрут хуков терминала во встроенном сервере (TASK-77, decision-54 п. 4): токен хуков открывает только
 * `/api/hooks/event`, основной токен MCP тоже подходит, браузерный Origin и чужой Host отклоняются.
 */

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-mcp-hook-'));

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

const { mcpServerService, TERMINAL_HOOK_ROUTE } = await import('../../electron/services/mcpServerService');
const { terminalHookService } = await import('../../electron/services/terminalHookService');

function request(reqPath: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string }> {
  const port = mcpServerService.getStatus().port;
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = http.request(
      { host: '127.0.0.1', port, path: reqPath, method: opts.method ?? 'GET', headers: { Connection: 'close', ...opts.headers } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          settled = true;
          resolve({ status: res.statusCode || 0, body });
        });
        if (reqPath === '/sse') {
          settled = true;
          resolve({ status: res.statusCode || 0, body: '' });
          res.destroy();
        }
      }
    );
    req.on('error', (err) => {
      if (!settled) reject(err);
    });
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const EVENT = JSON.stringify({ engine: 'claude', projectDir: userDataDir, payload: { hook_event_name: 'Nope', session_id: 's' } });

let hookToken = '';

beforeAll(async () => {
  await mcpServerService.init();
  hookToken = await terminalHookService.getToken();
  expect(await mcpServerService.start(43195)).toBe(true);
});

afterAll(async () => {
  await mcpServerService.stop();
});

describe('маршрут хуков терминала', () => {
  it('токен хуков принимается маршрутом хуков', async () => {
    const res = await request(TERMINAL_HOOK_ROUTE, { method: 'POST', headers: { Authorization: `Bearer ${hookToken}`, 'Content-Type': 'application/json' }, body: EVENT });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ exitCode: 0, stdout: '' });
    expect(JSON.parse(res.body).stderr).toContain('неподдерживаемое событие');
  });

  it('основной токен MCP тоже подходит', async () => {
    const token = mcpServerService.getStatus().token;
    const res = await request(TERMINAL_HOOK_ROUTE, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: EVENT });
    expect(res.status).toBe(200);
  });

  it('токен хуков не открывает остальные маршруты', async () => {
    const auth = { Authorization: `Bearer ${hookToken}` };
    expect((await request('/sse', { headers: auth })).status).toBe(401);
    expect((await request('/api/action', { method: 'POST', headers: auth, body: '{"type":"x"}' })).status).toBe(401);
  });

  it('без токена, с неверным токеном и с браузерным Origin — отказ', async () => {
    expect((await request(TERMINAL_HOOK_ROUTE, { method: 'POST', body: EVENT })).status).toBe(401);
    expect((await request(TERMINAL_HOOK_ROUTE, { method: 'POST', headers: { Authorization: 'Bearer ph_hook_wrong' }, body: EVENT })).status).toBe(401);
    expect((await request(TERMINAL_HOOK_ROUTE, { method: 'POST', headers: { Authorization: `Bearer ${hookToken}`, Origin: 'https://evil.example' }, body: EVENT })).status).toBe(403);
  });

  it('битый JSON — 400', async () => {
    expect((await request(TERMINAL_HOOK_ROUTE, { method: 'POST', headers: { Authorization: `Bearer ${hookToken}` }, body: '{' })).status).toBe(400);
  });

  it('адрес для скрипта хуков — только у запущенного сервера', () => {
    expect(mcpServerService.getHookBaseUrl()).toBe(`http://127.0.0.1:${mcpServerService.getStatus().port}`);
  });
});
