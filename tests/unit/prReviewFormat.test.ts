import { describe, expect, it } from 'vitest';
import {
  MAX_VERIFIED_FINDINGS,
  applyVerdicts,
  buildPrComment,
  buildReviewerPrompt,
  buildVerifierPrompt,
  dedupeFindings,
  extractFenced,
  findLinkedTaskId,
  ghCommentArgs,
  normalizeSeverity,
  parseReviewReport,
  parseVerifyReport,
  sanitizeForPublication,
  selectForVerification,
  type ReviewFinding,
  type UniqueFinding
} from '../../electron/services/prReviewFormat';

/** Формат и логика ревью PR (TASK-81, decision-53 п. 4–8). */

const PR = { number: 12, title: 'Разбор конфига', headRef: 'feat/task-5', baseRef: 'main', headSha: '0123456789abcdef', body: 'Описание' };

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return { file: 'src/parse.ts', line: 10, severity: 'major', title: 'Пустая строка роняет разбор', description: 'Пустая строка конфига роняет разбор с исключением', ...overrides };
}

describe('разбор ответа ревьюера', () => {
  it('берёт последнюю ограду projecthub-review, нормализует поля и синонимы', () => {
    const text = [
      'Сначала пример:',
      '```projecthub-review\n{"findings": []}\n```',
      'Итог:',
      '```projecthub-review',
      JSON.stringify({
        summary: 'Есть проблема',
        findings: [
          { path: '.\\src\\parse.ts', line: '10', end_line: 12, severity: 'HIGH', message: 'Падает на пустой строке. Подробности', suggestion: 'Проверить длину' },
          { file: 'a.ts', severity: 'blocker', title: 'Без описания' },
          { severity: 'low' },
          'мусор'
        ]
      }),
      '```'
    ].join('\n');
    const parsed = parseReviewReport(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe('Есть проблема');
    expect(parsed.findings).toEqual([
      { file: 'src/parse.ts', line: 10, endLine: 12, severity: 'major', title: 'Падает на пустой строке', description: 'Падает на пустой строке. Подробности', suggestion: 'Проверить длину' },
      { file: 'a.ts', severity: 'critical', title: 'Без описания', description: 'Без описания' }
    ]);
  });

  it('без ограды берёт последний JSON с findings; без JSON — ошибка, а не исключение', () => {
    expect(parseReviewReport('Вывод: {"findings":[{"file":"x.ts","description":"d"}]} конец').findings).toHaveLength(1);
    const bad = parseReviewReport('ничего нет');
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/projecthub-review/);
    expect(parseReviewReport('```projecthub-review\n{сломано\n```').ok).toBe(false);
  });

  it('серьёзность по синонимам', () => {
    expect(['blocker', 'HIGH', 'medium', 'low', 'info', 'что-то'].map(normalizeSeverity)).toEqual(['critical', 'major', 'minor', 'nit', 'nit', 'minor']);
    expect(extractFenced('```projecthub-verify\nA\n```', 'projecthub-verify')).toBe('A\n');
  });
});

describe('разбор вердиктов', () => {
  it('понимает синонимы и пропускает чужие id', () => {
    const parsed = parseVerifyReport(
      '```projecthub-verify\n' +
        JSON.stringify({ verdicts: [{ id: 'f1', verdict: 'Valid', reason: 'r', evidence: 'e' }, { id: 'F2', verdict: 'false' }, { id: 'X', verdict: 'confirmed' }, { id: 'F3', verdict: '?' }] }) +
        '\n```'
    );
    expect(parsed.verdicts).toEqual([
      { id: 'F1', verdict: 'confirmed', reason: 'r', evidence: 'e' },
      { id: 'F2', verdict: 'refuted' },
      { id: 'F3', verdict: 'uncertain' }
    ]);
  });
});

describe('дедупликация и отбор', () => {
  it('склеивает находки об одном месте с похожим текстом и считает согласие', () => {
    const unique = dedupeFindings([
      { reviewer: 'claude', findings: [finding(), finding({ file: 'src/other.ts', line: 3, severity: 'minor', title: 'Лишний лог', description: 'Лишний лог в цикле' })] },
      { reviewer: 'qwen', findings: [finding({ line: 12, severity: 'critical', description: 'Разбор падает с исключением на пустой строке конфига, подробно' })] },
      { reviewer: 'qwen2', findings: [finding({ line: 40, title: 'Утечка', description: 'Файл не закрывается' })] }
    ]);
    expect(unique.map((f) => [f.id, f.file, f.line, f.severity, f.agreement])).toEqual([
      ['F1', 'src/parse.ts', 10, 'critical', 2],
      ['F2', 'src/parse.ts', 40, 'major', 1],
      ['F3', 'src/other.ts', 3, 'minor', 1]
    ]);
    expect(unique[0].reviewers).toEqual(['claude', 'qwen']);
    expect(unique[0].description).toMatch(/подробно/);
  });

  it('одна ошибка разными словами на соседних строках склеивается по цитате кода (живой прогон TASK-81.6)', () => {
    const unique = dedupeFindings([
      {
        reviewer: 'claude',
        findings: [
          finding({ line: 6, severity: 'critical', title: 'Регрессия parsePort: изменена логика валидации', description: 'Условие стало пропускать порты вне диапазона', evidence: 'if (n > 0 || n < 65536) return n;' })
        ]
      },
      {
        reviewer: 'qwen',
        findings: [
          finding({ line: 7, severity: 'critical', title: 'Валидация parsePort отключена: || вместо && пропускает все номера', description: 'Любое число проходит проверку', evidence: 'if (n > 0 || n < 65536) return n;' })
        ]
      }
    ]);
    expect(unique).toHaveLength(1);
    expect(unique[0]).toMatchObject({ agreement: 2, line: 6, endLine: 7 });
  });

  it('разный текст в одном месте не склеивается; отбор ограничен и по серьёзности', () => {
    const unique = dedupeFindings([{ reviewer: 'a', findings: [finding(), finding({ title: 'Гонка', description: 'Одновременная запись в кэш без блокировки' })] }]);
    expect(unique).toHaveLength(2);
    const many = dedupeFindings([
      { reviewer: 'a', findings: Array.from({ length: 30 }, (_, i) => finding({ file: `f${i}.ts`, severity: i % 2 ? 'nit' : 'critical' })) }
    ]);
    const selected = selectForVerification(many);
    expect(selected).toHaveLength(MAX_VERIFIED_FINDINGS);
    expect(selected.filter((f) => f.severity === 'critical')).toHaveLength(15);
  });

  it('вердикты прикладываются по id', () => {
    const unique = dedupeFindings([{ reviewer: 'a', findings: [finding(), finding({ file: 'b.ts' })] }]);
    const verified = applyVerdicts(unique, [{ id: 'F1', verdict: 'confirmed', evidence: 'код' }]);
    expect(verified[0]).toMatchObject({ verdict: 'confirmed', verdictEvidence: 'код' });
    expect(verified[1].verdict).toBeUndefined();
  });
});

describe('промпты', () => {
  it('ревьюер получает PR, задачу, дифф и формат; длинный дифф усекается', () => {
    const prompt = buildReviewerPrompt({
      pr: PR,
      task: { id: 'TASK-5', title: 'Конфиг', description: 'Разбирать конфиг', criteria: ['Пустой файл не падает'] },
      diff: 'x'.repeat(100),
      maxDiffChars: 50
    });
    expect(prompt).toContain('Pull Request #12: Разбор конфига');
    expect(prompt).toContain('1. Пустой файл не падает');
    expect(prompt).toContain('```projecthub-review');
    expect(prompt).toMatch(/дифф усечён/);
    expect(prompt).toMatch(/Ничего не меняй/);
  });

  it('проверяющий получает находки с id и формат вердиктов', () => {
    const prompt = buildVerifierPrompt({ pr: PR, findings: dedupeFindings([{ reviewer: 'a', findings: [finding({ endLine: 14, evidence: 'if (!s)' })] }]) });
    expect(prompt).toContain('### F1 [major] src/parse.ts:10-14');
    expect(prompt).toContain('Доказательство ревьюера: if (!s)');
    expect(prompt).toContain('```projecthub-verify');
  });

  it('связанная задача из ветки или заголовка', () => {
    expect(findLinkedTaskId('feat/task-12.3-x', 'заголовок')).toBe('TASK-12.3');
    expect(findLinkedTaskId('main', 'TASK-7: фикс')).toBe('TASK-7');
    expect(findLinkedTaskId('main', 'без задачи')).toBeNull();
  });
});

describe('комментарий и публикация', () => {
  const unique = dedupeFindings([
    {
      reviewer: 'claude',
      findings: [finding({ suggestion: 'Проверить длину' }), finding({ file: 'b.ts', title: 'Ложная', description: 'Неверное замечание' }), finding({ file: 'c.ts', title: 'Неясно', description: 'Неясное замечание' })]
    }
  ]);
  const idOf = (file: string) => unique.find((f) => f.file === file)!.id;
  const verified: UniqueFinding[] = applyVerdicts(unique, [
    { id: idOf('src/parse.ts'), verdict: 'confirmed', evidence: 'parse("") бросает' },
    { id: idOf('b.ts'), verdict: 'refuted' }
  ]);

  it('в комментарий идут только подтверждённые, с итогом проверки и стоимостью', () => {
    const body = buildPrComment({ pr: PR, findings: verified, reviewers: ['claude'], verifier: 'qwen', costUsd: 0.1234 });
    expect(body).toContain('Подтверждено замечаний: **1**');
    expect(body).toContain('`src/parse.ts:10`');
    expect(body).toContain('**Предложение:** Проверить длину');
    expect(body).not.toContain('Ложная');
    expect(body).toContain('отброшено при проверке: 1 · не проверено: 1 · стоимость ревью: $0.12');
    expect(buildPrComment({ pr: PR, findings: [], reviewers: ['a'] })).toContain('Подтверждённых замечаний нет');
  });

  it('секреты маскируются; команда публикации — только pr comment', () => {
    const clean = sanitizeForPublication('ключ sk-ant-api03-AbCdEf0123456789xyz и Bearer abc.def');
    expect(clean.text).not.toContain('AbCdEf0123456789');
    expect(clean.text).toContain('Bearer ***');
    expect(sanitizeForPublication('обычный текст').blocked).toBeUndefined();
    expect(ghCommentArgs(12, 'C:/tmp/body.md')).toEqual(['pr', 'comment', '12', '--body-file', 'C:/tmp/body.md']);
    expect(() => ghCommentArgs(0, 'x')).toThrow();
  });
});
