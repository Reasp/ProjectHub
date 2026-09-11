import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHECK_TIMEOUT_MS,
  checkStatusFromExit,
  defaultChecksFromProject,
  isCountedStatus,
  isFailedStatus,
  normalizeCheckDefinition,
  parseCheckOutput,
  parseLintCounters,
  parseTestCounters,
  stripAnsi,
  summarizeCheckResult,
  tailOutput
} from '../../electron/services/arenaChecks';
import type { CheckRunResult } from '../../electron/services/arenaTypes';

const ESC = String.fromCharCode(27);

describe('defaultChecksFromProject', () => {
  it('выводит проверки из скриптов package.json в порядке «быстрые сначала»', () => {
    const checks = defaultChecksFromProject({
      scripts: { build: 'vite build', test: 'vitest run', lint: 'eslint .', dev: 'vite' }
    });
    expect(checks.map((c) => c.kind)).toEqual(['lint', 'test', 'build']);
    expect(checks.every((c) => c.blocking && c.enabled)).toBe(true);
    expect(checks[0].command).toBe('npm run lint');
    expect(checks[0].timeoutMs).toBe(DEFAULT_CHECK_TIMEOUT_MS);
  });

  it('уважает менеджер пакетов и не дублирует typecheck', () => {
    const checks = defaultChecksFromProject({
      scripts: { typecheck: 'tsc --noEmit', 'type-check': 'tsc -p .', test: 'jest' },
      packageManager: 'pnpm'
    });
    expect(checks.filter((c) => c.kind === 'typecheck')).toHaveLength(1);
    expect(checks[0].command).toBe('pnpm run typecheck');
    expect(checks[1].command).toBe('pnpm run test');
  });

  it('yarn и bun запускают скрипт без "run"', () => {
    const checks = defaultChecksFromProject({ scripts: { test: 'jest' }, packageManager: 'yarn' });
    expect(checks[0].command).toBe('yarn test');
  });

  it('пропускает вотчеры — проверка обязана завершаться сама', () => {
    const checks = defaultChecksFromProject({ scripts: { test: 'vitest --watch', build: 'tsc -w' } });
    expect(checks).toEqual([]);
  });

  it('без package.json берёт команды Rust или Python', () => {
    expect(defaultChecksFromProject({ hasCargoToml: true }).map((c) => c.command)).toEqual([
      'cargo check',
      'cargo test'
    ]);
    expect(defaultChecksFromProject({ hasPyProject: true }).map((c) => c.command)).toEqual(['pytest -q']);
    expect(defaultChecksFromProject({})).toEqual([]);
  });
});

describe('normalizeCheckDefinition', () => {
  it('достраивает запись из .projecthub.json до полной', () => {
    const check = normalizeCheckDefinition({ command: ' npm run lint ', kind: 'lint' }, 0);
    expect(check).toMatchObject({
      // id без явного значения выводится из вида и позиции: две проверки одного вида не схлопнутся.
      id: 'lint-1',
      kind: 'lint',
      name: 'lint-1',
      command: 'npm run lint',
      blocking: true,
      enabled: true,
      portStrategy: 'fixed'
    });
  });

  it('незнакомый kind становится custom, а id выводится из индекса', () => {
    expect(normalizeCheckDefinition({ command: 'make check', kind: 'whatever' }, 2)).toMatchObject({
      id: 'custom-3',
      kind: 'custom'
    });
  });

  it('запись без команды отбрасывается', () => {
    expect(normalizeCheckDefinition({ name: 'Пусто' }, 0)).toBeNull();
    expect(normalizeCheckDefinition(null, 0)).toBeNull();
  });

  it('blocking и enabled выключаются только явным false', () => {
    const check = normalizeCheckDefinition({ command: 'x', blocking: false, enabled: false, timeoutMs: 5000 }, 0);
    expect(check).toMatchObject({ blocking: false, enabled: false, timeoutMs: 5000 });
  });
});

describe('parseTestCounters', () => {
  it('vitest', () => {
    const output = [
      ' Test Files  1 failed | 3 passed (4)',
      '      Tests  2 failed | 10 passed | 1 skipped (13)',
      '   Start at  10:00:00'
    ].join('\n');
    expect(parseTestCounters(output)).toEqual({ failedTests: 2, passedTests: 10, totalTests: 13 });
  });

  it('vitest без упавших', () => {
    expect(parseTestCounters('      Tests  42 passed (42)')).toEqual({
      failedTests: 0,
      passedTests: 42,
      totalTests: 42
    });
  });

  it('jest', () => {
    const output = ['Test Suites: 1 failed, 2 passed, 3 total', 'Tests:       1 failed, 12 passed, 13 total'].join('\n');
    expect(parseTestCounters(output)).toEqual({ failedTests: 1, passedTests: 12, totalTests: 13 });
  });

  it('cargo', () => {
    expect(parseTestCounters('test result: FAILED. 12 passed; 3 failed; 0 ignored; 0 measured')).toEqual({
      failedTests: 3,
      passedTests: 12,
      totalTests: 15
    });
  });

  it('pytest', () => {
    expect(parseTestCounters('=========== 2 failed, 5 passed in 1.23s ============')).toEqual({
      failedTests: 2,
      passedTests: 5,
      totalTests: 7
    });
  });

  it('mocha', () => {
    expect(parseTestCounters('  12 passing (3s)\n  1 failing\n')).toEqual({
      failedTests: 1,
      passedTests: 12,
      totalTests: 13
    });
  });

  it('чужой вывод не даёт ложных счётчиков', () => {
    expect(parseTestCounters('Собрано за 3 секунды, всё хорошо')).toEqual({});
    expect(parseTestCounters('')).toEqual({});
  });

  it('раскрашенный вывод разбирается так же', () => {
    const colored = `${ESC}[32m      Tests  ${ESC}[0m1 failed | 2 passed (3)`;
    expect(parseTestCounters(colored)).toEqual({ failedTests: 1, passedTests: 2, totalTests: 3 });
  });

  it('берётся последняя сводка, а не первая', () => {
    const output = ['Tests:       5 failed, 0 passed, 5 total', 'retrying…', 'Tests:       0 failed, 5 passed, 5 total'].join(
      '\n'
    );
    expect(parseTestCounters(output)).toEqual({ failedTests: 0, passedTests: 5, totalTests: 5 });
  });
});

describe('parseLintCounters', () => {
  it('eslint', () => {
    expect(parseLintCounters('✖ 12 problems (3 errors, 9 warnings)')).toEqual({ errorCount: 3, warningCount: 9 });
  });

  it('tsc с итоговой строкой', () => {
    expect(parseLintCounters('Found 4 errors in 2 files.')).toEqual({ errorCount: 4 });
  });

  it('tsc без итоговой строки — по строкам с кодами ошибок', () => {
    const output = ['src/a.ts(3,1): error TS2304: Cannot find name.', 'src/b.ts(9,5): error TS2345: Bad argument.'].join(
      '\n'
    );
    expect(parseLintCounters(output)).toEqual({ errorCount: 2 });
  });

  it('чистый вывод даёт пустые счётчики', () => {
    expect(parseLintCounters('All good')).toEqual({});
  });
});

describe('parseCheckOutput', () => {
  it('для тестов предпочитает счётчики тестов', () => {
    expect(parseCheckOutput('test', 'Tests:       1 failed, 2 passed, 3 total')).toEqual({
      failedTests: 1,
      passedTests: 2,
      totalTests: 3
    });
  });

  it('для теста без счётчиков тестов падает на счётчики ошибок', () => {
    expect(parseCheckOutput('test', 'Found 2 errors in 1 file.')).toEqual({ errorCount: 2 });
  });

  it('для сборки с тестами внутри достаёт счётчики тестов', () => {
    expect(parseCheckOutput('build', '      Tests  0 failed | 7 passed (7)')).toEqual({
      failedTests: 0,
      passedTests: 7,
      totalTests: 7
    });
  });

  it('для линта берёт ошибки и предупреждения', () => {
    expect(parseCheckOutput('lint', '✖ 5 problems (1 error, 4 warnings)')).toEqual({
      errorCount: 1,
      warningCount: 4
    });
  });
});

describe('статусы проверок', () => {
  it('код возврата и таймаут', () => {
    expect(checkStatusFromExit(0, false)).toBe('passed');
    expect(checkStatusFromExit(1, false)).toBe('failed');
    expect(checkStatusFromExit(null, false)).toBe('failed');
    expect(checkStatusFromExit(0, true)).toBe('timeout');
  });

  it('провалом считается всё, что не прошло и не пропущено', () => {
    expect(isFailedStatus('failed')).toBe(true);
    expect(isFailedStatus('timeout')).toBe(true);
    expect(isFailedStatus('error')).toBe(true);
    expect(isFailedStatus('skipped')).toBe(false);
    expect(isFailedStatus('passed')).toBe(false);
  });

  it('в балл идут только отработавшие проверки', () => {
    expect(isCountedStatus('passed')).toBe(true);
    expect(isCountedStatus('failed')).toBe(true);
    expect(isCountedStatus('pending')).toBe(false);
    expect(isCountedStatus('skipped')).toBe(false);
  });
});

describe('tailOutput и stripAnsi', () => {
  it('короткий текст не трогается', () => {
    expect(tailOutput('abc', 10)).toEqual({ text: 'abc', truncated: false });
  });

  it('длинный текст обрезается с головы', () => {
    expect(tailOutput('abcdefghij', 4)).toEqual({ text: 'ghij', truncated: true });
  });

  it('stripAnsi убирает только управляющие последовательности', () => {
    expect(stripAnsi(`${ESC}[31mошибка${ESC}[0m [1] массив`)).toBe('ошибка [1] массив');
  });
});

describe('summarizeCheckResult', () => {
  const base: CheckRunResult = {
    id: 'test',
    kind: 'test',
    name: 'Tests',
    command: 'npm test',
    status: 'failed',
    blocking: true
  };

  it('показывает упавшие тесты и время', () => {
    expect(summarizeCheckResult({ ...base, failedTests: 3, totalTests: 10, durationMs: 4200 })).toBe(
      'failed, упавших тестов: 3 из 10, 4.2 с'
    );
  });

  it('без тестов показывает ошибки', () => {
    expect(summarizeCheckResult({ ...base, kind: 'lint', name: 'Lint', errorCount: 2 })).toBe('failed, ошибок: 2');
  });

  it('пропущенная проверка объясняет причину', () => {
    expect(summarizeCheckResult({ ...base, status: 'skipped', detail: 'нет worktree' })).toBe('skipped, нет worktree');
  });
});
