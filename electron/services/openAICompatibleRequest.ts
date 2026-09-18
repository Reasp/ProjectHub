/**
 * Сборка тела потокового запроса Chat Completions для OpenAI-совместимых провайдеров
 * (OpenRouter, DeepSeek, Ollama, custom) — TASK-92, [[decision-38]].
 *
 * Вынесено из `aiAgentService.requestOpenAICompatible`, где тело собиралось inline с тремя
 * дефектами: вендорский fallback модели `deepseek/deepseek-chat`, `temperature: 0.7` в каждом
 * запросе и игнорируемый `AIStreamRequest.maxTokens`. Здесь, по образцу `anthropicRequest.ts`:
 *
 * - модель обязательна — вендорского дефолта нет ([[decision-26]] п. 0);
 * - `temperature` и `max_tokens` отправляются, только если их явно задали: иначе действуют
 *   значения модели и провайдера (потолок ответа разных моделей не известен до TASK-70).
 *
 * Чистый модуль без Electron и сети — покрыт unit-тестами.
 */
import { isUnsetModelId } from './anthropicRequest.js';

export interface OpenAICompatibleBodyInput {
  /** Провайдер из настроек: от него зависят поля учёта usage. */
  provider: string;
  model: string | undefined | null;
  messages: unknown[];
  tools?: unknown[];
  /** Без значения параметр не отправляется — действует значение модели. */
  temperature?: number;
  /** Без значения параметр не отправляется — действует потолок провайдера. */
  maxTokens?: number;
}

/**
 * Идентификатор модели для запроса.
 *
 * @throws если модель не выбрана — молча подставлять модель вендора нельзя.
 */
export function resolveOpenAICompatibleModelId(model: string | undefined | null, provider: string): string {
  if (isUnsetModelId(model)) {
    throw new Error(
      `Модель не выбрана: укажите идентификатор модели провайдера ${provider} в настройках AI Studio или в слоте агента.`
    );
  }
  return (model as string).trim();
}

/** Тело запроса; `model` — уже проверенный идентификатор (для сообщений об ошибках и учёта usage). */
export type OpenAICompatibleChatBody = Record<string, unknown> & { model: string };

export function buildOpenAICompatibleChatBody(input: OpenAICompatibleBodyInput): OpenAICompatibleChatBody {
  const body: OpenAICompatibleChatBody = {
    model: resolveOpenAICompatibleModelId(input.model, input.provider),
    messages: input.messages,
    stream: true
  };
  if (typeof input.temperature === 'number' && Number.isFinite(input.temperature)) {
    body.temperature = input.temperature;
  }
  if (typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens) && input.maxTokens > 0) {
    body.max_tokens = Math.floor(input.maxTokens);
  }
  if (input.tools && input.tools.length > 0) {
    body.tools = input.tools;
  }
  // Usage в последнем чанке стрима — для учёта стоимости (TASK-56). Ollama поле не понимает.
  if (input.provider !== 'ollama') {
    body.stream_options = { include_usage: true };
  }
  if (input.provider === 'openrouter') {
    body.usage = { include: true };
  }
  return body;
}
