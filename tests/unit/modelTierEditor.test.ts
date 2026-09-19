import { describe, expect, it } from 'vitest';
import {
  addTierEntry,
  chainLinkLabel,
  entryAvailability,
  entryTargetChoice,
  entryTargetPatch,
  modelSuggestions,
  moveTierEntry,
  referencedProfileIds,
  removeTierEntry,
  tierDraftProblems,
  tierEntryCount,
  updateTierEntry
} from '../../src/lib/modelTierEditor';
import type { ModelTierSettings } from '../../src/types/electron';

const PROFILES = [
  { id: 'p1', name: 'Ollama', local: true },
  { id: 'p2', name: 'LAN', local: true }
];

function table(): ModelTierSettings {
  return {
    version: 1,
    fallbackToLowerTier: true,
    maxSwitches: 2,
    maxWaitMs: 30_000,
    tiers: {
      frontier: [{ engine: 'api', profile: 'LAN', model: 'ornith:35b', source: 'auto' }],
      balanced: [
        { engine: 'api', profile: 'Ollama', model: 'qwen2.5:7b-instruct' },
        { engine: 'claude-cli', model: 'sonnet', source: 'auto' }
      ],
      cheap: []
    }
  };
}

describe('modelTierEditor', () => {
  it('добавление, правка, удаление и порядок не мутируют исходную таблицу', () => {
    const base = table();
    const added = addTierEntry(base, 'cheap', { engine: 'api', model: '' });
    expect(added.tiers.cheap).toEqual([{ engine: 'api', model: '', source: 'manual' }]);
    expect(base.tiers.cheap).toEqual([]);

    const moved = moveTierEntry(base, 'balanced', 1, -1);
    expect(moved.tiers.balanced.map((e) => e.model)).toEqual(['sonnet', 'qwen2.5:7b-instruct']);
    expect(moveTierEntry(base, 'balanced', 0, -1)).toBe(base);

    // Правка делает звено ручным; смена движка на CLI снимает цель.
    const edited = updateTierEntry(base, 'frontier', 0, { engine: 'claude-cli', model: 'opus' });
    expect(edited.tiers.frontier[0]).toEqual({ engine: 'claude-cli', model: 'opus', source: 'manual' });
    expect(updateTierEntry(base, 'cheap', 5, { model: 'x' })).toBe(base);

    expect(removeTierEntry(base, 'balanced', 0).tiers.balanced.map((e) => e.model)).toEqual(['sonnet']);
    expect(tierEntryCount(base)).toBe(3);
  });

  it('цель звена для ProviderProfileSelect и обратно', () => {
    expect(entryTargetChoice({ engine: 'api', model: 'm', profile: 'Ollama' })).toEqual({ provider: 'openai-compatible', profile: 'Ollama' });
    expect(entryTargetChoice({ engine: 'api', model: 'm', provider: 'anthropic' })).toEqual({ provider: 'anthropic' });
    expect(entryTargetChoice({ engine: 'api', model: 'm' })).toEqual({});
    expect(entryTargetPatch({ provider: 'openai-compatible', profile: 'LAN' })).toEqual({ profile: 'LAN', provider: undefined });
    expect(entryTargetPatch({ provider: 'anthropic' })).toEqual({ provider: 'anthropic', profile: undefined });
    expect(entryTargetPatch({ provider: 'openai-compatible' })).toEqual({ profile: undefined, provider: undefined });
  });

  it('модель вне каталога профиля подсвечивается; алиасы CLI в порядке; без каталога — неизвестно', () => {
    const catalogs = { p1: { models: ['qwen2.5:7b-instruct', 'llama3.2:3b'], fetchedAt: 1 } };
    expect(entryAvailability({ engine: 'api', profile: 'ollama', model: 'qwen2.5:7b-instruct' }, PROFILES, catalogs)).toBe('ok');
    expect(entryAvailability({ engine: 'api', profile: 'Ollama', model: 'no-such-model:1b' }, PROFILES, catalogs)).toBe('missing');
    expect(entryAvailability({ engine: 'api', profile: 'LAN', model: 'ornith:35b' }, PROFILES, catalogs)).toBe('unknown');
    expect(entryAvailability({ engine: 'api', profile: 'Удалённый', model: 'x' }, PROFILES, catalogs)).toBe('no_profile');
    expect(entryAvailability({ engine: 'claude-cli', model: 'Opus' }, PROFILES, catalogs)).toBe('ok');
    expect(entryAvailability({ engine: 'claude-cli', model: 'claude-haiku-4-5' }, PROFILES, catalogs)).toBe('ok');
    expect(entryAvailability({ engine: 'codex-cli', model: 'gpt-x' }, PROFILES, catalogs)).toBe('unknown');
    expect(modelSuggestions({ engine: 'api', profile: 'Ollama', model: '' }, PROFILES, catalogs)).toEqual(['qwen2.5:7b-instruct', 'llama3.2:3b']);
    expect(modelSuggestions({ engine: 'claude-cli', model: '' }, PROFILES, catalogs)).toContain('sonnet');
    expect(referencedProfileIds(table(), PROFILES)).toEqual(['p2', 'p1']);
  });

  it('проблемы черновика: пустая модель и повтор', () => {
    const t = addTierEntry(addTierEntry(table(), 'cheap', { engine: 'api', model: ' ' }), 'cheap', { engine: 'api', profile: 'ollama', model: 'qwen2.5:7b-instruct' });
    expect(tierDraftProblems(t)).toEqual([
      { tier: 'cheap', index: 0, kind: 'empty_model' },
      { tier: 'cheap', index: 1, kind: 'duplicate' }
    ]);
    expect(tierDraftProblems(table())).toEqual([]);
  });

  it('подпись звена', () => {
    expect(chainLinkLabel({ engine: 'api', model: 'q', profile: 'Ollama' })).toBe('q · Ollama');
    expect(chainLinkLabel({ engine: 'api', model: 'q' })).toBe('q · AI Studio');
    expect(chainLinkLabel({ engine: 'claude-cli', model: 'opus' })).toBe('opus · claude-cli');
  });
});
