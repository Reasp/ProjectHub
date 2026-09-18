/**
 * Профили OpenAI-совместимых провайдеров (TASK-70.1, [[decision-39]], [[decision-26]] п. 1).
 *
 * Профиль — это адрес сервера Chat Completions, ключ и флаги совместимости: чем конкретный сервер
 * отличается от эталонного OpenAI API. Пресеты — стартовые значения для известных сервисов и
 * локальных серверов; после создания профиль редактируется целиком, пресет его не ограничивает.
 * Модели в пресетах нет: модель выбирает пользователь (decision-26 п. 0).
 *
 * Флаги пресетов взяты из публичной документации сервисов и вживую проверены не все (см. TASK-70.1):
 * консервативные значения (`streamUsage: false`) безопаснее — лишний параметр часть серверов
 * отклоняет с 400/422, а без usage стоимость просто считается неизвестной.
 *
 * Чистый модуль без Electron и сети — покрыт unit-тестами.
 */

/** Как сервер принимает усилие рассуждений (используется в TASK-70.3). */
export type LlmReasoningStyle = 'none' | 'reasoning_effort' | 'reasoning_object' | 'ollama_think';

export interface LlmCompatFlags {
  /** Вызов инструментов (`tools`). Без него режим агента для профиля недоступен. */
  tools: boolean;
  /**
   * Изображения из результатов инструментов (скриншоты computer use). Зависит от модели, а не от
   * сервиса, поэтому во всех пресетах выключено: включает пользователь для vision-модели.
   */
  vision: boolean;
  /** `stream_options: { include_usage: true }` — usage в последнем чанке стрима. */
  streamUsage: boolean;
  /** `usage: { include: true }` — стоимость в ответе OpenRouter. */
  openRouterUsage: boolean;
  /** Поле потолка ответа: новые модели OpenAI принимают только `max_completion_tokens`. */
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
  /** Формат усилия рассуждений. */
  reasoning: LlmReasoningStyle;
  /** `response_format` (JSON-режим). */
  responseFormat: boolean;
}

export interface LlmProviderPreset {
  id: string;
  name: string;
  /** Базовый адрес API: к нему добавляются `/chat/completions` и `/models`. */
  baseUrl: string;
  requiresApiKey: boolean;
  /** Сервер работает на машине пользователя — модели считаются по нулевой цене (TASK-70.4). */
  local: boolean;
  compat: LlmCompatFlags;
  /** Дополнительные заголовки сервиса. */
  headers?: Record<string, string>;
}

export interface LlmProfile {
  id: string;
  name: string;
  presetId: string;
  baseUrl: string;
  local: boolean;
  compat: LlmCompatFlags;
  headers?: Record<string, string>;
}

/** Профиль для renderer: вместо ключа — только признак его наличия. */
export interface LlmProfileView extends LlmProfile {
  hasApiKey: boolean;
}

export const CUSTOM_PRESET_ID = 'custom';

const BASE_COMPAT: LlmCompatFlags = {
  tools: true,
  vision: false,
  streamUsage: false,
  openRouterUsage: false,
  maxTokensField: 'max_tokens',
  reasoning: 'none',
  responseFormat: false
};

function compat(overrides: Partial<LlmCompatFlags>): LlmCompatFlags {
  return { ...BASE_COMPAT, ...overrides };
}

export const LLM_PROVIDER_PRESETS: readonly LlmProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
    local: false,
    compat: compat({
      streamUsage: true,
      maxTokensField: 'max_completion_tokens',
      reasoning: 'reasoning_effort',
      responseFormat: true
    })
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
    local: false,
    compat: compat({
      streamUsage: true,
      openRouterUsage: true,
      reasoning: 'reasoning_object',
      responseFormat: true
    }),
    headers: { 'HTTP-Referer': 'https://projecthub.local', 'X-Title': 'ProjectHub AI Studio' }
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    requiresApiKey: true,
    local: false,
    compat: compat({ streamUsage: true, responseFormat: true })
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    requiresApiKey: true,
    local: false,
    compat: compat({ responseFormat: true })
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    requiresApiKey: true,
    local: false,
    compat: compat({ responseFormat: true })
  },
  {
    id: 'xai',
    name: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    requiresApiKey: true,
    local: false,
    compat: compat({ streamUsage: true, reasoning: 'reasoning_effort', responseFormat: true })
  },
  {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    requiresApiKey: true,
    local: false,
    compat: compat({ responseFormat: true })
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    requiresApiKey: true,
    local: false,
    compat: compat({ responseFormat: true })
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    requiresApiKey: false,
    local: true,
    compat: compat({})
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    requiresApiKey: false,
    local: true,
    compat: compat({})
  },
  {
    id: 'vllm',
    name: 'vLLM',
    baseUrl: 'http://127.0.0.1:8000/v1',
    requiresApiKey: false,
    local: true,
    compat: compat({ streamUsage: true })
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp server',
    baseUrl: 'http://127.0.0.1:8080/v1',
    requiresApiKey: false,
    local: true,
    compat: compat({})
  },
  {
    id: 'jan',
    name: 'Jan',
    baseUrl: 'http://127.0.0.1:1337/v1',
    requiresApiKey: false,
    local: true,
    compat: compat({})
  },
  {
    id: CUSTOM_PRESET_ID,
    name: 'Custom',
    baseUrl: '',
    requiresApiKey: false,
    local: false,
    compat: compat({})
  }
];

export function getPreset(presetId: string | undefined | null): LlmProviderPreset {
  return LLM_PROVIDER_PRESETS.find((p) => p.id === presetId) ?? LLM_PROVIDER_PRESETS.find((p) => p.id === CUSTOM_PRESET_ID)!;
}

/** Адрес указывает на эту машину: localhost, 127.0.0.0/8, ::1. */
export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '::1' || /^127\./.test(host);
  } catch {
    return false;
  }
}

/**
 * Нормализует базовый адрес: без хвостовых `/` и без случайно вставленного `/chat/completions`.
 *
 * @throws если адрес не http(s).
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Некорректный адрес сервера: «${raw}». Нужен http(s)-адрес вида https://api.example.com/v1.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Некорректный адрес сервера: «${raw}». Поддерживаются только http и https.`);
  }
  return trimmed;
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

export function modelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/models`;
}

const MAX_PROFILE_NAME = 80;

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeCompat(raw: unknown, fallback: LlmCompatFlags): LlmCompatFlags {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof LlmCompatFlags, unknown>>;
  const reasoningValues: LlmReasoningStyle[] = ['none', 'reasoning_effort', 'reasoning_object', 'ollama_think'];
  return {
    tools: asBool(r.tools, fallback.tools),
    vision: asBool(r.vision, fallback.vision),
    streamUsage: asBool(r.streamUsage, fallback.streamUsage),
    openRouterUsage: asBool(r.openRouterUsage, fallback.openRouterUsage),
    maxTokensField:
      r.maxTokensField === 'max_tokens' || r.maxTokensField === 'max_completion_tokens' ? r.maxTokensField : fallback.maxTokensField,
    reasoning: reasoningValues.includes(r.reasoning as LlmReasoningStyle) ? (r.reasoning as LlmReasoningStyle) : fallback.reasoning,
    responseFormat: asBool(r.responseFormat, fallback.responseFormat)
  };
}

function normalizeHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    // Имя заголовка — токен RFC 9110; перевод строки в значении открыл бы подмену заголовков.
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(key) || typeof v !== 'string' || /[\r\n]/.test(v)) continue;
    if (key.toLowerCase() === 'authorization') continue; // ключ задаётся отдельным полем и хранится зашифрованным
    out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Проверяет и дополняет профиль из хранилища или из формы. Флаги, которых нет, берутся из пресета.
 *
 * @throws если нет id, имени или корректного адреса.
 */
export function normalizeProfile(raw: unknown): LlmProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error('Некорректный идентификатор профиля.');
  }
  const preset = getPreset(typeof r.presetId === 'string' ? r.presetId : undefined);
  const name = (typeof r.name === 'string' ? r.name.trim() : '').slice(0, MAX_PROFILE_NAME) || preset.name;
  const baseUrl = normalizeBaseUrl(typeof r.baseUrl === 'string' && r.baseUrl.trim() ? r.baseUrl : preset.baseUrl);
  const headers = normalizeHeaders(r.headers);
  return {
    id,
    name,
    presetId: preset.id,
    baseUrl,
    local: asBool(r.local, isLocalBaseUrl(baseUrl)),
    compat: normalizeCompat(r.compat, preset.compat),
    ...(headers ? { headers } : {})
  };
}

/** Новый профиль из пресета: адрес, флаги и признак «локальный» — из пресета. */
export function profileFromPreset(presetId: string, id: string, name?: string): LlmProfile {
  const preset = getPreset(presetId);
  return {
    id,
    name: name?.trim() || preset.name,
    presetId: preset.id,
    baseUrl: preset.baseUrl,
    local: preset.local,
    compat: { ...preset.compat },
    ...(preset.headers ? { headers: { ...preset.headers } } : {})
  };
}

/**
 * Заголовки запроса к серверу профиля.
 *
 * @throws если пресету нужен ключ, а его нет.
 */
export function buildProfileHeaders(profile: LlmProfile, apiKey: string | undefined): Record<string, string> {
  const key = apiKey?.trim();
  if (!key && getPreset(profile.presetId).requiresApiKey) {
    throw new Error(`API ключ не указан в профиле «${profile.name}».`);
  }
  return {
    ...(profile.headers ?? {}),
    'content-type': 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {})
  };
}

/**
 * Флаги совместимости прежних провайдеров `openrouter`/`deepseek`/`ollama`/`custom`: ровно то
 * поведение, которое было зашито в код до профилей (TASK-56, TASK-92).
 */
export function legacyProviderCompat(provider: string): LlmCompatFlags {
  return {
    ...BASE_COMPAT,
    streamUsage: provider !== 'ollama',
    openRouterUsage: provider === 'openrouter'
  };
}
