/**
 * Разбиение текста на фрагменты для потокового синтеза речи (TASK-69).
 *
 * Piper/VITS синтезирует фразу целиком, поэтому длинный текст озвучивался бы с большой задержкой
 * до первого звука. Текст режется на предложения, и каждое уходит в воркер отдельным чанком —
 * первое предложение слышно меньше чем через секунду, пока считаются остальные.
 *
 * Чистый модуль: без Electron, Node API и React — покрыт unit-тестами (decision-21, правило 17).
 */

/** Максимальная длина одного фрагмента в символах: длиннее — растёт задержка первого звука. */
export const DEFAULT_MAX_CHARS = 240;

/** Фрагменты короче этого склеиваются с соседними — иначе синтез «рубит» речь на слоги. */
const MIN_CHUNK_CHARS = 3;

/**
 * Сокращения, после точки в которых предложение не заканчивается (без завершающей точки,
 * в нижнем регистре). Внутренние точки убираются при сравнении: `т.д.` → `тд`.
 */
const ABBREVIATIONS = new Set([
  'тд', 'тп', 'те', 'др', 'см', 'рис', 'табл', 'стр', 'гг', 'вв', 'напр', 'проф', 'акад',
  'англ', 'рус', 'лат', 'руб', 'коп', 'млн', 'млрд', 'тыс', 'им', 'ул', 'пр', 'д', 'г', 'в',
  'mr', 'mrs', 'ms', 'dr', 'prof', 'inc', 'ltd', 'eg', 'ie', 'etc', 'vs', 'no', 'fig', 'approx'
]);

/** Символы конца предложения. */
const SENTENCE_END = new Set(['.', '!', '?', '…']);

/** Места «мягкого» переноса, если предложение длиннее лимита. */
const SOFT_BREAK = [';', ',', ':', '—', '–', ')'];

/**
 * Убирает из текста разметку, которую незачем проговаривать вслух: заголовки, маркеры списков,
 * ограждения кода, ссылки вида `[текст](url)` (остаётся текст), эмфазу и лишние пробелы.
 * Переводы строк сохраняются — они служат границами предложений.
 */
export function normalizeTtsText(text: string): string {
  if (!text) return '';
  return (
    text
      .replace(/\r\n?/g, '\n')
      // блоки кода целиком: читать их вслух бессмысленно
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      // ссылки и изображения: остаётся только подпись
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // заголовки и цитаты в начале строки
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]*>[ \t]?/gm, '')
      // маркеры списков в начале строки (не трогаем «5.» внутри строки)
      .replace(/^[ \t]*[-*+][ \t]+/gm, '')
      // эмфаза
      .replace(/(\*\*|__|\*|_)(\S[\s\S]*?\S|\S)\1/g, '$2')
      // горизонтальные линейки
      .replace(/^[ \t]*([-*_])[ \t]*(\1[ \t]*){2,}$/gm, ' ')
      // пробелы и табы схлопываем, переводы строк оставляем как границы
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n+ */g, '\n')
      .trim()
  );
}

/** Слово перед точкой — известное сокращение или инициал (`А.`)? */
function isAbbreviationBefore(text: string, dotIndex: number): boolean {
  let start = dotIndex;
  while (start > 0) {
    const ch = text[start - 1];
    if (/[\p{L}\p{N}.]/u.test(ch)) start -= 1;
    else break;
  }
  const word = text.slice(start, dotIndex).replace(/\./g, '').toLowerCase();
  if (!word) return false;
  // Одиночная буква перед точкой — инициал («А. С. Пушкин»), не конец предложения
  if (word.length === 1 && /\p{L}/u.test(word)) return true;
  return ABBREVIATIONS.has(word);
}

/** Точка внутри числа (`3.14`, `1.2.3`) — не конец предложения. */
function isInsideNumber(text: string, dotIndex: number): boolean {
  const prev = text[dotIndex - 1];
  const next = text[dotIndex + 1];
  return Boolean(prev && next && /\d/.test(prev) && /\d/.test(next));
}

/**
 * Считает позицию концом предложения, если за знаком идёт пробел/конец строки, а следующий
 * значимый символ не строчная буква (иначе это, скорее всего, сокращение или опечатка).
 */
function isSentenceBoundary(text: string, index: number): boolean {
  const ch = text[index];
  if (!SENTENCE_END.has(ch)) return false;
  if (ch === '.' && (isInsideNumber(text, index) || isAbbreviationBefore(text, index))) return false;

  // Подряд идущие знаки («?!», «...») — граница только после последнего
  let end = index;
  while (end + 1 < text.length && SENTENCE_END.has(text[end + 1])) end += 1;
  if (end !== index) return false;

  const rest = text.slice(index + 1);
  if (rest.length === 0) return true;
  if (!/^[\s»"')\]]/.test(rest)) return false;

  const nextMeaningful = rest.replace(/^[\s»"')\]]+/, '')[0];
  if (!nextMeaningful) return true;
  // строчная буква после точки — продолжение предложения («и т. д. далее»)
  return !/\p{Ll}/u.test(nextMeaningful);
}

/** Режет слишком длинный фрагмент по знакам препинания, а если их нет — по пробелам. */
function splitLongChunk(chunk: string, maxChars: number): string[] {
  if (chunk.length <= maxChars) return [chunk];

  const parts: string[] = [];
  let rest = chunk;

  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);

    let cut = -1;
    for (const sign of SOFT_BREAK) {
      const idx = window.lastIndexOf(sign);
      if (idx > cut) cut = idx;
    }
    // знак препинания забираем в текущий фрагмент
    if (cut >= MIN_CHUNK_CHARS) cut += 1;
    else cut = window.lastIndexOf(' ');
    // ни знаков, ни пробелов — режем жёстко по лимиту
    if (cut < MIN_CHUNK_CHARS) cut = maxChars;

    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest.length > 0) parts.push(rest);
  return parts.filter((p) => p.length > 0);
}

/**
 * Разбивает текст на фрагменты для последовательного синтеза.
 *
 * @param text исходный текст (любой длины, допускается разметка)
 * @param maxChars максимальная длина фрагмента; длиннее — режется по знакам препинания
 * @returns непустые фрагменты в порядке чтения; для пустого текста — пустой массив
 */
export function splitTextForTts(text: string, maxChars: number = DEFAULT_MAX_CHARS): string[] {
  const limit = Math.max(MIN_CHUNK_CHARS * 2, Math.floor(maxChars) || DEFAULT_MAX_CHARS);
  const normalized = normalizeTtsText(text);
  if (!normalized) return [];

  // 1. Границы предложений и переводов строк
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === '\n') {
      const piece = normalized.slice(start, i).trim();
      if (piece) sentences.push(piece);
      start = i + 1;
      continue;
    }
    if (isSentenceBoundary(normalized, i)) {
      const piece = normalized.slice(start, i + 1).trim();
      if (piece) sentences.push(piece);
      start = i + 1;
    }
  }
  const tail = normalized.slice(start).trim();
  if (tail) sentences.push(tail);

  // 2. Склейка слишком коротких огрызков с предыдущим фрагментом
  const merged: string[] = [];
  for (const sentence of sentences) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && (sentence.length < MIN_CHUNK_CHARS || prev.length < MIN_CHUNK_CHARS)) {
      const joined = `${prev} ${sentence}`.trim();
      if (joined.length <= limit) {
        merged[merged.length - 1] = joined;
        continue;
      }
    }
    merged.push(sentence);
  }

  // 3. Принудительный разрез длинных предложений
  const result: string[] = [];
  for (const sentence of merged) {
    for (const part of splitLongChunk(sentence, limit)) {
      if (part) result.push(part);
    }
  }
  return result;
}
