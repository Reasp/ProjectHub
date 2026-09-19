import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { secretStorageService } from './secretStorageService.js';
import { providerConfigError } from './providerErrors.js';
import {
  buildProfileHeaders,
  chatCompletionsUrl,
  normalizeProfile,
  type LlmCompatFlags,
  type LlmProfile,
  type LlmProfileView
} from './llmProfiles.js';

/**
 * Хранилище профилей OpenAI-совместимых провайдеров (TASK-70.1, [[decision-39]]).
 *
 * Файл `~/.projecthub/llm-profiles.json` лежит рядом с `ai-config.json` (там же и под той же
 * изоляцией тестов, decision-29). Ключ хранится зашифрованным `secretStorageService` и наружу
 * (в renderer) не отдаётся: `listProfiles` возвращает только `hasApiKey`.
 */

interface StoredProfile extends LlmProfile {
  /** Зашифрованный ключ (`enc_v1:…`) или открытый, если шифрование ОС недоступно. */
  apiKey?: string;
}

interface ProfilesFile {
  version: 1;
  profiles: StoredProfile[];
}

export interface SaveLlmProfileInput {
  profile: unknown;
  /** `undefined` — оставить прежний ключ, пустая строка или `null` — удалить, строка — задать. */
  apiKey?: string | null;
}

export interface LlmRequestTarget {
  profile: LlmProfile;
  endpoint: string;
  headers: Record<string, string>;
  compat: LlmCompatFlags;
}

function toView(p: StoredProfile): LlmProfileView {
  const { apiKey, ...rest } = p;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

export class LlmProfileService {
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath = path.join(os.homedir(), '.projecthub', 'llm-profiles.json')) {}

  private async readFile(): Promise<ProfilesFile> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, profiles: [] };
      throw err;
    }
    const parsed = JSON.parse(raw) as { profiles?: unknown };
    const profiles: StoredProfile[] = [];
    for (const item of Array.isArray(parsed.profiles) ? parsed.profiles : []) {
      try {
        const profile = normalizeProfile(item);
        const apiKey = (item as { apiKey?: unknown }).apiKey;
        profiles.push(typeof apiKey === 'string' && apiKey ? { ...profile, apiKey } : profile);
      } catch (err) {
        // Один испорченный профиль не должен лишать пользователя остальных.
        console.warn('[LlmProfileService] Пропущен некорректный профиль:', err instanceof Error ? err.message : err);
      }
    }
    return { version: 1, profiles };
  }

  private async writeFile(data: ProfilesFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tmp, this.filePath);
  }

  /** Изменения файла выполняются строго по очереди: параллельные сохранения не теряют друг друга. */
  private mutate<T>(fn: (data: ProfilesFile) => T): Promise<T> {
    const run = this.writeChain.then(async () => {
      const data = await this.readFile();
      const result = fn(data);
      await this.writeFile(data);
      return result;
    });
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  public async listProfiles(): Promise<LlmProfileView[]> {
    const { profiles } = await this.readFile();
    return profiles.map(toView);
  }

  public async saveProfile(input: SaveLlmProfileInput): Promise<LlmProfileView> {
    const profile = normalizeProfile(input.profile);
    return this.mutate((data) => {
      const idx = data.profiles.findIndex((p) => p.id === profile.id);
      const prevKey = idx >= 0 ? data.profiles[idx].apiKey : undefined;
      let apiKey = prevKey;
      if (input.apiKey === null || input.apiKey === '') apiKey = undefined;
      else if (typeof input.apiKey === 'string') apiKey = secretStorageService.encrypt(input.apiKey.trim());
      const stored: StoredProfile = apiKey ? { ...profile, apiKey } : profile;
      if (idx >= 0) data.profiles[idx] = stored;
      else data.profiles.push(stored);
      return toView(stored);
    });
  }

  public async deleteProfile(id: string): Promise<boolean> {
    return this.mutate((data) => {
      const before = data.profiles.length;
      data.profiles = data.profiles.filter((p) => p.id !== id);
      return data.profiles.length !== before;
    });
  }

  /** Профиль с расшифрованным ключом — только для main-процесса. */
  public async getProfileWithKey(id: string | undefined): Promise<{ profile: LlmProfile; apiKey?: string }> {
    if (!id) {
      throw providerConfigError('Профиль OpenAI-совместимого провайдера не выбран в настройках.', 'no_profile');
    }
    const { profiles } = await this.readFile();
    const stored = profiles.find((p) => p.id === id);
    if (!stored) {
      throw providerConfigError(`Профиль провайдера «${id}» не найден: возможно, он удалён. Выберите профиль в настройках AI Studio.`, 'no_profile');
    }
    const { apiKey, ...profile } = stored;
    return { profile, ...(apiKey ? { apiKey: secretStorageService.decrypt(apiKey) } : {}) };
  }

  /** Адрес Chat Completions, заголовки и флаги для запроса через профиль. */
  public async resolveRequestTarget(id: string | undefined): Promise<LlmRequestTarget> {
    const { profile, apiKey } = await this.getProfileWithKey(id);
    return {
      profile,
      endpoint: chatCompletionsUrl(profile.baseUrl),
      headers: buildProfileHeaders(profile, apiKey),
      compat: profile.compat
    };
  }
}

export const llmProfileService = new LlmProfileService();
