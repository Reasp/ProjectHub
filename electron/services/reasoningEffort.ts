/**
 * Усилие рассуждений — единая шкала сессии и слота и её трансляция в формат провайдера
 * (TASK-70.3, [[decision-41]], [[decision-26]] п. 2).
 *
 * Без значения ProjectHub ничего не отправляет — глубину рассуждений выбирает модель (decision-26 п. 0).
 * `none` — явное «без рассуждений», а не «по умолчанию».
 *
 * Чистый модуль без Electron и сети — покрыт unit-тестами.
 */
import type { LlmReasoningStyle } from './llmProfiles.js';

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'max';

/** Уровни по возрастанию. */
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'max'];

/** Значение из конфига или IPC; всё, что не входит в шкалу, — «не задано». */
export function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value)
    ? (value as ReasoningEffort)
    : undefined;
}

export interface OpenAICompatibleReasoning {
  /** Поля, которые добавляются в тело Chat Completions. */
  fields: Record<string, unknown>;
  /** Почему усилие не отправлено — для лога. */
  note?: string;
}

/**
 * Поля усилия для OpenAI-совместимого сервера по флагу профиля `compat.reasoning`. Значение уходит как
 * есть: OpenAI, OpenRouter и Ollama принимают всю шкалу `none…max`, а понижать уровень молча нельзя
 * (decision-41 п. 2). `ollama_think` — тоже `reasoning_effort`: Ollama `/v1` читает это поле, а `think`
 * через OpenAI-совместимый эндпоинт игнорирует (проверено на 0.31/0.34).
 */
export function openAICompatibleReasoningFields(
  effort: ReasoningEffort | undefined,
  style: LlmReasoningStyle
): OpenAICompatibleReasoning {
  if (!effort) return { fields: {} };
  switch (style) {
    case 'reasoning_effort':
    case 'ollama_think':
      return { fields: { reasoning_effort: effort } };
    case 'reasoning_object':
      return { fields: { reasoning: { effort } } };
    default:
      return {
        fields: {},
        note: `усилие рассуждений «${effort}» не отправлено: у профиля не выбран формат усилия (compat.reasoning = none)`
      };
  }
}

/** Бюджет `budget_tokens` для моделей Anthropic, где есть только `thinking.type: "enabled"`. */
export const ANTHROPIC_EFFORT_BUDGET_TOKENS: Readonly<Record<Exclude<ReasoningEffort, 'none'>, number>> = {
  low: 2048,
  medium: 8192,
  high: 16_384,
  max: 32_768
};

/** Уровни `output_config.effort`, которые публикует Models API; `xhigh` вне шкалы ProjectHub. */
export type AnthropicEffortLevel = Exclude<ReasoningEffort, 'none'>;

/**
 * Уровень для `output_config.effort`: сам уровень, если модель его принимает, иначе ближайший
 * поддерживаемый ниже. `undefined` — подходящего уровня нет.
 */
export function pickSupportedEffort(
  effort: AnthropicEffortLevel,
  supported: Readonly<Partial<Record<AnthropicEffortLevel, boolean>>>
): AnthropicEffortLevel | undefined {
  const order: AnthropicEffortLevel[] = ['low', 'medium', 'high', 'max'];
  for (let i = order.indexOf(effort); i >= 0; i--) {
    if (supported[order[i]]) return order[i];
  }
  return undefined;
}

export interface ClaudeCliEffort {
  args: string[];
  note?: string;
}

/** Флаг `--effort` Claude CLI (уровни `low|medium|high|xhigh|max`; «без рассуждений» в CLI нет). */
export function claudeCliEffortArgs(effort: ReasoningEffort | undefined): ClaudeCliEffort {
  if (!effort) return { args: [] };
  if (effort === 'none') {
    return { args: [], note: 'Claude CLI не умеет выключать рассуждения: усилие «none» не передано, действует режим модели' };
  }
  return { args: ['--effort', effort] };
}

/**
 * Текст рассуждений из дельты (или `message`) Chat Completions. Источники по порядку:
 * `reasoning_content` (DeepSeek, vLLM), `reasoning` строкой (Ollama, OpenRouter), текст
 * `reasoning_details[]` — только если строки нет, чтобы не показать одно и то же дважды.
 */
export function extractReasoningDelta(delta: unknown): string {
  if (typeof delta !== 'object' || delta === null) return '';
  const d = delta as { reasoning_content?: unknown; reasoning?: unknown; reasoning_details?: unknown };
  if (typeof d.reasoning_content === 'string' && d.reasoning_content) return d.reasoning_content;
  if (typeof d.reasoning === 'string' && d.reasoning) return d.reasoning;
  if (Array.isArray(d.reasoning_details)) {
    let text = '';
    for (const item of d.reasoning_details) {
      if (typeof item !== 'object' || item === null) continue;
      const detail = item as { text?: unknown; summary?: unknown };
      if (typeof detail.text === 'string') text += detail.text;
      else if (typeof detail.summary === 'string') text += detail.summary;
    }
    return text;
  }
  return '';
}
