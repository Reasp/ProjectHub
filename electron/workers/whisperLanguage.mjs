/**
 * Автоопределение языка речи для локального Whisper (TASK-117, decision-72).
 *
 * transformers.js не определяет язык сам: без языка он молча распознаёт как английский. Язык
 * определяется первым шагом декодера — после `<|startoftranscript|>` модель предсказывает токен
 * языка, и сравниваются логиты поддерживаемых языков. При малом отрыве (однословное «Да» модель
 * путает с «Yeah») берётся запасной язык — язык интерфейса.
 *
 * Чистый модуль без transformers.js — покрыт unit-тестами; сам прогон модели — в whisperWorker.mjs.
 */

/** Языки, между которыми выбирает автоопределение. */
export const WHISPER_AUTO_LANGUAGES = ['ru', 'en'];

/**
 * Минимальный отрыв логита победителя. Замер 2026-10-02 на whisper-base: фразы из 3–8 слов дают
 * отрыв 6–12, однословные «Yes» — 6.0, «Да» — 1.8 в пользу английского.
 */
export const WHISPER_AUTO_MIN_MARGIN = 3;

/**
 * Выбор языка по логитам токенов языка.
 * @param {Record<string, number>} scores логит токена `<|xx|>` для каждого языка
 * @param {'ru' | 'en'} fallback язык при малом отрыве или битых данных
 * @returns {{ language: 'ru' | 'en', margin: number, confident: boolean }}
 */
export function pickWhisperLanguage(scores, fallback, minMargin = WHISPER_AUTO_MIN_MARGIN) {
  const ranked = WHISPER_AUTO_LANGUAGES.map((language) => ({ language, score: Number(scores?.[language]) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);
  if (ranked.length < 2) return { language: fallback, margin: 0, confident: false };
  const margin = ranked[0].score - ranked[1].score;
  if (margin < minMargin) return { language: fallback, margin, confident: false };
  return { language: ranked[0].language, margin, confident: true };
}

/** Код Whisper → имя языка, которое ждёт пайплайн transformers.js. */
export function whisperLanguageName(language) {
  return language === 'en' ? 'english' : 'russian';
}
