import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { hookScriptFile } from '../../electron/services/terminalHookScript';
import { readMarker, stripMarker, contentHash } from '../../electron/services/roleExport';

/**
 * Скрипт `.projecthub/hooks/projecthub-hook.mjs` запускается настоящим `node`, как его запускают Claude Code
 * и Codex: вход — JSON в stdin, ответ — stdout/stderr/код выхода (TASK-77, decision-54 п. 3, 8).
 */

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-hookscript-'));
const script = path.join(dir, 'projecthub-hook.mjs');
const logFile = path.join(dir, 'hook.log');
let server: http.Server;
let baseUrl = '';
interface ReceivedBody {
  engine?: string;
  projectDir?: string;
  budgetMs?: number;
  payload?: { tool_name?: string };
}
const received: Array<{ auth?: string; body: ReceivedBody }> = [];
let mode: 'answer' | 'hang' | '401' = 'answer';

function run(args: string[], stdin: string, env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', PROJECTHUB_HOOK_LOG: logFile, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

const PRE = JSON.stringify({ session_id: 's', hook_event_name: 'PreToolUse', cwd: dir, tool_name: 'Bash', tool_input: { command: 'ls' } });
const POST = JSON.stringify({ session_id: 's', hook_event_name: 'PostToolUse', cwd: dir, tool_name: 'Bash', tool_input: {} });

beforeAll(async () => {
  await fs.writeFile(script, hookScriptFile());
  server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      received.push({ auth: req.headers.authorization, body: JSON.parse(data || '{}') });
      if (mode === 'hang') return;
      if (mode === '401') {
        res.writeHead(401).end('{}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ exitCode: 0, stdout: '{"hookSpecificOutput":{"permissionDecision":"allow"}}', stderr: 'note' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

describe('projecthub-hook.mjs', () => {
  it('файл помечен маркером с верным хэшем', () => {
    const content = hookScriptFile();
    expect(readMarker(content)?.hash).toBe(contentHash(stripMarker(content)));
  });

  it('пересылает вход и печатает ответ сервера как есть', async () => {
    mode = 'answer';
    received.length = 0;
    const res = await run(['claude', '--budget', '600'], PRE, { PROJECTHUB_HOOK_URL: baseUrl, PROJECTHUB_HOOK_TOKEN: 'ph_hook_t', CLAUDE_PROJECT_DIR: dir });
    expect(res).toEqual({ code: 0, stdout: '{"hookSpecificOutput":{"permissionDecision":"allow"}}', stderr: 'note\n' });
    expect(received[0].auth).toBe('Bearer ph_hook_t');
    expect(received[0].body).toMatchObject({ engine: 'claude', projectDir: dir, budgetMs: 585_000 });
    expect(received[0].body.payload.tool_name).toBe('Bash');
  });

  it('без токена: fail-open молча, fail-closed отказывает PreToolUse', async () => {
    const open = await run(['claude'], PRE, { PROJECTHUB_HOOK_URL: baseUrl });
    expect(open).toEqual({ code: 0, stdout: '', stderr: '' });
    const closed = await run(['claude'], PRE, { PROJECTHUB_HOOK_URL: baseUrl, PROJECTHUB_HOOK_FAIL_MODE: 'closed' });
    expect(JSON.parse(closed.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    const post = await run(['claude'], POST, { PROJECTHUB_HOOK_URL: baseUrl, PROJECTHUB_HOOK_FAIL_MODE: 'closed' });
    expect(post).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(await fs.readFile(logFile, 'utf-8')).toContain('не задан PROJECTHUB_HOOK_TOKEN');
  });

  it('ProjectHub не запущен: fail-open; fail-closed у Codex — exit 2', async () => {
    const env = { PROJECTHUB_HOOK_URL: 'http://127.0.0.1:1', PROJECTHUB_HOOK_TOKEN: 't' };
    expect(await run(['claude'], PRE, env)).toEqual({ code: 0, stdout: '', stderr: '' });
    const codex = await run(['codex'], PRE, { ...env, PROJECTHUB_HOOK_FAIL_MODE: 'closed' });
    expect(codex.code).toBe(2);
    expect(codex.stderr).toContain('fail-closed');
    expect(await fs.readFile(logFile, 'utf-8')).toMatch(/ECONNREFUSED|fetch failed/);
  });

  it('неверный токен (401) — как недоступность', async () => {
    mode = '401';
    const res = await run(['claude'], PRE, { PROJECTHUB_HOOK_URL: baseUrl, PROJECTHUB_HOOK_TOKEN: 'bad' });
    expect(res).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(await fs.readFile(logFile, 'utf-8')).toContain('HTTP 401');
  });

  it('сервер принял запрос, но не ответил в бюджет — отказ, а не fail-open', async () => {
    mode = 'hang';
    const res = await run(['claude', '--budget', '1'], PRE, { PROJECTHUB_HOOK_URL: baseUrl, PROJECTHUB_HOOK_TOKEN: 't' });
    expect(JSON.parse(res.stdout).hookSpecificOutput.permissionDecisionReason).toContain('нет решения');
  }, 15_000);

  it('вход не JSON — пропуск', async () => {
    expect(await run(['claude'], 'not json', { PROJECTHUB_HOOK_URL: baseUrl, PROJECTHUB_HOOK_TOKEN: 't' })).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});
