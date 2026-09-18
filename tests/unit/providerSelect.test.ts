import { describe, expect, it } from 'vitest';
import {
  decodeProviderChoice,
  encodeProviderChoice,
  filterModelGroups,
  findProfileByRef,
  slotProviderFromChoice,
  slotProviderFromRole,
  sortProfilesForMenu,
  type ModelGroup
} from '../../src/lib/providerSelect';

const PROFILES = [
  { id: 'p-or', name: 'OpenRouter', local: false },
  { id: 'p-ollama', name: 'Ollama', local: true },
  { id: 'p-a', name: 'Dup' },
  { id: 'p-b', name: 'DUP' }
];

describe('findProfileByRef (TASK-70.5)', () => {
  it('id, затем однозначное имя без учёта регистра', () => {
    expect(findProfileByRef('p-or', PROFILES)?.name).toBe('OpenRouter');
    expect(findProfileByRef('ollama', PROFILES)?.id).toBe('p-ollama');
    expect(findProfileByRef('dup', PROFILES)).toBeUndefined();
    expect(findProfileByRef(undefined, PROFILES)).toBeUndefined();
  });
});

describe('encode/decodeProviderChoice', () => {
  it('кодирует AI Studio, провайдера, профиль и отсутствующий профиль', () => {
    expect(encodeProviderChoice({}, PROFILES)).toBe('');
    expect(encodeProviderChoice({ provider: 'deepseek' }, PROFILES)).toBe('provider:deepseek');
    expect(encodeProviderChoice({ provider: 'openai-compatible', profile: 'Ollama' }, PROFILES)).toBe('profile:p-ollama');
    expect(encodeProviderChoice({ profile: 'LM Studio' }, PROFILES)).toBe('missing:LM Studio');
    expect(encodeProviderChoice({ provider: 'openai-compatible' }, PROFILES)).toBe('missing:');
  });

  it('роль хранит имя профиля, слот — id', () => {
    expect(decodeProviderChoice('profile:p-ollama', PROFILES, 'name')).toEqual({ provider: 'openai-compatible', profile: 'Ollama' });
    expect(decodeProviderChoice('profile:p-ollama', PROFILES, 'id')).toEqual({ provider: 'openai-compatible', profile: 'p-ollama' });
    expect(decodeProviderChoice('missing:LM Studio', PROFILES, 'name')).toEqual({ provider: 'openai-compatible', profile: 'LM Studio' });
    expect(decodeProviderChoice('provider:anthropic', PROFILES, 'id')).toEqual({ provider: 'anthropic' });
    expect(decodeProviderChoice('', PROFILES, 'id')).toEqual({});
  });
});

describe('slotProviderFromRole', () => {
  it('профиль роли по имени превращается в id профиля этой машины', () => {
    expect(slotProviderFromRole({ profile: 'ollama', model: 'qwen' }, PROFILES)).toEqual({
      provider: 'openai-compatible',
      profileId: 'p-ollama',
      model: 'qwen'
    });
    expect(slotProviderFromRole({ profile: 'Remote' }, PROFILES)).toEqual({ provider: 'openai-compatible', profileId: 'Remote' });
  });

  it('без провайдера — не anthropic: только модель или ничего', () => {
    expect(slotProviderFromRole({ model: 'm' }, PROFILES)).toEqual({ model: 'm' });
    expect(slotProviderFromRole({}, PROFILES)).toBeUndefined();
    expect(slotProviderFromRole({ provider: 'deepseek' }, PROFILES)).toEqual({ provider: 'deepseek' });
    expect(slotProviderFromRole({ provider: 'unknown', model: 'm' }, PROFILES)).toEqual({ model: 'm' });
  });
});

describe('slotProviderFromChoice', () => {
  it('смена провайдера сбрасывает модель, тот же — сохраняет', () => {
    const current = { provider: 'openai-compatible' as const, profileId: 'p-ollama', model: 'qwen' };
    expect(slotProviderFromChoice({ provider: 'openai-compatible', profile: 'p-ollama' }, current)).toEqual(current);
    expect(slotProviderFromChoice({ provider: 'openai-compatible', profile: 'p-or' }, current)).toEqual({
      provider: 'openai-compatible',
      profileId: 'p-or'
    });
    expect(slotProviderFromChoice({}, current)).toBeUndefined();
    expect(slotProviderFromChoice({}, { model: 'm' })).toEqual({ model: 'm' });
  });
});

describe('filterModelGroups / sortProfilesForMenu', () => {
  const groups: ModelGroup[] = [
    { key: 'claude-cli', label: 'Claude Code CLI', models: [{ id: 'sonnet', name: 'Sonnet', description: 'fast' }, { id: 'opus' }] },
    { key: 'p-ollama', label: 'Ollama', local: true, models: [{ id: 'qwen2.5:7b-instruct' }, { id: 'bge-m3:latest' }] },
    { key: 'p-empty', label: 'Empty', models: [] }
  ];

  it('без запроса — все группы, включая пустые', () => {
    expect(filterModelGroups(groups, '  ').map((g) => g.key)).toEqual(['claude-cli', 'p-ollama', 'p-empty']);
  });

  it('ищет по id, имени, описанию модели и имени профиля', () => {
    expect(filterModelGroups(groups, 'QWEN')).toEqual([{ ...groups[1], models: [{ id: 'qwen2.5:7b-instruct' }] }]);
    expect(filterModelGroups(groups, 'fast').map((g) => g.models.map((m) => m.id))).toEqual([['sonnet']]);
    expect(filterModelGroups(groups, 'ollama')[0].models).toHaveLength(2);
    expect(filterModelGroups(groups, 'nothing')).toEqual([]);
  });

  it('локальные профили первыми, затем по имени', () => {
    expect(sortProfilesForMenu(PROFILES).map((p) => p.id)).toEqual(['p-ollama', 'p-a', 'p-b', 'p-or']);
  });
});
