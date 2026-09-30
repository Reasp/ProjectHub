/**
 * Структурирование сплошного описания задачи для показа (TASK-120, [[decision-67]]).
 *
 * Агенты часто пишут описание одной строкой: «**Исполнитель:** … **Почему:** … Цель: …». Такой текст
 * MarkdownViewer честно показывает одним абзацем. Функция превращает его в разметку только для
 * отображения: метки становятся заголовками, длинный текст делится на абзацы по предложениям.
 * Файл задачи не меняется. Описание, в котором уже есть разметка или несколько абзацев, не трогаем:
 * автор оформил его сам.
 *
 * Модуль чистый — без React, покрыт тестами.
 */

/** Абзац длиннее этого делится на несколько по границам предложений. */
const PARAGRAPH_MAX_CHARS = 280;

/** Строка, с которой начинается блок Markdown: заголовок, список, цитата, таблица, код, HTML. */
const BLOCK_MARKER = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~|<)/;

/** Метка жирным: «**Почему:**» или «**Почему**:». Начинается с заглавной буквы. */
const BOLD_LABEL = /\*\*([A-ZА-ЯЁ][^*:\n]{0,40}?)(?::\*\*|\*\*:)\s*/gu;

/**
 * Метка без выделения: 1–3 слова с заглавной буквы и двоеточие — в начале текста или сразу после
 * конца предложения. Слова без цифр, чтобы «Шаг 2:» и «TASK-12:» не становились заголовками.
 */
const PLAIN_LABEL = /(^|[.!?…]\s+)([A-ZА-ЯЁ][\p{L}-]*(?: [\p{L}-]+){0,2}):\s+/gu;

/** Слова-связки перед двоеточием, которые заголовком не являются. */
const NOT_LABELS = new Set(['например', 'пример', 'то есть', 'итак', 'иначе', 'e.g', 'i.e', 'example', 'note']);

/** Граница предложения: знак конца, пробел и заглавная буква (или кавычка, скобка, код, жирный). */
const SENTENCE_BOUNDARY = /(?<=[.!?…])\s+(?=[«"„([*]?[A-ZА-ЯЁ])/u;

interface Section {
  label: string | null;
  body: string;
}

/** Сплошной ли это текст: один абзац без разметки блоков. */
function isPlainSingleParagraph(text: string): boolean {
  if (/\n[ \t]*\n/.test(text)) return false;
  return text.split('\n').every((line) => !BLOCK_MARKER.test(line));
}

/** Прячет код и ссылки за заглушками, чтобы точки и двоеточия внутри них не резали текст. */
function protectInline(text: string): { text: string; restore: (s: string) => string } {
  const saved: string[] = [];
  const hidden = text.replace(/`[^`]*`|!?\[[^\]]*\]\([^)]*\)/g, (m) => {
    saved.push(m);
    return `${saved.length - 1}`;
  });
  return { text: hidden, restore: (s) => s.replace(/(\d+)/g, (_, i: string) => saved[Number(i)]) };
}

interface LabelHit {
  start: number;
  end: number;
  label: string;
}

function findLabels(text: string): LabelHit[] {
  const hits: LabelHit[] = [];
  for (const m of text.matchAll(BOLD_LABEL)) {
    const start = m.index ?? 0;
    // Жирная метка — только в начале текста или после пробела, не посреди слова.
    if (start > 0 && !/\s/.test(text[start - 1])) continue;
    hits.push({ start, end: start + m[0].length, label: m[1].trim() });
  }
  for (const m of text.matchAll(PLAIN_LABEL)) {
    const label = m[2];
    if (NOT_LABELS.has(label.toLowerCase())) continue;
    const start = (m.index ?? 0) + m[1].length;
    if (hits.some((h) => start < h.end && h.start < start + label.length)) continue;
    hits.push({ start, end: (m.index ?? 0) + m[0].length, label });
  }
  return hits.sort((a, b) => a.start - b.start);
}

function splitSections(text: string, labels: LabelHit[]): Section[] {
  const sections: Section[] = [];
  const preamble = text.slice(0, labels.length > 0 ? labels[0].start : text.length).trim();
  if (preamble) sections.push({ label: null, body: preamble });
  labels.forEach((hit, idx) => {
    const next = idx + 1 < labels.length ? labels[idx + 1].start : text.length;
    sections.push({ label: hit.label, body: text.slice(hit.end, next).trim() });
  });
  return sections;
}

/** Делит текст на абзацы по предложениям так, чтобы абзац не превышал PARAGRAPH_MAX_CHARS. */
function toParagraphs(body: string): string[] {
  if (body.length <= PARAGRAPH_MAX_CHARS) return [body];
  const paragraphs: string[] = [];
  let current = '';
  for (const sentence of body.split(SENTENCE_BOUNDARY)) {
    if (current && current.length + 1 + sentence.length > PARAGRAPH_MAX_CHARS) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}

/** После метки текст часто идёт со строчной («**Почему:** новый канал») — под заголовком это режет глаз. */
function capitalize(s: string): string {
  return s.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
}

/**
 * Возвращает описание, размеченное для показа. Если структурировать нечего или описание уже
 * размечено автором, возвращает исходную строку без изменений.
 */
export function structureTaskDescription(description: string): string {
  const source = description.replace(/\r\n/g, '\n').trim();
  if (!source || !isPlainSingleParagraph(source)) return description;

  const { text, restore } = protectInline(source.replace(/\s*\n\s*/g, ' '));
  const labels = findLabels(text);
  if (labels.length === 0 && text.length <= PARAGRAPH_MAX_CHARS) return description;

  const blocks: string[] = [];
  for (const section of splitSections(text, labels)) {
    if (section.label) blocks.push(`### ${section.label}`);
    if (section.body) blocks.push(...toParagraphs(capitalize(section.body)));
  }
  return restore(blocks.join('\n\n'));
}
