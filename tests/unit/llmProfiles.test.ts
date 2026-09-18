import { describe, expect, it } from 'vitest';
import {
  LLM_PROVIDER_PRESETS,
  buildProfileHeaders,
  chatCompletionsUrl,
  getPreset,
  isLocalBaseUrl,
  legacyProviderCompat,
  modelsUrl,
  normalizeBaseUrl,
  normalizeProfile,
  profileFromLegacyConfig,
  profileFromPreset
} from '../../electron/services/llmProfiles';
import { resolveOpenAICompatibleEndpoint } from '../../electron/services/llmEndpoint';
import { isCatalogFresh, parseModelList } from '../../electron/services/llmModelCatalog';

describe('пресеты провайдеров (TASK-70.1)', () => {
  it('не меньше 10 пресетов, включая локальные серверы, id уникальны', () => {
    const ids = LLM_PROVIDER_PRESETS.map((p) => p.id);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['ollama', 'lmstudio', 'vllm', 'llamacpp', 'jan', 'openai', 'openrouter', 'custom']) {
      expect(ids).toContain(id);
    }
  });

  it('локальные пресеты не требуют ключа и указывают на эту машину', () => {
    for (const p of LLM_PROVIDER_PRESETS.filter((x) => x.local)) {
      expect(p.requiresApiKey).toBe(false);
      expect(isLocalBaseUrl(p.baseUrl)).toBe(true);
    }
  });

  it('ни в одном пресете нет модели и vision по умолчанию', () => {
    for (const p of LLM_PROVIDER_PRESETS) {
      expect(p).not.toHaveProperty('model');
      expect(p.compat.vision).toBe(false);
    }
  });

  it('неизвестный пресет — custom', () => {
    expect(getPreset('нет-такого').id).toBe('custom');
    expect(getPreset(undefined).id).toBe('custom');
  });
});

describe('адреса', () => {
  it('normalizeBaseUrl убирает хвостовые / и /chat/completions', () => {
    expect(normalizeBaseUrl(' http://127.0.0.1:1234/v1/ ')).toBe('http://127.0.0.1:1234/v1');
    expect(normalizeBaseUrl('https://api.x.ai/v1/chat/completions')).toBe('https://api.x.ai/v1');
  });

  it('normalizeBaseUrl отклоняет не-http адреса', () => {
    expect(() => normalizeBaseUrl('')).toThrow(/Некорректный адрес/);
    expect(() => normalizeBaseUrl('file:///etc/passwd')).toThrow(/только http и https/);
    expect(() => normalizeBaseUrl('api.openai.com/v1')).toThrow(/Некорректный адрес/);
  });

  it('chatCompletionsUrl и modelsUrl', () => {
    expect(chatCompletionsUrl('http://h:1/v1')).toBe('http://h:1/v1/chat/completions');
    expect(modelsUrl('http://h:1/v1/')).toBe('http://h:1/v1/models');
  });

  it('isLocalBaseUrl', () => {
    expect(isLocalBaseUrl('http://localhost:11434/v1')).toBe(true);
    expect(isLocalBaseUrl('http://127.0.0.2:8000')).toBe(true);
    expect(isLocalBaseUrl('http://[::1]:8080/v1')).toBe(true);
    expect(isLocalBaseUrl('https://api.groq.com/openai/v1')).toBe(false);
    expect(isLocalBaseUrl('мусор')).toBe(false);
  });
});

describe('normalizeProfile', () => {
  it('дополняет флаги и адрес из пресета', () => {
    const p = normalizeProfile({ id: 'p1', presetId: 'openai', name: '  Мой OpenAI ' });
    expect(p).toMatchObject({ id: 'p1', name: 'Мой OpenAI', presetId: 'openai', baseUrl: 'https://api.openai.com/v1', local: false });
    expect(p.compat.maxTokensField).toBe('max_completion_tokens');
  });

  it('флаги профиля перекрывают пресет, мусорные значения игнорируются', () => {
    const p = normalizeProfile({
      id: 'p2',
      presetId: 'ollama',
      compat: { tools: false, vision: true, maxTokensField: 'whatever', reasoning: 'ollama_think', streamUsage: 'yes' }
    });
    expect(p.compat).toMatchObject({ tools: false, vision: true, maxTokensField: 'max_tokens', reasoning: 'ollama_think', streamUsage: false });
    expect(p.local).toBe(true);
  });

  it('локальность по адресу, если не задана явно', () => {
    expect(normalizeProfile({ id: 'c', presetId: 'custom', baseUrl: 'http://localhost:9000/v1' }).local).toBe(true);
    expect(normalizeProfile({ id: 'c', presetId: 'custom', baseUrl: 'https://llm.example.com/v1' }).local).toBe(false);
  });

  it('без id или адреса — ошибка', () => {
    expect(() => normalizeProfile({ presetId: 'openai' })).toThrow(/идентификатор/);
    expect(() => normalizeProfile({ id: '../x', presetId: 'openai' })).toThrow(/идентификатор/);
    expect(() => normalizeProfile({ id: 'c', presetId: 'custom' })).toThrow(/Некорректный адрес/);
  });

  it('заголовки: Authorization и инъекции перевода строки отбрасываются', () => {
    const p = normalizeProfile({
      id: 'h',
      presetId: 'custom',
      baseUrl: 'http://localhost:1/v1',
      headers: { 'X-Org': 'a', Authorization: 'Bearer x', 'X-Bad': 'a\r\nInjected: 1', 'bad name': 'v' }
    });
    expect(p.headers).toEqual({ 'X-Org': 'a' });
  });

  it('profileFromPreset копирует флаги, а не ссылается на пресет', () => {
    const p = profileFromPreset('openrouter', 'or');
    p.compat.tools = false;
    expect(getPreset('openrouter').compat.tools).toBe(true);
    expect(p.headers).toMatchObject({ 'X-Title': 'ProjectHub AI Studio' });
  });
});

describe('buildProfileHeaders', () => {
  it('ключ — Bearer; облачному пресету без ключа — ошибка, локальному — можно', () => {
    const cloud = normalizeProfile({ id: 'g', presetId: 'groq' });
    expect(buildProfileHeaders(cloud, ' k ')).toMatchObject({ Authorization: 'Bearer k', 'content-type': 'application/json' });
    expect(() => buildProfileHeaders(cloud, undefined)).toThrow(/API ключ не указан в профиле «Groq»/);

    const local = normalizeProfile({ id: 'o', presetId: 'ollama' });
    expect(buildProfileHeaders(local, undefined)).toEqual({ 'content-type': 'application/json' });
  });
});

describe('legacyProviderCompat', () => {
  it('сохраняет прежнее поведение провайдеров', () => {
    expect(legacyProviderCompat('ollama')).toMatchObject({ streamUsage: false, openRouterUsage: false, maxTokensField: 'max_tokens' });
    expect(legacyProviderCompat('openrouter')).toMatchObject({ streamUsage: true, openRouterUsage: true });
    expect(legacyProviderCompat('deepseek')).toMatchObject({ streamUsage: true, openRouterUsage: false });
  });
});

describe('каталог моделей (TASK-70.2)', () => {
  it('parseModelList: OpenAI-формат и формат Ollama, без дублей, по алфавиту', () => {
    expect(parseModelList({ object: 'list', data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, { id: '' }, null] })).toEqual(['a', 'b']);
    expect(parseModelList({ models: [{ name: 'qwen3:8b' }, { name: 'llama3.1' }] })).toEqual(['llama3.1', 'qwen3:8b']);
    expect(parseModelList('мусор')).toEqual([]);
    expect(parseModelList({ data: 'x' })).toEqual([]);
  });

  it('isCatalogFresh: по TTL и адресу', () => {
    const entry = { baseUrl: 'http://a/v1', models: ['m'], fetchedAt: 1000 };
    expect(isCatalogFresh(entry, 'http://a/v1', 1500, 1000)).toBe(true);
    expect(isCatalogFresh(entry, 'http://a/v1', 2000, 1000)).toBe(false);
    expect(isCatalogFresh(entry, 'http://b/v1', 1500, 1000)).toBe(false);
    expect(isCatalogFresh(entry, 'http://a/v1', 500, 1000)).toBe(false);
    expect(isCatalogFresh(undefined, 'http://a/v1', 1500)).toBe(false);
  });
});

describe('перенос прежнего провайдера в профиль (TASK-70.5, decision-40)', () => {
  const cases: Array<{ provider: string; baseUrl?: string }> = [
    { provider: 'openrouter' },
    { provider: 'deepseek' },
    { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/' },
    { provider: 'custom', baseUrl: 'http://localhost:1234/v1/chat/completions' }
  ];

  it.each(cases)('$provider: тот же адрес и флаги, что у прежнего провайдера', (legacy) => {
    const profile = profileFromLegacyConfig(legacy, 'p-legacy');
    const before = resolveOpenAICompatibleEndpoint({ ...legacy, apiKey: 'k' });
    expect(chatCompletionsUrl(profile.baseUrl)).toBe(before.endpoint);
    expect(profile.compat).toEqual(legacyProviderCompat(legacy.provider));
    expect(profile.id).toBe('p-legacy');
    expect(profile.name).toMatch(/\(AI Studio\)$/);
    // Нормализация хранилища не меняет перенесённый профиль.
    expect(normalizeProfile(profile)).toEqual(profile);
  });

  it('OpenRouter сохраняет прежние заголовки, Ollama и локальный custom — локальные', () => {
    expect(profileFromLegacyConfig({ provider: 'openrouter' }, 'a').headers).toEqual({
      'HTTP-Referer': 'https://projecthub.local',
      'X-Title': 'ProjectHub AI Studio'
    });
    expect(profileFromLegacyConfig({ provider: 'ollama' }, 'a').local).toBe(true);
    expect(profileFromLegacyConfig({ provider: 'custom', baseUrl: 'http://localhost:8000/v1/chat/completions' }, 'a').local).toBe(true);
    expect(profileFromLegacyConfig({ provider: 'deepseek' }, 'a').local).toBe(false);
  });

  it('anthropic и custom-адрес без /chat/completions не переносятся', () => {
    expect(() => profileFromLegacyConfig({ provider: 'anthropic' }, 'a')).toThrow(/не переносится/);
    expect(() => profileFromLegacyConfig({ provider: 'custom', baseUrl: 'http://host/api/generate' }, 'a')).toThrow(
      /не оканчивается на \/chat\/completions/
    );
  });
});
