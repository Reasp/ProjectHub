import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PRICE_TABLE,
  addUsage,
  computeCostUsd,
  emptyUsage,
  formatTokens,
  formatUsd,
  mergePriceTables,
  normalizeModelId,
  parseClaudeResultEvent,
  parseCliUsageText,
  priceUsage,
  resolveModelPrice,
  usageFromAnthropic,
  usageFromClaudeAssistantEvent,
  usageFromOpenAI,
  withTotal
} from '../../electron/services/agentCost';

describe('agentCost (TASK-56): нормализация моделей и таблица цен', () => {
  it('normalizeModelId убирает провайдерный префикс, суффиксы даты/latest и ollama-теги', () => {
    expect(normalizeModelId('openai/gpt-4o-2024-08-06')).toBe('gpt-4o');
    expect(normalizeModelId('claude-3-7-sonnet-latest')).toBe('claude-3-7-sonnet');
    expect(normalizeModelId('claude-sonnet-4-5@20250929')).toBe('claude-sonnet-4-5');
    expect(normalizeModelId('Claude-Opus-5')).toBe('claude-opus-5');
    expect(normalizeModelId('llama3:8b')).toBe('llama3');
    expect(normalizeModelId('')).toBe('');
  });

  it('resolveModelPrice: точное совпадение, самый длинный префикс, подстрока, иначе undefined', () => {
    expect(resolveModelPrice('claude-opus-5')).toEqual(BUILTIN_PRICE_TABLE.models['claude-opus-5']);
    // gpt-4o-mini не должен схлопываться в gpt-4o
    expect(resolveModelPrice('openai/gpt-4o-mini')).toEqual(BUILTIN_PRICE_TABLE.models['gpt-4o-mini']);
    expect(resolveModelPrice('claude-sonnet-4-6-20260301')).toEqual(BUILTIN_PRICE_TABLE.models['claude-sonnet-4-6']);
    expect(resolveModelPrice('anthropic/claude-haiku-4-5')).toEqual(BUILTIN_PRICE_TABLE.models['claude-haiku-4-5']);
    expect(resolveModelPrice('mistral-large')).toBeUndefined();
    expect(resolveModelPrice(undefined)).toBeUndefined();
  });

  it('computeCostUsd считает по четырём категориям токенов за 1M', () => {
    const usage = withTotal({
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 500_000,
      cacheCreationTokens: 200_000,
      costSource: 'unknown'
    });
    // opus-5: 5 + 25*0.1 + 0.5*0.5 + 6.25*0.2 = 5 + 2.5 + 0.25 + 1.25 = 9
    expect(computeCostUsd(usage, 'claude-opus-5')).toBeCloseTo(9, 6);
    expect(computeCostUsd(usage, 'unknown-model')).toBeUndefined();
  });

  it('priceUsage не перетирает стоимость провайдера и помечает источник', () => {
    const fromProvider = { ...emptyUsage('claude-opus-5'), inputTokens: 10, totalTokens: 10, costUsd: 1.23, costSource: 'provider' as const };
    expect(priceUsage(fromProvider, 'claude-opus-5')).toBe(fromProvider);

    const table = priceUsage(withTotal({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costSource: 'unknown' }), 'deepseek-chat');
    expect(table.costSource).toBe('price-table');
    expect(table.costUsd).toBeCloseTo(0.28, 6);

    const unknown = priceUsage(withTotal({ inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costSource: 'unknown' }), 'mystery');
    expect(unknown.costSource).toBe('unknown');
    expect(unknown.costUsd).toBeUndefined();
  });

  it('mergePriceTables: пользовательские цены переопределяют встроенные, битые записи игнорируются', () => {
    const merged = mergePriceTables(BUILTIN_PRICE_TABLE, {
      updatedAt: '2026-10-01',
      models: {
        'claude-opus-5': { input: 1, output: 2 },
        'My-Model/custom-7b': { input: 0.1, output: 0.2, cacheRead: 0.01 },
        broken: { input: 'x' }
      }
    });
    expect(merged.updatedAt).toBe('2026-10-01');
    expect(merged.models['claude-opus-5']).toEqual({ input: 1, output: 2 });
    expect(merged.models['custom-7b']).toEqual({ input: 0.1, output: 0.2, cacheRead: 0.01 });
    expect(merged.models.broken).toBeUndefined();
    expect(merged.models['claude-sonnet-5']).toEqual(BUILTIN_PRICE_TABLE.models['claude-sonnet-5']);
    expect(mergePriceTables(BUILTIN_PRICE_TABLE, null)).toBe(BUILTIN_PRICE_TABLE);
  });
});

describe('agentCost (TASK-56): парсинг usage', () => {
  it('usageFromAnthropic / usageFromOpenAI читают snake_case и кэш; пустой usage → null', () => {
    expect(usageFromAnthropic({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 }, 'm')).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheCreationTokens: 2,
      totalTokens: 20,
      costSource: 'unknown',
      model: 'm'
    });
    expect(usageFromAnthropic({ input_tokens: 0 })).toBeNull();
    expect(usageFromAnthropic(null)).toBeNull();

    const openai = usageFromOpenAI({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 }, cost: 0.002 }, 'gpt-4o');
    expect(openai).toMatchObject({ inputTokens: 60, cacheReadTokens: 40, outputTokens: 20, costUsd: 0.002, costSource: 'provider' });
    const deepseek = usageFromOpenAI({ prompt_tokens: 100, completion_tokens: 1, prompt_cache_hit_tokens: 90 });
    expect(deepseek).toMatchObject({ inputTokens: 10, cacheReadTokens: 90 });
  });

  it('usageFromClaudeAssistantEvent берёт usage и модель из message, помечает один ход', () => {
    const u = usageFromClaudeAssistantEvent({
      type: 'assistant',
      message: { model: 'claude-opus-5', usage: { input_tokens: 5, output_tokens: 7 } }
    });
    expect(u).toMatchObject({ inputTokens: 5, outputTokens: 7, model: 'claude-opus-5', turns: 1 });
    expect(usageFromClaudeAssistantEvent({ type: 'assistant' })).toBeNull();
  });

  it('parseClaudeResultEvent: total_cost_usd → provider, модель из modelUsage, ошибка по subtype', () => {
    const summary = parseClaudeResultEvent({
      type: 'result',
      subtype: 'success',
      duration_ms: 1234,
      num_turns: 3,
      total_cost_usd: 0.42,
      result: 'done',
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 },
      modelUsage: {
        'claude-haiku-4-5': { inputTokens: 10, outputTokens: 5, costUSD: 0.01 },
        'claude-opus-5': { inputTokens: 90, outputTokens: 45, costUSD: 0.41 }
      }
    });
    expect(summary).not.toBeNull();
    expect(summary!.usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      totalTokens: 160,
      costUsd: 0.42,
      costSource: 'provider',
      model: 'claude-opus-5',
      turns: 3
    });
    expect(summary!.durationMs).toBe(1234);
    expect(summary!.isError).toBe(false);
    expect(summary!.result).toBe('done');

    const errored = parseClaudeResultEvent({ type: 'result', subtype: 'error_max_turns', is_error: true });
    expect(errored!.isError).toBe(true);
    // без usage totals собираются из modelUsage
    const fromModels = parseClaudeResultEvent({ type: 'result', modelUsage: { m: { inputTokens: 3, outputTokens: 4 } } });
    expect(fromModels!.usage.totalTokens).toBe(7);
    expect(parseClaudeResultEvent({ type: 'assistant' })).toBeNull();
  });

  it('parseCliUsageText: best-effort по строкам Codex/Aider, иначе null', () => {
    expect(parseCliUsageText('Tokens used: 12,345')).toMatchObject({ inputTokens: 12345, outputTokens: 0, totalTokens: 12345 });
    expect(parseCliUsageText('Tokens: 1.2k sent, 340 received.')).toBeNull();
    expect(parseCliUsageText('tokens: 1200 sent, 340 received')).toMatchObject({ inputTokens: 1200, outputTokens: 340 });
    expect(parseCliUsageText('input: 900 output: 100')).toMatchObject({ inputTokens: 900, outputTokens: 100 });
    expect(parseCliUsageText('Done. Files written: 3')).toBeNull();
    expect(parseCliUsageText('')).toBeNull();
  });

  it('addUsage складывает токены, стоимость (если известна) и ходы; formatUsd/formatTokens читаемы', () => {
    const a = { ...emptyUsage('m'), inputTokens: 1, totalTokens: 1, costUsd: 0.5, costSource: 'price-table' as const, turns: 1 };
    const b = { ...emptyUsage(), outputTokens: 2, totalTokens: 2, costSource: 'provider' as const, costUsd: 0.25, turns: 2 };
    const sum = addUsage(a, b);
    expect(sum).toMatchObject({ inputTokens: 1, outputTokens: 2, totalTokens: 3, costUsd: 0.75, costSource: 'provider', model: 'm', turns: 3 });
    expect(addUsage(emptyUsage(), emptyUsage()).costUsd).toBeUndefined();

    expect(formatUsd(undefined)).toBe('—');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(1.5)).toBe('$1.50');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(12_345)).toBe('12.3k');
    expect(formatTokens(2_500_000)).toBe('2.50M');
  });
});
