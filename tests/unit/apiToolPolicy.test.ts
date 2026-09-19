import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  apiToolKind,
  isApiToolAllowed,
  planApiToolCall,
  resolveApiMaxSteps,
  selectComputerTools,
  MAX_API_TOOL_STEPS
} from '../../electron/services/apiToolPolicy';
import { DEFAULT_MAX_TOOL_STEPS } from '../../electron/services/apiToolLoop';
import { applyRolePermissions } from '../../electron/services/hitlPolicy';
import type { AIProviderConfig, AutoApproveRules } from '../../electron/services/aiAgentService';

const WT = path.resolve('/tmp/wt-slot');
const RULES: AutoApproveRules = { enabled: true, allowCommands: true, allowFileWrite: true, allowFileRead: true, allowSubagents: true, writeExcludePatterns: [], readExcludePatterns: [], commandDenyList: [] };
const auto: AIProviderConfig = { provider: 'ollama', model: 'm', autoApprove: true };
const manual: AIProviderConfig = { provider: 'ollama', model: 'm', autoApprove: false };

describe('apiToolPolicy — вид и allow-список (decision-46 п. 1)', () => {
  it('вид инструмента по имени', () => {
    expect(apiToolKind('read_file')).toBe('read');
    expect(apiToolKind('list_dir')).toBe('list');
    expect(apiToolKind('write_file')).toBe('write');
    expect(apiToolKind('run_command')).toBe('command');
    expect(apiToolKind('ask_question')).toBe('question');
    expect(apiToolKind('computer_click')).toBe('computer');
    expect(apiToolKind('multi_edit')).toBe('unknown');
  });

  it('allow-список роли понимает имена Claude Code', () => {
    expect(isApiToolAllowed('read_file', undefined)).toBe(true);
    expect(isApiToolAllowed('read_file', ['Read', 'Grep'])).toBe(true);
    expect(isApiToolAllowed('list_dir', ['Read'])).toBe(true);
    expect(isApiToolAllowed('write_file', ['Read'])).toBe(false);
    expect(isApiToolAllowed('write_file', ['Edit'])).toBe(true);
    expect(isApiToolAllowed('run_command', ['Bash'])).toBe(true);
    expect(isApiToolAllowed('run_command', ['run_*'])).toBe(true);
    expect(isApiToolAllowed('computer_click', ['Read'])).toBe(false);
    expect(isApiToolAllowed('computer_click', ['computer_*'])).toBe(true);
  });
});

describe('planApiToolCall — вердикт общей политики', () => {
  it('неизвестный инструмент отклоняется без карточки', () => {
    const plan = planApiToolCall(auto, WT, 'multi_edit', {});
    expect(plan).toMatchObject({ verdict: 'deny', rule: 'unknown-tool' });
  });

  it('чтение в worktree — авто, вне — карточка, исключение — карточка', () => {
    expect(planApiToolCall(manual, WT, 'read_file', { filePath: 'a.txt' })).toMatchObject({ verdict: 'allow', rule: 'auto-read', filePath: 'a.txt' });
    expect(planApiToolCall(auto, WT, 'read_file', { filePath: '../other/secret.txt' })).toMatchObject({ verdict: 'ask', rule: 'read-outside' });
    const cfg: AIProviderConfig = { ...auto, autoApproveRules: { ...RULES, readExcludePatterns: ['.env*'] } };
    expect(planApiToolCall(cfg, WT, 'read_file', { path: '.env.local' })).toMatchObject({ verdict: 'ask', rule: 'read-excluded' });
  });

  it('роль с allowFileRead: false спрашивает даже про list_dir и search_rag', () => {
    const cfg = applyRolePermissions(auto, { allowFileRead: false });
    expect(planApiToolCall(cfg, WT, 'list_dir', {})).toMatchObject({ verdict: 'ask', rule: 'read-manual', filePath: '.' });
    expect(planApiToolCall(cfg, WT, 'search_rag', { query: 'x' })).toMatchObject({ verdict: 'ask', rule: 'read-manual' });
  });

  it('запись: вне worktree — deny, auto — allow, ручной режим — ask, без пути — deny', () => {
    expect(planApiToolCall(auto, WT, 'write_file', { filePath: '../escape.txt', content: 'x' })).toMatchObject({
      verdict: 'deny',
      rule: 'outside-project',
      approvalType: 'file_write'
    });
    expect(planApiToolCall(auto, WT, 'write_file', { filePath: 'b.txt', content: 'x' })).toMatchObject({ verdict: 'allow', rule: 'auto-write' });
    expect(planApiToolCall(manual, WT, 'write_file', { filePath: 'b.txt', content: 'x' })).toMatchObject({ verdict: 'ask', rule: 'manual' });
    expect(planApiToolCall(auto, WT, 'write_file', { content: 'x' })).toMatchObject({ verdict: 'deny', rule: 'bad-args' });
  });

  it('права роли сужают глобальный auto-approve записи', () => {
    const cfg = applyRolePermissions(auto, { allowFileWrite: false });
    expect(planApiToolCall(cfg, WT, 'write_file', { filePath: 'b.txt', content: 'x' })).toMatchObject({ verdict: 'ask', rule: 'write-manual' });
  });

  it('команды: deny-list — карточка, фоновые — отказ, пустая — отказ', () => {
    const cfg = applyRolePermissions(auto, { commandDenyList: ['rm -rf'] });
    expect(planApiToolCall(cfg, WT, 'run_command', { command: 'npm test' })).toMatchObject({ verdict: 'allow', rule: 'auto-command', command: 'npm test' });
    expect(planApiToolCall(cfg, WT, 'run_command', { command: 'rm -rf dist' })).toMatchObject({ verdict: 'ask', rule: 'command-denied' });
    expect(planApiToolCall(cfg, WT, 'run_command', { command: 'npm run dev', background: true })).toMatchObject({
      verdict: 'deny',
      rule: 'background-not-allowed'
    });
    expect(planApiToolCall(cfg, WT, 'run_command', { command: '  ' })).toMatchObject({ verdict: 'deny', rule: 'bad-args' });
  });

  it('allow-список прав роли отклоняет инструмент вне списка, но пропускает алиас', () => {
    const cfg = applyRolePermissions(auto, { allowedTools: ['Read'] });
    expect(planApiToolCall(cfg, WT, 'read_file', { filePath: 'a.txt' })).toMatchObject({ verdict: 'allow' });
    expect(planApiToolCall(cfg, WT, 'write_file', { filePath: 'a.txt', content: '' })).toMatchObject({ verdict: 'deny', rule: 'tool-not-allowed' });
  });

  it('вопрос всегда идёт человеку, computer_* — в прокси', () => {
    expect(planApiToolCall(auto, WT, 'ask_question', { question: '?' })).toMatchObject({ verdict: 'ask', rule: 'question', approvalType: 'question' });
    expect(planApiToolCall(auto, WT, 'computer_click', {})).toMatchObject({ verdict: 'allow', rule: 'computer-proxy', approvalType: 'computer_action' });
  });
});

describe('лимит шагов и computer_*', () => {
  it('maxTurns роли — лимит шагов в пределах 1…100', () => {
    expect(resolveApiMaxSteps(undefined)).toBe(DEFAULT_MAX_TOOL_STEPS);
    expect(resolveApiMaxSteps(0)).toBe(DEFAULT_MAX_TOOL_STEPS);
    expect(resolveApiMaxSteps(3)).toBe(3);
    expect(resolveApiMaxSteps(2.7)).toBe(2);
    expect(resolveApiMaxSteps(1000)).toBe(MAX_API_TOOL_STEPS);
  });

  it('computer_* только в цикле «до готовности» по задаче с label computer-use', () => {
    const tools = [{ name: 'computer_click' }, { name: 'computer_list_windows' }];
    expect(selectComputerTools(tools, { mode: 'fan_out', taskAllowsComputerUse: true })).toEqual([]);
    expect(selectComputerTools(tools, { mode: 'done_loop', taskAllowsComputerUse: false })).toEqual([]);
    expect(selectComputerTools(tools, { mode: 'done_loop', taskAllowsComputerUse: true })).toEqual(tools);
    expect(selectComputerTools(tools, { mode: 'done_loop', taskAllowsComputerUse: true, allowedToolNames: ['read_file'] })).toEqual([]);
    expect(selectComputerTools([], { mode: 'done_loop', taskAllowsComputerUse: true })).toEqual([]);
  });
});
