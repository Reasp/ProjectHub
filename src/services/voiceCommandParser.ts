export interface ParsedVoiceCommand {
  type: 'navigation' | 'action' | 'dictation';
  intent: string;
  payload?: any;
  feedbackText: string;
}

export function parseVoiceCommand(text: string): ParsedVoiceCommand {
  const normalized = text.toLowerCase().trim();

  // ─── 1. NAVIGATION INTENTS ───
  if (
    normalized.includes('бэклог') ||
    normalized.includes('задач') ||
    normalized.includes('доск') ||
    normalized.includes('kanban') ||
    normalized.includes('tasks')
  ) {
    return {
      type: 'navigation',
      intent: 'navigate_kanban',
      payload: 'kanban',
      feedbackText: 'Открываю доску задач и бэклог'
    };
  }

  if (
    normalized.includes('майлстоун') ||
    normalized.includes('план') ||
    normalized.includes('дорожн') ||
    normalized.includes('релиз') ||
    normalized.includes('milestones')
  ) {
    return {
      type: 'navigation',
      intent: 'navigate_milestones',
      payload: 'milestones',
      feedbackText: 'Перехожу к дорожной карте и майлстоунам'
    };
  }

  if (
    normalized.includes('гит') ||
    normalized.includes('ветк') ||
    normalized.includes('коммит') ||
    normalized.includes('дифф') ||
    normalized.includes('git')
  ) {
    return {
      type: 'navigation',
      intent: 'navigate_git',
      payload: 'git',
      feedbackText: 'Открываю управление Git репозиторием'
    };
  }

  if (
    normalized.includes('файл') ||
    normalized.includes('проводник') ||
    normalized.includes('дерев') ||
    normalized.includes('explorer') ||
    normalized.includes('files')
  ) {
    return {
      type: 'navigation',
      intent: 'navigate_files',
      payload: 'files',
      feedbackText: 'Открываю файловый проводник проекта'
    };
  }

  if (
    normalized.includes('пул') ||
    normalized.includes('пиар') ||
    normalized.includes('реквест') ||
    normalized.includes('pull request')
  ) {
    return {
      type: 'navigation',
      intent: 'navigate_prs',
      payload: 'prs',
      feedbackText: 'Открываю Pull Requests'
    };
  }

  if (
    normalized.includes('документ') ||
    normalized.includes('баз') ||
    normalized.includes('знаний') ||
    normalized.includes('доки') ||
    normalized.includes('adr') ||
    normalized.includes('docs')
  ) {
    return {
      type: 'navigation',
      intent: 'navigate_docs',
      payload: 'docs',
      feedbackText: 'Открываю базу знаний и ADR документы'
    };
  }

  if (
    normalized.includes('аналитик') ||
    normalized.includes('статистик') ||
    normalized.includes('график') ||
    normalized.includes('analytics')
  ) {
    return {
      type: 'navigation',
      intent: 'navigate_analytics',
      payload: 'analytics',
      feedbackText: 'Открываю аналитику проекта'
    };
  }

  if (
    normalized.includes('студи') ||
    normalized.includes('ассистент') ||
    normalized.includes('клауд') ||
    normalized.includes('ии') ||
    normalized.includes('ai')
  ) {
    return {
      type: 'navigation',
      intent: 'navigate_ai',
      payload: 'ai',
      feedbackText: 'Открываю Claude AI Studio'
    };
  }

  if (
    normalized.includes('терминал') ||
    normalized.includes('консоль') ||
    normalized.includes('логи')
  ) {
    return {
      type: 'navigation',
      intent: 'toggle_terminal',
      feedbackText: 'Переключаю панель терминала'
    };
  }

  // ─── 2. ACTION INTENTS ───
  if (
    normalized.includes('запусти проект') ||
    normalized.includes('старт дев') ||
    normalized.includes('старт dev') ||
    normalized.includes('запусти сервер') ||
    normalized.includes('запусти dev')
  ) {
    return {
      type: 'action',
      intent: 'run_dev',
      feedbackText: 'Запускаю локальный сервер разработки'
    };
  }

  if (
    normalized.includes('останови сервер') ||
    normalized.includes('стоп дев') ||
    normalized.includes('стоп dev') ||
    normalized.includes('останови dev') ||
    normalized.includes('останови проект')
  ) {
    return {
      type: 'action',
      intent: 'stop_dev',
      feedbackText: 'Останавливаю процесс сервера'
    };
  }

  if (
    normalized.includes('задеплой') ||
    normalized.includes('деплой') ||
    normalized.includes('опубликуй') ||
    normalized.includes('deploy')
  ) {
    return {
      type: 'action',
      intent: 'run_deploy',
      feedbackText: 'Запускаю процедуру деплоя'
    };
  }

  if (
    normalized.includes('тест') ||
    normalized.includes('запусти тесты') ||
    normalized.includes('прогони тесты')
  ) {
    return {
      type: 'action',
      intent: 'run_tests',
      feedbackText: 'Запускаю прогон тестов'
    };
  }

  // Fallback: Dictation
  return {
    type: 'dictation',
    intent: 'dictate',
    payload: text,
    feedbackText: `Распознано: ${text}`
  };
}
