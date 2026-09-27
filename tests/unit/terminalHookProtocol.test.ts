import { describe, expect, it } from 'vitest';
import {
  approvalTimeoutFromBudget,
  failModeResponse,
  formatHookResponse,
  parseHookPayload,
  patchFilePaths,
  policyToolCalls
} from '../../electron/services/terminalHookProtocol';

const PRE = {
  session_id: 's-1',
  hook_event_name: 'PreToolUse',
  cwd: 'F:/proj',
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
  tool_use_id: 'toolu_1',
  agent_type: 'reviewer'
};

describe('parseHookPayload', () => {
  it('нормализует PreToolUse Claude Code', () => {
    const res = parseHookPayload('claude', PRE);
    expect(res).toEqual({
      ok: true,
      event: {
        engine: 'claude',
        event: 'PreToolUse',
        sessionId: 's-1',
        cwd: 'F:/proj',
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        toolUseId: 'toolu_1',
        agentType: 'reviewer',
        stopHookActive: false,
        toolFailed: false
      }
    });
  });

  it('PostToolUseFailure и код выхода в ответе — ошибка инструмента', () => {
    const failure = parseHookPayload('claude', { ...PRE, hook_event_name: 'PostToolUseFailure', error: 'Exit code 1' });
    expect(failure.ok && failure.event.toolFailed).toBe(true);
    expect(failure.ok && failure.event.errorDetail).toBe('Exit code 1');
    const codex = parseHookPayload('codex', { ...PRE, hook_event_name: 'PostToolUse', tool_response: { exit_code: 3 } });
    expect(codex.ok && codex.event.toolFailed).toBe(true);
    const ok = parseHookPayload('codex', { ...PRE, hook_event_name: 'PostToolUse', tool_response: { exit_code: 0 } });
    expect(ok.ok && ok.event.toolFailed).toBe(false);
  });

  it('Stop без инструмента, stop_hook_active', () => {
    const res = parseHookPayload('claude', { session_id: 's', hook_event_name: 'Stop', stop_hook_active: true });
    expect(res.ok && res.event.stopHookActive).toBe(true);
  });

  it('отклоняет неизвестное событие и вход без session_id/tool_name', () => {
    expect(parseHookPayload('claude', { ...PRE, hook_event_name: 'UserPromptSubmit' }).ok).toBe(false);
    expect(parseHookPayload('claude', { ...PRE, session_id: '' }).ok).toBe(false);
    expect(parseHookPayload('claude', { ...PRE, tool_name: undefined }).ok).toBe(false);
    expect(parseHookPayload('claude', null).ok).toBe(false);
  });
});

describe('policyToolCalls', () => {
  it('Claude — как есть', () => {
    expect(policyToolCalls({ engine: 'claude', toolName: 'Write', toolInput: { file_path: 'a.ts' } })).toEqual([{ tool: 'Write', input: { file_path: 'a.ts' } }]);
  });

  it('Codex apply_patch → Edit на каждый файл', () => {
    const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: src/b.ts\n+z\n*** Delete File: old.ts\n*** End Patch';
    expect(patchFilePaths(patch)).toEqual(['src/a.ts', 'src/b.ts', 'old.ts']);
    expect(policyToolCalls({ engine: 'codex', toolName: 'apply_patch', toolInput: { command: patch } })).toEqual([
      { tool: 'Edit', input: { file_path: 'src/a.ts' } },
      { tool: 'Edit', input: { file_path: 'src/b.ts' } },
      { tool: 'Edit', input: { file_path: 'old.ts' } }
    ]);
  });

  it('Codex оболочка → Bash, массив аргументов склеивается', () => {
    expect(policyToolCalls({ engine: 'codex', toolName: 'Bash', toolInput: { command: 'rm -rf x' } })).toEqual([{ tool: 'Bash', input: { command: 'rm -rf x' } }]);
    expect(policyToolCalls({ engine: 'codex', toolName: 'shell', toolInput: { command: ['git', 'push'] } })).toEqual([{ tool: 'Bash', input: { command: 'git push' } }]);
  });
});

describe('formatHookResponse', () => {
  it('Claude PreToolUse allow/deny — JSON hookSpecificOutput', () => {
    const allow = formatHookResponse('claude', 'PreToolUse', { kind: 'allow' });
    expect(allow.exitCode).toBe(0);
    expect(JSON.parse(allow.stdout).hookSpecificOutput).toEqual({
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Разрешено в ProjectHub'
    });
    const deny = formatHookResponse('claude', 'PreToolUse', { kind: 'deny', reason: 'нельзя' });
    expect(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecisionReason).toBe('нельзя');
  });

  it('Codex: отказ — exit 2 и stderr, одобрение — без решения', () => {
    expect(formatHookResponse('codex', 'PreToolUse', { kind: 'deny', reason: 'нельзя' })).toEqual({ exitCode: 2, stdout: '', stderr: 'нельзя' });
    expect(formatHookResponse('codex', 'PreToolUse', { kind: 'allow' })).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  });

  it('Stop block только у Claude; PostToolUse ничего не решает', () => {
    expect(JSON.parse(formatHookResponse('claude', 'Stop', { kind: 'block', reason: 'тесты упали' }).stdout)).toEqual({ decision: 'block', reason: 'тесты упали' });
    expect(formatHookResponse('codex', 'Stop', { kind: 'block', reason: 'r' })).toEqual({ exitCode: 0, stdout: '', stderr: 'r' });
    expect(formatHookResponse('claude', 'PostToolUse', { kind: 'deny', reason: 'r' })).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(formatHookResponse('claude', 'PreToolUse', { kind: 'none', message: 'm' })).toEqual({ exitCode: 0, stdout: '', stderr: 'm' });
  });

  it('fail-closed отказывает только PreToolUse', () => {
    expect(failModeResponse('claude', 'PreToolUse', 'open', 'x')).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    const closed = failModeResponse('claude', 'PreToolUse', 'closed', 'ECONNREFUSED');
    expect(JSON.parse(closed.stdout).hookSpecificOutput.permissionDecisionReason).toContain('ECONNREFUSED');
    expect(failModeResponse('codex', 'PreToolUse', 'closed', 'x').exitCode).toBe(2);
    expect(failModeResponse('claude', 'PostToolUse', 'closed', 'x').exitCode).toBe(0);
  });

  it('срок решения человека меньше бюджета хука', () => {
    expect(approvalTimeoutFromBudget(1_785_000)).toBe(1_775_000);
    expect(approvalTimeoutFromBudget(1_785_000, 60_000)).toBe(60_000);
    expect(approvalTimeoutFromBudget(5_000)).toBe(10_000);
    expect(approvalTimeoutFromBudget(undefined)).toBe(10_000);
  });
});
