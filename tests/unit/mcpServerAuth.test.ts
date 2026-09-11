import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * Поверхность безопасности встроенного HTTP/SSE MCP-сервера (TASK-58, decision-14 п.8):
 * loopback-only Host, отказ браузерным Origin, Bearer-токен на защищённых маршрутах,
 * ротация токена делает старый недействительным. Сервер слушает только 127.0.0.1 —
 * реальный сокет безопасен для теста (в отличие от remoteControlService, который биндится
 * на 0.0.0.0 и там сервер не поднимается, см. remoteControlAuth.test.ts).
 */

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-mcp-'));

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

const PORT = 43111;

function request(
  reqPath: string,
  opts: http.RequestOptions = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  // Порт берётся из актуального статуса: start() при занятом порту молча пробует следующий
  // (см. mcpServerService.start), фиксированная константа могла бы указывать мимо сервера.
  const port = mcpServerService.getStatus().port;
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: reqPath,
        method: 'GET',
        ...opts,
        headers: { Connection: 'close', ...opts.headers }
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          settled = true;
          resolve({ status: res.statusCode || 0, body, headers: res.headers });
        });
      }
    );
    // afterEach принудительно рвёт ещё не до конца отсоединённые сокеты (closeAllConnections) —
    // это может породить асинхронный ECONNRESET уже ПОСЛЕ того, как ответ разобран и промис
    // разрешён; такие ошибки после settle игнорируются, а не проваливают следующий тест.
    req.on('error', (err) => {
      if (!settled) reject(err);
    });
    req.end();
  });
}

describe('mcpServerService HTTP auth surface', () => {
  beforeEach(async () => {
    const ok = await mcpServerService.start(PORT);
    expect(ok).toBe(true);
  });

  afterEach(async () => {
    await mcpServerService.stop();
  });

  it('отдаёт публичный статус без токена и без секретов на /api/status', async () => {
    const res = await request('/api/status');
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.token).toBeUndefined();
    expect(json.isRunning).toBe(true);
  });

  it('отклоняет запросы с заголовком Origin (браузерная страница, включая preflight)', async () => {
    const res = await request('/api/status', { headers: { Origin: 'http://evil.com' } });
    expect(res.status).toBe(403);
  });

  it('отклоняет запросы с не-loopback Host (защита от DNS rebinding)', async () => {
    const res = await request('/sse', { headers: { Host: 'evil.com' } });
    expect(res.status).toBe(403);
  });

  it('требует Bearer-токен на защищённых маршрутах и возвращает WWW-Authenticate', async () => {
    const res = await request('/sse');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/Bearer/);
  });

  it('отклоняет неверный Bearer-токен', async () => {
    const res = await request('/api/action', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' }
    });
    expect(res.status).toBe(401);
  });

  it('принимает верный Bearer-токен (проходит дальше проверки авторизации)', async () => {
    const status = mcpServerService.getStatus();
    const res = await request('/api/action', {
      method: 'POST',
      headers: { Authorization: `Bearer ${status.token}`, 'Content-Type': 'application/json' }
    });
    // Тело запроса пустое -> 400 при разборе JSON, но это уже ПОСЛЕ проверки токена.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('regenerateToken делает старый токен недействительным немедленно', async () => {
    const oldToken = mcpServerService.getStatus().token;
    mcpServerService.regenerateToken();

    const res = await request('/api/action', {
      method: 'POST',
      headers: { Authorization: `Bearer ${oldToken}` }
    });
    expect(res.status).toBe(401);
  });

  it('OPTIONS (CORS preflight) отвечает 204 без утечки токена', async () => {
    const res = await request('/sse', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.body).toBe('');
  });
});
