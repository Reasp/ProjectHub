import { describe, expect, it } from 'vitest';
import { buildEngineInvocation, extractAppendSystemPrompt } from '../../electron/services/roleEngineAdapter';

describe('extractAppendSystemPrompt: многострочный системный промпт — файлом, а не аргументом оболочки', () => {
  it('вынимает пару флаг+текст и сохраняет остальные флаги по порядку', () => {
    const invocation = buildEngineInvocation({
      engine: 'claude-cli',
      extraSystemPrompt: 'Строка 1\nСтрока 2 с "кавычками"',
      model: 'sonnet',
      budgetUsd: 3
    });
    const { args, systemPrompt } = extractAppendSystemPrompt(invocation.args);
    expect(systemPrompt).toBe('Строка 1\nСтрока 2 с "кавычками"');
    expect(args).toEqual(['--model', 'sonnet', '--max-budget-usd', '3']);
    expect(args).not.toContain('--append-system-prompt');
  });

  it('без системного промпта аргументы не меняются (копия)', () => {
    const input = ['--model', 'opus'];
    const result = extractAppendSystemPrompt(input);
    expect(result).toEqual({ args: ['--model', 'opus'] });
    expect(result.args).not.toBe(input);
  });

  it('флаг без значения в конце не ломает разбор', () => {
    expect(extractAppendSystemPrompt(['--append-system-prompt'])).toEqual({ args: ['--append-system-prompt'] });
  });
});
