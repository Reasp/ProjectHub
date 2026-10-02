/**
 * Язык распознавания речи отдельно от языка интерфейса (TASK-117, decision-72).
 *
 * До TASK-117 Whisper и Web Speech API всегда распознавали на языке интерфейса: при интерфейсе EN
 * русская речь «переводилась» на английский. Теперь язык распознавания — отдельная настройка, а
 * язык конкретной фразы (по нему работают классификатор команд и озвучка ответа) берётся из того,
 * что распознавание сообщило или что видно по тексту.
 *
 * Чистый модуль: без React, Electron и браузерных API — покрыт unit-тестами.
 */

export type VoiceLanguage = 'ru' | 'en';

/** Настройка «Язык распознавания»: как интерфейс, явный язык или автоопределение. */
export type RecognitionLanguage = 'ui' | VoiceLanguage | 'auto';

/** Язык, с которым уходит запрос к движку распознавания. */
export type RecognitionRequestLanguage = VoiceLanguage | 'auto';

export const DEFAULT_RECOGNITION_LANGUAGE: RecognitionLanguage = 'ui';

const RECOGNITION_LANGUAGES: readonly RecognitionLanguage[] = ['ui', 'ru', 'en', 'auto'];

/**
 * Значение из сохранённых настроек. У существующих пользователей поля нет — получают «как
 * интерфейс», то есть прежнее поведение.
 */
export function normalizeRecognitionLanguage(raw: unknown): RecognitionLanguage {
  return RECOGNITION_LANGUAGES.includes(raw as RecognitionLanguage) ? (raw as RecognitionLanguage) : DEFAULT_RECOGNITION_LANGUAGE;
}

/**
 * Умеет ли движок определить язык сам. Whisper — да: локальный определяет язык первым шагом
 * декодера (`electron/workers/whisperLanguage.mjs`), облачные — если не передать язык. Web Speech
 * API требует язык заранее.
 */
export function supportsAutoDetect(engine: 'whisper' | 'webspeech'): boolean {
  return engine === 'whisper';
}

/** Язык запроса к движку: автоопределение без поддержки движка откатывается на язык интерфейса. */
export function resolveRecognitionRequest(
  setting: RecognitionLanguage,
  uiLanguage: VoiceLanguage,
  autoSupported: boolean
): RecognitionRequestLanguage {
  if (setting === 'ru' || setting === 'en') return setting;
  if (setting === 'auto' && autoSupported) return 'auto';
  return uiLanguage;
}

/** Нужна ли в настройках подсказка «движок не умеет автоопределение, используется язык интерфейса». */
export function autoDetectUnavailable(setting: RecognitionLanguage, engine: 'whisper' | 'webspeech'): boolean {
  return setting === 'auto' && !supportsAutoDetect(engine);
}

/**
 * Доля кириллицы, начиная с которой текст русский. Порог несимметричный: в русской речи латиницей
 * пишутся термины («запусти npm run build в ProjectHub» — латиницы больше половины), а кириллица в
 * английской фразе почти не встречается.
 */
const CYRILLIC_SHARE_FOR_RU = 0.3;

/**
 * Язык текста по алфавиту: кириллица — русский, латиница — английский. Для двух поддерживаемых
 * языков этого достаточно, и Whisper пишет распознанное на языке речи. `null` — букв нет.
 */
export function detectTextLanguage(text: string): VoiceLanguage | null {
  let cyrillic = 0;
  let latin = 0;
  for (const ch of text ?? '') {
    if (/\p{Script=Cyrillic}/u.test(ch)) cyrillic += 1;
    else if (/[a-z]/i.test(ch)) latin += 1;
  }
  const letters = cyrillic + latin;
  if (letters === 0) return null;
  return cyrillic / letters >= CYRILLIC_SHARE_FOR_RU ? 'ru' : 'en';
}

/**
 * Язык распознанной фразы — по нему работают классификатор команд и озвучка ответа на фразу.
 *
 * 1. Язык, который сообщил движок (автоопределение локального Whisper).
 * 2. Явный язык запроса: Whisper с заданным языком пишет именно на нём.
 * 3. Алфавит распознанного текста (облачный Whisper без языка).
 * 4. Язык интерфейса.
 */
export function resolvePhraseLanguage(input: {
  reported?: VoiceLanguage | null;
  requested: RecognitionRequestLanguage;
  text: string;
  uiLanguage: VoiceLanguage;
}): VoiceLanguage {
  if (input.reported === 'ru' || input.reported === 'en') return input.reported;
  if (input.requested === 'ru' || input.requested === 'en') return input.requested;
  return detectTextLanguage(input.text) ?? input.uiLanguage;
}

/**
 * Язык озвучки текста: голос подбирается под язык самого текста. Ответ агента по-русски при
 * интерфейсе EN читается русским голосом; строки интерфейса и так на его языке.
 */
export function speechLanguageForText(text: string, uiLanguage: VoiceLanguage): VoiceLanguage {
  return detectTextLanguage(text) ?? uiLanguage;
}
