/**
 * Усилие рассуждений в UI сессии AI Studio и слота Swarm (TASK-70.3, decision-41). Чистые функции без
 * React — покрыты unit-тестами.
 *
 * Шкала повторяет `electron/services/reasoningEffort.ts` (рендерер не импортирует main-процесс). Пустое
 * значение — «по умолчанию модели»: ProjectHub ничего не отправляет.
 */
import type { SlotProvider } from './providerSelect';

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'max';

export const REASONING_EFFORT_OPTIONS: readonly ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'max'];

export function parseReasoningEffort(value: string | undefined | null): ReasoningEffort | undefined {
  return (REASONING_EFFORT_OPTIONS as readonly string[]).includes(value ?? '') ? (value as ReasoningEffort) : undefined;
}

/**
 * Куда уйдёт усилие — для подсказки под выбором:
 * - `claude-cli` — флаг `--effort`, «none» не передаётся;
 * - `anthropic-api` — `output_config.effort` / thinking по возможностям модели;
 * - `openai-compatible` — поле по формату профиля;
 * - `not-sent` — у провайдера или профиля нет формата усилия, поле не отправляется;
 * - `cli-ignored` — Codex/Gemini CLI, усилие не передаётся;
 * - `studio` — слот «как в AI Studio»: куда уйдёт, решают настройки AI Studio.
 */
export type EffortTargetKind = 'claude-cli' | 'anthropic-api' | 'openai-compatible' | 'not-sent' | 'cli-ignored' | 'studio';

export interface EffortTargetInput {
  /** Движок слота; для сессии AI Studio не задан. */
  engine?: string;
  provider?: string;
  /** Есть ли ключ Anthropic (без ключа AI Studio работает через Claude CLI). */
  hasApiKey?: boolean;
  /** `compat.reasoning` выбранного профиля. */
  profileReasoning?: string;
}

export function effortTargetKind(input: EffortTargetInput): EffortTargetKind {
  if (input.engine === 'claude-cli') return 'claude-cli';
  if (input.engine === 'codex-cli' || input.engine === 'gemini-cli') return 'cli-ignored';
  switch (input.provider) {
    case undefined:
    case '':
      return 'studio';
    case 'anthropic':
      // Слот с Anthropic берёт ключ AI Studio; `hasApiKey` задаёт только сессия.
      return input.hasApiKey === false ? 'claude-cli' : 'anthropic-api';
    case 'openai-compatible':
      return input.profileReasoning && input.profileReasoning !== 'none' ? 'openai-compatible' : 'not-sent';
    case 'ollama':
    case 'openrouter':
      return 'openai-compatible';
    default:
      return 'not-sent';
  }
}

/** Слот с новым усилием; остальные поля провайдера не меняются, пустой конфиг — `undefined`. */
export function withReasoningEffort(current: SlotProvider | undefined, effort: ReasoningEffort | undefined): SlotProvider | undefined {
  const next: SlotProvider = { ...current };
  delete next.reasoningEffort;
  if (effort) next.reasoningEffort = effort;
  return Object.keys(next).length > 0 ? next : undefined;
}
