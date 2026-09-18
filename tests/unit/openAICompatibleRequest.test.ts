import { describe, expect, it } from 'vitest';
import {
  buildOpenAICompatibleChatBody,
  resolveOpenAICompatibleModelId
} from '../../electron/services/openAICompatibleRequest';

const messages = [{ role: 'user', content: 'привет' }];

describe('resolveOpenAICompatibleModelId (TASK-92)', () => {
  it('без модели — понятная ошибка, а не модель вендора', () => {
    for (const model of [undefined, null, '', '   ', 'default']) {
      expect(() => resolveOpenAICompatibleModelId(model, 'openrouter')).toThrow(/Модель не выбрана.*openrouter/);
    }
  });

  it('модель обрезается по краям', () => {
    expect(resolveOpenAICompatibleModelId('  qwen/qwen3-coder  ', 'openrouter')).toBe('qwen/qwen3-coder');
  });
});

describe('buildOpenAICompatibleChatBody (TASK-92)', () => {
  it('без явных temperature и maxTokens параметры не отправляются', () => {
    const body = buildOpenAICompatibleChatBody({ provider: 'deepseek', model: 'deepseek-chat', messages });
    expect(body).toEqual({
      model: 'deepseek-chat',
      messages,
      stream: true,
      stream_options: { include_usage: true }
    });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('явная temperature отправляется, включая 0', () => {
    expect(buildOpenAICompatibleChatBody({ provider: 'custom', model: 'm', messages, temperature: 0 }).temperature).toBe(0);
    expect(buildOpenAICompatibleChatBody({ provider: 'custom', model: 'm', messages, temperature: 0.3 }).temperature).toBe(0.3);
    expect(buildOpenAICompatibleChatBody({ provider: 'custom', model: 'm', messages, temperature: Number.NaN })).not.toHaveProperty('temperature');
  });

  it('maxTokens уходит как max_tokens, некорректные значения игнорируются', () => {
    expect(buildOpenAICompatibleChatBody({ provider: 'custom', model: 'm', messages, maxTokens: 2048.7 }).max_tokens).toBe(2048);
    for (const maxTokens of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildOpenAICompatibleChatBody({ provider: 'custom', model: 'm', messages, maxTokens })).not.toHaveProperty('max_tokens');
    }
  });

  it('tools только непустые', () => {
    const tools = [{ type: 'function', function: { name: 'read_file' } }];
    expect(buildOpenAICompatibleChatBody({ provider: 'custom', model: 'm', messages, tools }).tools).toBe(tools);
    expect(buildOpenAICompatibleChatBody({ provider: 'custom', model: 'm', messages, tools: [] })).not.toHaveProperty('tools');
  });

  it('учёт usage: Ollama без stream_options, OpenRouter с usage.include', () => {
    const ollama = buildOpenAICompatibleChatBody({ provider: 'ollama', model: 'llama3.1', messages });
    expect(ollama).not.toHaveProperty('stream_options');
    expect(ollama).not.toHaveProperty('usage');

    const openrouter = buildOpenAICompatibleChatBody({ provider: 'openrouter', model: 'x/y', messages });
    expect(openrouter.stream_options).toEqual({ include_usage: true });
    expect(openrouter.usage).toEqual({ include: true });
  });

  it('без модели сборка падает с понятной ошибкой', () => {
    expect(() => buildOpenAICompatibleChatBody({ provider: 'ollama', model: '', messages })).toThrow(/Модель не выбрана/);
  });
});
