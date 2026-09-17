/**
 * Одноразовый запрос к модели через Claude Code CLI по подписке (TASK-83, [[decision-35]]).
 *
 * Нужен служебным запросам вроде разбора голосовой команды, когда провайдер AI Studio —
 * `anthropic`, а API-ключа нет: вход в Claude Code выполнен по подписке, и другого способа
 * обратиться к модели у пользователя нет. Запуск максимально облегчён, иначе CLI тратит секунды на
 * то, что служебному запросу не нужно: MCP-серверы, инструменты, сессия, навыки и системный
 * промпт Claude Code (замер 2026-09-17: 8.2 с по умолчанию против ~2.8 с с этими флагами).
 *
 * Модель — из настроек пользователя, вендорского дефолта нет ([[decision-26]] п. 0).
 *
 * Чистый модуль без Electron и процессов — покрыт unit-тестами.
 */

/** Короткий системный промпт: сами инструкции задачи уходят в stdin вместе с запросом. */
export const CLAUDE_CLI_COMPLETION_SYSTEM_PROMPT =
  'You are a service component. Follow the instructions in the user message exactly and reply only with what they ask for.';

export interface ClaudeCliCompletionInput {
  model: string;
  system?: string;
  prompt: string;
}

export interface ClaudeCliCompletionCommand {
  args: string[];
  stdin: string;
}

export function buildClaudeCliCompletionCommand(input: ClaudeCliCompletionInput): ClaudeCliCompletionCommand {
  const model = input.model.trim();
  if (!model) throw new Error('Модель не выбрана в настройках AI Studio.');
  const args = [
    '-p',
    '--model',
    model,
    '--output-format',
    'json',
    '--strict-mcp-config',
    '--tools=',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--system-prompt',
    CLAUDE_CLI_COMPLETION_SYSTEM_PROMPT
  ];
  const system = input.system?.trim();
  return { args, stdin: system ? `${system}\n\n${input.prompt}` : input.prompt };
}

/**
 * Разбирает ответ `claude -p --output-format json`.
 *
 * @throws если CLI сообщил об ошибке или вывод не является ожидаемым JSON.
 */
export function parseClaudeCliCompletionOutput(stdout: string): string {
  const trimmed = stdout.trim();
  // CLI иногда печатает предупреждения перед JSON — берём последний объект верхнего уровня
  const start = trimmed.lastIndexOf('\n{') >= 0 ? trimmed.lastIndexOf('\n{') + 1 : trimmed.indexOf('{');
  if (start < 0) throw new Error(`Claude CLI вернул не JSON: ${trimmed.slice(0, 200)}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start));
  } catch (err) {
    throw new Error(`Claude CLI вернул некорректный JSON: ${trimmed.slice(0, 200)}`, { cause: err });
  }

  const data = parsed as { is_error?: unknown; result?: unknown; subtype?: unknown };
  if (data.is_error === true) {
    const detail = typeof data.result === 'string' && data.result ? data.result : String(data.subtype ?? 'unknown error');
    throw new Error(`Claude CLI: ${detail}`);
  }
  if (typeof data.result !== 'string') {
    throw new Error('Claude CLI не вернул текст ответа');
  }
  return data.result.trim();
}
