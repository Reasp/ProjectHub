import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { llmProfileService, type LlmProfileService } from './llmProfileService.js';
import { buildProfileHeaders, modelsUrl } from './llmProfiles.js';
import { isCatalogFresh, parseModelList, type ModelCatalogEntry, type ModelCatalogResult } from './llmModelCatalog.js';

/** Сколько ждать ответа `/models`: локальный сервер отвечает мгновенно, облачный — за секунды. */
const CATALOG_FETCH_TIMEOUT_MS = 15_000;

/**
 * Каталог моделей профилей с кэшем в `~/.projecthub/llm-model-catalog.json` (TASK-70.2,
 * [[decision-39]]). Ошибка сервера не стирает прежний список — он возвращается вместе с ошибкой.
 */
export class LlmModelCatalogService {
  private cache: Record<string, ModelCatalogEntry> | null = null;

  constructor(
    private readonly profiles: LlmProfileService = llmProfileService,
    private readonly filePath = path.join(os.homedir(), '.projecthub', 'llm-model-catalog.json'),
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)
  ) {}

  private async loadCache(): Promise<Record<string, ModelCatalogEntry>> {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf-8'));
      this.cache = parsed && typeof parsed === 'object' ? (parsed as Record<string, ModelCatalogEntry>) : {};
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private async saveCache(): Promise<void> {
    if (!this.cache) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8');
  }

  public async listModels(profileId: string, options: { refresh?: boolean } = {}): Promise<ModelCatalogResult> {
    const { profile, apiKey } = await this.profiles.getProfileWithKey(profileId);
    const cache = await this.loadCache();
    const entry = cache[profileId];
    if (!options.refresh && isCatalogFresh(entry, profile.baseUrl, Date.now())) {
      return { models: entry.models, fetchedAt: entry.fetchedAt, cached: true };
    }

    // Прежний список годится как запасной, только если он получен с того же адреса.
    const fallback = entry && entry.baseUrl === profile.baseUrl ? entry : undefined;
    try {
      const response = await this.fetchImpl(modelsUrl(profile.baseUrl), {
        method: 'GET',
        headers: buildProfileHeaders(profile, apiKey),
        signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS)
      });
      if (!response.ok) {
        throw new Error(`сервер ответил ${response.status}: ${(await response.text()).slice(0, 300)}`);
      }
      const models = parseModelList(await response.json());
      const fresh: ModelCatalogEntry = { baseUrl: profile.baseUrl, models, fetchedAt: Date.now() };
      cache[profileId] = fresh;
      await this.saveCache().catch((err) => console.warn('[LlmModelCatalog] Кэш не сохранён:', err));
      return { models, fetchedAt: fresh.fetchedAt, cached: false };
    } catch (err) {
      const reason = err instanceof Error ? (err.name === 'TimeoutError' ? `нет ответа за ${CATALOG_FETCH_TIMEOUT_MS / 1000} с` : err.message) : String(err);
      return {
        models: fallback?.models ?? [],
        fetchedAt: fallback?.fetchedAt ?? null,
        cached: Boolean(fallback),
        error: `Не удалось получить список моделей профиля «${profile.name}» (${profile.baseUrl}): ${reason}`
      };
    }
  }

  /** Кэш удалённого профиля больше не нужен. */
  public async forget(profileId: string): Promise<void> {
    const cache = await this.loadCache();
    if (!(profileId in cache)) return;
    delete cache[profileId];
    await this.saveCache();
  }
}

export const llmModelCatalogService = new LlmModelCatalogService();
