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

/**
 * Около 45 с речи. Потолок задаёт, сколько слушать, а не как синтезировать: Qwen3-TTS озвучивает
 * такую сводку двумя-тремя фрагментами, Piper — по предложениям (TASK-116, decision-71).
 */
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

  // Заголовки, цитаты, маркеры списков и выделение. Только `[ \t]`, не `\s`: в режиме `m` `\s`
  // захватывает и перевод строки, и маркер следующей строки склеил бы абзацы.
  out = out.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  out = out.replace(/^[ \t]{0,3}>[ \t]?/gm, '');
  out = out.replace(/^[ \t]*[*+-][ \t]+/gm, '');
  out = out.replace(/^[ \t]*\d+[.)][ \t]+/gm, '');
  out = out.replace(/`([^`]*)`/g, '$1');
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/\*([^*]+)\*/g, '$1');
  out = out.replace(/__([^_]+)__/g, '$1');

  // Пробелы схлопываются внутри строки; строки и абзацы (`\n\n`) сохраняются: по ним Qwen3-TTS
  // собирает фрагменты, а Piper режет речь (TASK-116).
  return out
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Обрезка по границе предложения, а не по символу: обрубленное слово на слух режет ухо. */
function truncateAtSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  // Конец предложения — знак, за которым пробел или перевод строки (символ за пределом тоже смотрим)
  let sentenceEnd = -1;
  for (let i = maxChars - 1; i >= 0; i -= 1) {
    if ('.!?'.includes(text[i]) && /\s/.test(text[i + 1] ?? '')) {
      sentenceEnd = i;
      break;
    }
  }
  if (sentenceEnd > maxChars * 0.4) return text.slice(0, sentenceEnd + 1).trim();

  const head = text.slice(0, maxChars);
  const space = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'));
  const cut = space > maxChars * 0.4 ? head.slice(0, space) : head;
  return `${cut.trim()}…`;
}

/**
 * Готовит текст к произнесению: снимает код, диффы и разметку, схлопывает пробелы и обрезает.
 * Переводы строк и пустая строка между абзацами сохраняются.
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
