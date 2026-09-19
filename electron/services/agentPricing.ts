/**
 * Переопределения цен и импорт из OpenRouter (TASK-70.4, decision-42).
 *
 * Чистый модуль без Electron. Встроенная таблица (`BUILTIN_PRICE_TABLE`) — справочник в коде,
 * пользователь правит только переопределения в `<userData>/agent-pricing.json`. Формат файла
 * совместим с прежним (decision-16): `{ updatedAt, models: { <id>: { input, output, cacheRead?, cacheWrite? } } }`,
 * у записи может быть `source` — откуда она взялась (правка в UI или импорт OpenRouter).
 */

import { isValidPriceValue, normalizeModelId, type ModelPrice } from './agentCost.js';

export type PriceOverrideSource = 'manual' | 'openrouter';

export interface PriceOverrideEntry extends ModelPrice {
  source?: PriceOverrideSource;
}

export interface PriceOverrides {
  /** Дата последней правки переопределений (YYYY-MM-DD); пусто — ещё не правились. */
  updatedAt?: string;
  models: Record<string, PriceOverrideEntry>;
}

/** Цена за 1M токенов с точностью, достаточной для долей цента (10 знаков после запятой). */
function roundPrice(value: number): number {
  return Math.round(value * 1e10) / 1e10;
}

/**
 * Приводит содержимое `agent-pricing.json` (или ввод из UI) к `PriceOverrides`: ключи нормализуются
 * как при подборе цены, битые записи (нет входа/выхода, отрицательные или нечисловые цены) отбрасываются.
 */
export function sanitizePriceOverrides(raw: unknown): PriceOverrides {
  const result: PriceOverrides = { models: {} };
  if (!raw || typeof raw !== 'object') return result;
  const r = raw as { updatedAt?: unknown; models?: unknown };
  if (typeof r.updatedAt === 'string' && r.updatedAt.trim()) result.updatedAt = r.updatedAt.trim();
  if (!r.models || typeof r.models !== 'object') return result;
  for (const [key, value] of Object.entries(r.models as Record<string, unknown>)) {
    const id = normalizeModelId(key);
    if (!id || !value || typeof value !== 'object') continue;
    const v = value as Partial<PriceOverrideEntry>;
    if (!isValidPriceValue(v.input) || !isValidPriceValue(v.output)) continue;
    result.models[id] = {
      input: v.input,
      output: v.output,
      ...(isValidPriceValue(v.cacheRead) ? { cacheRead: v.cacheRead } : {}),
      ...(isValidPriceValue(v.cacheWrite) ? { cacheWrite: v.cacheWrite } : {}),
      ...(v.source === 'manual' || v.source === 'openrouter' ? { source: v.source } : {})
    };
  }
  return result;
}

export interface OpenRouterImportedPrice {
  /** Ключ таблицы цен (нормализованный id). */
  id: string;
  /** Исходный id OpenRouter (`anthropic/claude-sonnet-4.5`). */
  sourceId: string;
  name?: string;
  price: ModelPrice;
  /** У модели есть тариф длинного контекста (`pricing.overrides` с `min_prompt_tokens`), он не импортируется. */
  hasLongContextTier: boolean;
}

export interface OpenRouterImportResult {
  entries: OpenRouterImportedPrice[];
  /** Сколько моделей пропущено и почему. */
  skipped: {
    /** Варианты `:free`, `:batch`, `:thinking` … — после нормализации совпали бы с основной моделью. */
    variant: number;
    /** Роутеры с ценой `-1` (цена зависит от выбранной модели). */
    dynamic: number;
    /** Нет или не число `pricing.prompt`/`pricing.completion`. */
    invalid: number;
    /** Тот же нормализованный id у другой модели (датированная версия, другой вендор). */
    duplicate: number;
  };
  total: number;
}

/** Строка USD за токен (`"0.000003"`) → USD за 1M токенов; `undefined` — нет или не число, `null` — отрицательная. */
function perMillion(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return undefined;
  if (n < 0) return null;
  return roundPrice(n * 1_000_000);
}

/**
 * Разбор ответа `GET https://openrouter.ai/api/v1/models` (формат сверен с документацией и живым
 * ответом 2026-09-19): `{ data: [{ id, name, pricing: { prompt, completion, input_cache_read?,
 * input_cache_write?, overrides? } }] }`, цены — строки в USD за токен.
 *
 * - Варианты с `:` в id (`:free`, `:batch`) пропускаются: `normalizeModelId` отрезает суффикс, и
 *   бесплатный вариант перетёр бы цену платной модели.
 * - Цена `-1` (роутеры `openrouter/auto`) пропускается.
 * - `pricing.overrides` (тариф длинного контекста от `min_prompt_tokens`) не импортируется: usage
 *   агента суммируется по ходам, порог запроса к сумме применять нельзя (decision-42).
 * - При совпадении нормализованного id выигрывает модель, у которой id после слэша совпадает с ключом
 *   (недатированная), иначе первая по порядку ответа.
 */
export function parseOpenRouterModels(json: unknown): OpenRouterImportResult {
  const result: OpenRouterImportResult = { entries: [], skipped: { variant: 0, dynamic: 0, invalid: 0, duplicate: 0 }, total: 0 };
  const data = json && typeof json === 'object' ? (json as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) throw new Error('Неожиданный ответ OpenRouter: нет массива data.');
  const byId = new Map<string, { entry: OpenRouterImportedPrice; canonical: boolean }>();
  for (const item of data) {
    result.total += 1;
    if (!item || typeof item !== 'object') {
      result.skipped.invalid += 1;
      continue;
    }
    const m = item as { id?: unknown; name?: unknown; pricing?: Record<string, unknown> };
    const sourceId = typeof m.id === 'string' ? m.id.trim() : '';
    if (!sourceId || !m.pricing || typeof m.pricing !== 'object') {
      result.skipped.invalid += 1;
      continue;
    }
    if (sourceId.includes(':')) {
      result.skipped.variant += 1;
      continue;
    }
    const input = perMillion(m.pricing.prompt);
    const output = perMillion(m.pricing.completion);
    if (input === null || output === null) {
      result.skipped.dynamic += 1;
      continue;
    }
    if (input === undefined || output === undefined) {
      result.skipped.invalid += 1;
      continue;
    }
    const id = normalizeModelId(sourceId);
    if (!id) {
      result.skipped.invalid += 1;
      continue;
    }
    const cacheRead = perMillion(m.pricing.input_cache_read);
    const cacheWrite = perMillion(m.pricing.input_cache_write);
    const overrides = m.pricing.overrides;
    const entry: OpenRouterImportedPrice = {
      id,
      sourceId,
      ...(typeof m.name === 'string' && m.name.trim() ? { name: m.name.trim() } : {}),
      price: {
        input,
        output,
        ...(typeof cacheRead === 'number' ? { cacheRead } : {}),
        ...(typeof cacheWrite === 'number' ? { cacheWrite } : {})
      },
      hasLongContextTier: Array.isArray(overrides) && overrides.some((o) => o && typeof o === 'object' && 'min_prompt_tokens' in o)
    };
    const tail = sourceId.slice(sourceId.lastIndexOf('/') + 1).replace(/^~/, '').toLowerCase();
    const canonical = tail === id;
    const existing = byId.get(id);
    if (existing) {
      result.skipped.duplicate += 1;
      if (canonical && !existing.canonical) byId.set(id, { entry, canonical });
      continue;
    }
    byId.set(id, { entry, canonical });
  }
  result.entries = [...byId.values()].map((v) => v.entry).sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

/** Добавляет выбранные импортированные цены в переопределения (с пометкой `openrouter`), остальное не трогает. */
export function applyImportedPrices(overrides: PriceOverrides, entries: OpenRouterImportedPrice[], today: string): PriceOverrides {
  const models = { ...overrides.models };
  for (const e of entries) models[e.id] = { ...e.price, source: 'openrouter' };
  return { updatedAt: today, models };
}
