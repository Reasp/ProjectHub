/**
 * Поиск по памяти проекта и детектор дубликатов (TASK-76, decision-51 п. 4–6).
 *
 * Поиск по словам, а не по эмбеддингам: факты короткие, свежий факт должен находиться сразу после
 * записи (без переиндексации), а результат — быть детерминированным и проверяемым тестами.
 * Грубая нормализация под русский: нижний регистр, `ё` → `е`, стоп-слова, усечение слова до
 * первых 5 символов вместо стемминга («сборка», «сборки», «сборку» → «сборк»).
 *
 * Чистый модуль: без fs и Electron.
 */
import type { MemoryFact } from './memoryFormat.js';

/** Порог сходства заголовка+описания, выше которого новый факт считается дубликатом. */
export const DUPLICATE_THRESHOLD = 0.6;
/** Длина основы слова. */
const STEM_LENGTH = 5;
const MIN_TOKEN_LENGTH = 3;

const STOP_WORDS = new Set(
  [
    // русские служебные слова
    'это', 'как', 'для', 'что', 'при', 'или', 'если', 'без', 'над', 'под', 'про', 'все', 'всё', 'его', 'ее', 'её',
    'они', 'она', 'оно', 'так', 'там', 'тут', 'уже', 'еще', 'ещё', 'только', 'чтобы', 'когда', 'где', 'через',
    'после', 'перед', 'нужно', 'надо', 'можно', 'нельзя', 'быть', 'есть', 'был', 'была', 'были', 'будет', 'не', 'нет',
    // английские
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'not', 'but', 'you', 'use', 'when',
    'into', 'then', 'than', 'have', 'has'
  ].map((w) => w.replace(/ё/g, 'е'))
);

/** Текст → основы слов без стоп-слов и коротких токенов. */
export function tokenize(text: string): string[] {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(w));
  return words.map((w) => (w.length > STEM_LENGTH ? w.slice(0, STEM_LENGTH) : w));
}

/** Коэффициент Жаккара двух множеств основ. */
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

type Headline = Pick<MemoryFact, 'title' | 'description'>;

const headlineTokens = (f: Headline) => tokenize(`${f.title} ${f.description}`);

/**
 * Самый похожий существующий факт, если сходство заголовка и описания не ниже порога.
 * `excludeId` — факт, который сейчас обновляется (`replace`), с самим собой не сравнивается.
 */
export function findDuplicate<T extends Headline & { id: string }>(
  draft: Headline,
  facts: readonly T[],
  options: { threshold?: number; excludeId?: string } = {}
): { fact: T; score: number } | null {
  const threshold = options.threshold ?? DUPLICATE_THRESHOLD;
  const draftTokens = headlineTokens(draft);
  if (draftTokens.length === 0) return null;
  let best: { fact: T; score: number } | null = null;
  for (const fact of facts) {
    if (options.excludeId && fact.id === options.excludeId) continue;
    const score = jaccard(draftTokens, headlineTokens(fact));
    if (score >= threshold && (!best || score > best.score)) best = { fact, score };
  }
  return best;
}

export interface MemorySearchHit<T> {
  fact: T;
  score: number;
}

/**
 * Ранжирует факты по совпадению основ запроса: заголовок весит 3, описание 2, тело 1; оценка
 * нормирована на число основ запроса. Факты без совпадений не возвращаются; при равной оценке
 * выше более новый факт (больший номер).
 */
export function searchMemoryFacts<T extends Pick<MemoryFact, 'id' | 'title' | 'description' | 'body'>>(
  query: string,
  facts: readonly T[],
  limit = 5
): Array<MemorySearchHit<T>> {
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0 || limit <= 0) return [];

  const hits: Array<MemorySearchHit<T>> = [];
  for (const fact of facts) {
    const title = new Set(tokenize(fact.title));
    const description = new Set(tokenize(fact.description));
    const body = new Set(tokenize(fact.body));
    let raw = 0;
    for (const t of queryTokens) {
      if (title.has(t)) raw += 3;
      else if (description.has(t)) raw += 2;
      else if (body.has(t)) raw += 1;
    }
    if (raw > 0) hits.push({ fact, score: raw / (queryTokens.length * 3) });
  }
  const num = (id: string) => parseInt(id.replace(/\D+/g, ''), 10) || 0;
  hits.sort((a, b) => b.score - a.score || num(b.fact.id) - num(a.fact.id));
  return hits.slice(0, limit);
}
