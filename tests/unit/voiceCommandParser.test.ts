import { describe, expect, it } from 'vitest';
import { parseVoiceCommand } from '../../src/services/voiceCommandParser';

describe('parseVoiceCommand: настраиваемые фразы', () => {
  it('фразы по умолчанию и с префиксом «открой/перейди на» ведут на вкладки', () => {
    expect(parseVoiceCommand('Бэклог')).toMatchObject({ type: 'navigation', intent: 'navigate_kanban', payload: 'kanban' });
    expect(parseVoiceCommand('открой задачи.')).toMatchObject({ intent: 'navigate_kanban' });
    expect(parseVoiceCommand('перейди на доска')).toMatchObject({ intent: 'navigate_kanban' });
    expect(parseVoiceCommand('ai studio')).toMatchObject({ intent: 'navigate_ai', payload: 'ai' });
  });

  it('пользовательские фразы перекрывают стандартные и имеют наивысший приоритет', () => {
    const custom = { navigate_kanban: ['работа'], navigate_ai: ['мозг'] };
    expect(parseVoiceCommand('работа', custom)).toMatchObject({ intent: 'navigate_kanban' });
    expect(parseVoiceCommand('Открой мозг', custom)).toMatchObject({ intent: 'navigate_ai' });
    // Стандартная фраза «бэклог» после переопределения списка уже не срабатывает как точное совпадение,
    // но всё ещё ловится эвристикой по подстроке.
    expect(parseVoiceCommand('бэклог', custom)).toMatchObject({ intent: 'navigate_kanban' });
    // Пустые фразы игнорируются.
    expect(parseVoiceCommand('', { navigate_kanban: [''] })).toMatchObject({ type: 'dictation' });
  });
});

describe('parseVoiceCommand: управление агентом', () => {
  it('одобрение и отклонение, включая diff и английские формы', () => {
    for (const phrase of ['Да', 'принять', 'примени diff', 'approve', 'одобрить изменения']) {
      expect(parseVoiceCommand(phrase), phrase).toMatchObject({ type: 'ai_control', intent: 'agent_approve' });
    }
    for (const phrase of ['нет', 'отклонить diff', 'отмена', 'deny']) {
      expect(parseVoiceCommand(phrase), phrase).toMatchObject({ type: 'ai_control', intent: 'agent_reject' });
    }
  });

  it('выбор варианта: цифры, слова, порядковые, «последний», «10» не путается с «1»', () => {
    expect(parseVoiceCommand('вариант 1')).toMatchObject({ intent: 'agent_select_option', payload: { optionIndex: 0 } });
    expect(parseVoiceCommand('номер два')).toMatchObject({ intent: 'agent_select_option', payload: { optionIndex: 1 } });
    expect(parseVoiceCommand('третий вариант')).toMatchObject({ intent: 'agent_select_option', payload: { optionIndex: 2 } });
    expect(parseVoiceCommand('вариант 10')).toMatchObject({ intent: 'agent_select_option', payload: { optionIndex: 9 } });
    expect(parseVoiceCommand('последний вариант')).toMatchObject({ intent: 'agent_select_option', payload: { optionIndex: -1 } });
  });

  it('сессии Claude Studio: создать, закрыть, переключить по номеру и названию', () => {
    // «новый диалог» входит в настраиваемые фразы (new_ai_session) и перекрывает эвристику create_ai_session.
    expect(parseVoiceCommand('новый диалог')).toMatchObject({ intent: 'new_ai_session' });
    expect(parseVoiceCommand('создай диалог')).toMatchObject({ intent: 'create_ai_session' });
    expect(parseVoiceCommand('закрой чат')).toMatchObject({ intent: 'close_ai_session' });
    expect(parseVoiceCommand('следующий чат')).toMatchObject({ intent: 'switch_session_next' });
    expect(parseVoiceCommand('предыдущая сессия')).toMatchObject({ intent: 'switch_session_prev' });
    expect(parseVoiceCommand('сессия 2')).toMatchObject({ intent: 'switch_session_index', payload: { sessionIndex: 1 } });
    expect(parseVoiceCommand('последний чат')).toMatchObject({ intent: 'switch_session_index', payload: { sessionIndex: -1 } });
    expect(parseVoiceCommand('открой чат Рефакторинг')).toMatchObject({
      intent: 'navigate_ai_session',
      payload: { sessionTitle: 'Рефакторинг' }
    });
  });

  it('лимиты и быстрые промпты', () => {
    expect(parseVoiceCommand('покажи лимиты')).toMatchObject({ intent: 'show_claude_usage' });
    expect(parseVoiceCommand('следующая задача')).toMatchObject({ intent: 'quick_next_task' });
    expect(parseVoiceCommand('сделай коммит')).toMatchObject({ intent: 'quick_commit' });
    expect(parseVoiceCommand('деплой')).toMatchObject({ intent: 'quick_deploy' });
  });

  it('диктовка промпта агенту сохраняет исходный регистр текста', () => {
    expect(parseVoiceCommand('Напиши агенту Проверь тесты')).toEqual({
      type: 'ai_control',
      intent: 'send_prompt',
      payload: { text: 'Проверь тесты' },
      feedbackText: 'Отправляю промпт агенту: Проверь тесты'
    });
  });
});

describe('parseVoiceCommand: проекты, вкладки, действия и fallback', () => {
  it('навигация по проектам: закрыть, циклически, по индексу, по имени', () => {
    expect(parseVoiceCommand('закрой проект')).toMatchObject({ type: 'navigation', intent: 'close_current_project' });
    expect(parseVoiceCommand('следующий проект')).toMatchObject({ intent: 'switch_project_next' });
    expect(parseVoiceCommand('прошлый проект')).toMatchObject({ intent: 'switch_project_last' });
    expect(parseVoiceCommand('проект 3')).toMatchObject({ intent: 'switch_project_index', payload: { tabIndex: 2 } });
    expect(parseVoiceCommand('первая вкладка')).toMatchObject({ intent: 'switch_project_index', payload: { tabIndex: 0 } });
    expect(parseVoiceCommand('открой проект WorldSim')).toMatchObject({
      intent: 'navigate_project',
      payload: { projectName: 'WorldSim' }
    });
  });

  it('основные вкладки и панели', () => {
    expect(parseVoiceCommand('покажи гит')).toMatchObject({ intent: 'navigate_git', payload: 'git' });
    expect(parseVoiceCommand('файлы')).toMatchObject({ intent: 'navigate_files' });
    expect(parseVoiceCommand('терминал')).toMatchObject({ intent: 'toggle_terminal' });
    expect(parseVoiceCommand('скрой меню')).toMatchObject({ intent: 'hide_sidebar' });
    expect(parseVoiceCommand('меню')).toMatchObject({ intent: 'toggle_sidebar' });
  });

  it('action runner: запуск/остановка dev-сервера, деплой, тесты', () => {
    expect(parseVoiceCommand('запусти сервер')).toMatchObject({ type: 'action', intent: 'run_dev' });
    expect(parseVoiceCommand('останови сервер')).toMatchObject({ intent: 'stop_dev' });
    expect(parseVoiceCommand('прогони тесты')).toMatchObject({ intent: 'run_tests' });
  });

  it('нераспознанная фраза → диктовка с исходным текстом', () => {
    expect(parseVoiceCommand('  Просто какая-то фраза  ')).toEqual({
      type: 'dictation',
      intent: 'dictate',
      payload: '  Просто какая-то фраза  ',
      feedbackText: 'Распознано:   Просто какая-то фраза  '
    });
  });
});
