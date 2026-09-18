import { describe, expect, it } from 'vitest';
import {
  apiConfigProblem,
  describeProviderInfo,
  providerConfigFromSpec,
  resolveProfileRef,
  resolveSlotProviderConfig,
  reviewerProviderSpec
} from '../../electron/services/slotProvider';
import type { AIProviderConfig } from '../../electron/services/aiAgentService';

const PROFILES = [
  { id: 'p-ollama', name: 'Ollama', local: true },
  { id: 'p-or', name: 'OpenRouter', local: false },
  { id: 'p-dup-1', name: 'Dup', local: false },
  { id: 'p-dup-2', name: 'dup', local: false }
];

const ANTHROPIC_GLOBAL: AIProviderConfig = { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-ant', autoApprove: true };

describe('resolveProfileRef (TASK-70.5)', () => {
  it('находит профиль по id, затем по имени без учёта регистра', () => {
    expect(resolveProfileRef('p-or', PROFILES).id).toBe('p-or');
    expect(resolveProfileRef('  ollama ', PROFILES).id).toBe('p-ollama');
  });

  it('неоднозначное имя и отсутствующий профиль дают понятную ошибку', () => {
    expect(() => resolveProfileRef('DUP', PROFILES)).toThrow(/неоднозначно/);
    expect(() => resolveProfileRef('LM Studio', PROFILES)).toThrow(/«LM Studio» не найден/);
    expect(() => resolveProfileRef('  ', PROFILES)).toThrow(/не указан/);
  });
});

describe('providerConfigFromSpec', () => {
  it('без полей — undefined (настройки AI Studio), профиль важнее провайдера', () => {
    expect(providerConfigFromSpec(undefined)).toBeUndefined();
    expect(providerConfigFromSpec({ provider: ' ', model: '' })).toBeUndefined();
    expect(providerConfigFromSpec({ provider: 'deepseek', profile: 'Ollama', model: 'qwen' })).toEqual({
      provider: 'openai-compatible',
      profileId: 'Ollama',
      model: 'qwen'
    });
  });

  it('роль с одной моделью не получает провайдера anthropic', () => {
    expect(providerConfigFromSpec({ model: 'm1' })).toEqual({ model: 'm1' });
  });

  it('неизвестный провайдер — ошибка, temperature передаётся только числом', () => {
    expect(() => providerConfigFromSpec({ provider: 'gpt' })).toThrow(/Неизвестный провайдер «gpt»/);
    expect(providerConfigFromSpec({ provider: 'ollama', temperature: 0 })).toEqual({ provider: 'ollama', temperature: 0 });
  });
});

describe('resolveSlotProviderConfig', () => {
  it('без настроек слота — настройки AI Studio', () => {
    const { config, info } = resolveSlotProviderConfig(undefined, ANTHROPIC_GLOBAL, PROFILES);
    expect(config).toBe(ANTHROPIC_GLOBAL);
    expect(info).toEqual({ provider: 'anthropic', model: 'claude-x' });
  });

  it('профиль по имени разрешается в id, ключ AI Studio не копируется', () => {
    const { config, info } = resolveSlotProviderConfig(
      { provider: 'openai-compatible', profileId: 'ollama', model: 'qwen2.5:7b-instruct' },
      ANTHROPIC_GLOBAL,
      PROFILES
    );
    expect(config).toEqual({ provider: 'openai-compatible', profileId: 'p-ollama', model: 'qwen2.5:7b-instruct' });
    expect(config.apiKey).toBeUndefined();
    expect(info).toEqual({
      provider: 'openai-compatible',
      model: 'qwen2.5:7b-instruct',
      profileId: 'p-ollama',
      profileName: 'Ollama',
      local: true
    });
  });

  it('пустая модель профиля берётся из AI Studio только для того же профиля', () => {
    const global: AIProviderConfig = { provider: 'openai-compatible', profileId: 'p-ollama', model: 'qwen' };
    expect(resolveSlotProviderConfig({ provider: 'openai-compatible', profileId: 'p-ollama' }, global, PROFILES).config.model).toBe('qwen');
    expect(resolveSlotProviderConfig({ provider: 'openai-compatible', profileId: 'p-or', model: 'default' }, global, PROFILES).config.model).toBe('');
  });

  it('профиль без id и несуществующий профиль — ошибки', () => {
    expect(() => resolveSlotProviderConfig({ provider: 'openai-compatible' }, ANTHROPIC_GLOBAL, PROFILES)).toThrow(/не выбран профиль/);
    expect(() => resolveSlotProviderConfig({ profileId: 'gone' }, ANTHROPIC_GLOBAL, PROFILES)).toThrow(/не найден/);
  });

  it('только модель — провайдер и ключ AI Studio, модель слота', () => {
    const { config } = resolveSlotProviderConfig({ model: 'claude-y', temperature: 0.1 }, ANTHROPIC_GLOBAL, PROFILES);
    expect(config).toEqual({ ...ANTHROPIC_GLOBAL, model: 'claude-y', temperature: 0.1 });
  });

  it('тот же прежний провайдер — ключ AI Studio; `default` заменяется моделью AI Studio', () => {
    const { config } = resolveSlotProviderConfig({ provider: 'anthropic', model: 'default' }, ANTHROPIC_GLOBAL, PROFILES);
    expect(config.apiKey).toBe('sk-ant');
    expect(config.model).toBe('claude-x');
    const deepseek: AIProviderConfig = { provider: 'deepseek', model: 'ds-model', apiKey: 'sk-ds' };
    const r = resolveSlotProviderConfig({ provider: 'deepseek', model: 'ds-other' }, deepseek, PROFILES);
    expect(r.config).toEqual({ provider: 'deepseek', model: 'ds-other', apiKey: 'sk-ds' });
  });

  it('Ollama без ключа работает при другом провайдере AI Studio, без модели по умолчанию', () => {
    const { config, info } = resolveSlotProviderConfig({ provider: 'ollama' }, ANTHROPIC_GLOBAL, PROFILES);
    expect(config).toEqual({ provider: 'ollama', model: '' });
    expect(config.apiKey).toBeUndefined();
    expect(info.local).toBe(true);
  });

  it('иной прежний провайдер без своего ключа — ошибка, а не молчаливая подмена', () => {
    expect(() => resolveSlotProviderConfig({ provider: 'deepseek', model: 'x' }, ANTHROPIC_GLOBAL, PROFILES)).toThrow(
      /отличается от провайдера AI Studio/
    );
  });

  it('профиль AI Studio попадает в снимок с именем и признаком «локальная»', () => {
    const global: AIProviderConfig = { provider: 'openai-compatible', profileId: 'p-ollama', model: 'qwen' };
    expect(resolveSlotProviderConfig(undefined, global, PROFILES).info).toEqual({
      provider: 'openai-compatible',
      model: 'qwen',
      profileId: 'p-ollama',
      profileName: 'Ollama',
      local: true
    });
  });
});

describe('reviewerProviderSpec', () => {
  it('провайдер или профиль ревьюера заменяют провайдера роли, модель роли при этом не берётся', () => {
    expect(reviewerProviderSpec({ profile: 'Ollama' }, { provider: 'anthropic', model: 'claude-x' })).toEqual({ profile: 'Ollama' });
    expect(reviewerProviderSpec({ provider: 'ollama', model: 'm' }, { profile: 'OpenRouter', model: 'r' })).toEqual({
      provider: 'ollama',
      model: 'm'
    });
  });

  it('без своего провайдера — провайдер роли, модель настроек важнее модели роли', () => {
    expect(reviewerProviderSpec({ model: 'm' }, { profile: 'OpenRouter', model: 'r' })).toEqual({ profile: 'OpenRouter', model: 'm' });
    expect(reviewerProviderSpec(undefined, { provider: 'deepseek', model: 'r' })).toEqual({ provider: 'deepseek', model: 'r' });
    expect(reviewerProviderSpec(undefined, undefined)).toEqual({});
  });
});

describe('apiConfigProblem (запасной API-путь CLI-движков)', () => {
  it('объясняет, почему AI Studio не годится для API-запроса', () => {
    expect(apiConfigProblem({ provider: 'anthropic', model: 'default' })).toMatch(/без API-ключа/);
    expect(apiConfigProblem({ provider: 'openai-compatible', model: 'm' })).toMatch(/без профиля/);
    expect(apiConfigProblem({ provider: 'openai-compatible', profileId: 'p', model: '' })).toMatch(/не выбрана модель/);
    expect(apiConfigProblem({ provider: 'openrouter', model: 'default', apiKey: 'k' })).toMatch(/не выбрана модель/);
  });

  it('годный конфиг — null', () => {
    expect(apiConfigProblem(ANTHROPIC_GLOBAL)).toBeNull();
    expect(apiConfigProblem({ provider: 'openai-compatible', profileId: 'p', model: 'qwen' })).toBeNull();
  });
});

describe('describeProviderInfo', () => {
  it('подпись профиля и прежнего провайдера', () => {
    expect(describeProviderInfo(undefined)).toBe('—');
    expect(describeProviderInfo({ provider: 'openai-compatible', profileId: 'p', profileName: 'Ollama', local: true })).toBe(
      'профиль «Ollama» (локальная)'
    );
    expect(describeProviderInfo({ provider: 'deepseek' })).toBe('deepseek');
  });
});

describe('resolveSlotProviderConfig: усилие рассуждений слота (TASK-70.3, decision-41 п. 7)', () => {
  const GLOBAL_WITH_EFFORT: AIProviderConfig = { ...ANTHROPIC_GLOBAL, reasoningEffort: 'high' };

  it('слот «как в AI Studio» и слот только с моделью наследуют усилие AI Studio', () => {
    expect(resolveSlotProviderConfig(undefined, GLOBAL_WITH_EFFORT, PROFILES).config.reasoningEffort).toBe('high');
    expect(resolveSlotProviderConfig({ model: 'claude-y' }, GLOBAL_WITH_EFFORT, PROFILES).config.reasoningEffort).toBe('high');
  });

  it('своё усилие слота важнее, в том числе слот только с усилием', () => {
    expect(resolveSlotProviderConfig({ reasoningEffort: 'low' }, GLOBAL_WITH_EFFORT, PROFILES).config).toMatchObject({
      provider: 'anthropic',
      model: 'claude-x',
      reasoningEffort: 'low'
    });
    expect(resolveSlotProviderConfig({ model: 'claude-y', reasoningEffort: 'none' }, GLOBAL_WITH_EFFORT, PROFILES).config.reasoningEffort).toBe('none');
  });

  it('слот с профилем и Ollama берёт только своё усилие, без него — дефолт модели', () => {
    const profile = resolveSlotProviderConfig({ provider: 'openai-compatible', profileId: 'Ollama', model: 'qwen3' }, GLOBAL_WITH_EFFORT, PROFILES);
    expect(profile.config).not.toHaveProperty('reasoningEffort');
    const withOwn = resolveSlotProviderConfig({ provider: 'openai-compatible', profileId: 'Ollama', model: 'qwen3', reasoningEffort: 'max' }, GLOBAL_WITH_EFFORT, PROFILES);
    expect(withOwn.config.reasoningEffort).toBe('max');
    expect(resolveSlotProviderConfig({ provider: 'ollama', model: 'qwen3' }, GLOBAL_WITH_EFFORT, PROFILES).config).not.toHaveProperty('reasoningEffort');
  });

  it('значение вне шкалы игнорируется', () => {
    const cfg = resolveSlotProviderConfig({ provider: 'ollama', model: 'q', reasoningEffort: 'xhigh' as never }, ANTHROPIC_GLOBAL, PROFILES).config;
    expect(cfg).not.toHaveProperty('reasoningEffort');
  });
});
