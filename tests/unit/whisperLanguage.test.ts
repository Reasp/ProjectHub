import { describe, expect, it } from 'vitest';

import {
  pickWhisperLanguage,
  WHISPER_AUTO_MIN_MARGIN,
  whisperLanguageName
} from '../../electron/workers/whisperLanguage.mjs';

describe('whisperLanguage — автоопределение языка по логитам (TASK-117, AC #4)', () => {
  it('фразы из нескольких слов узнаются с большим отрывом (замер whisper-base 2026-10-02)', () => {
    expect(pickWhisperLanguage({ ru: 9.93, en: 22.11 }, 'ru')).toMatchObject({ language: 'en', confident: true });
    expect(pickWhisperLanguage({ ru: 24.39, en: 17.05 }, 'en')).toMatchObject({ language: 'ru', confident: true });
  });

  it('однословное «Да» с малым отрывом уходит в запасной язык — язык интерфейса', () => {
    // «Да.» дало ru 12.13 против en 13.94
    expect(pickWhisperLanguage({ ru: 12.13, en: 13.94 }, 'ru')).toMatchObject({ language: 'ru', confident: false });
    expect(pickWhisperLanguage({ ru: 12.13, en: 13.94 }, 'en').language).toBe('en');
  });

  it('отрыв считается от победителя ко второму', () => {
    const result = pickWhisperLanguage({ ru: 10, en: 10 + WHISPER_AUTO_MIN_MARGIN }, 'ru');
    expect(result).toMatchObject({ language: 'en', confident: true });
    expect(result.margin).toBeCloseTo(WHISPER_AUTO_MIN_MARGIN, 6);
  });

  it('нет логита одного из языков или мусор — запасной язык', () => {
    expect(pickWhisperLanguage({ ru: 5 }, 'en')).toMatchObject({ language: 'en', confident: false });
    expect(pickWhisperLanguage({ ru: Number.NaN, en: 3 }, 'ru').language).toBe('ru');
    expect(pickWhisperLanguage(null as unknown as Record<string, number>, 'ru').language).toBe('ru');
  });

  it('имя языка для пайплайна transformers.js', () => {
    expect(whisperLanguageName('en')).toBe('english');
    expect(whisperLanguageName('ru')).toBe('russian');
  });
});
