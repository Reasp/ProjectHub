import { describe, it, expect } from 'vitest';
import {
  REVIEWER_DIFF_MAX_CHARS,
  buildReviewerPrompt,
  extractJsonObject,
  parseReviewerResponse
} from '../../electron/services/reviewerPrompt';
import type { CheckRunResult } from '../../electron/services/arenaTypes';

const checks: CheckRunResult[] = [
  { id: 'lint', kind: 'lint', name: 'Lint', command: 'npm run lint', status: 'passed', blocking: true, durationMs: 3000 },
  {
    id: 'test',
    kind: 'test',
    name: 'Tests',
    command: 'npm test',
    status: 'failed',
    blocking: true,
    failedTests: 2,
    totalTests: 10,
    durationMs: 12_000
  }
];

describe('buildReviewerPrompt', () => {
  const base = {
    taskId: 'TASK-61',
    taskTitle: 'Автосудья',
    prompt: 'Сделай автосудью',
    criteria: ['Проверки запускаются', 'Балл раскладывается'],
    agentName: 'Claude',
    agentRole: 'Реализатор',
    diffPatch: 'diff --git a/src/a.ts b/src/a.ts\n+const x = 1;',
    diffSummary: { filesChanged: 1, insertions: 1, deletions: 0 },
    checks
  };

  it('включает задачу, нумерованные критерии, кандидата, проверки и дифф', () => {
    const prompt = buildReviewerPrompt(base);
    expect(prompt).toContain('TASK-61 — Автосудья');
    expect(prompt).toContain('1. Проверки запускаются');
    expect(prompt).toContain('2. Балл раскладывается');
    expect(prompt).toContain('Claude (роль: Реализатор)');
    expect(prompt).toContain('Tests (test, блокирующая): failed, упавших тестов: 2 из 10');
    expect(prompt).toContain('```diff');
    expect(prompt).toContain('+const x = 1;');
  });

  it('объясняет, что делать без чеклиста критериев', () => {
    expect(buildReviewerPrompt({ ...base, criteria: [] })).toContain('нет чеклиста критериев');
  });

  it('пустой дифф не выглядит как пропущенная секция', () => {
    expect(buildReviewerPrompt({ ...base, diffPatch: '' })).toContain('кандидат не изменил файлы');
  });

  it('длинный дифф усекается с пометкой', () => {
    const prompt = buildReviewerPrompt({ ...base, diffPatch: 'x'.repeat(100), diffMaxChars: 10 });
    expect(prompt).toContain('дифф усечён');
    expect(prompt).not.toContain('x'.repeat(20));
  });

  it('лимит диффа по умолчанию задан и разумен', () => {
    expect(REVIEWER_DIFF_MAX_CHARS).toBeGreaterThan(1000);
  });
});

describe('extractJsonObject', () => {
  it('достаёт объект из ```json-ограды с текстом вокруг', () => {
    const raw = 'Вот мой ответ:\n```json\n{"summary":"ок"}\n```\nСпасибо!';
    expect(extractJsonObject(raw)).toBe('{"summary":"ок"}');
  });

  it('не обрывается на скобке внутри строки', () => {
    const raw = '{"summary":"тут } скобка","overall":1}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it('учитывает экранированные кавычки', () => {
    const raw = String.raw`{"summary":"он сказал \"нет\"","overall":0.5}`;
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it('вложенные объекты забираются целиком', () => {
    const raw = '{"a":{"b":{"c":1}},"d":2}';
    expect(extractJsonObject(`префикс ${raw} суффикс`)).toBe(raw);
  });

  it('без объекта возвращает null', () => {
    expect(extractJsonObject('просто текст')).toBeNull();
    expect(extractJsonObject('{"незакрытый": 1')).toBeNull();
  });
});

describe('parseReviewerResponse', () => {
  const criteria = ['Первый критерий', 'Второй критерий', 'Третий критерий'];

  it('разбирает полный ответ и сохраняет тексты критериев', () => {
    const raw = JSON.stringify({
      summary: 'Годится с оговорками',
      overall: 0.8,
      criteria: [
        { index: 1, verdict: 'met', comment: 'сделано' },
        { index: 2, verdict: 'partial' }
      ],
      findings: [{ file: 'src/a.ts', line: 12, severity: 'major', message: 'утечка' }],
      risks: ['может сломать сборку']
    });
    const parsed = parseReviewerResponse(raw, criteria);
    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe('Годится с оговорками');
    expect(parsed.overall).toBe(0.8);
    expect(parsed.criteria).toEqual([
      { index: 1, text: 'Первый критерий', verdict: 'met', comment: 'сделано' },
      { index: 2, text: 'Второй критерий', verdict: 'partial' },
      // О третьем модель промолчала — он остаётся в списке как «не оценён», а не выпадает.
      { index: 3, text: 'Третий критерий', verdict: 'unknown' }
    ]);
    expect(parsed.findings).toEqual([{ file: 'src/a.ts', line: 12, severity: 'major', message: 'утечка' }]);
    expect(parsed.risks).toEqual(['может сломать сборку']);
  });

  it('неизвестный вердикт и синонимы приводятся к канону', () => {
    const raw = JSON.stringify({
      criteria: [
        { index: 1, verdict: 'PASS' },
        { index: 2, verdict: 'fail' },
        { index: 3, verdict: 'что-то своё' }
      ]
    });
    const parsed = parseReviewerResponse(raw, criteria);
    expect(parsed.criteria.map((c) => c.verdict)).toEqual(['met', 'unmet', 'unknown']);
  });

  it('стобалльная и десятибалльная оценка приводятся к 0..1', () => {
    expect(parseReviewerResponse('{"overall": 85}').overall).toBeCloseTo(0.85, 5);
    expect(parseReviewerResponse('{"overall": 7}').overall).toBeCloseTo(0.7, 5);
    expect(parseReviewerResponse('{"overall": 0.42}').overall).toBeCloseTo(0.42, 5);
    expect(parseReviewerResponse('{"overall": -3}').overall).toBe(0);
  });

  it('неизвестная серьёзность становится minor, замечание без текста отбрасывается', () => {
    const raw = JSON.stringify({
      findings: [{ severity: 'катастрофа', message: 'что-то' }, { severity: 'info' }, { severity: 'critical', message: 'беда' }]
    });
    const parsed = parseReviewerResponse(raw);
    expect(parsed.findings).toEqual([
      { severity: 'minor', message: 'что-то' },
      { severity: 'critical', message: 'беда' }
    ]);
  });

  it('ответ без JSON помечается ошибкой разбора, а не падает', () => {
    const parsed = parseReviewerResponse('Извини, не смог оценить.');
    expect(parsed.ok).toBe(false);
    expect(parsed.parseError).toContain('нет JSON');
    expect(parsed.criteria).toEqual([]);
  });

  it('битый JSON помечается ошибкой разбора', () => {
    const parsed = parseReviewerResponse('{"summary": "ок",}');
    expect(parsed.ok).toBe(false);
    expect(parsed.parseError).toContain('JSON не разобрался');
  });

  it('вердикт, завёрнутый моделью в массив, всё равно разбирается', () => {
    const parsed = parseReviewerResponse('[{"summary":"ок"}]');
    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe('ок');
  });

  it('без списка критериев индексы берутся из ответа модели', () => {
    const parsed = parseReviewerResponse('{"criteria":[{"index":2,"verdict":"met"},{"index":1,"verdict":"unmet"}]}');
    expect(parsed.criteria.map((c) => c.index)).toEqual([1, 2]);
    expect(parsed.criteria[0].text).toBe('Критерий 1');
  });

  it('мусорные поля не ломают разбор', () => {
    const parsed = parseReviewerResponse(
      '{"summary": 42, "criteria": "нет", "findings": {"a":1}, "risks": [null, "риск", 5]}',
      criteria
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBeUndefined();
    expect(parsed.findings).toEqual([]);
    expect(parsed.risks).toEqual(['риск']);
    expect(parsed.criteria.every((c) => c.verdict === 'unknown')).toBe(true);
  });
});
