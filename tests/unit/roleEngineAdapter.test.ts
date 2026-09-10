import { describe, expect, it } from 'vitest';
import {
  buildEngineInvocation,
  claudeToolNamesForCategories,
  apiToolNamesForCategories,
  ENGINE_CAPABILITIES
} from '../../electron/services/roleEngineAdapter';
import type { RoleDefinition } from '../../electron/services/roleTypes';

function role(overrides: Partial<RoleDefinition> = {}): RoleDefinition {
  return {
    slug: 'test-role',
    name: 'Test Role',
    systemPrompt: 'Ты тестовая роль.',
    source: 'builtin',
    ...overrides
  };
}

describe('claudeToolNamesForCategories / apiToolNamesForCategories', () => {
  it('сопоставляет канонические категории нативным именам инструментов', () => {
    expect(claudeToolNamesForCategories(['read', 'write'])).toEqual(expect.arrayContaining(['Read', 'Write', 'Edit']));
    expect(apiToolNamesForCategories(['command'])).toEqual(['run_command']);
  });

  it('пустой список категорий даёт пустой список инструментов', () => {
    expect(claudeToolNamesForCategories([])).toEqual([]);
  });
});

describe('buildEngineInvocation — claude-cli', () => {
  it('строит --append-system-prompt, --model, --allowedTools, --max-budget-usd', () => {
    const r = role({ tools: ['read', 'command'] });
    const result = buildEngineInvocation({ engine: 'claude-cli', role: r, model: 'sonnet', budgetUsd: 3 });
    expect(result.args).toEqual(
      expect.arrayContaining(['--append-system-prompt', r.systemPrompt, '--model', 'sonnet', '--max-budget-usd', '3'])
    );
    expect(result.args.some((a) => a === '--allowedTools')).toBe(true);
    expect(result.unsupportedFeatures).toEqual([]);
  });

  it('промпт не выносится в promptPrefix — идёт через --append-system-prompt', () => {
    const result = buildEngineInvocation({ engine: 'claude-cli', role: role() });
    expect(result.promptPrefix).toBeUndefined();
  });

  it('maxTurns считается поддерживаемым (обеспечивается ProjectHub, не флагом CLI)', () => {
    const r = role({ maxTurns: 10 });
    const result = buildEngineInvocation({ engine: 'claude-cli', role: r });
    expect(result.unsupportedFeatures).not.toContain('maxTurns');
  });
});

describe('buildEngineInvocation — codex-cli', () => {
  it('строит exec/--json/--sandbox/--ask-for-approval и промпт-преамбулу', () => {
    const r = role({ tools: ['read'] });
    const result = buildEngineInvocation({ engine: 'codex-cli', role: r, model: 'gpt-5-codex', autoApprove: true });
    expect(result.args[0]).toBe('exec');
    expect(result.args).toEqual(expect.arrayContaining(['--json', '--sandbox', 'workspace-write', '--ask-for-approval', 'never', '-m', 'gpt-5-codex']));
    expect(result.promptPrefix).toBe(r.systemPrompt);
  });

  it('read-only sandbox, если роль запрещает запись', () => {
    const result = buildEngineInvocation({ engine: 'codex-cli', role: role(), allowFileWrite: false });
    expect(result.args).toEqual(expect.arrayContaining(['--sandbox', 'read-only']));
  });

  it('помечает tools и maxTurns как неподдерживаемые нативно', () => {
    const r = role({ tools: ['read'], maxTurns: 5 });
    const result = buildEngineInvocation({ engine: 'codex-cli', role: r });
    expect(result.unsupportedFeatures).toEqual(expect.arrayContaining(['tools', 'maxTurns']));
  });
});

describe('buildEngineInvocation — gemini-cli', () => {
  it('строит --approval-mode/--output-format и промпт-преамбулу', () => {
    const result = buildEngineInvocation({ engine: 'gemini-cli', role: role(), model: 'gemini-2.5-pro', autoApprove: false });
    expect(result.args).toEqual(expect.arrayContaining(['--approval-mode', 'default', '--output-format', 'json', '-m', 'gemini-2.5-pro']));
    expect(result.promptPrefix).toBe(role().systemPrompt);
  });

  it('yolo при autoApprove', () => {
    const result = buildEngineInvocation({ engine: 'gemini-cli', role: role(), autoApprove: true });
    expect(result.args).toEqual(expect.arrayContaining(['--approval-mode', 'yolo']));
  });
});

describe('buildEngineInvocation — api', () => {
  it('не строит CLI-аргументы, только promptPrefix', () => {
    const result = buildEngineInvocation({ engine: 'api', role: role() });
    expect(result.args).toEqual([]);
    expect(result.promptPrefix).toBe(role().systemPrompt);
  });

  it('tools поддерживаются, maxTurns — нет', () => {
    const r = role({ tools: ['read'], maxTurns: 3 });
    const result = buildEngineInvocation({ engine: 'api', role: r });
    expect(result.unsupportedFeatures).toEqual(['maxTurns']);
  });
});

describe('ENGINE_CAPABILITIES — матрица поддержки для UI', () => {
  it('claude-cli поддерживает всё, codex/gemini — не tools/maxTurns', () => {
    expect(ENGINE_CAPABILITIES['claude-cli']).toEqual({ systemPrompt: true, model: true, tools: true, maxTurns: true });
    expect(ENGINE_CAPABILITIES['codex-cli'].tools).toBe(false);
    expect(ENGINE_CAPABILITIES['gemini-cli'].tools).toBe(false);
  });
});
