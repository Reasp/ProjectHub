import { promises as fs } from 'fs';
import path from 'path';
import { BUILTIN_PRICE_TABLE, mergePriceTables, type PriceTable } from './agentCost.js';
import { parseOpenRouterModels, sanitizePriceOverrides, type OpenRouterImportResult, type PriceOverrides } from './agentPricing.js';
import { getUserDataDir } from './appPaths.js';

export const AGENT_PRICING_FILE = 'agent-pricing.json';
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_TIMEOUT_MS = 30_000;

export interface AgentPricingState {
  builtin: PriceTable;
  overrides: PriceOverrides;
  filePath: string;
  /** Файл есть, но не прочитан (битый JSON): переопределения не применяются, сохранение перезапишет файл. */
  loadError?: string;
}

/**
 * Таблица цен агентов (TASK-70.4, decision-42): встроенная + переопределения из
 * `<userData>/agent-pricing.json`. Один экземпляр на процесс для Swarm, AI Studio и Claude CLI,
 * чтобы стоимость везде считалась одинаково. После сохранения из UI кэш обновляется сразу,
 * перезапуск не нужен.
 */
export class PricingService {
  private table: PriceTable = BUILTIN_PRICE_TABLE;
  private overrides: PriceOverrides = { models: {} };
  private loadError: string | undefined;
  private loading: Promise<void> | null = null;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePathOverride?: string) {}

  get filePath(): string {
    return this.filePathOverride ?? path.join(getUserDataDir(), AGENT_PRICING_FILE);
  }

  /** Текущая таблица без ожидания: до первой загрузки — встроенная. */
  getTable(): PriceTable {
    return this.table;
  }

  /** Таблица с переопределениями; файл читается один раз, дальше — кэш. */
  async ensureLoaded(): Promise<PriceTable> {
    if (!this.loading) this.loading = this.load();
    await this.loading;
    return this.table;
  }

  /** Перечитать файл (например, после ручной правки). */
  async reload(): Promise<PriceTable> {
    this.loading = this.load();
    await this.loading;
    return this.table;
  }

  async getState(): Promise<AgentPricingState> {
    await this.ensureLoaded();
    return {
      builtin: BUILTIN_PRICE_TABLE,
      overrides: this.overrides,
      filePath: this.filePath,
      ...(this.loadError ? { loadError: this.loadError } : {})
    };
  }

  /** Сохраняет переопределения целиком (ввод из UI санируется) и сразу применяет их. */
  async saveOverrides(raw: unknown): Promise<AgentPricingState> {
    const run = this.writeChain.then(async () => {
      const overrides = sanitizePriceOverrides(raw);
      const data: PriceOverrides = { updatedAt: overrides.updatedAt ?? new Date().toISOString().slice(0, 10), models: overrides.models };
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
      await fs.rename(tmp, this.filePath);
      this.apply(data);
      this.loadError = undefined;
      this.loading = Promise.resolve();
      console.log(`[PricingService] Сохранены переопределения цен: ${Object.keys(data.models).length} моделей`);
    });
    this.writeChain = run.catch(() => undefined);
    await run;
    return this.getState();
  }

  /**
   * Список цен OpenRouter (`GET /api/v1/models`, ключ не нужен). Только по кнопке пользователя:
   * сеть не трогается при старте и расчёте стоимости (decision-7, decision-42). Ничего не пишет —
   * выбранные цены сохраняются отдельным `saveOverrides`.
   */
  async fetchOpenRouterPrices(fetchImpl: typeof fetch = fetch): Promise<OpenRouterImportResult> {
    const response = await fetchImpl(OPENROUTER_MODELS_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS)
    });
    if (!response.ok) {
      throw new Error(`OpenRouter ответил ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return parseOpenRouterModels(await response.json());
  }

  private apply(overrides: PriceOverrides): void {
    this.overrides = overrides;
    this.table = mergePriceTables(BUILTIN_PRICE_TABLE, overrides);
  }

  private async load(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[PricingService] Не удалось прочитать agent-pricing.json, используются встроенные цены:', err);
        this.loadError = err instanceof Error ? err.message : String(err);
      }
      this.apply({ models: {} });
      return;
    }
    try {
      this.apply(sanitizePriceOverrides(JSON.parse(raw)));
      this.loadError = undefined;
      console.log(`[PricingService] Загружены переопределения цен: ${Object.keys(this.overrides.models).length} моделей`);
    } catch (err) {
      console.warn('[PricingService] agent-pricing.json не разобран, используются встроенные цены:', err);
      this.loadError = err instanceof Error ? err.message : String(err);
      this.apply({ models: {} });
    }
  }
}

export const pricingService = new PricingService();
