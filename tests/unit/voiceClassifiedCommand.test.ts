import { describe, expect, it } from 'vitest';
import { VOICE_INTENT_CATALOG } from '../../electron/services/voiceCommandClassifier';
import { parseVoiceCommand } from '../../src/services/voiceCommandParser';
import { TAB_BY_NAVIGATION_INTENT, toExecutableVoiceCommand } from '../../src/services/voiceClassifiedCommand';

/** Фразы, по которым парсер регулярок выдаёт каждый интент навигации по вкладкам и меню проектов. */
const CANONICAL_PHRASES: Record<string, string> = {
  navigate_ai: 'открой чат',
  navigate_kanban: 'открой задачи',
  navigate_milestones: 'майлстоуны',
  navigate_git: 'открой гит',
  navigate_files: 'открой файлы',
  navigate_prs: 'открой пулл реквесты',
  navigate_docs: 'открой документацию',
  navigate_analytics: 'открой аналитику',
  toggle_sidebar: 'меню проектов',
  hide_sidebar: 'скрой меню',
  show_sidebar: 'верни меню'
};

describe('toExecutableVoiceCommand: команда модели исполняется так же, как команда регулярок (TASK-83)', () => {
  for (const [intent, phrase] of Object.entries(CANONICAL_PHRASES)) {
    it(`${intent}: тип и payload совпадают с парсером («${phrase}»)`, () => {
      const parsed = parseVoiceCommand(phrase);
      expect(parsed.intent, `фраза «${phrase}» должна давать ${intent}`).toBe(intent);

      const spec = VOICE_INTENT_CATALOG.find((s) => s.id === intent);
      expect(spec, `интент ${intent} есть в каталоге классификатора`).toBeDefined();

      const executable = toExecutableVoiceCommand({ intent, type: spec!.type }, 'x');
      expect(executable.type).toBe(parsed.type);
      expect(executable.payload).toEqual(parsed.payload);
    });
  }

  it('каждый интент навигации каталога имеет вкладку', () => {
    const navigate = VOICE_INTENT_CATALOG.filter((s) => s.id.startsWith('navigate_') && s.id !== 'navigate_project' && s.id !== 'navigate_ai_session');
    for (const spec of navigate) expect(TAB_BY_NAVIGATION_INTENT[spec.id], spec.id).toBeTruthy();
  });

  it('диктовка — в ветке действий, payload модели сохраняется у остальных интентов', () => {
    expect(toExecutableVoiceCommand({ intent: 'dictation_start', type: 'dictation' }, 'x').type).toBe('action');
    expect(toExecutableVoiceCommand({ intent: 'navigate_project', type: 'navigation', payload: { projectName: 'WorldSim' } }, 'f')).toEqual({
      type: 'navigation',
      intent: 'navigate_project',
      payload: { projectName: 'WorldSim' },
      feedbackText: 'f'
    });
    expect(toExecutableVoiceCommand({ intent: 'send_prompt', type: 'ai_control', payload: { text: 'hi' } }, 'f').type).toBe('ai_control');
  });
});
