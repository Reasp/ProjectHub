/**
 * Учёт токенов и стоимости работы агентов (TASK-56, decision-16).
 *
 * Чистый модуль без Electron: парсит usage из событий `stream-json` Claude CLI, из ответов
 * API-провайдеров и из итоговых строк сторонних CLI, считает стоимость по таблице цен.
 *
 * Источники правды по стоимости, по убыванию приоритета:
 * 1. `provider` — стоимость сообщил сам провайдер (`total_cost_usd` в событии `result` Claude CLI).
 * 2. `price-table` — посчитано по usage и таблице цен (встроенной или переопределённой пользователем
 *    в `<userData>/agent-pricing.json`).
 * 3. `unknown` — usage есть, но модель в таблице не найдена (стоимость не показывается).
 */

export type CostSource = 'provider' | 'price-table' | 'unknown';

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Сумма всех четырёх категорий. */
  totalTokens: number;
  costUsd?: number;
  costSource: CostSource;
  model?: string;
  /** Число ответов модели (turns) — для CLI-агентов. */
  turns?: number;
}

/** Цены в USD за 1 млн токенов. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface PriceTable {
  /** Дата актуальности цен (ISO, YYYY-MM-DD). */
  updatedAt: string;
  models: Record<string, ModelPrice>;
}

/**
 * Встроенная таблица цен. Ключи — нормализованные идентификаторы моделей (без провайдерного
 * префикса и суффикса даты), подбор идёт по самому длинному совпадающему префиксу.
 * Цены Anthropic — первопартийные API-тарифы; кэш: запись ≈ 1.25× входа, чтение ≈ 0.1× входа.
 */
export const BUILTIN_PRICE_TABLE: PriceTable = {
  updatedAt: '2026-09-10',
  models: {
    // Anthropic
    'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
    'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
    'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-3-7-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-3-5-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    // DeepSeek
    'deepseek-chat': { input: 0.28, output: 0.42, cacheRead: 0.028 },
    'deepseek-reasoner': { input: 0.28, output: 0.42, cacheRead: 0.028 },
    // OpenAI (в т.ч. через OpenRouter с префиксом openai/)
    'gpt-5-mini': { input: 0.25, output: 2, cacheRead: 0.025 },
    'gpt-5-nano': { input: 0.05, output: 0.4, cacheRead: 0.005 },
    'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125 },
    'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheRead: 0.1 },
    'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5 },
    'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075 },
    'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25 },
    'o4-mini': { input: 1.1, output: 4.4, cacheRead: 0.275 },
    'o3': { input: 2, output: 8, cacheRead: 0.5 },
    // Google
    'gemini-2.5-pro': { input: 1.25, output: 10, cacheRead: 0.31 },
    'gemini-2.5-flash': { input: 0.3, output: 2.5, cacheRead: 0.075 }
  }
};

export function emptyUsage(model?: string): AgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    costSource: 'unknown',
    ...(model ? { model } : {})
  };
}

function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[,\s_]/g, ''));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

export function withTotal(usage: Omit<AgentUsage, 'totalTokens'>): AgentUsage {
  return {
    ...usage,
    totalTokens: usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens
  };
}

/** Суммирование двух usage. Стоимость складывается, только если известна у обоих. */
export function addUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  const costKnown = typeof a.costUsd === 'number' || typeof b.costUsd === 'number';
  const costUsd = costKnown ? (a.costUsd ?? 0) + (b.costUsd ?? 0) : undefined;
  const sourceRank: Record<CostSource, number> = { unknown: 0, 'price-table': 1, provider: 2 };
  const costSource = sourceRank[a.costSource] >= sourceRank[b.costSource] ? a.costSource : b.costSource;
  return withTotal({
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    ...(costUsd !== undefined ? { costUsd } : {}),
    costSource,
    model: a.model || b.model,
    turns: (a.turns ?? 0) + (b.turns ?? 0) || undefined
  });
}

/**
 * Нормализация идентификатора модели для подбора цены:
 * `openai/gpt-4o-2024-08-06` → `gpt-4o`, `claude-3-7-sonnet-latest` → `claude-3-7-sonnet`,
 * `claude-sonnet-4-5@20250929` → `claude-sonnet-4-5`.
 */
export function normalizeModelId(model: string): string {
  let id = String(model || '').trim().toLowerCase();
  const slash = id.lastIndexOf('/');
  if (slash >= 0) id = id.slice(slash + 1);
  id = id.replace(/:.*$/, ''); // ollama-теги вида llama3:8b
  id = id.replace(/@.*$/, ''); // vertex-версии
  id = id.replace(/-latest$/, '');
  id = id.replace(/-\d{8}$/, ''); // суффикс даты YYYYMMDD
  id = id.replace(/-\d{4}-\d{2}-\d{2}$/, ''); // суффикс даты YYYY-MM-DD
  return id;
}

/** Цена модели: точное совпадение, иначе самый длинный ключ-префикс, иначе самый длинный ключ-подстрока. */
export function resolveModelPrice(model: string | undefined, table: PriceTable = BUILTIN_PRICE_TABLE): ModelPrice | undefined {
  if (!model) return undefined;
  const id = normalizeModelId(model);
  if (!id) return undefined;
  if (table.models[id]) return table.models[id];
  let best: string | undefined;
  for (const key of Object.keys(table.models)) {
    if (id.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  if (!best) {
    for (const key of Object.keys(table.models)) {
      if (id.includes(key) && (!best || key.length > best.length)) best = key;
    }
  }
  return best ? table.models[best] : undefined;
}

export function computeCostUsd(usage: AgentUsage, model: string | undefined, table: PriceTable = BUILTIN_PRICE_TABLE): number | undefined {
  const price = resolveModelPrice(model ?? usage.model, table);
  if (!price) return undefined;
  const cacheRead = price.cacheRead ?? price.input * 0.1;
  const cacheWrite = price.cacheWrite ?? price.input * 1.25;
  const cost =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * cacheRead +
      usage.cacheCreationTokens * cacheWrite) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Если стоимость ещё не известна от провайдера, дописывает её по таблице цен. */
export function priceUsage(usage: AgentUsage, model: string | undefined, table: PriceTable = BUILTIN_PRICE_TABLE): AgentUsage {
  if (usage.costSource === 'provider' && typeof usage.costUsd === 'number') return usage;
  const costUsd = computeCostUsd(usage, model, table);
  if (costUsd === undefined) return { ...usage, costSource: 'unknown', costUsd: undefined };
  return { ...usage, costUsd, costSource: 'price-table', model: usage.model || model };
}

/** Слияние встроенной таблицы с пользовательскими переопределениями (`agent-pricing.json`). */
export function mergePriceTables(base: PriceTable, override: unknown): PriceTable {
  if (!override || typeof override !== 'object') return base;
  const o = override as Partial<PriceTable> & { models?: unknown };
  const models: Record<string, ModelPrice> = { ...base.models };
  if (o.models && typeof o.models === 'object') {
    for (const [key, value] of Object.entries(o.models as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const v = value as Partial<ModelPrice>;
      if (typeof v.input !== 'number' || typeof v.output !== 'number') continue;
      models[normalizeModelId(key)] = {
        input: v.input,
        output: v.output,
        ...(typeof v.cacheRead === 'number' ? { cacheRead: v.cacheRead } : {}),
        ...(typeof v.cacheWrite === 'number' ? { cacheWrite: v.cacheWrite } : {})
      };
    }
  }
  return {
    updatedAt: typeof o.updatedAt === 'string' && o.updatedAt ? o.updatedAt : base.updatedAt,
    models
  };
}

/** Usage из объекта `usage` формата Anthropic Messages API (snake_case). */
export function usageFromAnthropic(raw: unknown, model?: string): AgentUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const usage = withTotal({
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheCreationTokens: num(u.cache_creation_input_tokens),
    costSource: 'unknown',
    ...(model ? { model } : {})
  });
  return usage.totalTokens > 0 ? usage : null;
}

/** Usage из объекта `usage` формата OpenAI Chat Completions (prompt_tokens / completion_tokens). */
export function usageFromOpenAI(raw: unknown, model?: string): AgentUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const details = (u.prompt_tokens_details || u.prompt_cache_hit_tokens !== undefined ? u : {}) as Record<string, unknown>;
  const cached =
    num((u.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens) ||
    num(details.prompt_cache_hit_tokens);
  const prompt = num(u.prompt_tokens);
  const usage = withTotal({
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: num(u.completion_tokens),
    cacheReadTokens: cached,
    cacheCreationTokens: 0,
    costSource: 'unknown',
    ...(model ? { model } : {})
  });
  // OpenRouter отдаёт стоимость запроса в поле `cost` (USD).
  if (typeof u.cost === 'number' && Number.isFinite(u.cost)) {
    usage.costUsd = u.cost;
    usage.costSource = 'provider';
  }
  return usage.totalTokens > 0 ? usage : null;
}

/** Usage одного ответа модели из события `assistant` stream-json Claude CLI. */
export function usageFromClaudeAssistantEvent(event: unknown): AgentUsage | null {
  if (!event || typeof event !== 'object') return null;
  const message = (event as { message?: Record<string, unknown> }).message;
  if (!message || typeof message !== 'object') return null;
  const model = typeof message.model === 'string' ? message.model : undefined;
  const usage = usageFromAnthropic(message.usage, model);
  return usage ? { ...usage, turns: 1 } : null;
}

export interface ClaudeResultSummary {
  usage: AgentUsage;
  durationMs?: number;
  durationApiMs?: number;
  numTurns?: number;
  subtype?: string;
  isError: boolean;
  /** Текст итогового ответа (если есть). */
  result?: string;
}

/**
 * Итоговое событие `result` stream-json Claude CLI: авторитетные totals по токенам и
 * `total_cost_usd`. В `modelUsage` лежит разбивка по моделям — из неё берём имя модели.
 */
export function parseClaudeResultEvent(event: unknown): ClaudeResultSummary | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as Record<string, unknown>;
  if (e.type !== 'result') return null;

  let usage = usageFromAnthropic(e.usage) ?? emptyUsage();
  const modelUsage = e.modelUsage;
  let model: string | undefined;
  if (modelUsage && typeof modelUsage === 'object') {
    const entries = Object.entries(modelUsage as Record<string, Record<string, unknown>>);
    if (entries.length > 0) {
      // Основная модель — та, что потратила больше всего выходных токенов.
      entries.sort((a, b) => num(b[1]?.outputTokens) - num(a[1]?.outputTokens));
      model = entries[0][0];
      if (usage.totalTokens === 0) {
        for (const [, mu] of entries) {
          usage = addUsage(
            usage,
            withTotal({
              inputTokens: num(mu?.inputTokens),
              outputTokens: num(mu?.outputTokens),
              cacheReadTokens: num(mu?.cacheReadInputTokens),
              cacheCreationTokens: num(mu?.cacheCreationInputTokens),
              costSource: 'unknown'
            })
          );
        }
      }
    }
  }
  usage = { ...usage, model };
  if (typeof e.total_cost_usd === 'number' && Number.isFinite(e.total_cost_usd)) {
    usage.costUsd = e.total_cost_usd;
    usage.costSource = 'provider';
  }
  if (typeof e.num_turns === 'number') usage.turns = e.num_turns;

  return {
    usage,
    durationMs: typeof e.duration_ms === 'number' ? e.duration_ms : undefined,
    durationApiMs: typeof e.duration_api_ms === 'number' ? e.duration_api_ms : undefined,
    numTurns: typeof e.num_turns === 'number' ? e.num_turns : undefined,
    subtype: typeof e.subtype === 'string' ? e.subtype : undefined,
    isError: e.is_error === true || (typeof e.subtype === 'string' && e.subtype.startsWith('error')),
    result: typeof e.result === 'string' ? e.result : undefined
  };
}

/**
 * Best-effort парсинг итоговых строк сторонних CLI (Codex, Gemini CLI, Aider):
 * `Tokens used: 12,345`, `input: 1000 output: 200`, `tokens: 1000 sent, 200 received`,
 * `Total tokens: 5000`. Возвращает null, если ничего похожего нет.
 */
/** ANSI-последовательности вида ESC[...m; ESC собирается из кода, чтобы не держать control-символ в литерале. */
const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export function parseCliUsageText(text: string): AgentUsage | null {
  if (!text) return null;
  const t = text.replace(ANSI_ESCAPE_RE, '');
  let input = 0;
  let output = 0;
  let total = 0;
  let found = false;

  const io = t.match(/(?:input|prompt|sent)[^\d\n]{0,20}([\d,]{1,12})[^\n]*?(?:output|completion|received)[^\d\n]{0,20}([\d,]{1,12})/i);
  if (io) {
    input = num(io[1]);
    output = num(io[2]);
    found = true;
  } else {
    const sentRecv = t.match(/([\d,]{1,12})\s*(?:tokens?\s*)?sent[^\n]*?([\d,]{1,12})\s*(?:tokens?\s*)?received/i);
    if (sentRecv) {
      input = num(sentRecv[1]);
      output = num(sentRecv[2]);
      found = true;
    }
  }
  // Отрицательный lookahead отсекает сокращения вида «1.2k», где целое число — лишь префикс.
  const totalMatch = t.match(/(?:total\s+)?tokens?\s*(?:used|total)?\s*[:=]\s*([\d,]{1,12})(?![.,]?\d*\s*[kKmM])/i);
  if (totalMatch) {
    total = num(totalMatch[1]);
    found = true;
  }
  if (!found) return null;
  if (!input && !output && total) {
    // Известен только итог — считаем всё входом, стоимость будет консервативной.
    input = total;
  }
  return withTotal({
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costSource: 'unknown'
  });
}

export function formatUsd(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatTokens(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}
