export interface ParsedVoiceCommand {
  type: 'navigation' | 'action' | 'ai_control' | 'dictation';
  intent: string;
  payload?: any;
  feedbackText: string;
}

// Helper to convert Russian ordinal / number words to numeric index (0-based)
function parseNumberWord(text: string): number | null {
  const normalized = text.toLowerCase().trim();

  if (normalized.includes('1') || normalized.includes('один') || normalized.includes('перв') || normalized.includes('first')) return 0;
  if (normalized.includes('2') || normalized.includes('два') || normalized.includes('втор') || normalized.includes('second')) return 1;
  if (normalized.includes('3') || normalized.includes('три') || normalized.includes('трет') || normalized.includes('third')) return 2;
  if (normalized.includes('4') || normalized.includes('четыр') || normalized.includes('четверт') || normalized.includes('fourth')) return 3;
  if (normalized.includes('5') || normalized.includes('пят') || normalized.includes('fifth')) return 4;
  if (normalized.includes('6') || normalized.includes('шест')) return 5;
  if (normalized.includes('7') || normalized.includes('сед')) return 6;
  if (normalized.includes('8') || normalized.includes('восем')) return 7;
  if (normalized.includes('9') || normalized.includes('девят')) return 8;

  return null;
}

export function parseVoiceCommand(text: string): ParsedVoiceCommand {
  const raw = text.trim();
  const normalized = raw.toLowerCase();

  // ─────────────────────────────────────────────────────────────────
  // 1. AI AGENT & INTERACTIVE MENU APPROVALS
  // ─────────────────────────────────────────────────────────────────
  // A. Approvals: «принять», «одобрить», «да», «разрешить», «применить diff»
  if (
    /^(принять|одобрить|одобри|разрешить|разреши|примени|применить|да|согласен|подтвердить|подтверждаю|approve|accept|allow|confirm)( диф| diff)?$/i.test(normalized) ||
    normalized.includes('принять diff') ||
    normalized.includes('примени diff') ||
    normalized.includes('одобрить изменения')
  ) {
    return {
      type: 'ai_control',
      intent: 'agent_approve',
      feedbackText: 'Действие одобрено'
    };
  }

  // B. Rejections: «отклонить», «нет», «отменить», «запретить», «отклонить diff»
  if (
    /^(отклонить|отклони|запретить|запрети|отменить|отмена|нет|не надо|reject|deny|cancel)( диф| diff)?$/i.test(normalized) ||
    normalized.includes('отклонить diff') ||
    normalized.includes('отмени diff')
  ) {
    return {
      type: 'ai_control',
      intent: 'agent_reject',
      feedbackText: 'Действие отклонено'
    };
  }

  // C. Question Option Selection: «вариант 1», «вариант 2», «номер один», «первый вариант»
  if (
    normalized.startsWith('вариант') ||
    normalized.startsWith('номер') ||
    normalized.startsWith('выбери вариант') ||
    normalized.startsWith('выбери номер') ||
    normalized.startsWith('option') ||
    normalized.includes('вариант') ||
    normalized.includes('номер')
  ) {
    const numIdx = parseNumberWord(normalized);
    if (numIdx !== null) {
      return {
        type: 'ai_control',
        intent: 'agent_select_option',
        payload: { optionIndex: numIdx },
        feedbackText: `Выбираю вариант ${numIdx + 1}`
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. CLAUDE STUDIO TABS & SESSION MANAGEMENT
  // ─────────────────────────────────────────────────────────────────
  // A. New Dialog / Session: «новый диалог», «новая вкладка», «новая сессия», «new session»
  if (
    normalized.includes('новый диалог') ||
    normalized.includes('новая вкладка') ||
    normalized.includes('новая сессия') ||
    normalized.includes('новый чат') ||
    normalized.includes('создай диалог') ||
    normalized.includes('new chat') ||
    normalized.includes('new session')
  ) {
    return {
      type: 'ai_control',
      intent: 'create_ai_session',
      feedbackText: 'Создаю новый диалог в Claude Studio'
    };
  }

  // B. Show Claude Usage & Limits: «лимиты», «лимиты клод», «покажи лимиты», «расход токенов», «покажи расход», «квота», «usage»
  if (
    normalized.includes('лимит') ||
    normalized.includes('расход') ||
    normalized.includes('квот') ||
    normalized.includes('usage') ||
    normalized.includes('токен')
  ) {
    return {
      type: 'ai_control',
      intent: 'show_claude_usage',
      feedbackText: 'Открываю статистику и лимиты Claude Code'
    };
  }

  // B. Switch Studio Tab / Session by Number: «вкладка 1», «вкладка 2», «первая вкладка», «диалог 2»
  if (
    normalized.includes('вкладка') ||
    normalized.includes('вкладку') ||
    normalized.includes('диалог') ||
    normalized.includes('сессия') ||
    normalized.includes('сессию') ||
    normalized.includes('tab')
  ) {
    const numIdx = parseNumberWord(normalized);
    if (numIdx !== null) {
      return {
        type: 'ai_control',
        intent: 'switch_ai_session',
        payload: { sessionIndex: numIdx },
        feedbackText: `Переключаю на вкладку ${numIdx + 1}`
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. PROMPT DICTATION & SENDING TO AGENT
  // ─────────────────────────────────────────────────────────────────
  // A. Direct Prompt Injection: «промпт [текст]», «напиши [текст]», «скажи агенту [текст]», «отправь агенту [текст]»
  const promptMatch = raw.match(/^(?:промпт|напиши агенту|напиши|скажи агенту|отправь агенту|отправь|спроси|prompt|ask agent)\s+(.+)$/i);
  if (promptMatch && promptMatch[1]) {
    const promptContent = promptMatch[1].trim();
    return {
      type: 'ai_control',
      intent: 'send_prompt',
      payload: { text: promptContent },
      feedbackText: `Отправляю промпт агенту: ${promptContent}`
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. PROJECT NAVIGATION (FUZZY SEARCH BY PROJECT NAME)
  // ─────────────────────────────────────────────────────────────────
  // «перейди на проект [X]», «открой проект [X]», «проект [X]», «переключи на [X]»
  const projectMatch = raw.match(/^(?:перейди на проект|переключи на проект|открой проект|проект|open project|switch to project)\s+(.+)$/i);
  if (projectMatch && projectMatch[1]) {
    const targetProjectQuery = projectMatch[1].trim();
    return {
      type: 'navigation',
      intent: 'navigate_project',
      payload: { projectName: targetProjectQuery },
      feedbackText: `Перехожу на проект ${targetProjectQuery}`
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. MAIN TAB NAVIGATION
  // ─────────────────────────────────────────────────────────────────
  if (
    normalized.includes('студи') ||
    normalized.includes('ассистент') ||
    normalized.includes('клауд') ||
    normalized.includes('ии') ||
    normalized.includes('ai studio') ||
    normalized.includes('claude')
  ) {
    return {
      type: 'navigation',
      intent: 'navigate_ai',
      payload: 'ai',
      feedbackText: 'Открываю Claude AI Studio'
    };
  }

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
    normalized.includes('pull request') ||
    normalized.includes('prs')
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

  // ─────────────────────────────────────────────────────────────────
  // 6. ACTION RUNNER INTENTS
  // ─────────────────────────────────────────────────────────────────
  if (
    normalized.includes('запусти проект') ||
    normalized.includes('старт дев') ||
    normalized.includes('старт dev') ||
    normalized.includes('запусти сервер') ||
    normalized.includes('запусти dev') ||
    normalized.includes('start dev')
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
    normalized.includes('останови проект') ||
    normalized.includes('stop dev')
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
    normalized.includes('прогони тесты') ||
    normalized.includes('run tests')
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
