import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STREAM_MAX_TOKENS,
  MIN_THINKING_BUDGET_TOKENS,
  UNKNOWN_MODEL_CAPABILITIES,
  buildAnthropicMessagesBody,
  isUnsetModelId,
  modelAcceptsTemperature,
  parseAnthropicModelCapabilities,
  resolveAnthropicModelId,
  type AnthropicBodyInput,
  type AnthropicModelCapabilities
} from '../../electron/services/anthropicRequest';

const ADAPTIVE: AnthropicModelCapabilities = { thinking: { adaptive: true, enabled: false }, maxOutputTokens: 128_000 };
const ADAPTIVE_AND_ENABLED: AnthropicModelCapabilities = { thinking: { adaptive: true, enabled: true }, maxOutputTokens: 128_000 };
const ENABLED_ONLY: AnthropicModelCapabilities = { thinking: { adaptive: false, enabled: true }, maxOutputTokens: 64_000 };
const NO_THINKING: AnthropicModelCapabilities = { thinking: { adaptive: false, enabled: false }, maxOutputTokens: 8_192 };

function input(overrides: Partial<AnthropicBodyInput> = {}): AnthropicBodyInput {
  return { model: 'claude-opus-5', system: 'sys', messages: [{ role: 'user', content: 'hi' }], ...overrides };
}

describe('resolveAnthropicModelId: без вендорского дефолта (TASK-88, decision-26 п. 0)', () => {
  it('пустая модель и сентинел CLI «default» — понятная ошибка', () => {
    for (const model of [undefined, null, '', '   ', 'default', ' default ']) {
      expect(isUnsetModelId(model)).toBe(true);
      expect(() => resolveAnthropicModelId(model)).toThrow(/Модель не выбрана/);
    }
  });

  it('заданная модель возвращается без пробелов по краям', () => {
    expect(resolveAnthropicModelId(' claude-sonnet-5 ')).toBe('claude-sonnet-5');
    expect(isUnsetModelId('claude-sonnet-5')).toBe(false);
  });

  it('сборка тела без модели падает, а не подставляет модель', () => {
    expect(() => buildAnthropicMessagesBody(input({ model: '' }), ADAPTIVE)).toThrow(/Модель не выбрана/);
  });
});

describe('parseAnthropicModelCapabilities: ответ Models API', () => {
  it('читает режимы thinking и потолок max_tokens', () => {
    const caps = parseAnthropicModelCapabilities({
      id: 'claude-opus-5',
      max_tokens: 128000,
      capabilities: {
        thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } }
      }
    });
    expect(caps).toEqual({ thinking: { adaptive: true, enabled: false }, maxOutputTokens: 128000 });
  });

  it('thinking.supported=false обнуляет оба режима', () => {
    const caps = parseAnthropicModelCapabilities({
      capabilities: { thinking: { supported: false, types: { adaptive: { supported: true }, enabled: { supported: true } } } }
    });
    expect(caps.thinking).toEqual({ adaptive: false, enabled: false });
  });

  it('отсутствующие capabilities и неопубликованный max_tokens — «неизвестно», а не «нет»', () => {
    expect(parseAnthropicModelCapabilities({ capabilities: null, max_tokens: 0 })).toEqual(UNKNOWN_MODEL_CAPABILITIES);
    expect(parseAnthropicModelCapabilities({ max_tokens: null })).toEqual(UNKNOWN_MODEL_CAPABILITIES);
    expect(parseAnthropicModelCapabilities(null)).toEqual(UNKNOWN_MODEL_CAPABILITIES);
    expect(parseAnthropicModelCapabilities('oops')).toEqual(UNKNOWN_MODEL_CAPABILITIES);
  });
});

describe('modelAcceptsTemperature: закрытый allow-список семейств до Opus 4.7', () => {
  it('старые семейства принимают temperature', () => {
    for (const id of [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-1-20250805',
      'claude-sonnet-4-20250514',
      'claude-3-5-haiku-latest'
    ]) {
      expect(modelAcceptsTemperature(id), id).toBe(true);
    }
  });

  it('Opus 4.7+, Sonnet 5, Fable, Mythos, алиасы и неизвестные модели — нет', () => {
    for (const id of [
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-fable-5-1',
      'claude-mythos-5',
      'sonnet',
      'some-future-model'
    ]) {
      expect(modelAcceptsTemperature(id), id).toBe(false);
    }
  });
});

describe('buildAnthropicMessagesBody: max_tokens (AC#1)', () => {
  it('по умолчанию — потоковый потолок, а не 4096', () => {
    const { body } = buildAnthropicMessagesBody(input(), ADAPTIVE);
    expect(body.max_tokens).toBe(DEFAULT_STREAM_MAX_TOKENS);
    expect(body).toMatchObject({ model: 'claude-opus-5', system: 'sys', stream: true });
  });

  it('значение вызывающего кода используется как есть', () => {
    expect(buildAnthropicMessagesBody(input({ maxTokens: 2000 }), ADAPTIVE).body.max_tokens).toBe(2000);
  });

  it('ограничивается потолком модели; мусорные значения игнорируются', () => {
    expect(buildAnthropicMessagesBody(input(), NO_THINKING).body.max_tokens).toBe(8_192);
    expect(buildAnthropicMessagesBody(input({ maxTokens: 500_000 }), ADAPTIVE).body.max_tokens).toBe(128_000);
    expect(buildAnthropicMessagesBody(input({ maxTokens: -5 }), UNKNOWN_MODEL_CAPABILITIES).body.max_tokens).toBe(
      DEFAULT_STREAM_MAX_TOKENS
    );
    expect(buildAnthropicMessagesBody(input({ maxTokens: Number.NaN }), ADAPTIVE).body.max_tokens).toBe(DEFAULT_STREAM_MAX_TOKENS);
  });

  it('tools добавляются только непустым списком', () => {
    expect(buildAnthropicMessagesBody(input({ tools: [] }), ADAPTIVE).body).not.toHaveProperty('tools');
    expect(buildAnthropicMessagesBody(input({ tools: [{ name: 'x' }] }), ADAPTIVE).body.tools).toEqual([{ name: 'x' }]);
  });
});

describe('buildAnthropicMessagesBody: thinking по возможностям модели (AC#2)', () => {
  it('без бюджета thinking не отправляется — действует режим модели', () => {
    for (const thinkingBudget of [undefined, 0]) {
      const { body, notes } = buildAnthropicMessagesBody(input({ thinkingBudget }), ADAPTIVE);
      expect(body).not.toHaveProperty('thinking');
      expect(notes).toEqual([]);
    }
  });

  it('adaptive-модель получает adaptive без budget_tokens, независимо от имени', () => {
    for (const model of ['claude-opus-5', 'claude-sonnet-5', 'my-proxy-alias']) {
      const { body } = buildAnthropicMessagesBody(input({ model, thinkingBudget: 2048 }), ADAPTIVE);
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    }
  });

  it('если доступны оба режима — выбирается adaptive', () => {
    const { body } = buildAnthropicMessagesBody(input({ thinkingBudget: 4096 }), ADAPTIVE_AND_ENABLED);
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it('модель только с enabled получает budget_tokens не меньше минимума и меньше max_tokens', () => {
    const model = 'claude-haiku-4-5';
    expect(buildAnthropicMessagesBody(input({ model, thinkingBudget: 4096 }), ENABLED_ONLY).body.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 4096
    });
    expect(buildAnthropicMessagesBody(input({ model, thinkingBudget: 512 }), ENABLED_ONLY).body.thinking).toEqual({
      type: 'enabled',
      budget_tokens: MIN_THINKING_BUDGET_TOKENS
    });
    expect(
      buildAnthropicMessagesBody(input({ model, thinkingBudget: 8192, maxTokens: 3000 }), ENABLED_ONLY).body.thinking
    ).toEqual({ type: 'enabled', budget_tokens: 2999 });
  });

  it('max_tokens без места под минимальный бюджет — thinking не отправляется, причина в notes', () => {
    const { body, notes } = buildAnthropicMessagesBody(
      input({ model: 'claude-haiku-4-5', thinkingBudget: 2048, maxTokens: 1024 }),
      ENABLED_ONLY
    );
    expect(body).not.toHaveProperty('thinking');
    expect(notes.join('\n')).toMatch(/места для бюджета/);
  });

  it('модель без рассуждений и неизвестные возможности — без thinking, с пояснением', () => {
    const none = buildAnthropicMessagesBody(input({ thinkingBudget: 2048 }), NO_THINKING);
    expect(none.body).not.toHaveProperty('thinking');
    expect(none.notes.join('\n')).toMatch(/не поддерживает рассуждения/);

    const unknown = buildAnthropicMessagesBody(input({ thinkingBudget: 2048 }), UNKNOWN_MODEL_CAPABILITIES);
    expect(unknown.body).not.toHaveProperty('thinking');
    expect(unknown.notes.join('\n')).toMatch(/неизвестны/);
  });
});

describe('buildAnthropicMessagesBody: temperature развязана с thinking (AC#3)', () => {
  it('без явного значения temperature не подставляется', () => {
    const { body } = buildAnthropicMessagesBody(input({ model: 'claude-sonnet-4-6' }), ADAPTIVE_AND_ENABLED);
    expect(body).not.toHaveProperty('temperature');
  });

  it('явное значение уходит на модель, которая его принимает, в том числе 0', () => {
    for (const temperature of [0, 0.3]) {
      const { body } = buildAnthropicMessagesBody(input({ model: 'claude-sonnet-4-6', temperature }), ADAPTIVE_AND_ENABLED);
      expect(body.temperature).toBe(temperature);
    }
  });

  it('модели без sampling-параметров temperature не отправляется — даже без thinking', () => {
    const { body, notes } = buildAnthropicMessagesBody(input({ model: 'claude-opus-5', temperature: 0.7 }), ADAPTIVE);
    expect(body).not.toHaveProperty('temperature');
    expect(notes.join('\n')).toMatch(/sampling/);
  });

  it('при включённых рассуждениях thinking сохраняется, temperature отбрасывается с пояснением', () => {
    const { body, notes } = buildAnthropicMessagesBody(
      input({ model: 'claude-haiku-4-5', temperature: 0.2, thinkingBudget: 2048 }),
      ENABLED_ONLY
    );
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
    expect(body).not.toHaveProperty('temperature');
    expect(notes.join('\n')).toMatch(/несовместима/);
  });

  it('если thinking не отправлен, заданная temperature уходит', () => {
    const { body } = buildAnthropicMessagesBody(
      input({ model: 'claude-sonnet-4-5', temperature: 0.2, thinkingBudget: 2048 }),
      UNKNOWN_MODEL_CAPABILITIES
    );
    expect(body).not.toHaveProperty('thinking');
    expect(body.temperature).toBe(0.2);
  });
});
