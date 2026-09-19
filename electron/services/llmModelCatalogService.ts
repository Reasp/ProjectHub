import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { llmProfileService, type LlmProfileService } from './llmProfileService.js';
import { buildProfileHeaders, modelsUrl } from './llmProfiles.js';
import { isCatalogFresh, parseModelList, type ModelCatalogEntry, type ModelCatalogResult } from './llmModelCatalog.js';
import {
  ProviderError,
  classifyHttpError,
  providerErrorAdviceRu,
  providerErrorWhatRu,
  secretsFromHeaders,
  toProviderErrorInfo,
  type ProviderErrorContext
} from './providerErrors.js';

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
    const errorContext: ProviderErrorContext = {
      provider: profile.name,
      profileId: profile.id,
      endpoint: modelsUrl(profile.baseUrl),
      local: profile.local,
      secrets: apiKey ? [apiKey] : []
    };
    try {
      // Заголовки — внутри try: профиль без обязательного ключа даёт ошибку каталога, а не исключение.
      const headers = buildProfileHeaders(profile, apiKey);
      errorContext.secrets = [...(errorContext.secrets ?? []), ...secretsFromHeaders(headers)];
      const response = await this.fetchImpl(modelsUrl(profile.baseUrl), {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS)
      });
      if (!response.ok) {
        throw new ProviderError(classifyHttpError({ status: response.status, body: await response.text(), headers: response.headers }, errorContext));
      }
      const models = parseModelList(await response.json());
      const fresh: ModelCatalogEntry = { baseUrl: profile.baseUrl, models, fetchedAt: Date.now() };
      cache[profileId] = fresh;
      await this.saveCache().catch((err) => console.warn('[LlmModelCatalog] Кэш не сохранён:', err));
      return { models, fetchedAt: fresh.fetchedAt, cached: false };
    } catch (err) {
      // Вид ошибки — тем же классификатором, что и запросы к модели (decision-43): «fetch failed»
      // превращается в «сервер не принимает подключения (ECONNREFUSED)» с советом.
      const info = toProviderErrorInfo(err, errorContext);
      let reason: string;
      if (!info) {
        reason = String(err);
      } else if (info.kind === 'unknown') {
        reason = info.message;
      } else {
        const tech = info.status !== undefined ? `HTTP ${info.status}` : info.code ?? '';
        const detail = info.reason === 'timeout' ? `нет ответа за ${CATALOG_FETCH_TIMEOUT_MS / 1000} с` : info.serverMessage;
        const advice = providerErrorAdviceRu(info);
        reason = `${providerErrorWhatRu(info)}${tech ? ` (${tech})` : ''}${detail ? `: ${detail}` : ''}.${advice ? ` ${advice}` : ''}`;
      }
      return {
        models: fallback?.models ?? [],
        fetchedAt: fallback?.fetchedAt ?? null,
        cached: Boolean(fallback),
        error: `Не удалось получить список моделей профиля «${profile.name}» (${profile.baseUrl}): ${reason}`
      };
    }
  }

  /**
   * Модели из кэша каталогов без обращения к серверам (первичное заполнение тиров, decision-44 п. 3):
   * id профиля → список моделей. Устаревший кэш тоже годится — это подсказка, а не проверка.
   */
  public async cachedModels(): Promise<Record<string, string[]>> {
    const cache = await this.loadCache();
    const out: Record<string, string[]> = {};
    for (const [profileId, entry] of Object.entries(cache)) {
      if (entry && Array.isArray(entry.models)) out[profileId] = entry.models.filter((m): m is string => typeof m === 'string');
    }
    return out;
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
