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

/** Формы входа Antigravity — из живой проверки agy 1.2.12 (TASK-106, decision-62). */
describe('Antigravity', () => {
  const base = {
    conversationId: 'conv-1',
    workspacePaths: ['C:/Temp/ph-106'],
    transcriptPath: 'C:/x/transcript_full.jsonl',
    artifactDirectoryPath: 'C:/x',
    modelName: 'gemini-3.6-flash-low'
  };
  const PRE_CMD = { ...base, stepIdx: 3, toolCall: { name: 'run_command', args: { CommandLine: 'echo hi > b.txt', Cwd: 'C:\\Temp\\ph-106', WaitMsBeforeAsync: 5000 } } };

  it('событие берётся из подсказки, сессия — conversationId, toolUseId — conversationId:stepIdx', () => {
    const res = parseHookPayload('antigravity', PRE_CMD, 'PreToolUse');
    expect(res).toEqual({
      ok: true,
      event: {
        engine: 'antigravity',
        event: 'PreToolUse',
        sessionId: 'conv-1',
        cwd: 'C:\\Temp\\ph-106',
        toolName: 'run_command',
        toolInput: PRE_CMD.toolCall.args,
        toolUseId: 'conv-1:3',
        stopHookActive: false,
        toolFailed: false
      }
    });
  });

  it('без события или conversationId — ошибка; PostToolUseFailure у Antigravity не бывает', () => {
    expect(parseHookPayload('antigravity', PRE_CMD).ok).toBe(false);
    expect(parseHookPayload('antigravity', PRE_CMD, 'PostToolUseFailure').ok).toBe(false);
    expect(parseHookPayload('antigravity', { ...PRE_CMD, conversationId: '' }, 'PreToolUse').ok).toBe(false);
    expect(parseHookPayload('antigravity', { ...base, stepIdx: 1 }, 'PreToolUse').ok).toBe(false);
  });

  it('PostToolUse с error — провал; cwd без Cwd — первый workspacePaths', () => {
    const post = parseHookPayload('antigravity', { ...base, stepIdx: 2, error: 'exit status 1', toolCall: { name: 'view_file', args: { AbsolutePath: 'C:\\Temp\\ph-106\\README.md' } } }, 'PostToolUse');
    expect(post.ok && post.event).toMatchObject({ toolFailed: true, errorDetail: 'exit status 1', cwd: 'C:/Temp/ph-106', toolUseId: 'conv-1:2' });
    const ok = parseHookPayload('antigravity', { ...base, stepIdx: 2, error: '', toolCall: { name: 'view_file', args: {} } }, 'PostToolUse');
    expect(ok.ok && ok.event.toolFailed).toBe(false);
  });

  it('Stop: fullyIdle и executionNum', () => {
    const stop = parseHookPayload('antigravity', { ...base, executionNum: 0, fullyIdle: false, terminationReason: 'NO_TOOL_CALL', error: '' }, 'Stop');
    expect(stop.ok && stop.event).toMatchObject({ event: 'Stop', stopIdle: false, stopHookActive: false });
    const again = parseHookPayload('antigravity', { ...base, executionNum: 1, fullyIdle: true }, 'Stop');
    expect(again.ok && again.event).toMatchObject({ stopIdle: true, stopHookActive: true });
  });

  it('инструменты → имена и вход политики в форме Claude Code', () => {
    const call = (name: string, args: Record<string, unknown>) => policyToolCalls({ engine: 'antigravity', toolName: name, toolInput: args });
    expect(call('run_command', { CommandLine: 'npm test', Cwd: 'C:/p' })).toEqual([{ tool: 'Bash', input: { command: 'npm test', cwd: 'C:/p' } }]);
    expect(call('write_to_file', { TargetFile: 'C:/p/a.txt', CodeContent: 'A', Overwrite: false })).toEqual([{ tool: 'Write', input: { file_path: 'C:/p/a.txt', content: 'A' } }]);
    expect(call('replace_file_content', { TargetFile: 'C:/p/r.md', TargetContent: 'a', ReplacementContent: 'b' })).toEqual([
      { tool: 'Edit', input: { file_path: 'C:/p/r.md', old_string: 'a', new_string: 'b' } }
    ]);
    expect(
      call('multi_replace_file_content', {
        TargetFile: 'C:/p/r.md',
        ReplacementChunks: [
          { TargetContent: 'a', ReplacementContent: 'b' },
          { TargetContent: 'c', ReplacementContent: 'd' }
        ]
      })[0]
    ).toEqual({ tool: 'Edit', input: { file_path: 'C:/p/r.md', old_string: 'a\n…\nc', new_string: 'b\n…\nd' } });
    expect(call('view_file', { AbsolutePath: 'C:/p/README.md' })).toEqual([{ tool: 'Read', input: { file_path: 'C:/p/README.md' } }]);
    expect(call('grep_search', { Query: 'x', SearchPath: 'C:/p' })[0].tool).toBe('Grep');
    expect(call('list_dir', { DirectoryPath: 'C:/p' })[0].tool).toBe('Glob');
    expect(call('read_url_content', { Url: 'https://e.x' })).toEqual([{ tool: 'WebFetch', input: { url: 'https://e.x' } }]);
    expect(call('invoke_subagent', { Subagents: [{ TypeName: 'reviewer' }, { TypeName: 'tester' }] })).toEqual([
      { tool: 'Agent', input: { description: 'reviewer, tester' } }
    ]);
    expect(call('ask_question', { Question: '?' })[0].tool).toBe('AskUserQuestion');
    expect(call('send_message', { Message: 'hi' })).toEqual([{ tool: 'send_message', input: { Message: 'hi' } }]);
  });

  it('ответ: код выхода всегда 0, без решения — пустой stdout', () => {
    expect(formatHookResponse('antigravity', 'PreToolUse', { kind: 'none', message: 'm' })).toEqual({ exitCode: 0, stdout: '', stderr: 'm' });
    expect(formatHookResponse('antigravity', 'PreToolUse', { kind: 'deny', reason: 'нельзя' })).toEqual({
      exitCode: 0,
      stdout: '{"decision":"deny","reason":"нельзя"}',
      stderr: ''
    });
    expect(JSON.parse(formatHookResponse('antigravity', 'PreToolUse', { kind: 'allow' }).stdout)).toEqual({ decision: 'allow', reason: 'Разрешено в ProjectHub' });
    expect(formatHookResponse('antigravity', 'PostToolUse', { kind: 'deny', reason: 'x' })).toEqual({ exitCode: 0, stdout: '', stderr: '' });
    expect(JSON.parse(formatHookResponse('antigravity', 'Stop', { kind: 'block', reason: 'проверки' }).stdout)).toEqual({ decision: 'continue', reason: 'проверки' });
    const closed = failModeResponse('antigravity', 'PreToolUse', 'closed', 'ECONNREFUSED');
    expect(closed.exitCode).toBe(0);
    expect(JSON.parse(closed.stdout).decision).toBe('deny');
  });
});
