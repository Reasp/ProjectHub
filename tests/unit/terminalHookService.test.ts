import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-termhook-'));

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir, isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  },
  BrowserWindow: { getAllWindows: () => [] }
}));

const { HitlService } = await import('../../electron/services/hitlService');
const { TerminalHookService } = await import('../../electron/services/terminalHookService');
type HitlServiceT = InstanceType<typeof HitlService>;
type AppBusEvent = import('../../electron/services/hitlTypes').AppBusEvent;
type AIProviderConfig = import('../../electron/services/aiAgentService').AIProviderConfig;
type RoleDefinition = import('../../electron/services/roleTypes').RoleDefinition;

const PROJECT = path.join(userDataDir, 'proj');

function config(autoApprove: boolean): AIProviderConfig {
  return {
    autoApprove,
    autoApproveRules: {
      enabled: true,
      allowCommands: true,
      allowFileWrite: true,
      allowFileRead: true,
      allowSubagents: true,
      writeExcludePatterns: [],
      readExcludePatterns: [],
      commandDenyList: ['git push']
    }
  } as unknown as AIProviderConfig;
}

const REVIEWER: RoleDefinition = {
  slug: 'reviewer',
  name: 'Ревьюер',
  systemPrompt: '',
  source: 'builtin',
  permissions: { allowFileWrite: false, allowCommands: false }
};

interface Harness {
  service: InstanceType<typeof TerminalHookService>;
  hitl: HitlServiceT;
  events: AppBusEvent[];
  now: { value: number };
  checks: { failed: string[]; summary: string };
}

async function harness(autoApprove = true): Promise<Harness> {
  const dir = await fs.mkdtemp(path.join(userDataDir, 'h-'));
  const now = { value: 1_000_000 };
  const hitl = new HitlService({ now: () => now.value });
  await hitl.init({ dir: path.join(dir, 'hitl'), auditDir: path.join(dir, 'audit') });
  const events: AppBusEvent[] = [];
  const checks = { failed: [] as string[], summary: 'unit: passed' };
  const service = new TerminalHookService({
    hitl,
    getConfig: async () => config(autoApprove),
    loadRoles: async () => ({ roles: [REVIEWER] }),
    resolveProject: async (d) => (d.startsWith(PROJECT) ? PROJECT : null),
    publish: (e) => events.push(e),
    runStopChecks: async () => checks,
    buildDiff: async (_w, _t, filePath) => ({ filePath, oldContent: '', newContent: 'x', patch: '+x' }),
    userDataDir: () => dir,
    getSecret: async () => null,
    setSecret: async () => undefined,
    now: () => now.value
  });
  return { service, hitl, events, now, checks };
}

function body(payload: Record<string, unknown>, engine: 'claude' | 'codex' = 'claude') {
  return { engine, projectDir: PROJECT, budgetMs: 600_000, payload: { session_id: 'sess-1', cwd: PROJECT, ...payload } };
}

const pre = (tool: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  body({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool_use_id: `tu-${tool}`, ...extra });

describe('TerminalHookService', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it('allow политики → без решения, аудит; PostToolUse пишет длительность', async () => {
    const out = await h.service.handle(pre('Bash', { command: 'npm test' }));
    expect(out).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    h.now.value += 1234;
    await h.service.handle(body({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'tu-Bash', tool_response: { stdout: 'ok' } }));
    await h.hitl.flush();
    const audit = await h.hitl.listAudit({});
    const decision = audit.find((e) => e.kind === 'decision');
    const outcome = audit.find((e) => e.kind === 'outcome');
    expect(decision).toMatchObject({ origin: 'terminal', engine: 'claude-cli', decision: 'allow', decidedBy: 'auto', rule: 'auto-command', sessionId: 'terminal-claude-sess-1' });
    expect(outcome).toMatchObject({ outcome: 'executed', durationMs: 1234, requestId: decision!.requestId });
  });

  it('deny политики (запись вне проекта) → отказ в формате Claude', async () => {
    const out = await h.service.handle(pre('Write', { file_path: path.join(os.tmpdir(), 'outside.txt'), content: 'x' }));
    const parsed = JSON.parse(out.stdout);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('вне корня проекта');
  });

  it('ask → очередь HITL; одобрение человека → allow без собственного запроса Claude', async () => {
    const pending = h.service.handle(pre('Bash', { command: 'git push origin main' }));
    await vi.waitFor(() => expect(h.hitl.listPending()).toHaveLength(1));
    const req = h.hitl.listPending()[0];
    expect(req).toMatchObject({ origin: 'terminal', engine: 'claude-cli', type: 'command', command: 'git push origin main', tool: 'Bash' });
    expect(req.expiresAt! - req.createdAt).toBe(590_000);
    h.hitl.decide(req.id, { approved: true, text: 'ок' }, { kind: 'local' });
    const out = await pending;
    expect(JSON.parse(out.stdout).hookSpecificOutput).toMatchObject({ permissionDecision: 'allow', permissionDecisionReason: 'Разрешено в ProjectHub: ок' });
  });

  it('ask → отказ человека → deny с комментарием', async () => {
    const pending = h.service.handle(pre('Bash', { command: 'git push' }));
    await vi.waitFor(() => expect(h.hitl.listPending()).toHaveLength(1));
    h.hitl.decide(h.hitl.listPending()[0].id, { approved: false, text: 'не сейчас' }, { kind: 'remote' });
    const out = await pending;
    expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecisionReason).toBe('Отклонено в ProjectHub: не сейчас');
  });

  it('обрыв соединения хука снимает запрос с очереди', async () => {
    const controller = new AbortController();
    const pending = h.service.handle(pre('Bash', { command: 'git push' }), { signal: controller.signal });
    await vi.waitFor(() => expect(h.hitl.listPending()).toHaveLength(1));
    controller.abort();
    const out = await pending;
    expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(h.hitl.listPending()).toHaveLength(0);
  });

  it('роль субагента сужает права: запись у ревьюера идёт человеку с диффом', async () => {
    const pending = h.service.handle(pre('Write', { file_path: path.join(PROJECT, 'a.ts'), content: 'x' }, { agent_type: 'reviewer' }));
    await vi.waitFor(() => expect(h.hitl.listPending()).toHaveLength(1));
    const req = h.hitl.listPending()[0];
    expect(req).toMatchObject({ type: 'file_write', role: 'reviewer', agentName: 'Claude Code · reviewer' });
    expect(req.diff?.patch).toBe('+x');
    h.hitl.decide(req.id, { approved: true }, { kind: 'local' });
    await pending;
  });

  it('AskUserQuestion и незарегистрированный проект — без решения', async () => {
    expect(await h.service.handle(pre('AskUserQuestion', { questions: [] }))).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    const foreign = await h.service.handle({ ...pre('Bash', { command: 'ls' }), projectDir: path.join(os.tmpdir(), 'nope') , payload: { ...pre('Bash', { command: 'ls' }).payload, cwd: path.join(os.tmpdir(), 'nope') } });
    expect(foreign.stdout).toBe('');
    expect(foreign.stderr).toContain('не принадлежит');
    expect(h.hitl.listPending()).toHaveLength(0);
  });

  it('Codex apply_patch вне проекта → exit 2', async () => {
    const patch = '*** Begin Patch\n*** Add File: ../../evil.txt\n+x\n*** End Patch';
    const codex = await h.service.handle(body({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: patch }, tool_use_id: 'x' }, 'codex'));
    expect(codex.exitCode).toBe(2);
    expect(codex.stderr).toContain('вне корня проекта');
  });

  it('PostToolUse без PreToolUse — post-only без длительности; ошибка инструмента — failed', async () => {
    await h.service.handle(body({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'lost', error: 'Exit code 1' }));
    await h.hitl.flush();
    const audit = await h.hitl.listAudit({});
    expect(audit.find((e) => e.kind === 'decision')?.rule).toBe('post-only');
    const outcome = audit.find((e) => e.kind === 'outcome');
    expect(outcome).toMatchObject({ outcome: 'failed', detail: 'Exit code 1' });
    expect(outcome?.durationMs).toBeUndefined();
  });

  it('Stop: off — уведомление; block — продолжение при проваленных проверках, но не повторно', async () => {
    await h.service.handle(body({ hook_event_name: 'Stop' }));
    expect(h.events.at(-1)).toMatchObject({ type: 'agent:finished', origin: 'terminal', sessionId: 'terminal-claude-sess-1', projectPath: PROJECT });

    await h.service.saveSettings({ stopChecks: 'block' });
    h.checks.failed = ['unit'];
    const blocked = await h.service.handle(body({ hook_event_name: 'Stop' }));
    expect(JSON.parse(blocked.stdout)).toMatchObject({ decision: 'block' });
    expect(h.events.at(-1)).toMatchObject({ type: 'agent:failed' });

    const again = await h.service.handle(body({ hook_event_name: 'Stop', stop_hook_active: true }));
    expect(again.stdout).toBe('');

    await h.service.saveSettings({ stopChecks: 'notify' });
    const notified = await h.service.handle(body({ hook_event_name: 'Stop' }));
    expect(notified.stdout).toBe('');
    expect(notified.stderr).toContain('unit');
  });

  it('токен хуков: создаётся, сравнивается, ротируется', async () => {
    expect(h.service.isHookToken('ph_hook_x')).toBe(false);
    const token = await h.service.getToken();
    expect(token).toMatch(/^ph_hook_[0-9a-f]{32}$/);
    expect(h.service.isHookToken(token)).toBe(true);
    const next = await h.service.regenerateToken();
    expect(h.service.isHookToken(token)).toBe(false);
    expect(h.service.isHookToken(next)).toBe(true);
    expect(await h.service.terminalEnv('http://127.0.0.1:1')).toEqual({ PROJECTHUB_HOOK_URL: 'http://127.0.0.1:1', PROJECTHUB_HOOK_TOKEN: next, PROJECTHUB_HOOK_FAIL_MODE: 'open' });
    expect(await h.service.terminalEnv(null)).toEqual({});
  });

  it('битый вход — без решения с сообщением', async () => {
    expect((await h.service.handle({ engine: 'nope' })).stderr).toContain('движок');
    expect((await h.service.handle({ engine: 'claude', payload: { hook_event_name: 'Nope' } })).stderr).toContain('неподдерживаемое');
  });
});
