import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  KNOWN_BROWSER_TOOLS,
  classifyBrowserTool,
  evaluateBrowserTool,
  parseBrowserToolName
} from '../../electron/services/browserToolCatalog';
import { evaluateToolRequest } from '../../electron/services/hitlPolicy';
import type { AIProviderConfig } from '../../electron/services/aiAgentService';

const workDir = path.resolve('/tmp/proj/.worktrees/agent-1');

describe('parseBrowserToolName', () => {
  it('разбирает имя MCP-инструмента с любым именем сервера', () => {
    expect(parseBrowserToolName('mcp__playwright__browser_click')).toEqual({ server: 'playwright', action: 'browser_click' });
    expect(parseBrowserToolName('mcp__my_pw__browser_take_screenshot')).toEqual({ server: 'my_pw', action: 'browser_take_screenshot' });
  });

  it('не принимает не-браузерные и не-MCP имена', () => {
    expect(parseBrowserToolName('browser_click')).toBeNull();
    expect(parseBrowserToolName('mcp__projecthub__computer_click')).toBeNull();
    expect(parseBrowserToolName('Bash')).toBeNull();
  });
});

describe('classifyBrowserTool', () => {
  it('действия внутри браузера — page', () => {
    for (const action of ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_evaluate', 'browser_fill_form']) {
      expect(classifyBrowserTool(action, { url: 'http://localhost:5173' }, workDir)?.cls).toBe('page');
    }
  });

  it('browser_run_code_unsafe — всегда host', () => {
    const r = classifyBrowserTool('browser_run_code_unsafe', { code: 'async (page) => page.title()' }, workDir);
    expect(r?.cls).toBe('host');
    expect(r?.reason).toMatch(/произвольный код/);
  });

  it('файлы вне рабочего каталога — host, внутри — page', () => {
    expect(classifyBrowserTool('browser_take_screenshot', { filename: 'shots/home.png' }, workDir)?.cls).toBe('page');
    expect(classifyBrowserTool('browser_take_screenshot', { filename: '../../secret.png' }, workDir)?.cls).toBe('host');
    expect(classifyBrowserTool('browser_snapshot', { filename: path.resolve('/etc/snap.yml') }, workDir)?.cls).toBe('host');
    expect(classifyBrowserTool('browser_file_upload', { paths: [path.join(workDir, 'fixture.txt')] }, workDir)?.cls).toBe('page');
    expect(classifyBrowserTool('browser_file_upload', { paths: [path.resolve('/home/user/.ssh/id_rsa')] }, workDir)?.cls).toBe('host');
    expect(classifyBrowserTool('browser_drop', { paths: [42] }, workDir)?.cls).toBe('host');
    // Без путей file_upload отменяет выбор файла — это действие в странице.
    expect(classifyBrowserTool('browser_file_upload', {}, workDir)?.cls).toBe('page');
  });

  it('адрес file: — host (навигация и новая вкладка)', () => {
    expect(classifyBrowserTool('browser_navigate', { url: 'file:///C:/Windows/win.ini' }, workDir)?.cls).toBe('host');
    expect(classifyBrowserTool('browser_tabs', { action: 'new', url: ' FILE:///etc/passwd' }, workDir)?.cls).toBe('host');
  });

  it('неизвестный browser_* не классифицируется', () => {
    expect(classifyBrowserTool('browser_teleport', {}, workDir)).toBeNull();
    expect(KNOWN_BROWSER_TOOLS.has('browser_take_screenshot')).toBe(true);
  });
});

describe('evaluateBrowserTool', () => {
  it('page → allow, host → ask, host в автономном запуске → deny', () => {
    expect(evaluateBrowserTool('mcp__playwright__browser_click', {}, { workDir })).toEqual({ verdict: 'allow', rule: 'browser-page' });
    const ask = evaluateBrowserTool('mcp__playwright__browser_run_code_unsafe', {}, { workDir });
    expect(ask?.verdict).toBe('ask');
    expect(ask?.rule).toBe('browser-host');
    const deny = evaluateBrowserTool('mcp__playwright__browser_run_code_unsafe', {}, { workDir, autonomous: true });
    expect(deny?.verdict).toBe('deny');
    expect(deny?.rule).toBe('browser-host-autonomous');
  });

  it('не-браузерные инструменты — null', () => {
    expect(evaluateBrowserTool('Bash', { command: 'ls' }, { workDir })).toBeNull();
    expect(evaluateBrowserTool('mcp__playwright__browser_unknown', {}, { workDir })).toBeNull();
  });
});

describe('evaluateToolRequest и браузер', () => {
  const config = (over: Partial<AIProviderConfig> = {}): AIProviderConfig =>
    ({ provider: 'anthropic', model: 'x', autoApprove: false, ...over }) as AIProviderConfig;
  const project = path.resolve('/tmp/proj');

  it('действие в браузере не спрашивает человека даже в ручном режиме', () => {
    expect(evaluateToolRequest(config(), project, 'mcp__playwright__browser_navigate', { url: 'http://localhost:3000' })).toEqual({
      verdict: 'allow',
      rule: 'browser-page'
    });
  });

  it('выход за браузер спрашивает даже при auto-approve, в автономном запуске отклоняется', () => {
    const auto = config({ autoApprove: true });
    expect(evaluateToolRequest(auto, project, 'mcp__playwright__browser_run_code_unsafe', {}).verdict).toBe('ask');
    expect(evaluateToolRequest(auto, project, 'mcp__playwright__browser_run_code_unsafe', {}, { autonomous: true }).verdict).toBe('deny');
  });

  it('рабочий каталог из контекста: файл в worktree агента — page', () => {
    const input = { filename: path.join(workDir, 'shot.png') };
    expect(evaluateToolRequest(config(), project, 'mcp__playwright__browser_take_screenshot', input, { workDir }).verdict).toBe('allow');
    expect(evaluateToolRequest(config(), path.resolve('/other'), 'mcp__playwright__browser_take_screenshot', input).verdict).toBe('ask');
  });

  it('allow-список роли сильнее browser-page', () => {
    const narrowed = config({
      autoApproveRules: {
        enabled: true,
        allowCommands: true,
        allowFileWrite: true,
        allowFileRead: true,
        allowSubagents: true,
        writeExcludePatterns: [],
        readExcludePatterns: [],
        commandDenyList: [],
        allowedTools: ['Read']
      }
    });
    expect(evaluateToolRequest(narrowed, project, 'mcp__playwright__browser_click', {}).rule).toBe('tool-not-allowed');
  });

  it('прочие MCP-инструменты — прежняя политика', () => {
    expect(evaluateToolRequest(config(), project, 'mcp__docs-rag__search_docs', {}).rule).toBe('manual');
    expect(evaluateToolRequest(config({ autoApprove: true }), project, 'mcp__docs-rag__search_docs', {}).rule).toBe('auto-other');
  });
});
