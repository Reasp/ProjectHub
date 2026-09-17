import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CLI_COMPLETION_SYSTEM_PROMPT,
  buildClaudeCliCompletionCommand,
  parseClaudeCliCompletionOutput
} from '../../electron/services/claudeCliCompletion';

describe('buildClaudeCliCompletionCommand: облегчённый запуск claude -p (TASK-83)', () => {
  it('модель из настроек, без MCP, инструментов, сессии и навыков', () => {
    const { args } = buildClaudeCliCompletionCommand({ model: ' sonnet ', prompt: 'hi' });
    expect(args).toEqual([
      '-p',
      '--model',
      'sonnet',
      '--output-format',
      'json',
      '--strict-mcp-config',
      '--tools=',
      '--no-session-persistence',
      '--disable-slash-commands',
      '--system-prompt',
      CLAUDE_CLI_COMPLETION_SYSTEM_PROMPT
    ]);
  });

  it('инструкции задачи и запрос уходят в stdin, а не в аргументы', () => {
    const { args, stdin } = buildClaudeCliCompletionCommand({ model: 'sonnet', system: 'Classify.', prompt: 'Фраза "в кавычках"' });
    expect(stdin).toBe('Classify.\n\nФраза "в кавычках"');
    expect(args.join(' ')).not.toContain('в кавычках');
    expect(buildClaudeCliCompletionCommand({ model: 'sonnet', prompt: 'x' }).stdin).toBe('x');
  });

  it('без модели — понятная ошибка, а не модель вендора', () => {
    expect(() => buildClaudeCliCompletionCommand({ model: '  ', prompt: 'x' })).toThrow(/Модель не выбрана/);
  });
});

describe('parseClaudeCliCompletionOutput: ответ --output-format json', () => {
  it('возвращает текст результата', () => {
    const out = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: ' {"intent":"read_tasks"} ' });
    expect(parseClaudeCliCompletionOutput(out)).toBe('{"intent":"read_tasks"}');
  });

  it('пропускает предупреждения перед JSON', () => {
    const out = `Warning: something\n${JSON.stringify({ is_error: false, result: 'ok' })}\n`;
    expect(parseClaudeCliCompletionOutput(out)).toBe('ok');
  });

  it('ошибка CLI превращается в исключение с причиной', () => {
    const out = JSON.stringify({ is_error: true, subtype: 'error_during_execution', result: 'Not logged in' });
    expect(() => parseClaudeCliCompletionOutput(out)).toThrow(/Not logged in/);
  });

  it('не JSON и JSON без текста — ошибки', () => {
    expect(() => parseClaudeCliCompletionOutput('command not found')).toThrow(/не JSON/);
    expect(() => parseClaudeCliCompletionOutput('{"is_error":false}')).toThrow(/не вернул текст/);
    expect(() => parseClaudeCliCompletionOutput('{broken')).toThrow(/некорректный JSON/);
  });
});
