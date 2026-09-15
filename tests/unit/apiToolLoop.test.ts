import { describe, expect, it } from 'vitest';
import {
  OpenAIToolCallAccumulator,
  buildAnthropicToolTurn,
  buildOpenAIToolTurn,
  parseToolArguments,
  toOpenAITools,
  truncateToolResult
} from '../../electron/services/apiToolLoop';

describe('OpenAIToolCallAccumulator: потоковые delta.tool_calls', () => {
  it('собирает имя и аргументы из фрагментов по index', () => {
    const acc = new OpenAIToolCallAccumulator();
    acc.push([{ index: 0, id: 'call_1', type: 'function', function: { name: 'computer_', arguments: '' } }]);
    acc.push([{ index: 0, function: { name: 'type', arguments: '{"text":"При' } }]);
    acc.push([{ index: 1, id: 'call_2', function: { name: 'computer_key', arguments: '{"text":"ctrl+s"}' } }]);
    acc.push([{ index: 0, function: { arguments: 'вет"}' } }]);
    expect(acc.finalize()).toEqual([
      { id: 'call_1', name: 'computer_type', args: { text: 'Привет' } },
      { id: 'call_2', name: 'computer_key', args: { text: 'ctrl+s' } }
    ]);
  });

  it('Ollama: аргументы объектом одним чанком, без id', () => {
    const acc = new OpenAIToolCallAccumulator();
    acc.push([{ function: { name: 'computer_list_windows', arguments: {} } }]);
    const [call] = acc.finalize('ollama');
    expect(call.name).toBe('computer_list_windows');
    expect(call.args).toEqual({});
    expect(call.id).toMatch(/^ollama-0-/);
  });

  it('битый JSON аргументов не роняет цикл', () => {
    expect(parseToolArguments('{"text": ')).toHaveProperty('_parseError');
    expect(parseToolArguments('')).toEqual({});
    expect(parseToolArguments('[1,2]')).toEqual({ value: [1, 2] });
    const acc = new OpenAIToolCallAccumulator();
    acc.push('garbage');
    acc.push([null, { index: 0, function: {} }]);
    expect(acc.finalize()).toEqual([]);
  });
});

describe('сообщения хода tool-loop', () => {
  const call = { id: 'toolu_1', name: 'computer_screenshot', args: {} };
  const result = { content: '1366x768 | screen 1920x1080', images: [{ mimeType: 'image/jpeg', data: 'AAAA' }] };

  it('toOpenAITools переносит input_schema в parameters', () => {
    expect(toOpenAITools([{ name: 'read_file', description: 'd', input_schema: { type: 'object', properties: { a: { type: 'string' } } } }])).toEqual([
      { type: 'function', function: { name: 'read_file', description: 'd', parameters: { type: 'object', properties: { a: { type: 'string' } } } } }
    ]);
  });

  it('Anthropic: блоки ассистента как есть, tool_result с изображением и is_error', () => {
    const [assistant, user] = buildAnthropicToolTurn(
      [
        { type: 'thinking', thinking: 'hmm', signature: 'sig' },
        { type: 'text', text: '' },
        { type: 'tool_use', id: 'toolu_1', name: 'computer_screenshot', input: {} }
      ],
      [{ call, result }, { call: { ...call, id: 'toolu_2' }, result: { content: 'нет окна', isError: true } }]
    );
    expect(assistant.content.map((b) => b.type)).toEqual(['thinking', 'tool_use']);
    expect(user.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: [
        { type: 'text', text: '1366x768 | screen 1920x1080' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }
      ]
    });
    expect(user.content[1]).toMatchObject({ tool_use_id: 'toolu_2', is_error: true });
  });

  it('OpenAI без vision: изображения не передаются, модель направляется к дереву доступности', () => {
    const messages = buildOpenAIToolTurn('Смотрю экран', [{ call, result }]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: 'assistant',
      content: 'Смотрю экран',
      tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'computer_screenshot', arguments: '{}' } }]
    });
    expect(messages[1].role).toBe('tool');
    expect(messages[1].tool_call_id).toBe('toolu_1');
    expect(messages[1].content).toContain('get_ui_tree');
  });

  it('OpenAI с vision: скриншоты отдельным user-сообщением', () => {
    const messages = buildOpenAIToolTurn('', [{ call, result }], { vision: true });
    expect(messages[0].content).toBeNull();
    expect(messages[2].role).toBe('user');
    expect((messages[2].content as unknown[])[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });
  });

  it('длинный результат усекается', () => {
    const text = truncateToolResult('x'.repeat(50), 10);
    expect(text.startsWith('xxxxxxxxxx\n')).toBe(true);
    expect(text).toContain('40');
  });
});
