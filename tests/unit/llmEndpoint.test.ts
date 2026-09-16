import { describe, expect, it } from 'vitest';
import {
  CUSTOM_DEFAULT_ENDPOINT,
  OLLAMA_DEFAULT_BASE_URL,
  resolveOpenAICompatibleEndpoint
} from '../../electron/services/llmEndpoint';

describe('resolveOpenAICompatibleEndpoint: адрес и заголовки провайдера (TASK-83)', () => {
  it('OpenRouter: ключ обязателен, добавляются заголовки атрибуции', () => {
    const resolved = resolveOpenAICompatibleEndpoint({ provider: 'openrouter', apiKey: ' key ' });
    expect(resolved.endpoint).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(resolved.headers).toMatchObject({
      Authorization: 'Bearer key',
      'HTTP-Referer': 'https://projecthub.local',
      'X-Title': 'ProjectHub AI Studio',
      'content-type': 'application/json'
    });
    expect(() => resolveOpenAICompatibleEndpoint({ provider: 'openrouter' })).toThrow(/OpenRouter/);
    expect(() => resolveOpenAICompatibleEndpoint({ provider: 'openrouter', apiKey: '   ' })).toThrow(/OpenRouter/);
  });

  it('DeepSeek: ключ обязателен, эндпоинт фиксированный', () => {
    const resolved = resolveOpenAICompatibleEndpoint({ provider: 'deepseek', apiKey: 'k' });
    expect(resolved.endpoint).toBe('https://api.deepseek.com/chat/completions');
    expect(resolved.headers.Authorization).toBe('Bearer k');
    expect(() => resolveOpenAICompatibleEndpoint({ provider: 'deepseek' })).toThrow(/DeepSeek/);
  });

  it('Ollama: локальный сервер без ключа, baseUrl дополняется путём', () => {
    expect(resolveOpenAICompatibleEndpoint({ provider: 'ollama' }).endpoint).toBe(
      `${OLLAMA_DEFAULT_BASE_URL}/v1/chat/completions`
    );
    expect(resolveOpenAICompatibleEndpoint({ provider: 'ollama', baseUrl: 'http://10.0.0.2:11434///' }).endpoint).toBe(
      'http://10.0.0.2:11434/v1/chat/completions'
    );
    expect(resolveOpenAICompatibleEndpoint({ provider: 'ollama' }).headers.Authorization).toBeUndefined();
  });

  it('custom: baseUrl — полный адрес, ключ необязателен', () => {
    expect(resolveOpenAICompatibleEndpoint({ provider: 'custom' }).endpoint).toBe(CUSTOM_DEFAULT_ENDPOINT);
    const resolved = resolveOpenAICompatibleEndpoint({
      provider: 'custom',
      baseUrl: 'http://localhost:1234/v1/chat/completions',
      apiKey: 'local'
    });
    expect(resolved.endpoint).toBe('http://localhost:1234/v1/chat/completions');
    expect(resolved.headers.Authorization).toBe('Bearer local');
  });

  it('baseUrl для openrouter и deepseek сегодня игнорируется (долг TASK-70, decision-26 п. 1)', () => {
    expect(
      resolveOpenAICompatibleEndpoint({ provider: 'deepseek', apiKey: 'k', baseUrl: 'https://proxy.local' }).endpoint
    ).toBe('https://api.deepseek.com/chat/completions');
  });
});
