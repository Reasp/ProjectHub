import { describe, expect, it } from 'vitest';
import { DUPLICATE_THRESHOLD, findDuplicate, jaccard, searchMemoryFacts, tokenize } from '../../electron/services/memorySearch';

/** Поиск по памяти и детектор дубликатов (TASK-76.1, decision-51 п. 4–5). */

const fact = (id: string, title: string, description: string, body = '') => ({ id, title, description, body });

const FACTS = [
  fact('mem-1', 'Сборка pack:win падает при открытом exe', 'Закрыть ProjectHub.exe перед сборкой', 'electron-builder держит блокировку'),
  fact('mem-2', 'Ollama под нагрузкой перестаёт отвечать', 'Перезапустить ollama, если агенты получают пустые ответы', 'curl висит'),
  fact('mem-3', 'huggingface.co рвёт соединение', 'Качать веса через hf-mirror.com', 'curl с докачкой')
];

describe('tokenize', () => {
  it('нижний регистр, ё → е, стоп-слова, усечение основы', () => {
    expect(tokenize('Сборка ПАДАЕТ, если открыт exe')).toEqual(['сборк', 'падае', 'откры', 'exe']);
    expect(tokenize('сборки сборку')).toEqual(['сборк', 'сборк']);
    expect(tokenize('перезапустить перезапуск')).toEqual(['перез', 'перез']);
    expect(tokenize('Зелёные тесты')).toEqual(['зелен', 'тесты']);
    expect(tokenize('')).toEqual([]);
  });
});

describe('jaccard', () => {
  it('считает сходство множеств', () => {
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
    expect(jaccard([], [])).toBe(0);
  });
});

describe('findDuplicate', () => {
  it('находит перефразированный в пределах слов факт', () => {
    const dup = findDuplicate({ title: 'Сборка pack:win падает при открытом exe', description: 'Закрыть exe перед сборкой ProjectHub' }, FACTS);
    expect(dup?.fact.id).toBe('mem-1');
    expect(dup!.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });

  it('разные факты не считаются дубликатами', () => {
    expect(findDuplicate({ title: 'Скриншоты через Playwright', description: 'Подменять projects:list' }, FACTS)).toBeNull();
  });

  it('обновляемый факт с собой не сравнивается', () => {
    const same = { title: FACTS[0].title, description: FACTS[0].description };
    expect(findDuplicate(same, FACTS)?.fact.id).toBe('mem-1');
    expect(findDuplicate(same, FACTS, { excludeId: 'mem-1' })).toBeNull();
  });

  it('пустой черновик дубликатом не бывает', () => {
    expect(findDuplicate({ title: 'и', description: 'на' }, FACTS)).toBeNull();
  });
});

describe('searchMemoryFacts', () => {
  it('заголовок весит больше тела', () => {
    const hits = searchMemoryFacts('curl ollama', FACTS);
    expect(hits[0].fact.id).toBe('mem-2');
    expect(hits.map((h) => h.fact.id)).toEqual(['mem-2', 'mem-3']);
  });

  it('формы слова находят друг друга', () => {
    expect(searchMemoryFacts('сборки', FACTS).map((h) => h.fact.id)).toEqual(['mem-1']);
    expect(searchMemoryFacts('сборка упала', FACTS)[0].fact.id).toBe('mem-1');
  });

  it('лимит и пустой запрос', () => {
    expect(searchMemoryFacts('curl', FACTS, 1)).toHaveLength(1);
    expect(searchMemoryFacts('', FACTS)).toEqual([]);
    expect(searchMemoryFacts('curl', FACTS, 0)).toEqual([]);
  });

  it('при равной оценке выше более новый факт', () => {
    const hits = searchMemoryFacts('curl', FACTS);
    expect(hits.map((h) => h.fact.id)).toEqual(['mem-3', 'mem-2']);
  });
});
