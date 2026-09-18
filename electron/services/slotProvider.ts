/**
 * Провайдер LLM для слота Swarm, роли и ревьюера Arena (TASK-70.5, decision-40).
 *
 * Слот, роль и ревьюер задают провайдера одним из трёх способов:
 * - профилем OpenAI-совместимого провайдера ([[decision-39]]) — адрес, ключ и флаги берутся из профиля;
 * - прежним провайдером (`anthropic`, `openrouter`, `deepseek`, `ollama`, `custom`) — ключ у такого
 *   провайдера один, он хранится в настройках AI Studio, поэтому работает только тот, что там выбран;
 * - ничем — тогда используются настройки AI Studio пользователя.
 * Модели по умолчанию здесь нет ([[decision-26]] п. 0): пустая модель уходит дальше, и запрос
 * падает с понятной ошибкой «Модель не выбрана».
 *
 * Чистый модуль без Electron — импортируется unit-тестами напрямую.
 */
import type { AIProviderConfig } from './aiAgentService.js';
import { normalizeReasoningEffort } from './reasoningEffort.js';

export type ProviderId = AIProviderConfig['provider'];

export const PROFILE_PROVIDER: ProviderId = 'openai-compatible';

/** Провайдеры до профилей: ключ и адрес — из настроек AI Studio. */
export const LEGACY_PROVIDERS: readonly ProviderId[] = ['openrouter', 'deepseek', 'ollama', 'custom'];

const KNOWN_PROVIDERS: readonly ProviderId[] = ['anthropic', ...LEGACY_PROVIDERS, PROFILE_PROVIDER];

/** Провайдеры, которым ключ не нужен: можно использовать в слоте, даже если в AI Studio выбран другой. */
const KEYLESS_PROVIDERS: readonly ProviderId[] = ['ollama'];

/** Минимум сведений о профиле для разрешения ссылки. */
export interface ProfileRefEntry {
  id: string;
  name: string;
  local?: boolean;
}

/** Провайдер слота, роли или ревьюера, как его задал пользователь. */
export interface ProviderSpec {
  provider?: string;
  /** Профиль: id или имя (роли хранят имя — id профиля свой на каждой машине). */
  profile?: string;
  model?: string;
  temperature?: number;
}

/** Снимок провайдера, с которым агент реально работал, — для экспорта и UI (TASK-70.5). */
export interface ResolvedProviderInfo {
  provider: ProviderId;
  model?: string;
  profileId?: string;
  profileName?: string;
  local?: boolean;
}

export function isKnownProvider(value: string | undefined | null): value is ProviderId {
  return typeof value === 'string' && (KNOWN_PROVIDERS as readonly string[]).includes(value);
}

function clean(value: string | undefined | null): string | undefined {
  const v = typeof value === 'string' ? value.trim() : '';
  return v ? v : undefined;
}

/**
 * Профиль по ссылке: сначала точное совпадение id, затем имя без учёта регистра.
 *
 * @throws если профиль не найден или имя неоднозначно.
 */
export function resolveProfileRef(ref: string, profiles: readonly ProfileRefEntry[]): ProfileRefEntry {
  const needle = ref.trim();
  if (!needle) throw new Error('Профиль провайдера не указан.');
  const byId = profiles.find((p) => p.id === needle);
  if (byId) return byId;
  const lower = needle.toLocaleLowerCase();
  const byName = profiles.filter((p) => p.name.trim().toLocaleLowerCase() === lower);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new Error(`Имя профиля «${needle}» неоднозначно: таких профилей ${byName.length}. Переименуйте профили или укажите id.`);
  }
  throw new Error(
    `Профиль провайдера «${needle}» не найден. Создайте его в настройках AI Studio (OpenAI-compatible) или выберите другой.`
  );
}

/**
 * Конфиг провайдера из полей роли или ревьюера: `profile` важнее `provider`. Без полей — `undefined`
 * (настройки AI Studio). Роль с одной моделью наследует провайдера AI Studio, а не `anthropic`.
 */
export function providerConfigFromSpec(spec: ProviderSpec | undefined): Partial<AIProviderConfig> | undefined {
  if (!spec) return undefined;
  const profile = clean(spec.profile);
  const provider = clean(spec.provider);
  const model = clean(spec.model);
  const temperature = typeof spec.temperature === 'number' && Number.isFinite(spec.temperature) ? spec.temperature : undefined;
  if (!profile && !provider && !model) return undefined;
  const out: Partial<AIProviderConfig> = {};
  if (profile) {
    out.provider = PROFILE_PROVIDER;
    out.profileId = profile;
  } else if (provider) {
    if (!isKnownProvider(provider)) {
      throw new Error(`Неизвестный провайдер «${provider}». Допустимо: ${KNOWN_PROVIDERS.join(', ')}.`);
    }
    out.provider = provider;
  }
  if (model) out.model = model;
  if (temperature !== undefined) out.temperature = temperature;
  return out;
}

/**
 * Провайдер ревьюера Arena: провайдер или профиль из настроек ревьюера целиком заменяют провайдера
 * роли (смешивать профиль роли с провайдером настроек нельзя); модель — из настроек, а без своего
 * провайдера у ревьюера — затем из роли.
 */
export function reviewerProviderSpec(
  reviewer: ProviderSpec | undefined,
  role: ProviderSpec | undefined
): ProviderSpec {
  const ownTarget = Boolean(clean(reviewer?.profile) || clean(reviewer?.provider));
  const source = ownTarget ? reviewer : role;
  // Модель роли относится к провайдеру роли — со своим провайдером ревьюера она не берётся.
  const model = ownTarget ? clean(reviewer?.model) : clean(reviewer?.model) ?? clean(role?.model);
  return {
    ...(clean(source?.profile) ? { profile: clean(source?.profile) } : {}),
    ...(clean(source?.provider) ? { provider: clean(source?.provider) } : {}),
    ...(model ? { model } : {})
  };
}

function sameLegacyTarget(slot: Partial<AIProviderConfig>, global: AIProviderConfig): boolean {
  return slot.provider === global.provider;
}

/**
 * Итоговый конфиг запроса для слота/ревьюера.
 *
 * - нет настроек слота — настройки AI Studio;
 * - профиль — ссылка разрешается в id профиля, ключ возьмёт `llmProfileService`;
 * - провайдер не задан (только модель) — провайдер и ключ AI Studio, модель слота;
 * - прежний провайдер = провайдер AI Studio — ключ и адрес AI Studio, модель слота;
 * - прежний провайдер без ключа (Ollama) — адрес слота или AI Studio;
 * - иной прежний провайдер — ошибка: его ключа нет, молча подменять провайдера нельзя.
 *
 * Пустая модель слота (или `default`) заменяется моделью AI Studio только для того же провайдера или
 * профиля: модель другого провайдера была бы чужой.
 *
 * Усилие рассуждений слота важнее унаследованного. Слот «как в AI Studio» или только с моделью
 * наследует усилие AI Studio, слот с профилем или Ollama — только своё ([[decision-41]] п. 7).
 */
export function resolveSlotProviderConfig(
  slot: Partial<AIProviderConfig> | undefined,
  global: AIProviderConfig,
  profiles: readonly ProfileRefEntry[]
): { config: AIProviderConfig; info: ResolvedProviderInfo } {
  const resolved = resolveSlotTarget(slot, global, profiles);
  const effort = normalizeReasoningEffort(slot?.reasoningEffort);
  return effort ? { ...resolved, config: { ...resolved.config, reasoningEffort: effort } } : resolved;
}

function resolveSlotTarget(
  slot: Partial<AIProviderConfig> | undefined,
  global: AIProviderConfig,
  profiles: readonly ProfileRefEntry[]
): { config: AIProviderConfig; info: ResolvedProviderInfo } {
  if (!slot || (!slot.provider && !slot.profileId && !clean(slot.model))) {
    return withInfo(global, profiles);
  }

  const slotModel = clean(slot.model);
  const temperature = slot.temperature ?? undefined;

  if (slot.provider === PROFILE_PROVIDER || slot.profileId) {
    if (!slot.profileId) {
      throw new Error('У слота выбран OpenAI-совместимый провайдер, но не выбран профиль.');
    }
    const profile = resolveProfileRef(slot.profileId, profiles);
    // Та же пара «профиль AI Studio» — можно взять модель оттуда; иначе модель обязана быть у слота.
    const inheritModel = global.provider === PROFILE_PROVIDER && global.profileId === profile.id;
    const model = slotModel && !isDefaultAlias(slotModel) ? slotModel : inheritModel ? global.model : '';
    const config: AIProviderConfig = {
      provider: PROFILE_PROVIDER,
      profileId: profile.id,
      model,
      ...(temperature !== undefined ? { temperature } : {})
    };
    return { config, info: { provider: PROFILE_PROVIDER, model, profileId: profile.id, profileName: profile.name, ...(profile.local !== undefined ? { local: profile.local } : {}) } };
  }

  if (!slot.provider) {
    const config: AIProviderConfig = {
      ...global,
      model: slotModel ?? global.model,
      ...(temperature !== undefined ? { temperature } : {})
    };
    return withInfo(config, profiles);
  }

  if (sameLegacyTarget(slot, global)) {
    const config: AIProviderConfig = {
      ...global,
      model: slotModel && !isDefaultAlias(slotModel) ? slotModel : global.model,
      ...(temperature !== undefined ? { temperature } : {})
    };
    return withInfo(config, profiles);
  }

  if ((KEYLESS_PROVIDERS as readonly string[]).includes(slot.provider)) {
    const config: AIProviderConfig = {
      provider: slot.provider,
      model: slotModel && !isDefaultAlias(slotModel) ? slotModel : '',
      ...(clean(slot.baseUrl) ? { baseUrl: clean(slot.baseUrl) } : {}),
      ...(temperature !== undefined ? { temperature } : {})
    };
    return { config, info: { provider: config.provider, model: config.model, local: true } };
  }

  throw new Error(
    `Провайдер слота «${slot.provider}» отличается от провайдера AI Studio («${global.provider}»), а ключ хранится только ` +
      'для провайдера AI Studio. Создайте профиль OpenAI-совместимого провайдера и выберите его в слоте или роли.'
  );
}

function isDefaultAlias(model: string): boolean {
  return model === 'default';
}

function withInfo(config: AIProviderConfig, profiles: readonly ProfileRefEntry[]): { config: AIProviderConfig; info: ResolvedProviderInfo } {
  if (config.provider === PROFILE_PROVIDER && config.profileId) {
    const profile = profiles.find((p) => p.id === config.profileId);
    return {
      config,
      info: {
        provider: PROFILE_PROVIDER,
        model: config.model,
        profileId: config.profileId,
        ...(profile ? { profileName: profile.name } : {}),
        ...(profile?.local !== undefined ? { local: profile.local } : {})
      }
    };
  }
  return { config, info: { provider: config.provider, model: config.model, ...(config.provider === 'ollama' ? { local: true } : {}) } };
}

/**
 * Почему конфиг AI Studio не годится для API-пути (запасной путь CLI-движков), или `null`.
 * Проверяется до запроса, чтобы вместо молчаливого ухода к вендору была понятная причина.
 */
export function apiConfigProblem(config: AIProviderConfig): string | null {
  const model = clean(config.model);
  if (config.provider === 'anthropic') {
    if (!clean(config.apiKey)) return 'в AI Studio выбран Anthropic без API-ключа (API-путь требует ключ)';
    return null;
  }
  if (config.provider === PROFILE_PROVIDER && !clean(config.profileId)) {
    return 'в AI Studio выбран OpenAI-совместимый провайдер без профиля';
  }
  if (!model || isDefaultAlias(model)) return `в AI Studio не выбрана модель провайдера «${config.provider}»`;
  return null;
}

/** Короткая подпись провайдера для логов и экспорта: «профиль «Ollama» (локальная)» или «deepseek». */
export function describeProviderInfo(info: ResolvedProviderInfo | undefined): string {
  if (!info) return '—';
  if (info.provider === PROFILE_PROVIDER) {
    const name = info.profileName ?? info.profileId ?? '?';
    return `профиль «${name}»${info.local ? ' (локальная)' : ''}`;
  }
  return `${info.provider}${info.local ? ' (локальная)' : ''}`;
}
