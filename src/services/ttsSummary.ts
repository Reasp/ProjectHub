/**
 * Подготовка ответа агента к озвучке (TASK-83, п. 3).
 *
 * Читать вслух ответ агента как есть нельзя: там блоки кода, диффы, таблицы и пути к файлам —
 * на слух это шум. Модуль оставляет прозаическую часть и обрезает её до разумной длины.
 *
 * Пересечение с `electron/services/ttsTextSplit.ts` кажущееся: тот живёт в main, применяется только
 * на пути Piper и решает другую задачу — резать текст на предложения для потокового синтеза. Здесь
 * нужен результат до выбора движка (системный `speechSynthesis` не чистит текст вовсе) и с
 * ограничением длины, которого там нет.
 *
 * Чистый модуль без React и Electron — покрыт unit-тестами.
 */

export interface TtsSummaryOptions {
  /** Потолок длины: длинный ответ агента озвучивается сводкой, а не целиком. */
  maxChars?: number;
}

export const DEFAULT_TTS_SUMMARY_MAX_CHARS = 600;

/**
 * Строки, которые вслух не читают: служебные заголовки диффа, таблицы, горизонтальные линии.
 *
 * Тела диффов и кода сюда обычно не доходят — их уже сняла обработка ограждённых блоков. Маркеры
 * списков (`- `, `+ `, `* `) намеренно не трогаем: это нормальная речь, и они снимаются ниже как
 * разметка, а не выбрасываются вместе с содержимым.
 */
function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^(\+\+\+|@@|diff --git|index [0-9a-f]{7,})/.test(trimmed)) return true;
  if (/^-{3,}$/.test(trimmed)) return true;
  if (/^\|.*\|$/.test(trimmed)) return true;
  if (/^([*_=])\1{2,}$/.test(trimmed)) return true;
  return false;
}

function stripCodeAndMarkup(text: string): string {
  let out = text ?? '';

  // Блоки кода в ограде — вместе с содержимым.
  out = out.replace(/```[\s\S]*?```/g, ' ');
  out = out.replace(/~~~[\s\S]*?~~~/g, ' ');
  // Незакрытая ограда: всё после неё — код (ответ мог оборваться на полуслове).
  out = out.replace(/```[\s\S]*$/g, ' ');

  // Картинки убираем целиком, у ссылок оставляем текст.
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // HTML-разметка.
  out = out.replace(/<[^>]+>/g, ' ');

  out = out
    .split(/\r?\n/)
    .filter((line) => !isNoiseLine(line))
    .join('\n');

  // Заголовки, цитаты, маркеры списков и выделение.
  out = out.replace(/^#{1,6}\s+/gm, '');
  out = out.replace(/^\s{0,3}>\s?/gm, '');
  out = out.replace(/^\s*[*+-]\s+/gm, '');
  out = out.replace(/^\s*\d+[.)]\s+/gm, '');
  out = out.replace(/`([^`]*)`/g, '$1');
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/\*([^*]+)\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');

  return out.replace(/\s+/g, ' ').trim();
}

/** Обрезка по границе предложения, а не по символу: обрубленное слово на слух режет ухо. */
function truncateAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const head = text.slice(0, maxChars);
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (sentenceEnd > maxChars * 0.4) return head.slice(0, sentenceEnd + 1).trim();

  const space = head.lastIndexOf(' ');
  const cut = space > maxChars * 0.4 ? head.slice(0, space) : head;
  return `${cut.trim()}…`;
}

/**
 * Готовит текст к произнесению: снимает код, диффы и разметку, схлопывает пробелы и обрезает.
 *
 * @returns пустую строку, если читать вслух нечего (ответ состоял только из кода).
 */
export function summarizeForSpeech(text: string, options: TtsSummaryOptions = {}): string {
  const maxChars = options.maxChars ?? DEFAULT_TTS_SUMMARY_MAX_CHARS;
  const cleaned = stripCodeAndMarkup(text ?? '');
  if (!cleaned) return '';
  return truncateAtSentence(cleaned, maxChars);
}

/** В ответе не осталось ничего, кроме кода и разметки. */
export function hasSpeakableContent(text: string): boolean {
  return stripCodeAndMarkup(text ?? '').length > 0;
}
