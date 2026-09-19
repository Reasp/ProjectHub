import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  buildModelChain,
  decideFallback,
  describeChainLink,
  describeFallbackStop,
  emptyModelTierSettings,
  entryKey,
  fallbackRuleFor,
  normalizeModelTierSettings,
  parameterSizeB,
  seedModelTiers,
  targetKey,
  tierForModelSize,
  tiersForChain,
  type ChainLink,
  type ModelTierSettings
} from '../../electron/services/modelTiers';
import { ModelTierService } from '../../electron/services/modelTierService';
import { classifyClaudeCliError, classifyHttpError, type ProviderErrorKind } from '../../electron/services/providerErrors';

function settingsWith(tiers: Partial<ModelTierSettings['tiers']>, extra: Partial<ModelTierSettings> = {}): ModelTierSettings {
  const base = emptyModelTierSettings();
  return { ...base, ...extra, tiers: { ...base.tiers, ...tiers } };
}

const TABLE = settingsWith({
  frontier: [
    { engine: 'api', profile: 'LAN Ollama', model: 'ornith:35b' },
    { engine: 'claude-cli', model: 'opus' }
  ],
  balanced: [
    { engine: 'api', profile: 'Ollama', model: 'no-such-model:1b' },
    { engine: 'api', profile: 'Dead', model: 'qwen2.5:7b-instruct' },
    { engine: 'api', profile: 'Ollama', model: 'qwen2.5:7b-instruct' },
    { engine: 'claude-cli', model: 'sonnet' }
  ],
  cheap: [
    { engine: 'api', profile: 'Ollama', model: 'llama3.2:3b' },
    { engine: 'claude-cli', model: 'haiku' },
    { engine: 'codex-cli', model: 'gpt-mini' }
  ]
});

describe('normalizeModelTierSettings', () => {
  it('пропускает битые записи и повторы, ограничивает лимиты', () => {
    const { settings, problems } = normalizeModelTierSettings({
      maxSwitches: 7,
      maxWaitMs: -5,
      fallbackToLowerTier: false,
      tiers: {
        cheap: [
          { engine: 'api', profile: ' Ollama ', model: ' qwen ' },
          { engine: 'nope', model: 'x' },
          { engine: 'api', model: '' },
          'строка'
        ],
        balanced: [{ engine: 'api', profile: 'Ollama', model: 'qwen' }, { engine: 'claude-cli', model: 'sonnet', profile: 'игнор' }],
        frontier: 'не список'
      }
    });
    expect(settings.maxSwitches).toBe(2);
    expect(settings.maxWaitMs).toBe(0);
    expect(settings.fallbackToLowerTier).toBe(false);
    expect(settings.tiers.cheap).toEqual([{ engine: 'api', profile: 'Ollama', model: 'qwen' }]);
    // Повтор из другого тира отброшен, у CLI цели нет.
    expect(settings.tiers.balanced).toEqual([{ engine: 'claude-cli', model: 'sonnet' }]);
    expect(settings.tiers.frontier).toEqual([]);
    expect(problems).toHaveLength(5);
  });

  it('не объект — пустая таблица с пояснением', () => {
    expect(normalizeModelTierSettings('x').problems).toEqual(['файл тиров не содержит объект']);
    expect(normalizeModelTierSettings(undefined).problems).toEqual([]);
    expect(normalizeModelTierSettings(null).settings).toEqual(emptyModelTierSettings());
  });

  it('ключи цели и звена: регистр цели не важен, модели — важен', () => {
    expect(targetKey({ engine: 'api', profile: 'Ollama' })).toBe(targetKey({ engine: 'api', profile: 'ollama' }));
    expect(entryKey({ engine: 'api', profile: 'Ollama', model: 'Q' })).not.toBe(entryKey({ engine: 'api', profile: 'Ollama', model: 'q' }));
    expect(targetKey({ engine: 'api' })).toBe('api|ai-studio');
    expect(targetKey({ engine: 'claude-cli', profile: 'x' })).toBe('claude-cli|');
  });
});

describe('buildModelChain', () => {
  it('тир для API: звенья тира, затем младших тиров, только своего движка', () => {
    const chain = buildModelChain(TABLE, { engine: 'api', tier: 'balanced' });
    expect(chain.map((l) => `${l.tier}:${l.model}@${l.profile}`)).toEqual([
      'balanced:no-such-model:1b@Ollama',
      'balanced:qwen2.5:7b-instruct@Dead',
      'balanced:qwen2.5:7b-instruct@Ollama',
      'cheap:llama3.2:3b@Ollama'
    ]);
    expect(chain.every((l) => l.origin === 'tier')).toBe(true);
  });

  it('frontier спускается до cheap; без спуска — только свой тир', () => {
    expect(tiersForChain('frontier', true)).toEqual(['frontier', 'balanced', 'cheap']);
    expect(tiersForChain('balanced', false)).toEqual(['balanced']);
    const cli = buildModelChain(TABLE, { engine: 'claude-cli', tier: 'frontier' });
    expect(cli.map((l) => l.model)).toEqual(['opus', 'sonnet', 'haiku']);
    const noLower = buildModelChain({ ...TABLE, fallbackToLowerTier: false }, { engine: 'claude-cli', tier: 'frontier' });
    expect(noLower.map((l) => l.model)).toEqual(['opus']);
  });

  it('явная модель — первое звено, повтор из тира убирается', () => {
    const chain = buildModelChain(TABLE, {
      engine: 'api',
      tier: 'cheap',
      explicit: { model: 'llama3.2:3b', profile: 'ollama' }
    });
    expect(chain).toEqual([{ engine: 'api', model: 'llama3.2:3b', profile: 'ollama', origin: 'explicit' }]);
  });

  it('без тира — только явная модель; default и пустая модель не звено', () => {
    expect(buildModelChain(TABLE, { engine: 'api', explicit: { model: 'm', provider: 'anthropic' } })).toEqual([
      { engine: 'api', model: 'm', provider: 'anthropic', origin: 'explicit' }
    ]);
    expect(buildModelChain(TABLE, { engine: 'api', explicit: { model: 'default' } })).toEqual([]);
    expect(buildModelChain(TABLE, { engine: 'gemini-cli', tier: 'frontier' })).toEqual([]);
  });

  it('подпись звена', () => {
    expect(describeChainLink({ engine: 'api', model: 'q', profile: 'Ollama' })).toBe('q · профиль «Ollama»');
    expect(describeChainLink({ engine: 'api', model: 'q', provider: 'anthropic' })).toBe('q · anthropic');
    expect(describeChainLink({ engine: 'api', model: 'q' })).toBe('q · AI Studio');
    expect(describeChainLink({ engine: 'claude-cli', model: 'opus' })).toBe('opus · claude-cli');
  });
});

describe('decideFallback', () => {
  const chain = buildModelChain(TABLE, { engine: 'api', tier: 'balanced' });
  const base = { chain, currentIndex: 0, switchesDone: 0, maxSwitches: 2, maxWaitMs: 30_000 };

  it('model_not_found — следующее звено сразу', () => {
    expect(decideFallback({ ...base, error: { kind: 'model_not_found', retryAfterMs: 5000 } })).toEqual({
      action: 'switch',
      nextIndex: 1,
      waitMs: 0,
      rule: 'next'
    });
  });

  it('rate_limit — ждать retryAfterMs, но не дольше maxWaitMs', () => {
    expect(decideFallback({ ...base, error: { kind: 'rate_limit', retryAfterMs: 12_000 } })).toMatchObject({ action: 'switch', nextIndex: 1, waitMs: 12_000 });
    expect(decideFallback({ ...base, error: { kind: 'rate_limit', retryAfterMs: 90_000 } })).toMatchObject({ waitMs: 30_000 });
    expect(decideFallback({ ...base, error: { kind: 'rate_limit' } })).toMatchObject({ waitMs: 0 });
    expect(decideFallback({ ...base, error: { kind: 'unavailable', reason: 'overloaded', retryAfterMs: 1000 } })).toMatchObject({ waitMs: 1000, rule: 'wait_next' });
  });

  it('отказ сервера — только звено с другой целью', () => {
    // Звено 1 — профиль Dead, звено 2 — Ollama: после refused на Dead идём на Ollama.
    expect(decideFallback({ ...base, currentIndex: 1, switchesDone: 1, error: { kind: 'unavailable', reason: 'refused' } })).toMatchObject({
      action: 'switch',
      nextIndex: 2,
      rule: 'other_target'
    });
    // С Ollama (звено 0) при quota следующее звено той же цели пропускается.
    expect(decideFallback({ ...base, error: { kind: 'quota' } })).toMatchObject({ nextIndex: 1 });
    // На последнем звене Ollama при refused — звеньев с другой целью нет.
    expect(decideFallback({ ...base, currentIndex: 2, switchesDone: 0, error: { kind: 'unavailable', reason: 'dns' } })).toMatchObject({
      action: 'stop',
      reason: 'exhausted'
    });
  });

  it('auth, config, bad_request и unknown не переключают; context — переключает', () => {
    for (const error of [{ kind: 'auth' as const }, { kind: 'config' as const }, { kind: 'unknown' as const }, { kind: 'bad_request' as const, reason: 'tools' as const }]) {
      expect(decideFallback({ ...base, error })).toEqual({ action: 'stop', reason: 'not_switchable', rule: 'none' });
    }
    expect(decideFallback({ ...base, error: { kind: 'bad_request', reason: 'context' } })).toMatchObject({ action: 'switch', rule: 'next' });
  });

  it('лимит 2, maxSwitches 0 выключает, после инструментов не переключает', () => {
    expect(decideFallback({ ...base, currentIndex: 2, switchesDone: 2, error: { kind: 'model_not_found' } })).toMatchObject({ action: 'stop', reason: 'limit' });
    expect(decideFallback({ ...base, maxSwitches: 9, switchesDone: 2, error: { kind: 'model_not_found' } })).toMatchObject({ reason: 'limit' });
    expect(decideFallback({ ...base, maxSwitches: 0, error: { kind: 'model_not_found' } })).toMatchObject({ reason: 'disabled' });
    expect(decideFallback({ ...base, sideEffects: true, error: { kind: 'rate_limit' } })).toMatchObject({ reason: 'side_effects' });
    expect(decideFallback({ ...base, currentIndex: 3, error: { kind: 'model_not_found' } })).toMatchObject({ reason: 'exhausted' });
    expect(describeFallbackStop('limit', 2)).toContain('(2)');
  });

  it('правило по фикстурам provider-errors.json совпадает с decision-43 §8', () => {
    const fixtures = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'provider-errors.json'), 'utf-8')) as {
      cases: Array<{ id: string; status: number; body: string; local?: boolean; toolsSent?: boolean; reasoningEffort?: string; headers?: Record<string, string> }>;
    };
    const expected: Record<ProviderErrorKind, string[]> = {
      model_not_found: ['next'],
      rate_limit: ['wait_next'],
      unavailable: ['wait_next', 'other_target'],
      quota: ['other_target'],
      bad_request: ['none', 'next'],
      auth: ['none'],
      config: ['none'],
      unknown: ['none']
    };
    let rateLimitWithWait = 0;
    for (const c of fixtures.cases) {
      const info = classifyHttpError(
        { status: c.status, body: c.body, headers: c.headers },
        { local: c.local, toolsSent: c.toolsSent, reasoningEffort: c.reasoningEffort }
      );
      const rule = fallbackRuleFor(info);
      expect(expected[info.kind], c.id).toContain(rule);
      if (info.kind === 'bad_request') expect(rule === 'next', c.id).toBe(info.reason === 'context');
      if (info.kind === 'rate_limit' && info.retryAfterMs) {
        rateLimitWithWait += 1;
        const d = decideFallback({ chain, currentIndex: 0, switchesDone: 0, maxSwitches: 2, maxWaitMs: 120_000, error: info });
        expect(d).toMatchObject({ action: 'switch', waitMs: info.retryAfterMs });
      }
    }
    expect(rateLimitWithWait).toBeGreaterThan(0);
  });
});

describe('classifyClaudeCliError', () => {
  it('model_not_found из stream-json Claude CLI 2.1.275 (вживую)', () => {
    const info = classifyClaudeCliError(
      {
        errorType: 'model_not_found',
        status: 404,
        message: "There's an issue with the selected model (no-such-model-xyz). It may not exist or you may not have access to it."
      },
      { provider: 'Claude CLI', model: 'no-such-model-xyz' }
    );
    expect(info).toMatchObject({ kind: 'model_not_found', status: 404, retryable: false, model: 'no-such-model-xyz' });
    expect(fallbackRuleFor(info)).toBe('next');
  });

  it('виды SDKAssistantMessageError и ожидание из rate_limit_event', () => {
    expect(classifyClaudeCliError({ errorType: 'authentication_failed', status: 401 }).kind).toBe('auth');
    expect(classifyClaudeCliError({ errorType: 'billing_error' }).kind).toBe('quota');
    expect(classifyClaudeCliError({ errorType: 'invalid_request', status: 400, message: 'bad' }).kind).toBe('bad_request');
    expect(classifyClaudeCliError({ errorType: 'server_error', status: 500 })).toMatchObject({ kind: 'unavailable', retryable: true });
    expect(classifyClaudeCliError({ errorType: 'overloaded', status: 529 })).toMatchObject({ kind: 'unavailable', reason: 'overloaded' });
    const limited = classifyClaudeCliError({ errorType: 'rate_limit', status: 429, retryAfterMs: 4000 });
    expect(limited).toMatchObject({ kind: 'rate_limit', retryAfterMs: 4000 });
    expect(limited.message).toContain('4 с');
    // Без вида — по статусу.
    expect(classifyClaudeCliError({ status: 429 }).kind).toBe('rate_limit');
  });
});

describe('seedModelTiers', () => {
  it('размер в id модели', () => {
    expect(parameterSizeB('qwen2.5:7b-instruct')).toBe(7);
    expect(parameterSizeB('ornith:35b')).toBe(35);
    expect(parameterSizeB('phi3:3.8b')).toBe(3.8);
    expect(parameterSizeB('gpt-oss:20B')).toBe(20);
    expect(parameterSizeB('mixtral:8x7b')).toBeUndefined();
    expect(parameterSizeB('qwen2.5')).toBeUndefined();
    expect(tierForModelSize(7)).toBe('cheap');
    expect(tierForModelSize(30)).toBe('balanced');
    expect(tierForModelSize(35)).toBe('frontier');
  });

  it('из настроенного: AI Studio, алиасы Claude CLI, каталоги с размером; без вендорских дефолтов', () => {
    const { settings, added } = seedModelTiers({
      aiStudio: { provider: 'openai-compatible', profileId: 'p1', model: 'qwen2.5:7b-instruct' },
      profiles: [
        { id: 'p1', name: 'Ollama', local: true },
        { id: 'p2', name: 'LAN', local: true }
      ],
      catalogs: {
        p1: ['qwen2.5:7b-instruct', 'llama3.2:3b', 'bge-m3:567m', 'nomic-embed-text:v1.5', 'mystery-model'],
        p2: ['ornith:35b', 'gpt-oss:20b']
      },
      claudeCli: true
    });
    expect(settings.tiers.balanced).toEqual([
      { engine: 'api', model: 'qwen2.5:7b-instruct', profile: 'Ollama', source: 'auto' },
      { engine: 'claude-cli', model: 'sonnet', source: 'auto' },
      { engine: 'api', model: 'gpt-oss:20b', profile: 'LAN', source: 'auto' }
    ]);
    expect(settings.tiers.frontier.map((e) => e.model)).toEqual(['opus', 'ornith:35b']);
    // qwen уже в balanced из AI Studio — в cheap не дублируется; эмбеддинги и модели без размера не попадают.
    expect(settings.tiers.cheap.map((e) => e.model)).toEqual(['haiku', 'llama3.2:3b']);
    expect(added).toBe(7);
  });

  it('без Claude CLI и профилей — только модель AI Studio; ручные записи не трогаются', () => {
    const base = settingsWith({ frontier: [{ engine: 'api', provider: 'anthropic', model: 'mine', source: 'manual' }] });
    const { settings, added } = seedModelTiers(
      { aiStudio: { provider: 'anthropic', model: 'mine' }, profiles: [], catalogs: {}, claudeCli: false },
      base
    );
    expect(added).toBe(0);
    expect(settings).toEqual(base);
    expect(seedModelTiers({ aiStudio: { provider: 'anthropic', model: 'default' }, profiles: [], catalogs: {}, claudeCli: false }).added).toBe(0);
  });

  it('неоднозначное имя профиля — ссылка по id', () => {
    const { settings } = seedModelTiers({
      profiles: [
        { id: 'a', name: 'Dup' },
        { id: 'b', name: 'dup' }
      ],
      catalogs: { a: ['m:70b'] },
      claudeCli: false
    });
    expect(settings.tiers.frontier).toEqual([{ engine: 'api', model: 'm:70b', profile: 'a', source: 'auto' }]);
  });
});

describe('ModelTierService', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-tiers-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const seedInput = async () => ({ profiles: [{ id: 'p', name: 'Ollama', local: true }], catalogs: { p: ['ornith:35b'] }, claudeCli: false });

  it('при первом запуске заполняет и сохраняет файл, потом читает его', async () => {
    const file = path.join(dir, 'model-tiers.json');
    const service = new ModelTierService(file, seedInput);
    const state = await service.getState();
    expect(state.settings.tiers.frontier).toEqual([{ engine: 'api', model: 'ornith:35b', profile: 'Ollama', source: 'auto' }]);
    const onDisk = JSON.parse(await fs.readFile(file, 'utf-8'));
    expect(onDisk.tiers.frontier).toHaveLength(1);
    expect(onDisk.updatedAt).toBeTypeOf('string');

    // Второй экземпляр читает файл и не заполняет заново.
    const other = new ModelTierService(file, async () => {
      throw new Error('не должен вызываться');
    });
    expect((await other.getState()).settings.tiers.frontier).toHaveLength(1);
  });

  it('битый файл — пустые тиры и причина; сохранение чинит файл', async () => {
    const file = path.join(dir, 'model-tiers.json');
    await fs.writeFile(file, '{ битый', 'utf-8');
    const service = new ModelTierService(file, seedInput);
    const state = await service.getState();
    expect(state.loadError).toBeTruthy();
    expect(state.settings).toEqual(emptyModelTierSettings());
    const saved = await service.save({ tiers: { cheap: [{ engine: 'claude-cli', model: 'haiku' }, { engine: 'x' }] } });
    expect(saved.loadError).toBeUndefined();
    expect(saved.problems).toHaveLength(1);
    expect((await new ModelTierService(file, seedInput).getState()).settings.tiers.cheap).toEqual([{ engine: 'claude-cli', model: 'haiku' }]);
  });

  it('«Заполнить из настроенного» добавляет к черновику и ничего не пишет', async () => {
    const file = path.join(dir, 'model-tiers.json');
    await fs.writeFile(file, JSON.stringify({ tiers: {} }), 'utf-8');
    const service = new ModelTierService(file, seedInput);
    const draft = { tiers: { cheap: [{ engine: 'api', profile: 'Ollama', model: 'x:1b', source: 'manual' }] } };
    const seeded = await service.seed(draft);
    expect(seeded.added).toBe(1);
    expect(seeded.settings.tiers.cheap).toHaveLength(1);
    expect(seeded.settings.tiers.frontier).toHaveLength(1);
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({ tiers: {} });
  });
});

// Тип звена экспортирован для agentFleetService — проверка формы.
const _link: ChainLink = { engine: 'api', model: 'm', origin: 'tier', tier: 'cheap' };
void _link;
