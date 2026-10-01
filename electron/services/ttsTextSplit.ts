/**
 * Разбиение текста на фрагменты для потокового синтеза речи (TASK-69).
 *
 * Piper/VITS синтезирует фразу целиком, поэтому длинный текст озвучивался бы с большой задержкой
 * до первого звука. Текст режется на предложения, и каждое уходит в воркер отдельным чанком —
 * первое предложение слышно меньше чем через секунду, пока считаются остальные.
 *
 * Qwen3-TTS отдаёт звук потоком внутри фрагмента, и каждый стык фрагментов стоит ему паузы и новой
 * интонации, — для него текст режется крупнее, по абзацам (`splitTextForStreamingTts`, TASK-116).
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
 * Переводы строк сохраняются — они служат границами предложений; пустая строка между абзацами
 * остаётся одной пустой строкой (`\n\n`), по ней Qwen3-TTS собирает фрагменты (TASK-116).
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
      // пробелы и табы схлопываем, переводы строк оставляем как границы, абзацы — как `\n\n`
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
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

/** Предложение или строка текста и то, чем оно закончилось. */
interface Segment {
  text: string;
  /** Закончилось переводом строки, а не знаком конца предложения (пункт списка, заголовок). */
  lineEnd: boolean;
  /** Последнее в абзаце: за ним пустая строка или конец текста. */
  paragraphEnd: boolean;
  /** Кусок длинного предложения, разрезанного по лимиту: следующий кусок — его продолжение. */
  partial: boolean;
}

function limitOf(maxChars: number, fallback: number): number {
  return Math.max(MIN_CHUNK_CHARS * 2, Math.floor(maxChars) || fallback);
}

/** Предложения и строки нормализованного текста; длинные разрезаны по `limit`. */
function segmentText(normalized: string, limit: number): Segment[] {
  // 1. Границы предложений и переводов строк
  const sentences: Segment[] = [];
  const push = (piece: string, lineEnd: boolean, paragraphEnd: boolean) => {
    const trimmed = piece.trim();
    if (trimmed) sentences.push({ text: trimmed, lineEnd, paragraphEnd, partial: false });
    else if (paragraphEnd && sentences.length > 0) sentences[sentences.length - 1].paragraphEnd = true;
  };
  let start = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === '\n') {
      const paragraphEnd = normalized[i + 1] === '\n';
      push(normalized.slice(start, i), true, paragraphEnd);
      if (paragraphEnd) i += 1;
      start = i + 1;
      continue;
    }
    if (isSentenceBoundary(normalized, i)) {
      push(normalized.slice(start, i + 1), false, false);
      start = i + 1;
    }
  }
  push(normalized.slice(start), true, true);
  if (sentences.length > 0) sentences[sentences.length - 1].paragraphEnd = true;

  // 2. Склейка слишком коротких огрызков с предыдущим фрагментом
  const merged: Segment[] = [];
  for (const sentence of sentences) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && (sentence.text.length < MIN_CHUNK_CHARS || prev.text.length < MIN_CHUNK_CHARS)) {
      const joined = `${prev.text} ${sentence.text}`.trim();
      if (joined.length <= limit) {
        merged[merged.length - 1] = { ...sentence, text: joined };
        continue;
      }
    }
    merged.push(sentence);
  }

  // 3. Принудительный разрез длинных предложений: признаки конца достаются последнему куску
  const result: Segment[] = [];
  for (const sentence of merged) {
    const parts = splitLongChunk(sentence.text, limit).filter((part) => part.length > 0);
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      result.push(
        last
          ? { ...sentence, text: part }
          : { text: part, lineEnd: false, paragraphEnd: false, partial: true }
      );
    });
  }
  return result;
}

/**
 * Разбивает текст на фрагменты для последовательного синтеза.
 *
 * @param text исходный текст (любой длины, допускается разметка)
 * @param maxChars максимальная длина фрагмента; длиннее — режется по знакам препинания
 * @returns непустые фрагменты в порядке чтения; для пустого текста — пустой массив
 */
export function splitTextForTts(text: string, maxChars: number = DEFAULT_MAX_CHARS): string[] {
  const normalized = normalizeTtsText(text);
  if (!normalized) return [];
  return segmentText(normalized, limitOf(maxChars, DEFAULT_MAX_CHARS)).map((segment) => segment.text);
}

/** Потолок первого фрагмента потокового синтеза: одно-два предложения. */
export const STREAMING_FIRST_MAX_CHARS = 160;
/** Потолок следующих фрагментов: ~40–50 с речи, с запасом до предела контекста модели. */
export const STREAMING_MAX_CHARS = 600;
/** Абзац короче этого продолжается следующим: иначе короткие абзацы снова дают стык на каждой фразе. */
export const STREAMING_MIN_PARAGRAPH_CHARS = 120;

export interface StreamingSplitOptions {
  firstMaxChars?: number;
  maxChars?: number;
  minParagraphChars?: number;
}

/** Строка без знака препинания в конце (пункт списка, заголовок) склеивается через точку — паузу. */
const ENDS_WITH_PUNCTUATION = /[.!?…:;,—–][»"')\]]*$/;

function joinSegments(segments: Segment[]): string {
  let out = '';
  segments.forEach((segment, index) => {
    if (index > 0) {
      const prev = segments[index - 1];
      if (prev.lineEnd && !ENDS_WITH_PUNCTUATION.test(out)) out += '.';
      out += ' ';
    }
    out += segment.text;
  });
  return out;
}

/**
 * Нарезка для потокового движка (Qwen3-TTS, TASK-116): каждый фрагмент — отдельная генерация со своей
 * задержкой до первого звука и своей интонацией, поэтому фрагменты крупные.
 *
 * Первый фрагмент — одно-два предложения: по нему движок замеряет скорость генерации и подбирает
 * размер чанка до длинного фрагмента. Следующие копят предложения до конца абзаца (если абзац не
 * короче `minParagraphChars`) или до `maxChars`. Разрез — только на границе предложения или строки;
 * предложение длиннее `maxChars` режется по знакам препинания, как в `splitTextForTts`.
 *
 * @returns непустые фрагменты в порядке чтения; для пустого текста — пустой массив
 */
export function splitTextForStreamingTts(text: string, options: StreamingSplitOptions = {}): string[] {
  const normalized = normalizeTtsText(text);
  if (!normalized) return [];

  const maxChars = limitOf(options.maxChars ?? STREAMING_MAX_CHARS, STREAMING_MAX_CHARS);
  const firstMaxChars = Math.min(maxChars, limitOf(options.firstMaxChars ?? STREAMING_FIRST_MAX_CHARS, STREAMING_FIRST_MAX_CHARS));
  const minParagraphChars = Math.max(0, options.minParagraphChars ?? STREAMING_MIN_PARAGRAPH_CHARS);
  const segments = segmentText(normalized, maxChars);

  const fragments: string[] = [];
  let index = 0;

  // Первый фрагмент: одно предложение, второе — если оба помещаются в короткий потолок
  const first = [segments[index++]];
  const second = segments[index];
  const firstEndsHere = first[0].paragraphEnd || first[0].partial;
  if (second && !firstEndsHere && !second.partial && joinSegments([first[0], second]).length <= firstMaxChars) {
    first.push(second);
    index += 1;
  }
  fragments.push(joinSegments(first));

  let current: Segment[] = [];
  for (; index < segments.length; index += 1) {
    const segment = segments[index];
    // Предложение длиннее потолка целиком не поместится — режем перед ним, а не посреди него
    const startsLongSentence = segment.partial && !segments[index - 1]?.partial;
    if (current.length > 0 && (startsLongSentence || joinSegments([...current, segment]).length > maxChars)) {
      fragments.push(joinSegments(current));
      current = [];
    }
    current.push(segment);
    if (segment.paragraphEnd && joinSegments(current).length >= minParagraphChars) {
      fragments.push(joinSegments(current));
      current = [];
    }
  }
  if (current.length > 0) fragments.push(joinSegments(current));
  return fragments;
}
