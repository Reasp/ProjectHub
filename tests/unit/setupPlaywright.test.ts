import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  DEFAULT_ON,
  PLAYWRIGHT_MCP_PACKAGE,
  buildDesiredMcpServers,
  ensureGitignoreEntry
} from '../../scripts/setup.mjs';

const REPO = path.resolve(__dirname, '../..');

describe('фича playwright в шаблоне (decision-55 п. 1)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-setup-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('по умолчанию выключена', () => {
    expect(DEFAULT_ON).not.toContain('playwright');
    expect(buildDesiredMcpServers('', DEFAULT_ON).playwright).toBeUndefined();
  });

  it('запись MCP: закреплённая версия, headless, профиль в памяти, без опасных флагов', () => {
    const entry = buildDesiredMcpServers('infra/', ['playwright']).playwright;
    expect(entry).toEqual({ command: 'npx', args: ['--yes', PLAYWRIGHT_MCP_PACKAGE, '--headless', '--isolated'] });
    expect(PLAYWRIGHT_MCP_PACKAGE).toMatch(/^@playwright\/mcp@\d+\.\d+\.\d+$/);
    const args = entry.args.join(' ');
    expect(args).not.toMatch(/--extension|--allow-unrestricted-file-access|--caps|--port/);
  });

  it('.gitignore: дописывает один раз, узнаёт варианты записи, сохраняет CRLF', () => {
    expect(ensureGitignoreEntry(dir, '.playwright-mcp/')).toBe(true);
    expect(ensureGitignoreEntry(dir, '.playwright-mcp/')).toBe(false);
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8')).toBe('.playwright-mcp/\n');

    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\r\n/.playwright-mcp');
    expect(ensureGitignoreEntry(dir, '.playwright-mcp/')).toBe(false);

    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\r\ndist');
    expect(ensureGitignoreEntry(dir, '.playwright-mcp/')).toBe(true);
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8')).toBe('node_modules/\r\ndist\r\n.playwright-mcp/\r\n');
  });

  it('настоящий запуск setup.mjs добавляет и убирает Playwright MCP в обоих конфигах', () => {
    // Копия инфраструктуры: setup.mjs пишет infra.config.json рядом с собой — настоящий конфиг ProjectHub не трогаем.
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    for (const f of ['setup.mjs', 'config.mjs']) fs.copyFileSync(path.join(REPO, 'scripts', f), path.join(dir, 'scripts', f));
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { mine: { command: 'x' } } }));
    const run = (features: string) =>
      execFileSync(process.execPath, [path.join(dir, 'scripts', 'setup.mjs'), '--project-root', '.', '--features', features, '--no-interactive'], {
        cwd: dir,
        encoding: 'utf-8'
      });
    const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf-8'));

    const out = run('docsRag,playwright');
    expect(out).toContain('playwright: Playwright MCP');
    for (const rel of ['.mcp.json', '.agents/mcp_config.json']) {
      expect(read(rel).mcpServers.playwright.args).toContain(PLAYWRIGHT_MCP_PACKAGE);
    }
    expect(read('.mcp.json').mcpServers.mine).toEqual({ command: 'x' });
    expect(read('infra.config.json').features.playwright).toBe(true);
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8')).toContain('.playwright-mcp/');

    run('docsRag');
    for (const rel of ['.mcp.json', '.agents/mcp_config.json']) {
      expect(read(rel).mcpServers.playwright).toBeUndefined();
      expect(read(rel).mcpServers['docs-rag']).toBeDefined();
    }
    expect(read('infra.config.json').features.playwright).toBe(false);
  });
});
