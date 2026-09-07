export interface ParsedVoiceCommand {
  type: 'navigation' | 'action' | 'ai_control' | 'dictation';
  intent: string;
  payload?: any;
  feedbackText: string;
}

// Helper to convert Russian/English ordinal and number words to numeric index (0-based)
// `\b` в JS — только ASCII-граница слова, для кириллицы не работает («\bдва\b» никогда не совпадёт),
// поэтому границы проверяем lookaround'ами по Unicode-буквам/цифрам.
function hasWord(text: string, alternatives: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

// Порядок важен: «10» проверяется раньше «1», иначе «вариант 10» ловится проверкой ` 1`.
const NUMBER_WORDS: Array<[index: number, digit: string, words: string]> = [
  [9, '10', 'десят\\p{L}*|tenth|ten'],
  [0, '1', 'один|одну|перв\\p{L}*|first|one'],
  [1, '2', 'два|две|втор\\p{L}*|second|two'],
  [2, '3', 'три|трет\\p{L}*|third|three'],
  [3, '4', 'четыр\\p{L}*|четверт\\p{L}*|fourth|four'],
  [4, '5', 'пят\\p{L}*|fifth|five'],
  [5, '6', 'шест\\p{L}*|sixth|six'],
  [6, '7', 'семь|сед\\p{L}*|seventh|seven'],
  [7, '8', 'восем\\p{L}*|eighth|eight'],
  [8, '9', 'девят\\p{L}*|ninth|nine']
];

function parseNumberWord(text: string): number | null {
  const normalized = text.toLowerCase().trim();

  // Words or digits 1..10 & ordinals
  for (const [index, digit, words] of NUMBER_WORDS) {
    if (hasWord(normalized, `${digit}|${words}`) || normalized.includes(` ${digit}`) || normalized.endsWith(digit)) {
      return index;
    }
  }

  // Last / Последний
  if (hasWord(normalized, 'последн\\p{L}*|last')) return -1;

  return null;
}

import { CONFIGURABLE_COMMANDS } from './voiceCommandPhrases';

export function parseVoiceCommand(text: string, customPhrases?: Record<string, string[]>): ParsedVoiceCommand {
  const raw = text.trim();
  const normalized = raw.toLowerCase().replace(/[.,!?;:]+$/, '').trim();

  // ─────────────────────────────────────────────────────────────────
  // 0. CUSTOM / CONFIGURABLE PHRASES OVERRIDE (HIGHEST PRIORITY)
  // ─────────────────────────────────────────────────────────────────
  // Strip common command prefixes like «открой», «перейди на», «перейди в», «покажи», «включи»
  const cleanCmd = normalized
    .replace(/^(?:открой|открыть|перейди на|перейти на|перейди в|перейти в|переключи на|переключить на|покажи|показать|включи|включить)\s+/i, '')
    .trim();

  for (const cmd of CONFIGURABLE_COMMANDS) {
    const phrases = (customPhrases && customPhrases[cmd.intent]) || cmd.defaultPhrases;
    for (const p of phrases) {
      const normP = p.toLowerCase().trim();
      if (!normP) continue;
      if (normalized === normP || cleanCmd === normP) {
        return {
          type: cmd.type,
          intent: cmd.intent,
          payload: cmd.payload,
          feedbackText: cmd.feedbackText
        };
      }
    }
  }

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

  // B. Close Current Chat / Session: «закрой чат», «закрой сессию», «close chat», «close session»
  if (
    /^(закрой чат|закрыть чат|закрой сессию|закрыть сессию|закрой диалог|закрыть диалог|close chat|close session)$/i.test(normalized) ||
    normalized.startsWith('закрой чат') ||
    normalized.startsWith('закрой сессию') ||
    normalized.startsWith('закрыть чат') ||
    normalized.startsWith('close chat') ||
    normalized.startsWith('close session')
  ) {
    return {
      type: 'ai_control',
      intent: 'close_ai_session',
      feedbackText: 'Закрываю текущий чат'
    };
  }

  // C. New Chat / Session: «новый чат», «создай чат», «новая сессия», «new chat», «create chat»
  if (
    /^(новый чат|создай чат|создать чат|новая сессия|создай сессию|создать сессию|новый диалог|new chat|create chat|new session)$/i.test(normalized) ||
    normalized === 'новый чат' ||
    normalized === 'создай чат' ||
    normalized === 'new chat'
  ) {
    return {
      type: 'ai_control',
      intent: 'new_ai_session',
      feedbackText: 'Создаю новый чат'
    };
  }

  // D. Cyclic Chat Navigation: «следующий чат», «предыдущий чат», «прошлый чат / назад»
  if (
    normalized.includes('следующий чат') ||
    normalized.includes('следующая сессия') ||
    normalized.includes('следующий диалог') ||
    normalized.includes('next chat') ||
    normalized.includes('next session')
  ) {
    return {
      type: 'ai_control',
      intent: 'switch_session_next',
      feedbackText: 'Переключаю на следующий чат'
    };
  }

  if (
    normalized.includes('предыдущий чат') ||
    normalized.includes('предыдущая сессия') ||
    normalized.includes('предыдущий диалог') ||
    normalized.includes('previous chat') ||
    normalized.includes('prev chat') ||
    normalized.includes('prev session')
  ) {
    return {
      type: 'ai_control',
      intent: 'switch_session_prev',
      feedbackText: 'Переключаю на предыдущий чат'
    };
  }

  if (
    normalized === 'прошлый чат' ||
    normalized === 'прошлая сессия' ||
    normalized === 'назад к чату' ||
    normalized === 'вернись к чату' ||
    normalized === 'back chat' ||
    normalized === 'last chat'
  ) {
    return {
      type: 'ai_control',
      intent: 'switch_session_last',
      feedbackText: 'Возвращаюсь к предыдущему чату'
    };
  }

  // Quick Action Prompts: «следующая задача», «комить», «деплой»
  if (
    /^(следующая задача|след задача|следующую задачу|какая следующая задача|next task)$/i.test(normalized) ||
    normalized.startsWith('следующая задача') ||
    normalized.startsWith('след задача')
  ) {
    return {
      type: 'ai_control',
      intent: 'quick_next_task',
      feedbackText: 'Запускаю быстрый промпт: Следующая задача'
    };
  }

  if (
    /^(комить|коммить|сделай коммит|сделай комит|закоммить|закоммитить|закомитить|commit)$/i.test(normalized) ||
    normalized.startsWith('закоммить') ||
    normalized.startsWith('сделай коммит') ||
    normalized.startsWith('сделай комит')
  ) {
    return {
      type: 'ai_control',
      intent: 'quick_commit',
      feedbackText: 'Запускаю быстрый промпт: Сделай коммит'
    };
  }

  if (
    /^(деплой|сделай деплой|задеплой|задеплоить|deploy)$/i.test(normalized) ||
    normalized.startsWith('сделай деплой') ||
    normalized.startsWith('задеплой')
  ) {
    return {
      type: 'ai_control',
      intent: 'quick_deploy',
      feedbackText: 'Запускаю быстрый промпт: Деплой'
    };
  }

  // E. Switch Chat / Session by Number (1..N, Ordinals): «чат 1», «сессия 2», «первый чат», «последняя сессия»
  const chatIndexMatch = normalized.match(/^(?:чат|сессия|сессию|диалог|chat|session|dialog)\s+(?:номер\s+)?(.+)$/i) ||
                         normalized.match(/^(.+?)\s+(?:чат|сессия|сессию|диалог|chat|session|dialog)$/i);

  if (chatIndexMatch && chatIndexMatch[1]) {
    const candidateText = chatIndexMatch[1].trim();
    const parsedIdx = parseNumberWord(candidateText);
    if (parsedIdx !== null) {
      return {
        type: 'ai_control',
        intent: 'switch_session_index',
        payload: { sessionIndex: parsedIdx },
        feedbackText: parsedIdx === -1 ? 'Открываю последний чат' : `Переключаю на чат ${parsedIdx + 1}`
      };
    }
  }

  // F. Search Chat / Session by Title: «перейди в чат [X]», «открой чат [X]», «чат [X]»
  const chatTitleMatch = raw.match(/^(?:перейди в чат|переключи на чат|открой чат|чат|open chat|switch to chat)\s+(.+)$/i);
  if (chatTitleMatch && chatTitleMatch[1]) {
    const targetQuery = chatTitleMatch[1].trim();
    return {
      type: 'ai_control',
      intent: 'navigate_ai_session',
      payload: { sessionTitle: targetQuery },
      feedbackText: `Перехожу в чат ${targetQuery}`
    };
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
  // 4. PROJECT NAVIGATION & MULTI-PROJECT SESSION TABS
  // ─────────────────────────────────────────────────────────────────
  // A. Close Current Project / Tab: «закрой проект», «закрой вкладку», «close tab», «close project»
  if (
    /^(закрой проект|закрыть проект|закрой вкладку|закрыть вкладку|close project|close tab)$/i.test(normalized) ||
    normalized.startsWith('закрой проект') ||
    normalized.startsWith('закрой вкладку') ||
    normalized.startsWith('close project') ||
    normalized.startsWith('close tab')
  ) {
    return {
      type: 'navigation',
      intent: 'close_current_project',
      feedbackText: 'Закрываю текущий проект'
    };
  }

  // B. Cyclic & Relative Navigation: «следующий проект», «предыдущий проект», «прошлый проект / назад»
  if (
    normalized.includes('следующий проект') ||
    normalized.includes('следующая вкладка') ||
    normalized.includes('next project') ||
    normalized.includes('next tab')
  ) {
    return {
      type: 'navigation',
      intent: 'switch_project_next',
      feedbackText: 'Переключаю на следующий проект'
    };
  }

  if (
    normalized.includes('предыдущий проект') ||
    normalized.includes('предыдущая вкладка') ||
    normalized.includes('previous project') ||
    normalized.includes('prev project') ||
    normalized.includes('prev tab')
  ) {
    return {
      type: 'navigation',
      intent: 'switch_project_prev',
      feedbackText: 'Переключаю на предыдущий проект'
    };
  }

  if (
    normalized === 'прошлый проект' ||
    normalized === 'назад к проекту' ||
    normalized === 'вернись к проекту' ||
    normalized === 'вернуться назад' ||
    normalized === 'back project' ||
    normalized === 'last project' ||
    normalized === 'прошлый'
  ) {
    return {
      type: 'navigation',
      intent: 'switch_project_last',
      feedbackText: 'Возвращаюсь к предыдущему проекту'
    };
  }

  // C. Tab / Project by Index (1..N, Ordinals): «проект 1», «вкладка 2», «первый проект», «project two»
  // Match patterns like:
  // «проект один», «проект 2», «вкладка 3», «первый проект», «последний проект»
  // «project 1», «tab 2», «first project», «last project»
  const tabIndexMatch = normalized.match(/^(?:проект|вкладка|вкладку|project|tab)\s+(?:номер\s+)?(.+)$/i) ||
                        normalized.match(/^(.+?)\s+(?:проект|вкладка|вкладку|project|tab)$/i);

  if (tabIndexMatch && tabIndexMatch[1]) {
    const candidateText = tabIndexMatch[1].trim();
    const parsedIdx = parseNumberWord(candidateText);
    if (parsedIdx !== null) {
      return {
        type: 'navigation',
        intent: 'switch_project_index',
        payload: { tabIndex: parsedIdx },
        feedbackText: parsedIdx === -1 ? 'Открываю последний проект' : `Переключаю на проект ${parsedIdx + 1}`
      };
    }
  }

  // D. Project Navigation by Name or Voice Alias: «перейди на проект [X]», «открой проект [X]», «проект [X]»
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
    normalized.includes('claude') ||
    /^(чат|чет|чад|чят|chat)$/i.test(normalized) ||
    /^(открой|открыть|перейди в|перейти в|переключи на|покажи)\s+(чат|чет|чад|чят|chat)$/i.test(normalized)
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
    normalized.includes('логи') ||
    normalized === 'terminal' ||
    normalized === 'console'
  ) {
    return {
      type: 'navigation',
      intent: 'toggle_terminal',
      feedbackText: 'Переключаю панель терминала'
    };
  }

  // Quick Action Commands: VS Code, Folder/Explorer, Help/Hotkeys, Omni Search, Refresh
  if (
    /^(код|открой код|открыть код|vs code|vscode|open code|open in code)$/i.test(normalized) ||
    normalized === 'код' ||
    normalized === 'открой код' ||
    normalized === 'vs code' ||
    normalized === 'vscode'
  ) {
    return {
      type: 'action',
      intent: 'open_code',
      feedbackText: 'Открываю проект в VS Code'
    };
  }

  if (
    /^(папка|проводник|открой папку|открыть папку|открой проводник|открыть проводник|open folder|folder|explorer)$/i.test(normalized) ||
    normalized === 'папка' ||
    normalized === 'открой папку' ||
    normalized === 'проводник' ||
    normalized === 'folder'
  ) {
    return {
      type: 'action',
      intent: 'open_explorer',
      feedbackText: 'Открываю папку проекта в проводнике'
    };
  }

  if (
    /^(справка|помощь|горячие клавиши|хоткеи|help|hotkeys)$/i.test(normalized) ||
    normalized === 'справка' ||
    normalized === 'помощь' ||
    normalized === 'help'
  ) {
    return {
      type: 'action',
      intent: 'open_help',
      feedbackText: 'Открываю справку по горячим клавишам'
    };
  }

  if (
    /^(поиск|найти|омни поиск|search|find)$/i.test(normalized) ||
    normalized === 'поиск' ||
    normalized === 'search'
  ) {
    return {
      type: 'action',
      intent: 'open_search',
      feedbackText: 'Открываю глобальный поиск'
    };
  }

  if (
    /^(обнови|обновить|перезагрузи|перезагрузить|refresh)$/i.test(normalized) ||
    normalized === 'обнови' ||
    normalized === 'refresh'
  ) {
    return {
      type: 'action',
      intent: 'refresh_project',
      feedbackText: 'Обновляю статус проекта и Git'
    };
  }

  // 5.0.1 SIDEBAR / PROJECT MENU TOGGLE & CONTROL
  if (
    /^(меню|сайдбар|скрой меню|скрыть меню|закрой меню|закрыть меню|покажи меню|показать меню|открой меню|открыть меню|панель проектов|меню проектов|toggle sidebar|hide sidebar|show sidebar|sidebar)$/i.test(normalized) ||
    normalized.includes('скрой меню') ||
    normalized.includes('покажи меню') ||
    normalized.includes('скрой сайдбар') ||
    normalized.includes('покажи сайдбар') ||
    normalized.includes('панель проектов') ||
    normalized.includes('меню проектов') ||
    normalized === 'меню' ||
    normalized === 'сайдбар' ||
    normalized === 'sidebar'
  ) {
    if (normalized.includes('скрой') || normalized.includes('закрой') || normalized.includes('hide') || normalized.includes('close')) {
      return {
        type: 'action',
        intent: 'hide_sidebar',
        feedbackText: 'Скрываю меню проектов'
      };
    }
    if (normalized.includes('покажи') || normalized.includes('открой') || normalized.includes('show') || normalized.includes('open')) {
      return {
        type: 'action',
        intent: 'show_sidebar',
        feedbackText: 'Показываю меню проектов'
      };
    }
    return {
      type: 'action',
      intent: 'toggle_sidebar',
      feedbackText: 'Переключаю меню проектов'
    };
  }

  // 5.1 READING & AUDIO ASSISTANT (TTS ONLY)
  if (
    /^(прочитай задачи|прочитай таски|озвучь задачи|какие задачи|список задач|read tasks)$/i.test(normalized) ||
    normalized.includes('прочитай задачи') ||
    normalized.includes('озвучь задачи') ||
    normalized.includes('какие задачи')
  ) {
    return {
      type: 'action',
      intent: 'read_tasks',
      feedbackText: 'Читаю список задач'
    };
  }

  if (
    /^(прочитай документ|прочитай доку|озвучь документ|прочитай доки|read doc|read document)$/i.test(normalized) ||
    normalized.includes('прочитай документ') ||
    normalized.includes('прочитай доку')
  ) {
    return {
      type: 'action',
      intent: 'read_doc',
      feedbackText: 'Читаю документ'
    };
  }

  if (
    /^(хватит|замолчи|останови чтение|стоп чтение|тишина|stop reading|mute)$/i.test(normalized) ||
    normalized === 'хватит' ||
    normalized === 'замолчи' ||
    normalized === 'стоп чтение'
  ) {
    return {
      type: 'action',
      intent: 'stop_reading',
      feedbackText: 'Чтение остановлено'
    };
  }

  if (
    /^(пауза|на паузу|приостанови|возобнови|продолжи|pause|resume)$/i.test(normalized) ||
    normalized === 'пауза' ||
    normalized === 'возобнови'
  ) {
    return {
      type: 'action',
      intent: 'toggle_pause',
      feedbackText: 'Пауза голосового ввода'
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
