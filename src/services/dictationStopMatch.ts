import { CONFIGURABLE_COMMANDS } from './voiceCommandPhrases';

/**
 * Нечёткое распознавание стоп-фразы в режиме диктовки (TASK-98).
 *
 * В диктовке стоп-фраза — единственный выход из режима, а всё остальное печатается в активное
 * окно. Whisper-base слышит «Конец диктовки» как «Коронец диктовки.», и точное сравнение
 * такую фразу пропускает: режим не выключается, фраза печатается в документ.
 *
 * Сопоставление намеренно узкое, чтобы не съедать обычный текст:
 * - фраза целиком короткая — столько же слов, сколько в стоп-фразе;
 * - слово-якорь («дикт…», «dict…») должно начинаться с основы якоря;
 * - остальные слова — в пределах малого расстояния правки;
 * - стоп-фраза должна подходить строго лучше фраз включения диктовки («включи диктовку»
 *   отличается от «выключи диктовку» одной буквой).
 */

/**
 * Основы слова-якоря: без них фраза не считается стоп-фразой даже при малом расстоянии.
 * Короткие намеренно: whisper-base под шумом слышит «диктовки» как «диктухней», «диктохни».
 */
const ANCHOR_STEMS = ['дикт', 'dict'];

/**
 * Слова, которые VAD/whisper добавляет перед фразой («и конец диктовки»). Явный список, а не
 * «любое короткое слово»: «не конец диктовки» стоп-фразой быть не должна.
 */
const LEADING_FILLERS = new Set(['и', 'а', 'ну', 'вот', 'э', 'ээ', 'and', 'so', 'uh', 'um']);

/** Максимум правок на одно неякорное слово и доля от его длины. */
const MAX_WORD_EDITS = 2;
const MAX_WORD_EDIT_RATIO = 0.4;

/** Регистр, ё→е, пунктуация и лишние пробелы. */
export function normalizeSpokenPhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Расстояние Левенштейна. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function anchorStem(word: string): string | undefined {
  return ANCHOR_STEMS.find((stem) => word.startsWith(stem));
}

/**
 * Сумма правок между фразой и шаблоном или null, если фраза шаблону не соответствует.
 * Шаблон без слова-якоря нечётко не сопоставляется — только точно.
 */
function phraseDistance(spoken: string[], pattern: string[]): number | null {
  if (spoken.length !== pattern.length) return null;
  let total = 0;
  let hasAnchor = false;
  for (let i = 0; i < pattern.length; i++) {
    const stem = anchorStem(pattern[i]);
    if (stem) {
      if (!spoken[i].startsWith(stem)) return null;
      hasAnchor = true;
      total += editDistance(spoken[i], pattern[i]);
      continue;
    }
    const d = editDistance(spoken[i], pattern[i]);
    if (d > MAX_WORD_EDITS || d > Math.floor(pattern[i].length * MAX_WORD_EDIT_RATIO)) return null;
    total += d;
  }
  if (!hasAnchor && total > 0) return null;
  return total;
}

function bestDistance(spoken: string[], phrases: string[]): number | null {
  let best: number | null = null;
  for (const phrase of phrases) {
    const words = normalizeSpokenPhrase(phrase).split(' ').filter(Boolean);
    if (!words.length) continue;
    const d = phraseDistance(spoken, words);
    if (d !== null && (best === null || d < best)) best = d;
  }
  return best;
}

function phrasesFor(intent: string, customPhrases?: Record<string, string[]>): string[] {
  const custom = customPhrases?.[intent];
  if (custom && custom.length) return custom;
  return CONFIGURABLE_COMMANDS.find((c) => c.intent === intent)?.defaultPhrases ?? [];
}

/**
 * Похожа ли распознанная фраза на стоп-фразу диктовки (`dictation_stop`) с учётом ошибок
 * распознавания. Вызывается только в режиме диктовки.
 */
export function isFuzzyDictationStop(text: string, customPhrases?: Record<string, string[]>): boolean {
  const words = normalizeSpokenPhrase(text).split(' ').filter(Boolean);
  if (!words.length) return false;
  const variants = [words];
  if (words.length > 1 && LEADING_FILLERS.has(words[0])) variants.push(words.slice(1));
  return variants.some((spoken) => {
    const stop = bestDistance(spoken, phrasesFor('dictation_stop', customPhrases));
    if (stop === null) return false;
    const start = bestDistance(spoken, phrasesFor('dictation_start', customPhrases));
    return start === null || stop < start;
  });
}
