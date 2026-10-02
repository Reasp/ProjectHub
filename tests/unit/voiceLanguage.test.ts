import { describe, expect, it } from 'vitest';

import {
  autoDetectUnavailable,
  DEFAULT_RECOGNITION_LANGUAGE,
  detectTextLanguage,
  normalizeRecognitionLanguage,
  resolvePhraseLanguage,
  resolveRecognitionRequest,
  speechLanguageForText,
  supportsAutoDetect
} from '../../src/services/voiceLanguage';

describe('voiceLanguage — настройка и миграция (TASK-117, AC #1, #6)', () => {
  it('по умолчанию «как интерфейс»', () => {
    expect(DEFAULT_RECOGNITION_LANGUAGE).toBe('ui');
  });

  it('настройки без поля и с мусором мигрируют в «как интерфейс»', () => {
    expect(normalizeRecognitionLanguage(undefined)).toBe('ui');
    expect(normalizeRecognitionLanguage(null)).toBe('ui');
    expect(normalizeRecognitionLanguage('de')).toBe('ui');
    expect(normalizeRecognitionLanguage(42)).toBe('ui');
  });

  it('допустимые значения сохраняются', () => {
    for (const value of ['ui', 'ru', 'en', 'auto'] as const) expect(normalizeRecognitionLanguage(value)).toBe(value);
  });
});

describe('voiceLanguage — язык запроса к движку (AC #2, #3, #4)', () => {
  it('«как интерфейс» следует за переключателем EN / RU — прежнее поведение', () => {
    expect(resolveRecognitionRequest('ui', 'ru', true)).toBe('ru');
    expect(resolveRecognitionRequest('ui', 'en', true)).toBe('en');
  });

  it('явный язык не зависит от языка интерфейса: интерфейс EN, распознавание «Русский»', () => {
    expect(resolveRecognitionRequest('ru', 'en', true)).toBe('ru');
    expect(resolveRecognitionRequest('ru', 'en', false)).toBe('ru');
    expect(resolveRecognitionRequest('en', 'ru', true)).toBe('en');
  });

  it('автоопределение уходит в Whisper, а без поддержки откатывается на язык интерфейса', () => {
    expect(resolveRecognitionRequest('auto', 'en', true)).toBe('auto');
    expect(resolveRecognitionRequest('auto', 'en', false)).toBe('en');
    expect(resolveRecognitionRequest('auto', 'ru', false)).toBe('ru');
  });

  it('автоопределение умеет только Whisper; подсказка — только для Web Speech с автоопределением', () => {
    expect(supportsAutoDetect('whisper')).toBe(true);
    expect(supportsAutoDetect('webspeech')).toBe(false);
    expect(autoDetectUnavailable('auto', 'webspeech')).toBe(true);
    expect(autoDetectUnavailable('auto', 'whisper')).toBe(false);
    expect(autoDetectUnavailable('ru', 'webspeech')).toBe(false);
  });
});

describe('voiceLanguage — язык текста по алфавиту', () => {
  it('кириллица — русский, латиница — английский', () => {
    expect(detectTextLanguage('Переключись на следующий проект.')).toBe('ru');
    expect(detectTextLanguage('Switch to the next project.')).toBe('en');
  });

  it('латинские термины в русской фразе не делают её английской', () => {
    expect(detectTextLanguage('Открой ProjectHub и запусти npm run build')).toBe('ru');
    expect(detectTextLanguage('Сделай git push')).toBe('ru');
  });

  it('одно русское слово в длинной английской фразе её не перекрашивает', () => {
    expect(detectTextLanguage('Please open the backlog board and show the next task, спасибо')).toBe('en');
  });

  it('без букв — не определён', () => {
    expect(detectTextLanguage('')).toBeNull();
    expect(detectTextLanguage('123, 456!')).toBeNull();
  });
});

describe('voiceLanguage — язык распознанной фразы (AC #5)', () => {
  it('язык, сообщённый автоопределением, главнее всего', () => {
    expect(resolvePhraseLanguage({ reported: 'en', requested: 'auto', text: 'Да', uiLanguage: 'ru' })).toBe('en');
  });

  it('явный язык запроса — язык фразы: Whisper пишет на заданном языке', () => {
    expect(resolvePhraseLanguage({ requested: 'ru', text: 'Open', uiLanguage: 'en' })).toBe('ru');
  });

  it('облачное автоопределение без языка в ответе — по алфавиту текста, затем язык интерфейса', () => {
    expect(resolvePhraseLanguage({ requested: 'auto', text: 'Покажи задачи', uiLanguage: 'en' })).toBe('ru');
    expect(resolvePhraseLanguage({ reported: null, requested: 'auto', text: '42', uiLanguage: 'en' })).toBe('en');
  });

  it('озвучка подбирает голос под язык текста, без букв — язык интерфейса', () => {
    expect(speechLanguageForText('Готово, тесты зелёные.', 'en')).toBe('ru');
    expect(speechLanguageForText('Done, tests are green.', 'ru')).toBe('en');
    expect(speechLanguageForText('2 + 2', 'ru')).toBe('ru');
  });
});
