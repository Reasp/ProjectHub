/**
 * Многошаговый tool-loop API-агента (TASK-82): чистые функции без сети и Electron.
 *
 * До TASK-82 API-агент делал один запрос к модели на ход и не возвращал ей результаты
 * инструментов; OpenAI-совместимые провайдеры (Ollama, OpenRouter, DeepSeek, custom) не получали
 * `tools` вовсе. Здесь — накопление потоковых `delta.tool_calls` OpenAI и сборка сообщений хода
 * «ответ модели с вызовами → результаты инструментов» в форматах Anthropic Messages и OpenAI
 * Chat Completions. Цикл и сеть — в `aiAgentService.streamChat`.
 */

type JsonObject = Record<string, unknown>;

/** Вызов инструмента, распознанный в ответе модели. */
export interface LoopToolCall {
  id: string;
  name: string;
  args: JsonObject;
}

export interface ToolResultImage {
  mimeType: string;
  /** base64 без префикса data:. */
  data: string;
}

/** Результат исполнения инструмента для модели. */
export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
  images?: ToolResultImage[];
}

/** Определение инструмента в формате Anthropic (как в `aiAgentService.getAnthropicTools`). */
export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema: JsonObject;
}

export interface OpenAIToolDefinition {
  type: 'function';
  function: { name: string; description?: string; parameters: JsonObject };
}

export const DEFAULT_MAX_TOOL_STEPS = 25;
/** Лимит текста результата инструмента, возвращаемого модели. */
export const TOOL_RESULT_MAX_CHARS = 30_000;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function truncateToolResult(text: string, max = TOOL_RESULT_MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[результат усечён: ${text.length - max} символов не показано]`;
}

/** Anthropic tools → OpenAI `tools` (`type: function`). */
export function toOpenAITools(tools: AnthropicToolDefinition[]): OpenAIToolDefinition[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: isObject(t.input_schema) ? t.input_schema : { type: 'object', properties: {} }
    }
  }));
}

interface PartialOpenAICall {
  id?: string;
  name: string;
  arguments: string;
}

/** Накопитель потоковых `choices[0].delta.tool_calls` (фрагменты по `index`). */
export class OpenAIToolCallAccumulator {
  private calls = new Map<number, PartialOpenAICall>();

  public push(deltaToolCalls: unknown): void {
    if (!Array.isArray(deltaToolCalls)) return;
    for (const raw of deltaToolCalls) {
      if (!isObject(raw)) continue;
      const index = typeof raw.index === 'number' ? raw.index : this.calls.size;
      const current = this.calls.get(index) ?? { name: '', arguments: '' };
      if (typeof raw.id === 'string' && raw.id) current.id = raw.id;
      const fn = isObject(raw.function) ? raw.function : {};
      if (typeof fn.name === 'string') current.name += fn.name;
      if (typeof fn.arguments === 'string') current.arguments += fn.arguments;
      // Некоторые серверы (Ollama) присылают аргументы уже объектом, одним чанком.
      else if (isObject(fn.arguments)) current.arguments = JSON.stringify(fn.arguments);
      this.calls.set(index, current);
    }
  }

  public get size(): number {
    return this.calls.size;
  }

  /** Готовые вызовы в порядке `index`; битый JSON аргументов → объект с `_parseError`. */
  public finalize(idPrefix = 'call'): LoopToolCall[] {
    return Array.from(this.calls.entries())
      .sort((a, b) => a[0] - b[0])
      .filter(([, c]) => c.name)
      .map(([index, c]) => ({
        id: c.id || `${idPrefix}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        name: c.name,
        args: parseToolArguments(c.arguments)
      }));
  }
}

export function parseToolArguments(raw: string): JsonObject {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? parsed : { value: parsed };
  } catch {
    return { _parseError: `Не удалось разобрать аргументы инструмента как JSON: ${raw.slice(0, 200)}` };
  }
}

/** Блоки содержимого ответа Anthropic, которые нужно вернуть модели как есть (включая thinking с подписью). */
export type AnthropicAssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: JsonObject };

export interface AnthropicToolTurnMessage {
  role: 'assistant' | 'user';
  content: JsonObject[];
}

/**
 * Сообщения хода для Anthropic: ответ ассистента (его блоки в исходном порядке) и `user` с
 * `tool_result` на каждый вызов. Изображения (скриншоты) идут внутрь `tool_result`.
 */
export function buildAnthropicToolTurn(
  assistantBlocks: AnthropicAssistantBlock[],
  results: Array<{ call: LoopToolCall; result: ToolExecutionResult }>
): AnthropicToolTurnMessage[] {
  const content: JsonObject[] = assistantBlocks.filter((b) => b.type !== 'text' || b.text.length > 0).map((b) => ({ ...b }));
  const toolResults: JsonObject[] = results.map(({ call, result }) => {
    const blocks: JsonObject[] = [{ type: 'text', text: truncateToolResult(result.content || (result.isError ? 'Ошибка' : 'OK')) }];
    for (const img of result.images ?? []) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } });
    }
    return { type: 'tool_result', tool_use_id: call.id, content: blocks, ...(result.isError ? { is_error: true } : {}) };
  });
  return [
    { role: 'assistant', content },
    { role: 'user', content: toolResults }
  ];
}

export interface OpenAIToolTurnOptions {
  /** Провайдер принимает изображения (vision): скриншоты уходят отдельным `user`-сообщением с `image_url`. */
  vision?: boolean;
}

/**
 * Сообщения хода для OpenAI Chat Completions: `assistant` с `tool_calls` и `tool` на каждый
 * вызов. Содержимое `tool` — только текст; без vision изображения заменяются пометкой, чтобы
 * модели без vision (например, локальные через Ollama) не получали то, что не умеют читать.
 */
export function buildOpenAIToolTurn(
  assistantText: string,
  results: Array<{ call: LoopToolCall; result: ToolExecutionResult }>,
  options: OpenAIToolTurnOptions = {}
): JsonObject[] {
  const messages: JsonObject[] = [
    {
      role: 'assistant',
      content: assistantText || null,
      tool_calls: results.map(({ call }) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) }
      }))
    }
  ];
  const imageParts: JsonObject[] = [];
  for (const { call, result } of results) {
    let text = truncateToolResult(result.content || (result.isError ? 'Ошибка' : 'OK'));
    const images = result.images ?? [];
    if (images.length > 0) {
      if (options.vision) {
        for (const img of images) imageParts.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
        text += `\n[изображений: ${images.length} — переданы следующим сообщением]`;
      } else {
        text += `\n[изображений: ${images.length} — не переданы: модель без vision; используй дерево доступности (get_ui_tree/find_element)]`;
      }
    }
    messages.push({ role: 'tool', tool_call_id: call.id, content: result.isError ? `Ошибка: ${text}` : text });
  }
  if (imageParts.length > 0) {
    messages.push({ role: 'user', content: [{ type: 'text', text: 'Скриншоты из результатов инструментов выше:' }, ...imageParts] });
  }
  return messages;
}
