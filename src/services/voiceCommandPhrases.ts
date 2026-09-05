export interface CommandPhraseDefinition {
  intent: string;
  type: 'navigation' | 'action' | 'ai_control';
  category: 'tabs' | 'panels' | 'ai' | 'approval';
  nameKey: string;
  descKey: string;
  defaultPhrases: string[];
  payload?: any;
  feedbackText: string;
}

export const CONFIGURABLE_COMMANDS: CommandPhraseDefinition[] = [
  // ── Вкладки (Tabs) ──
  {
    intent: 'navigate_ai',
    type: 'navigation',
    category: 'tabs',
    nameKey: 'navigateAi',
    descKey: 'navigateAiDesc',
    defaultPhrases: ['чат', 'чет', 'чад', 'чят', 'студия', 'студию', 'ассистент', 'клауд', 'ии', 'claude', 'ai studio'],
    payload: 'ai',
    feedbackText: 'Открываю Claude AI Studio'
  },
  {
    intent: 'navigate_kanban',
    type: 'navigation',
    category: 'tabs',
    nameKey: 'navigateKanban',
    descKey: 'navigateKanbanDesc',
    defaultPhrases: ['задачи', 'бэклог', 'доска', 'канбан', 'tasks', 'backlog'],
    payload: 'kanban',
    feedbackText: 'Открываю доску задач и бэклог'
  },
  {
    intent: 'navigate_milestones',
    type: 'navigation',
    category: 'tabs',
    nameKey: 'navigateMilestones',
    descKey: 'navigateMilestonesDesc',
    defaultPhrases: ['майлстоуны', 'план', 'дорожная карта', 'релизы', 'вехи', 'milestones'],
    payload: 'milestones',
    feedbackText: 'Перехожу к дорожной карте и майлстоунам'
  },
  {
    intent: 'navigate_git',
    type: 'navigation',
    category: 'tabs',
    nameKey: 'navigateGit',
    descKey: 'navigateGitDesc',
    defaultPhrases: ['гит', 'ветки', 'коммиты', 'дифф', 'репозиторий', 'git'],
    payload: 'git',
    feedbackText: 'Открываю управление Git репозиторием'
  },
  {
    intent: 'navigate_files',
    type: 'navigation',
    category: 'tabs',
    nameKey: 'navigateFiles',
    descKey: 'navigateFilesDesc',
    defaultPhrases: ['файлы', 'проводник', 'дерево файлов', 'код', 'files', 'explorer'],
    payload: 'files',
    feedbackText: 'Открываю файловый проводник проекта'
  },
  {
    intent: 'navigate_prs',
    type: 'navigation',
    category: 'tabs',
    nameKey: 'navigatePrs',
    descKey: 'navigatePrsDesc',
    defaultPhrases: ['пул реквесты', 'пиары', 'реквесты', 'пулы', 'prs', 'pull requests'],
    payload: 'prs',
    feedbackText: 'Открываю Pull Requests'
  },
  {
    intent: 'navigate_docs',
    type: 'navigation',
    category: 'tabs',
    nameKey: 'navigateDocs',
    descKey: 'navigateDocsDesc',
    defaultPhrases: ['документы', 'доки', 'база знаний', 'решения', 'docs', 'adr'],
    payload: 'docs',
    feedbackText: 'Открываю базу знаний и ADR документы'
  },
  {
    intent: 'navigate_analytics',
    type: 'navigation',
    category: 'tabs',
    nameKey: 'navigateAnalytics',
    descKey: 'navigateAnalyticsDesc',
    defaultPhrases: ['аналитика', 'статистика', 'графики', 'отчет', 'analytics'],
    payload: 'analytics',
    feedbackText: 'Открываю аналитику проекта'
  },

  // ── Панели и меню (Panels) ──
  {
    intent: 'toggle_terminal',
    type: 'navigation',
    category: 'panels',
    nameKey: 'toggleTerminal',
    descKey: 'toggleTerminalDesc',
    defaultPhrases: ['терминал', 'консоль', 'логи', 'открой терминал', 'скрой терминал', 'terminal', 'console'],
    feedbackText: 'Переключаю панель терминала'
  },
  {
    intent: 'toggle_sidebar',
    type: 'navigation',
    category: 'panels',
    nameKey: 'toggleSidebar',
    descKey: 'toggleSidebarDesc',
    defaultPhrases: ['меню', 'боковая панель', 'панель проектов', 'переключи меню', 'меню проектов', 'sidebar'],
    feedbackText: 'Переключаю видимость меню проектов'
  },
  {
    intent: 'hide_sidebar',
    type: 'navigation',
    category: 'panels',
    nameKey: 'hideSidebar',
    descKey: 'hideSidebarDesc',
    defaultPhrases: ['скрой меню', 'закрой меню', 'спрячь меню', 'скрыть меню', 'скрой панель'],
    feedbackText: 'Скрываю меню проектов'
  },
  {
    intent: 'show_sidebar',
    type: 'navigation',
    category: 'panels',
    nameKey: 'showSidebar',
    descKey: 'showSidebarDesc',
    defaultPhrases: ['покажи меню', 'открой меню', 'верни меню', 'показать меню', 'покажи панель'],
    feedbackText: 'Показываю меню проектов'
  },

  // ── Claude AI Studio (AI) ──
  {
    intent: 'new_ai_session',
    type: 'ai_control',
    category: 'ai',
    nameKey: 'newAiSession',
    descKey: 'newAiSessionDesc',
    defaultPhrases: ['новый чат', 'создай чат', 'новый диалог', 'новая сессия', 'new chat', 'create chat'],
    feedbackText: 'Создаю новый чат'
  },
  {
    intent: 'close_ai_session',
    type: 'ai_control',
    category: 'ai',
    nameKey: 'closeAiSession',
    descKey: 'closeAiSessionDesc',
    defaultPhrases: ['закрой чат', 'закрыть чат', 'закрой диалог', 'закрой сессию', 'close chat'],
    feedbackText: 'Закрываю текущий чат'
  },
  {
    intent: 'switch_session_next',
    type: 'ai_control',
    category: 'ai',
    nameKey: 'nextAiSession',
    descKey: 'nextAiSessionDesc',
    defaultPhrases: ['следующий чат', 'следующий диалог', 'следующая сессия', 'next chat'],
    feedbackText: 'Переключаю на следующий чат'
  },
  {
    intent: 'switch_session_prev',
    type: 'ai_control',
    category: 'ai',
    nameKey: 'prevAiSession',
    descKey: 'prevAiSessionDesc',
    defaultPhrases: ['предыдущий чат', 'предыдущий диалог', 'предыдущая сессия', 'prev chat', 'previous chat'],
    feedbackText: 'Переключаю на предыдущий чат'
  },
  {
    intent: 'quick_next_task',
    type: 'ai_control',
    category: 'ai',
    nameKey: 'quickNextTask',
    descKey: 'quickNextTaskDesc',
    defaultPhrases: ['следующая задача', 'след задача', 'следующую задачу', 'next task'],
    feedbackText: 'Запускаю промпт: Следующая задача'
  },
  {
    intent: 'quick_commit',
    type: 'ai_control',
    category: 'ai',
    nameKey: 'quickCommit',
    descKey: 'quickCommitDesc',
    defaultPhrases: ['комить', 'коммить', 'сделай коммит', 'закоммить', 'закоммитить', 'commit'],
    feedbackText: 'Запускаю промпт: Сделай коммит'
  },
  {
    intent: 'quick_deploy',
    type: 'ai_control',
    category: 'ai',
    nameKey: 'quickDeploy',
    descKey: 'quickDeployDesc',
    defaultPhrases: ['деплой', 'сделай деплой', 'задеплой', 'deploy'],
    feedbackText: 'Запускаю промпт: Деплой'
  },

  // ── Согласование действий (Approvals) ──
  {
    intent: 'agent_approve',
    type: 'ai_control',
    category: 'approval',
    nameKey: 'agentApprove',
    descKey: 'agentApproveDesc',
    defaultPhrases: ['принять', 'одобрить', 'одобри', 'разрешить', 'да', 'согласен', 'approve', 'accept'],
    feedbackText: 'Действие одобрено'
  },
  {
    intent: 'agent_reject',
    type: 'ai_control',
    category: 'approval',
    nameKey: 'agentReject',
    descKey: 'agentRejectDesc',
    defaultPhrases: ['отклонить', 'отклони', 'запретить', 'запрети', 'отмена', 'нет', 'reject', 'deny'],
    feedbackText: 'Действие отклонено'
  }
];

export function getDefaultCommandPhrases(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const cmd of CONFIGURABLE_COMMANDS) {
    result[cmd.intent] = [...cmd.defaultPhrases];
  }
  return result;
}
