import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// claudeBridgeService тянет electron через secretStorageService/processManager — подменяем модуль.
vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  },
  BrowserWindow: { getAllWindows: () => [] }
}));

const { claudeBridgeService } = await import('../../electron/services/claudeBridgeService');
type ApprovalRequest = import('../../electron/services/claudeBridgeService').ApprovalRequest;
type CliPermissionMeta = import('../../electron/services/claudeBridgeService').CliPermissionMeta;
type AIProviderConfig = import('../../electron/services/aiAgentService').AIProviderConfig;

const PROJECT = process.cwd();
const cfg = (autoApprove: boolean): AIProviderConfig => ({ provider: 'anthropic', model: 'default', autoApprove });

function session(id: string, config: AIProviderConfig, meta: CliPermissionMeta = {}) {
  const approvals: ApprovalRequest[] = [];
  claudeBridgeService.registerCliPermissionContext(
    id,
    PROJECT,
    config,
    (chunk) => {
      if (chunk.approvalRequest) approvals.push(chunk.approvalRequest);
    },
    meta
  );
  return approvals;
}

afterEach(() => {
  claudeBridgeService.killAll();
  claudeBridgeService.removeAllListeners();
});

describe('Playwright MCP в HITL агентов ProjectHub (decision-55 п. 3)', () => {
  it('действие в браузере проходит без карточки даже в ручном режиме', async () => {
    const approvals = session('b1', cfg(false));
    const res = await claudeBridgeService.handleCliPermissionRequest('b1', {
      tool_name: 'mcp__playwright__browser_navigate',
      input: { url: 'http://localhost:4178/' }
    });
    expect(res.behavior).toBe('allow');
    expect(approvals).toEqual([]);
  });

  it('browser_run_code_unsafe при auto-approve всё равно идёт к человеку с причиной', async () => {
    const approvals = session('b2', cfg(true));
    const pending = claudeBridgeService.handleCliPermissionRequest('b2', {
      tool_name: 'mcp__playwright__browser_run_code_unsafe',
      input: { code: 'async (page) => page.title()' }
    });
    for (let i = 0; i < 100 && approvals.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(approvals).toHaveLength(1);
    expect(approvals[0].title).toMatch(/выходит за пределы браузера/);
    expect(approvals[0].details).toMatch(/произвольный код/);
    expect(claudeBridgeService.sendApprovalResponse(approvals[0].id, { approved: false, text: 'нет' }, { kind: 'local' })).toBe(true);
    const res = await pending;
    expect(res.behavior).toBe('deny');
  });

  it('в автономном запуске выход за браузер отклоняется без карточки', async () => {
    for (const origin of ['automation', 'assigned'] as const) {
      const approvals = session(`b3-${origin}`, cfg(true), { origin });
      const res = await claudeBridgeService.handleCliPermissionRequest(`b3-${origin}`, {
        tool_name: 'mcp__playwright__browser_file_upload',
        input: { paths: [path.resolve('/etc/passwd')] }
      });
      expect(res.behavior).toBe('deny');
      if (res.behavior === 'deny') expect(res.message).toMatch(/автономном запуске/);
      expect(approvals).toEqual([]);
    }
  });

  it('файл в worktree агента — внутри рабочего каталога', async () => {
    const worktree = path.join(PROJECT, '.worktrees', 'agent-1');
    const approvals = session('b4', cfg(false), { workspaceRoot: worktree });
    const res = await claudeBridgeService.handleCliPermissionRequest('b4', {
      tool_name: 'mcp__playwright__browser_take_screenshot',
      input: { filename: path.join(worktree, 'shots', 'home.png') }
    });
    expect(res.behavior).toBe('allow');
    expect(approvals).toEqual([]);
  });
});
