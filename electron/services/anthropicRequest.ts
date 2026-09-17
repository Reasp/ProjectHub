/**
 * Сборка тела потокового запроса к Anthropic Messages API (TASK-88, [[decision-33]]).
 *
 * Вынесено из `aiAgentService.requestAnthropic`, где тело собиралось inline с тремя дефектами:
 * захардкоженный `max_tokens: 4096`, extended thinking только для `claude-3-7-*` (по подстроке
 * имени) и `temperature: 0.7`, подставляемая в ветке «без thinking». Здесь:
 *
 * - модель обязательна — вендорского дефолта нет ([[decision-26]] п. 0);
 * - режим рассуждений выбирается по возможностям модели из Models API
 *   (`capabilities.thinking.types`), а не по имени;
 * - `temperature` отправляется, только если её явно задали, модель её принимает и thinking в
 *   запросе не включён — остальные случаи API отклоняет с 400.
 *
 * Чистый модуль без Electron и сети — покрыт unit-тестами.
 */

/** Потолок ответа по умолчанию для потокового пути: стрим не упирается в HTTP-таймауты. */
export const DEFAULT_STREAM_MAX_TOKENS = 64_000;

/** Минимальный `budget_tokens` для `thinking.type: "enabled"` — меньшие значения API отклоняет. */
export const MIN_THINKING_BUDGET_TOKENS = 1024;

/**
 * Значения, означающие «модель не выбрана». `default` — сентинел Claude CLI (`claudeBridgeService`
 * в этом случае не передаёт `--model`), для Messages API он не является идентификатором модели.
 */
const UNSET_MODEL_IDS = new Set(['', 'default']);

/** Возможности модели, известные из Models API. `null` — неизвестно (запрос не удался). */
export interface AnthropicModelCapabilities {
  thinking: { adaptive: boolean; enabled: boolean } | null;
  maxOutputTokens: number | null;
}

export const UNKNOWN_MODEL_CAPABILITIES: AnthropicModelCapabilities = { thinking: null, maxOutputTokens: null };

export function isUnsetModelId(model: string | undefined | null): boolean {
  return UNSET_MODEL_IDS.has((model ?? '').trim());
}

/**
 * Идентификатор модели для запроса.
 *
 * @throws если модель не выбрана — молча подставлять модель вендора нельзя.
 */
export function resolveAnthropicModelId(model: string | undefined | null): string {
  if (isUnsetModelId(model)) {
    throw new Error(
      'Модель не выбрана: укажите идентификатор модели Anthropic в настройках AI Studio или в слоте агента '
      + '(значение «default» понимает только Claude CLI).'
    );
  }
  return (model as string).trim();
}

function supportedLeaf(node: unknown): boolean {
  return typeof node === 'object' && node !== null && (node as { supported?: unknown }).supported === true;
}

/** Разбирает ответ `GET /v1/models/{id}`. Отсутствующие поля трактуются как «неизвестно», а не «нет». */
export function parseAnthropicModelCapabilities(payload: unknown): AnthropicModelCapabilities {
  if (typeof payload !== 'object' || payload === null) return UNKNOWN_MODEL_CAPABILITIES;
  const info = payload as { capabilities?: unknown; max_tokens?: unknown };

  let thinking: AnthropicModelCapabilities['thinking'] = null;
  const caps = info.capabilities as { thinking?: { supported?: unknown; types?: Record<string, unknown> } } | null | undefined;
  if (caps && typeof caps === 'object' && caps.thinking && typeof caps.thinking === 'object') {
    const supported = caps.thinking.supported === true;
    const types = caps.thinking.types ?? {};
    thinking = {
      adaptive: supported && supportedLeaf(types.adaptive),
      enabled: supported && supportedLeaf(types.enabled)
    };
  }

  // Поле бывает null или 0, если значение не опубликовано.
  const maxOutputTokens =
    typeof info.max_tokens === 'number' && Number.isFinite(info.max_tokens) && info.max_tokens > 0
      ? Math.floor(info.max_tokens)
      : null;

  return { thinking, maxOutputTokens };
}

/**
 * Принимает ли модель `temperature`.
 *
 * Models API этот признак не публикует, поэтому здесь allow-список: семейства, выпущенные до
 * отказа от sampling-параметров (Opus 4.7). На Opus 4.7/4.8/5, Sonnet 5, Fable и Mythos
 * нестандартная `temperature` даёт 400 в любом запросе. Список закрытый — новые модели его не
 * пополнят, а неизвестная модель безопасно получает запрос без `temperature`.
 */
export function modelAcceptsTemperature(modelId: string): boolean {
  const id = modelId.trim();
  return /^claude-3/.test(id) || /^claude-(opus|sonnet|haiku)-4(?:-[0-6])?(?:-\d{8}|-latest)?$/.test(id);
}

export interface AnthropicBodyInput {
  model: string;
  system: string;
  messages: unknown[];
  tools?: unknown[];
  /** Потолок ответа; по умолчанию `DEFAULT_STREAM_MAX_TOKENS`, ограничивается потолком модели. */
  maxTokens?: number;
  /** Без значения параметр не отправляется — действует значение модели. */
  temperature?: number;
  /** > 0 — включить рассуждения; 0 или нет значения — режим модели по умолчанию. */
  thinkingBudget?: number;
}

export interface AnthropicBodyResult {
  body: Record<string, unknown>;
  /** Что из настроек не попало в запрос и почему — для лога. */
  notes: string[];
}

function positiveInt(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function buildAnthropicMessagesBody(
  input: AnthropicBodyInput,
  capabilities: AnthropicModelCapabilities
): AnthropicBodyResult {
  const model = resolveAnthropicModelId(input.model);
  const notes: string[] = [];

  let maxTokens = positiveInt(input.maxTokens) ?? DEFAULT_STREAM_MAX_TOKENS;
  if (capabilities.maxOutputTokens !== null && maxTokens > capabilities.maxOutputTokens) {
    maxTokens = capabilities.maxOutputTokens;
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system: input.system,
    messages: input.messages,
    stream: true
  };
  if (input.tools && input.tools.length > 0) {
    body.tools = input.tools;
  }

  const budget = positiveInt(input.thinkingBudget);
  let thinkingSent = false;
  if (budget !== undefined) {
    if (capabilities.thinking === null) {
      notes.push(`thinking не отправлен: возможности модели «${model}» неизвестны (Models API недоступен)`);
    } else if (capabilities.thinking.adaptive) {
      // Бюджет токенов на adaptive-моделях не применяется (budget_tokens там отклоняется или устарел);
      // summarized — чтобы рассуждения было что показать в интерфейсе.
      body.thinking = { type: 'adaptive', display: 'summarized' };
      thinkingSent = true;
    } else if (capabilities.thinking.enabled) {
      // budget_tokens должен быть не меньше минимума и строго меньше max_tokens.
      const budgetTokens = Math.min(Math.max(budget, MIN_THINKING_BUDGET_TOKENS), maxTokens - 1);
      if (budgetTokens >= MIN_THINKING_BUDGET_TOKENS) {
        body.thinking = { type: 'enabled', budget_tokens: budgetTokens };
        thinkingSent = true;
      } else {
        notes.push(`thinking не отправлен: max_tokens ${maxTokens} не оставляет места для бюджета рассуждений`);
      }
    } else {
      notes.push(`thinking не отправлен: модель «${model}» не поддерживает рассуждения`);
    }
  }

  if (typeof input.temperature === 'number' && Number.isFinite(input.temperature)) {
    if (!modelAcceptsTemperature(model)) {
      notes.push(`temperature не отправлена: модель «${model}» не принимает sampling-параметры`);
    } else if (thinkingSent) {
      notes.push('temperature не отправлена: несовместима с включёнными рассуждениями');
    } else {
      body.temperature = input.temperature;
    }
  }

  return { body, notes };
}
