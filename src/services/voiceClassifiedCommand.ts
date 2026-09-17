/**
 * Приведение ответа LLM-классификатора к команде, которую исполняет голосовой виджет (TASK-83).
 *
 * Исполнитель команд (`VoiceControlWidget.executeCommand`) рассчитан на результат парсера
 * регулярок: вкладка открывается по `payload` (`'kanban'`, `'git'` …), а диктовка — в ветке
 * действий. Классификатор возвращает интент своего каталога, где у вкладок нет `payload`, а у
 * диктовки тип `dictation`. Без приведения распознанная моделью команда показывала
 * «Команда: Вкладка Задачи», но ничего не делала (живая проверка 2026-09-17).
 *
 * Соответствие с парсером регулярок закреплено unit-тестом.
 *
 * Чистый модуль без React и Electron.
 */
import type { ParsedVoiceCommand } from './voiceCommandParser';

/** Вкладка для интентов навигации — те же значения, что кладёт в `payload` парсер регулярок. */
export const TAB_BY_NAVIGATION_INTENT: Readonly<Record<string, string>> = {
  navigate_ai: 'ai',
  navigate_kanban: 'kanban',
  navigate_milestones: 'milestones',
  navigate_git: 'git',
  navigate_files: 'files',
  navigate_prs: 'prs',
  navigate_docs: 'docs',
  navigate_analytics: 'analytics'
};

/** Интенты с типом `dictation` в каталоге исполнитель обрабатывает в ветке действий. */
const ACTION_INTENTS = new Set(['dictation_start', 'dictation_stop']);

export interface ClassifiedVoiceIntent {
  intent: string;
  type: string;
  payload?: Record<string, unknown>;
}

export function toExecutableVoiceCommand(result: ClassifiedVoiceIntent, feedbackText: string): ParsedVoiceCommand {
  const tab = TAB_BY_NAVIGATION_INTENT[result.intent];
  if (tab) {
    return { type: 'navigation', intent: result.intent, payload: tab, feedbackText };
  }

  const type: ParsedVoiceCommand['type'] = ACTION_INTENTS.has(result.intent)
    ? 'action'
    : result.type === 'navigation' || result.type === 'action' || result.type === 'ai_control'
      ? result.type
      : 'action';

  return { type, intent: result.intent, payload: result.payload, feedbackText };
}
