import { describe, expect, it } from 'vitest';

import { ALL_TTS_ERROR_CODES } from '../../electron/services/ttsErrorCodes';
import { en } from '../../src/i18n/en';
import { ru } from '../../src/i18n/ru';

/**
 * Контракт decision-25 п. 3: main отдаёт код ошибки, а текст живёт в i18n рендерера. Цена ошибки —
 * сырой `already_installed` в интерфейсе вместо сообщения (TASK-87, дефект 2), и заметить это
 * без теста нельзя: TypeScript словарь кодов не проверяет (`ttsErrors: Record<string, string>`).
 */
const dictionaries = {
  ru: ru.voice.settingsModal.ttsErrors,
  en: en.voice.settingsModal.ttsErrors
};

describe('коды ошибок TTS переведены целиком (TASK-87, AC#2)', () => {
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    it(`каждый код имеет непустой перевод в ${language}`, () => {
      const missing = ALL_TTS_ERROR_CODES.filter((code) => {
        const text = dictionary[code];
        return typeof text !== 'string' || text.trim().length === 0;
      });

      expect(missing, `нет перевода для кодов: ${missing.join(', ')}`).toEqual([]);
    });

    it(`в словаре ${language} нет кодов, которых больше нет в main`, () => {
      const orphans = Object.keys(dictionary).filter((code) => !ALL_TTS_ERROR_CODES.includes(code));

      expect(orphans, `осиротевшие ключи: ${orphans.join(', ')}`).toEqual([]);
    });
  }

  it('наборы ключей ru и en совпадают', () => {
    expect(Object.keys(dictionaries.ru).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });

  it('список кодов не содержит дублей', () => {
    expect(new Set(ALL_TTS_ERROR_CODES).size).toBe(ALL_TTS_ERROR_CODES.length);
  });
});
