import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  BUILTIN_PRICE_TABLE,
  addUsage,
  estimateUsage,
  mergePriceTables,
  priceUsage,
  usageFromOpenAI,
  withTotal,
  type AgentUsage
} from '../../electron/services/agentCost';
import { applyImportedPrices, parseOpenRouterModels, sanitizePriceOverrides } from '../../electron/services/agentPricing';
import { PricingService } from '../../electron/services/pricingService';
import { legacyProviderCompat, legacyProviderIsLocal, getPreset } from '../../electron/services/llmProfiles';
import {
  applyImportSelection,
  buildPriceRows,
  draftFromPrice,
  filterImportEntries,
  formatPrice,
  parsePriceField,
  priceFromDraft,
  removeOverride,
  setOverride
} from '../../src/lib/pricingEditor';
import { formatUsd as formatUsdUi } from '../../src/utils/swarmFormat';

const FIXTURE = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'openrouter-models.json'), 'utf8'));

function usage(partial: Partial<AgentUsage>): AgentUsage {
  return withTotal({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costSource: 'unknown', ...partial });
}

describe('priceUsage (decision-42): локальный ноль, оценка, таблица', () => {
  it('локальный провайдер — 0 и costSource local независимо от имени модели', () => {
    const u = usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
    // Та же модель у облачного провайдера платная, в локальном Ollama — нет.
    const table = mergePriceTables(BUILTIN_PRICE_TABLE, { models: { 'qwen2.5': { input: 1, output: 2 } } });
    expect(priceUsage(u, 'qwen2.5:7b-instruct', table).costUsd).toBeCloseTo(3, 6);
    const local = priceUsage(u, 'qwen2.5:7b-instruct', table, { local: true });
    expect(local).toMatchObject({ costUsd: 0, costSource: 'local', model: 'qwen2.5:7b-instruct' });
    // Даже модель из встроенной таблицы на локальном сервере бесплатна.
    expect(priceUsage(u, 'claude-opus-5', BUILTIN_PRICE_TABLE, { local: true }).costUsd).toBe(0);
  });

  it('стоимость провайдера не перетирается даже у локального флага', () => {
    const u = { ...usage({ inputTokens: 10 }), costUsd: 0.01, costSource: 'provider' as const };
    expect(priceUsage(u, 'x', BUILTIN_PRICE_TABLE, { local: true })).toBe(u);
  });

  it('оценка по длине текста у платной модели — unknown без стоимости, у локальной — 0', () => {
    const est = estimateUsage({ inputChars: 400, outputChars: 81, model: 'claude-opus-5' });
    expect(est).toMatchObject({ inputTokens: 100, outputTokens: 21, estimated: true, costSource: 'unknown', model: 'claude-opus-5' });
    expect(est.totalTokens).toBe(121);
    const paid = priceUsage(est, 'claude-opus-5');
    expect(paid.costSource).toBe('unknown');
    expect(paid.costUsd).toBeUndefined();
    expect(priceUsage(est, 'claude-opus-5', BUILTIN_PRICE_TABLE, { local: true })).toMatchObject({ costUsd: 0, costSource: 'local', estimated: true });
    expect(estimateUsage({ inputChars: -5, outputChars: Number.NaN }).totalTokens).toBe(0);
  });

  it('addUsage сохраняет пометку estimated и ранжирует local ниже price-table', () => {
    const a = { ...usage({ inputTokens: 1 }), costUsd: 0, costSource: 'local' as const };
    const b = { ...estimateUsage({ inputChars: 8, outputChars: 0 }) };
    expect(addUsage(a, b)).toMatchObject({ costSource: 'local', estimated: true, inputTokens: 3, costUsd: 0 });
    const c = { ...usage({ outputTokens: 1 }), costUsd: 1, costSource: 'price-table' as const };
    expect(addUsage(a, c).costSource).toBe('price-table');
    expect(addUsage(a, c).estimated).toBeUndefined();
  });

  it('usageFromOpenAI: cached_tokens Ollama и DeepSeek попадают в cacheReadTokens, cost OpenRouter — provider', () => {
    // Живой ответ Ollama 0.34 на повтор запроса с тем же префиксом (2026-09-19).
    const ollama = usageFromOpenAI({ prompt_tokens: 1680, prompt_tokens_details: { cached_tokens: 1679 }, completion_tokens: 5, total_tokens: 1685 }, 'qwen2.5:7b-instruct');
    expect(ollama).toMatchObject({ inputTokens: 1, cacheReadTokens: 1679, outputTokens: 5, totalTokens: 1685 });
    // Ollama 0.31.2 не сообщает кэш.
    expect(usageFromOpenAI({ prompt_tokens: 314, completion_tokens: 47, total_tokens: 361 })).toMatchObject({ inputTokens: 314, cacheReadTokens: 0 });
    expect(usageFromOpenAI({ prompt_tokens: 100, prompt_cache_hit_tokens: 60, completion_tokens: 1 })).toMatchObject({ inputTokens: 40, cacheReadTokens: 60 });
    expect(usageFromOpenAI({ prompt_tokens: 10, completion_tokens: 1, cost: 0.002 })).toMatchObject({ costUsd: 0.002, costSource: 'provider' });
  });

  it('mergePriceTables отбрасывает отрицательные и бесконечные цены', () => {
    const merged = mergePriceTables(BUILTIN_PRICE_TABLE, {
      models: { bad: { input: -1, output: 1 }, inf: { input: Infinity, output: 1 }, ok: { input: 0, output: 0, cacheRead: -1 } }
    });
    expect(merged.models.bad).toBeUndefined();
    expect(merged.models.inf).toBeUndefined();
    expect(merged.models.ok).toEqual({ input: 0, output: 0 });
  });
});

describe('Ollama: usage в стриме (decision-42)', () => {
  it('пресет Ollama и прежний провайдер ollama шлют stream_options.include_usage', () => {
    expect(getPreset('ollama').compat.streamUsage).toBe(true);
    expect(legacyProviderCompat('ollama').streamUsage).toBe(true);
  });

  it('legacyProviderIsLocal: ollama всегда, custom — только localhost', () => {
    expect(legacyProviderIsLocal('ollama', 'http://192.168.1.11:11434/v1/chat/completions')).toBe(true);
    expect(legacyProviderIsLocal('custom', 'http://127.0.0.1:8000/v1/chat/completions')).toBe(true);
    expect(legacyProviderIsLocal('custom', 'https://api.example.com/v1/chat/completions')).toBe(false);
    expect(legacyProviderIsLocal('custom', '')).toBe(false);
    expect(legacyProviderIsLocal('openrouter', 'http://localhost/v1')).toBe(false);
  });
});

describe('parseOpenRouterModels: фикстура живого ответа /api/v1/models', () => {
  it('переводит USD за токен в USD за 1M, берёт кэш, пропускает варианты, роутеры и дубли', () => {
    const r = parseOpenRouterModels(FIXTURE);
    expect(r.total).toBe(7);
    expect(r.skipped).toEqual({ variant: 2, dynamic: 1, invalid: 0, duplicate: 1 });
    const byId = Object.fromEntries(r.entries.map((e) => [e.id, e]));
    expect(Object.keys(byId).sort()).toEqual(['claude-sonnet-4.5', 'deepseek-v4.1-flash', 'gpt-4o-mini']);
    expect(byId['claude-sonnet-4.5']).toMatchObject({
      sourceId: 'anthropic/claude-sonnet-4.5',
      price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      hasLongContextTier: true
    });
    // Недатированная модель выигрывает у датированной версии с тем же нормализованным id.
    expect(byId['gpt-4o-mini']).toMatchObject({ sourceId: 'openai/gpt-4o-mini', price: { input: 0.15, output: 0.6, cacheRead: 0.075 }, hasLongContextTier: false });
    expect(byId['gpt-4o-mini'].price.cacheWrite).toBeUndefined();
    expect(byId['deepseek-v4.1-flash'].price.cacheRead).toBeCloseTo(0.003, 10);
  });

  it('датированная версия раньше основной не побеждает; бесплатная модель без суффикса импортируется с нулём', () => {
    const r = parseOpenRouterModels({
      data: [
        { id: 'openai/gpt-x-2025-01-01', pricing: { prompt: '0.000002', completion: '0.000004' } },
        { id: 'openai/gpt-x', pricing: { prompt: '0.000001', completion: '0.000002' } },
        { id: 'vendor/free-model', pricing: { prompt: '0', completion: '0' } },
        { id: 'broken', pricing: { prompt: 'abc', completion: '1' } },
        { id: 'noprice' },
        null
      ]
    });
    expect(r.entries.find((e) => e.id === 'gpt-x')).toMatchObject({ sourceId: 'openai/gpt-x', price: { input: 1, output: 2 } });
    expect(r.entries.find((e) => e.id === 'free-model')?.price).toEqual({ input: 0, output: 0 });
    expect(r.skipped).toEqual({ variant: 0, dynamic: 0, invalid: 3, duplicate: 1 });
  });

  it('ответ без data — ошибка', () => {
    expect(() => parseOpenRouterModels({ error: 'x' })).toThrow(/data/);
    expect(() => parseOpenRouterModels(null)).toThrow();
  });
});

describe('переопределения цен: санитизация и импорт', () => {
  it('sanitizePriceOverrides нормализует ключи и отбрасывает битые записи, сохраняет source', () => {
    const o = sanitizePriceOverrides({
      updatedAt: '2026-09-19',
      models: {
        'OpenAI/GPT-4o-2024-08-06': { input: 2, output: 8, source: 'openrouter' },
        'my-local': { input: 0, output: 0, cacheRead: 'x', source: 'hack' },
        bad: { input: 1 },
        neg: { input: -1, output: 1 }
      }
    });
    expect(o).toEqual({
      updatedAt: '2026-09-19',
      models: { 'gpt-4o': { input: 2, output: 8, source: 'openrouter' }, 'my-local': { input: 0, output: 0 } }
    });
    expect(sanitizePriceOverrides('garbage')).toEqual({ models: {} });
  });

  it('applyImportedPrices дописывает выбранные цены с пометкой openrouter и не трогает остальные', () => {
    const r = parseOpenRouterModels(FIXTURE);
    const next = applyImportedPrices({ models: { mine: { input: 1, output: 1, source: 'manual' } } }, r.entries.filter((e) => e.id === 'gpt-4o-mini'), '2026-09-19');
    expect(next).toEqual({
      updatedAt: '2026-09-19',
      models: { mine: { input: 1, output: 1, source: 'manual' }, 'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, source: 'openrouter' } }
    });
    // Импортированная цена применяется в расчёте, встроенная таблица не меняется.
    const table = mergePriceTables(BUILTIN_PRICE_TABLE, next);
    expect(table.models['gpt-4o-mini']).toEqual({ input: 0.15, output: 0.6, cacheRead: 0.075 });
    expect(BUILTIN_PRICE_TABLE.models.mine).toBeUndefined();
  });
});

describe('PricingService: файл agent-pricing.json и перечитывание без перезапуска', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-pricing-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('без файла — встроенная таблица; сохранение сразу меняет таблицу и пишет файл', async () => {
    const file = path.join(dir, 'agent-pricing.json');
    const svc = new PricingService(file);
    expect(await svc.ensureLoaded()).toEqual(BUILTIN_PRICE_TABLE);
    const state = await svc.saveOverrides({ models: { 'my-model': { input: 1, output: 2 }, 'claude-opus-5': { input: 4, output: 20 } } });
    expect(state.overrides.models['my-model']).toEqual({ input: 1, output: 2 });
    expect(state.overrides.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(svc.getTable().models['claude-opus-5']).toEqual({ input: 4, output: 20 });
    expect(svc.getTable().models['claude-sonnet-5']).toEqual(BUILTIN_PRICE_TABLE.models['claude-sonnet-5']);
    const onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(onDisk.models['my-model']).toEqual({ input: 1, output: 2 });
    // Новый экземпляр (перезапуск) читает тот же файл.
    expect((await new PricingService(file).ensureLoaded()).models['my-model']).toEqual({ input: 1, output: 2 });
    // Сброс к встроенной: переопределение удалено.
    await svc.saveOverrides({ models: {} });
    expect(svc.getTable().models['claude-opus-5']).toEqual(BUILTIN_PRICE_TABLE.models['claude-opus-5']);
  });

  it('битый файл — встроенные цены и loadError, сохранение перезаписывает', async () => {
    const file = path.join(dir, 'agent-pricing.json');
    await fs.writeFile(file, '{ not json', 'utf8');
    const svc = new PricingService(file);
    const state = await svc.getState();
    expect(state.loadError).toBeTruthy();
    expect(svc.getTable()).toEqual(BUILTIN_PRICE_TABLE);
    const saved = await svc.saveOverrides({ models: { a: { input: 1, output: 1 } } });
    expect(saved.loadError).toBeUndefined();
  });

  it('fetchOpenRouterPrices разбирает ответ и сообщает об ошибке HTTP; ничего не пишет', async () => {
    const file = path.join(dir, 'agent-pricing.json');
    const svc = new PricingService(file);
    const ok = (async () => new Response(JSON.stringify(FIXTURE), { status: 200 })) as unknown as typeof fetch;
    const result = await svc.fetchOpenRouterPrices(ok);
    expect(result.entries.length).toBe(3);
    await expect(fs.access(file)).rejects.toThrow();
    const fail = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    await expect(svc.fetchOpenRouterPrices(fail)).rejects.toThrow(/429/);
  });
});

describe('pricingEditor (UI): строки, ввод, сброс, импорт', () => {
  const builtin = { updatedAt: '2026-09-10', models: { a: { input: 1, output: 2 }, b: { input: 3, output: 4, cacheRead: 0.3 } } };

  it('buildPriceRows: свои, переопределённые, встроенные; поиск по id', () => {
    const rows = buildPriceRows(builtin, { models: { b: { input: 5, output: 6, source: 'manual' }, z: { input: 0, output: 0 } } });
    expect(rows.map((r) => [r.id, r.status])).toEqual([['z', 'custom'], ['b', 'overridden'], ['a', 'builtin']]);
    expect(rows[1]).toMatchObject({ price: { input: 5, output: 6 }, builtin: { input: 3, output: 4, cacheRead: 0.3 } });
    expect(buildPriceRows(builtin, { models: {} }, ' B ').map((r) => r.id)).toEqual(['b']);
  });

  it('parsePriceField / priceFromDraft: запятая, пусто, отрицательные и мусор', () => {
    expect(parsePriceField('0,25')).toBe(0.25);
    expect(parsePriceField(' 3 ')).toBe(3);
    expect(parsePriceField('1e-3')).toBe(0.001);
    expect(parsePriceField('')).toBeUndefined();
    expect(parsePriceField('-1')).toBeNull();
    expect(parsePriceField('0x10')).toBeNull();
    expect(parsePriceField('Infinity')).toBeNull();
    expect(parsePriceField('abc')).toBeNull();
    expect(priceFromDraft({ input: '1', output: '2', cacheRead: '', cacheWrite: '0.5' })).toEqual({ input: 1, output: 2, cacheWrite: 0.5 });
    expect(priceFromDraft({ input: '', output: '2', cacheRead: '', cacheWrite: '' })).toBeNull();
    expect(priceFromDraft({ input: '1', output: '2', cacheRead: 'x', cacheWrite: '' })).toBeNull();
    expect(draftFromPrice({ input: 1, output: 2, cacheRead: 0.1 })).toEqual({ input: '1', output: '2', cacheRead: '0.1', cacheWrite: '' });
  });

  it('setOverride / removeOverride: сброс встроенной к исходной цене, удаление своей', () => {
    let o = setOverride({ models: {} }, 'a', { input: 9, output: 9 });
    expect(o.models.a).toEqual({ input: 9, output: 9, source: 'manual' });
    expect(buildPriceRows(builtin, o).find((r) => r.id === 'a')?.status).toBe('overridden');
    o = removeOverride(o, 'a');
    expect(buildPriceRows(builtin, o).find((r) => r.id === 'a')).toMatchObject({ status: 'builtin', price: { input: 1, output: 2 } });
    expect(removeOverride(o, 'missing')).toBe(o);
  });

  it('импорт: фильтр по id/названию и добавление только выбранных', () => {
    const r = parseOpenRouterModels(FIXTURE);
    expect(filterImportEntries(r.entries, 'anthropic').map((e) => e.id)).toEqual(['claude-sonnet-4.5']);
    expect(filterImportEntries(r.entries, '').length).toBe(3);
    const next = applyImportSelection({ models: {} }, r.entries, new Set(['openai/gpt-4o-mini']));
    expect(next.models).toEqual({ 'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, source: 'openrouter' } });
  });

  it('formatUsd в рендерере: доли цента не превращаются в $0.0000', () => {
    expect(formatUsdUi(0)).toBe('$0.00');
    expect(formatUsdUi(0.00004)).toBe('$0.000040');
    expect(formatUsdUi(0.0042)).toBe('$0.0042');
  });

  it('formatPrice', () => {
    expect(formatPrice(undefined)).toBe('—');
    expect(formatPrice(0)).toBe('0');
    expect(formatPrice(0.075)).toBe('0.075');
    expect(formatPrice(3.0000000001)).toBe('3');
  });
});
