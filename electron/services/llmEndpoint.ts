/**
 * Эндпоинт и заголовки OpenAI-совместимого провайдера (TASK-83).
 *
 * Вынесено из `aiAgentService`, где это было приватным методом без тестов: одним и тем же кодом
 * пользуются потоковый диалог AI Studio и одноразовый вызов модели (`aiAgentService.complete`),
 * который понадобился классификатору голосовых команд. Модуль намеренно принимает структурный
 * минимум полей, а не `AIProviderConfig`, — чтобы не заводить циклический импорт и остаться
 * чистым.
 *
 * Поведение сохранено ровно таким, каким оно было в `aiAgentService`, включая известные
 * шероховатости (`baseUrl` игнорируется для `openrouter` и `deepseek`) — их разбор относится к
 * универсальному провайдеру с профилями ([[decision-26]] п. 1, TASK-70), а не к этой задаче.
 *
 * Чистый модуль без Electron и сети — покрыт unit-тестами.
 */
import { providerConfigError } from './providerErrors.js';

export interface LlmEndpointConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ResolvedLlmEndpoint {
  endpoint: string;
  headers: Record<string, string>;
}

export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
export const CUSTOM_DEFAULT_ENDPOINT = 'http://localhost:8000/v1/chat/completions';

/**
 * Разрешает адрес и заголовки запроса.
 *
 * @throws если провайдеру нужен ключ, а он не задан.
 */
export function resolveOpenAICompatibleEndpoint(config: LlmEndpointConfig): ResolvedLlmEndpoint {
  let endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };

  const apiKey = config.apiKey?.trim();

  if (config.provider === 'openrouter') {
    if (!apiKey) {
      throw providerConfigError('API ключ OpenRouter не указан в настройках.', 'no_key', { provider: 'openrouter' });
    }
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['HTTP-Referer'] = 'https://projecthub.local';
    headers['X-Title'] = 'ProjectHub AI Studio';
  } else if (config.provider === 'deepseek') {
    if (!apiKey) {
      throw providerConfigError('API ключ DeepSeek не указан в настройках.', 'no_key', { provider: 'deepseek' });
    }
    endpoint = 'https://api.deepseek.com/chat/completions';
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (config.provider === 'ollama') {
    const base = (config.baseUrl || OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, '');
    endpoint = `${base}/v1/chat/completions`;
  } else if (config.provider === 'custom') {
    endpoint = config.baseUrl || CUSTOM_DEFAULT_ENDPOINT;
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return { endpoint, headers };
}
