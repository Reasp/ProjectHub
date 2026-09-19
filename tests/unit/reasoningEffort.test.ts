import { describe, expect, it } from 'vitest';
import {
  REASONING_EFFORTS,
  claudeCliEffortArgs,
  extractReasoningDelta,
  normalizeReasoningEffort,
  openAICompatibleReasoningFields,
  pickSupportedEffort
} from '../../electron/services/reasoningEffort';
import { buildOpenAICompatibleChatBody } from '../../electron/services/openAICompatibleRequest';
import { getPreset, legacyProviderCompat, type LlmCompatFlags } from '../../electron/services/llmProfiles';

const messages = [{ role: 'user', content: 'hi' }];

describe('normalizeReasoningEffort: шкала none…max (decision-41 п. 1)', () => {
  it('принимает только значения шкалы', () => {
    for (const e of REASONING_EFFORTS) expect(normalizeReasoningEffort(e)).toBe(e);
    for (const bad of [undefined, null, '', 'xhigh', 'minimal', 'HIGH', 3]) expect(normalizeReasoningEffort(bad)).toBeUndefined();
  });
});

describe('openAICompatibleReasoningFields: трансляция по compat.reasoning (decision-41 п. 2)', () => {
  it('без усилия ничего не отправляется ни в одном стиле', () => {
    for (const style of ['none', 'reasoning_effort', 'reasoning_object', 'ollama_think'] as const) {
      expect(openAICompatibleReasoningFields(undefined, style)).toEqual({ fields: {} });
    }
  });

  it('reasoning_effort — значение как есть, включая none и max', () => {
    for (const e of REASONING_EFFORTS) {
      expect(openAICompatibleReasoningFields(e, 'reasoning_effort').fields).toEqual({ reasoning_effort: e });
    }
  });

  it('reasoning_object (OpenRouter) — reasoning.effort', () => {
    expect(openAICompatibleReasoningFields('max', 'reasoning_object').fields).toEqual({ reasoning: { effort: 'max' } });
    expect(openAICompatibleReasoningFields('none', 'reasoning_object').fields).toEqual({ reasoning: { effort: 'none' } });
  });

  it('ollama_think — reasoning_effort: Ollama /v1 игнорирует think', () => {
    const r = openAICompatibleReasoningFields('high', 'ollama_think');
    expect(r.fields).toEqual({ reasoning_effort: 'high' });
    expect(r.fields).not.toHaveProperty('think');
    expect(openAICompatibleReasoningFields('none', 'ollama_think').fields).toEqual({ reasoning_effort: 'none' });
  });

  it('none — поле не отправляется, есть пояснение', () => {
    const r = openAICompatibleReasoningFields('high', 'none');
    expect(r.fields).toEqual({});
    expect(r.note).toMatch(/compat.reasoning = none/);
  });
});

describe('buildOpenAICompatibleChatBody: усилие в теле запроса', () => {
  const compat = (reasoning: LlmCompatFlags['reasoning']): LlmCompatFlags => ({ ...getPreset('custom').compat, reasoning });

  it('поле попадает в тело по стилю профиля', () => {
    expect(buildOpenAICompatibleChatBody({ provider: 'p', compat: compat('reasoning_effort'), model: 'm', messages, reasoningEffort: 'low' }).reasoning_effort).toBe('low');
    expect(buildOpenAICompatibleChatBody({ provider: 'p', compat: compat('reasoning_object'), model: 'm', messages, reasoningEffort: 'medium' }).reasoning).toEqual({ effort: 'medium' });
    expect(buildOpenAICompatibleChatBody({ provider: 'p', compat: getPreset('ollama').compat, model: 'm', messages, reasoningEffort: 'max' }).reasoning_effort).toBe('max');
  });

  it('без усилия тело прежнее; стиль none — пояснение в notes', () => {
    const plain = buildOpenAICompatibleChatBody({ provider: 'p', compat: compat('reasoning_effort'), model: 'm', messages });
    expect(plain).not.toHaveProperty('reasoning_effort');
    expect(plain).not.toHaveProperty('reasoning');
    const notes: string[] = [];
    const body = buildOpenAICompatibleChatBody({ provider: 'p', compat: compat('none'), model: 'm', messages, reasoningEffort: 'high', notes });
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(notes).toHaveLength(1);
  });

  it('пресеты и прежние провайдеры: Ollama — ollama_think, OpenRouter — reasoning_object, DeepSeek — none', () => {
    expect(getPreset('ollama').compat.reasoning).toBe('ollama_think');
    expect(legacyProviderCompat('ollama').reasoning).toBe('ollama_think');
    expect(legacyProviderCompat('openrouter').reasoning).toBe('reasoning_object');
    expect(legacyProviderCompat('deepseek').reasoning).toBe('none');
    expect(legacyProviderCompat('custom').reasoning).toBe('none');
  });
});

describe('pickSupportedEffort: ближайший поддерживаемый уровень ниже', () => {
  it('сам уровень, затем ниже, иначе undefined', () => {
    expect(pickSupportedEffort('max', { low: true, medium: true, high: true, max: true })).toBe('max');
    expect(pickSupportedEffort('max', { low: true, medium: true, high: true })).toBe('high');
    expect(pickSupportedEffort('medium', { high: true })).toBeUndefined();
  });
});

describe('claudeCliEffortArgs: флаг --effort Claude CLI (decision-41 п. 5)', () => {
  it('уровни передаются, none — нет (у CLI нет такого уровня)', () => {
    expect(claudeCliEffortArgs(undefined)).toEqual({ args: [] });
    expect(claudeCliEffortArgs('high')).toEqual({ args: ['--effort', 'high'] });
    expect(claudeCliEffortArgs('max').args).toEqual(['--effort', 'max']);
    const none = claudeCliEffortArgs('none');
    expect(none.args).toEqual([]);
    expect(none.note).toMatch(/не умеет выключать/);
  });
});

describe('extractReasoningDelta: дельты рассуждений → thought (decision-41 п. 6)', () => {
  it('DeepSeek reasoning_content', () => {
    expect(extractReasoningDelta({ reasoning_content: 'шаг 1' })).toBe('шаг 1');
  });

  it('Ollama /v1 и OpenRouter — reasoning строкой (формат проверен на Ollama 0.31)', () => {
    expect(extractReasoningDelta({ role: 'assistant', content: '', reasoning: 'Thinking' })).toBe('Thinking');
  });

  it('reasoning_details — только если строки reasoning нет (без двойного показа)', () => {
    const details = [{ type: 'reasoning.text', text: 'a' }, { type: 'reasoning.summary', summary: 'b' }, { type: 'reasoning.encrypted', data: 'x' }];
    expect(extractReasoningDelta({ reasoning_details: details })).toBe('ab');
    expect(extractReasoningDelta({ reasoning: 'a', reasoning_details: details })).toBe('a');
  });

  it('обычный текст и мусор — пусто', () => {
    for (const d of [{ content: 'hi' }, { reasoning: '' }, { reasoning: 42 }, null, undefined, 'x']) {
      expect(extractReasoningDelta(d)).toBe('');
    }
  });
});
