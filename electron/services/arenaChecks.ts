/**
 * Проверки кандидатов Swarm Arena: дефолты из `package.json` и разбор вывода (decision-12, TASK-61).
 *
 * Чистый модуль без Electron и файловой системы — вход это уже прочитанные `scripts` и текст
 * вывода команды, выход это `CheckDefinition[]` и счётчики. Покрыт unit-тестами.
 */
import type { CheckDefinition, CheckKind, CheckRunResult, CheckStatus } from './arenaTypes.js';

/** Сколько символов вывода команды сохраняется в результате проверки (хвост). */
export const CHECK_OUTPUT_TAIL_CHARS = 8000;

/** Таймаут проверки по умолчанию, если не задан в `.projecthub.json`. */
export const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60 * 1000;

/** Сколько проверок выполняется одновременно по всем кандидатам по умолчанию. */
export const DEFAULT_MAX_CONCURRENT_CHECKS = 2;

/**
 * Скрипты `package.json`, которые считаются проверкой, и их вид. Порядок определяет порядок
 * проверок в конфиге: сначала быстрые (типы, линт), потом тесты и сборка.
 */
const NODE_SCRIPT_KINDS: Array<{ script: string; kind: CheckKind; name: string }> = [
  { script: 'typecheck', kind: 'typecheck', name: 'Typecheck' },
  { script: 'type-check', kind: 'typecheck', name: 'Typecheck' },
  { script: 'lint', kind: 'lint', name: 'Lint' },
  { script: 'test', kind: 'test', name: 'Tests' },
  { script: 'build', kind: 'build', name: 'Build' }
];

/** Проверки не должны поднимать dev-сервер или вотчер: команда обязана завершаться сама. */
const WATCH_LIKE_RE = /(^|\s)(--watch\b|--watchAll\b|-w\b|nodemon\b|--hot\b|--serve\b)/i;

export interface DefaultChecksInput {
  /** Содержимое `scripts` из `package.json` кандидата (может отсутствовать). */
  scripts?: Record<string, string>;
  /** Менеджер пакетов, которым запускать скрипты. */
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
  /** Признаки не-Node проектов — используются, когда `package.json` нет. */
  hasCargoToml?: boolean;
  hasPyProject?: boolean;
}

function runScript(pm: string, script: string): string {
  if (pm === 'yarn' || pm === 'bun') return `${pm} ${script}`;
  return `${pm} run ${script}`;
}

/**
 * Проверки по умолчанию: скрипты `package.json`, а если его нет — типовые команды Rust/Python.
 * Скрипты с вотчерами пропускаются: проверка должна завершаться сама.
 */
export function defaultChecksFromProject(input: DefaultChecksInput): CheckDefinition[] {
  const { scripts, packageManager = 'npm', hasCargoToml, hasPyProject } = input;
  const out: CheckDefinition[] = [];
  const seenKinds = new Set<CheckKind>();

  if (scripts) {
    for (const { script, kind, name } of NODE_SCRIPT_KINDS) {
      if (seenKinds.has(kind)) continue;
      const command = scripts[script];
      if (typeof command !== 'string' || !command.trim()) continue;
      if (WATCH_LIKE_RE.test(command)) continue;
      seenKinds.add(kind);
      out.push({
        id: kind === 'custom' ? script : kind,
        kind,
        name,
        command: runScript(packageManager, script),
        timeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
        blocking: true,
        enabled: true
      });
    }
    if (out.length > 0) return out;
  }

  if (hasCargoToml) {
    return [
      { id: 'typecheck', kind: 'typecheck', name: 'Cargo Check', command: 'cargo check', timeoutMs: DEFAULT_CHECK_TIMEOUT_MS, blocking: true, enabled: true },
      { id: 'test', kind: 'test', name: 'Cargo Test', command: 'cargo test', timeoutMs: DEFAULT_CHECK_TIMEOUT_MS, blocking: true, enabled: true }
    ];
  }

  if (hasPyProject) {
    return [
      { id: 'test', kind: 'test', name: 'Pytest', command: 'pytest -q', timeoutMs: DEFAULT_CHECK_TIMEOUT_MS, blocking: true, enabled: true }
    ];
  }

  return out;
}

/** Приводит запись проверки из `.projecthub.json` к полному виду; `null` — запись невалидна. */
export function normalizeCheckDefinition(raw: unknown, index: number): CheckDefinition | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const command = typeof r.command === 'string' ? r.command.trim() : '';
  if (!command) return null;
  const kind: CheckKind =
    r.kind === 'lint' || r.kind === 'test' || r.kind === 'build' || r.kind === 'typecheck' ? r.kind : 'custom';
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `${kind}-${index + 1}`;
  const timeoutRaw = typeof r.timeoutMs === 'number' && Number.isFinite(r.timeoutMs) ? r.timeoutMs : undefined;
  return {
    id,
    kind,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : id,
    command,
    timeoutMs: timeoutRaw && timeoutRaw > 0 ? timeoutRaw : DEFAULT_CHECK_TIMEOUT_MS,
    blocking: r.blocking !== false,
    enabled: r.enabled !== false,
    portStrategy: r.portStrategy === 'auto' ? 'auto' : 'fixed',
    ...(typeof r.port === 'number' && Number.isFinite(r.port) ? { port: r.port } : {})
  };
}

/** Хвост текста с пометкой об усечении. */
export function tailOutput(text: string, maxChars = CHECK_OUTPUT_TAIL_CHARS): { text: string; truncated: boolean } {
  const value = text ?? '';
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(value.length - maxChars), truncated: true };
}

export interface ParsedCheckCounters {
  failedTests?: number;
  passedTests?: number;
  totalTests?: number;
  errorCount?: number;
  warningCount?: number;
}

function toInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Последнее совпадение регулярки — прогонщики печатают итог в конце вывода. */
function lastMatch(text: string, re: RegExp): RegExpMatchArray | null {
  const matches = [...text.matchAll(re)];
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

/**
 * Счётчики упавших/прошедших тестов из вывода популярных прогонщиков.
 * Порядок проверки важен: форматы vitest и jest похожи, но различаются разделителями.
 */
export function parseTestCounters(output: string): ParsedCheckCounters {
  const text = stripAnsi(output ?? '');
  if (!text) return {};

  // vitest: "Tests  2 failed | 10 passed | 1 skipped (13)"
  const vitest = lastMatch(text, /^\s*Tests\s+(?<body>.+?)(?:\((?<total>\d+)\))?\s*$/gm);
  if (vitest?.groups?.body && /\d+\s+(?:failed|passed)/.test(vitest.groups.body)) {
    const body = vitest.groups.body;
    const failed = toInt(/(\d+)\s+failed/.exec(body)?.[1]) ?? 0;
    const passed = toInt(/(\d+)\s+passed/.exec(body)?.[1]) ?? 0;
    const total = toInt(vitest.groups.total) ?? failed + passed;
    return { failedTests: failed, passedTests: passed, totalTests: total };
  }

  // jest: "Tests:       1 failed, 2 passed, 3 total"
  const jest = lastMatch(text, /^\s*Tests:\s+(?<body>.+)$/gm);
  if (jest?.groups?.body) {
    const body = jest.groups.body;
    const failed = toInt(/(\d+)\s+failed/.exec(body)?.[1]) ?? 0;
    const passed = toInt(/(\d+)\s+passed/.exec(body)?.[1]) ?? 0;
    const total = toInt(/(\d+)\s+total/.exec(body)?.[1]) ?? failed + passed;
    return { failedTests: failed, passedTests: passed, totalTests: total };
  }

  // cargo: "test result: FAILED. 12 passed; 3 failed; 0 ignored"
  const cargo = lastMatch(text, /test result:\s+\w+\.\s+(?<body>.+)$/gm);
  if (cargo?.groups?.body) {
    const body = cargo.groups.body;
    const failed = toInt(/(\d+)\s+failed/.exec(body)?.[1]) ?? 0;
    const passed = toInt(/(\d+)\s+passed/.exec(body)?.[1]) ?? 0;
    return { failedTests: failed, passedTests: passed, totalTests: failed + passed };
  }

  // pytest: "=== 2 failed, 5 passed in 1.23s ===" либо "5 passed in 0.4s"
  const pytest = lastMatch(text, /^=+\s*(?<body>[^=]*\b(?:passed|failed|error)\b[^=]*?)\s*=+\s*$/gm);
  if (pytest?.groups?.body) {
    const body = pytest.groups.body;
    const failed = (toInt(/(\d+)\s+failed/.exec(body)?.[1]) ?? 0) + (toInt(/(\d+)\s+errors?/.exec(body)?.[1]) ?? 0);
    const passed = toInt(/(\d+)\s+passed/.exec(body)?.[1]) ?? 0;
    if (failed > 0 || passed > 0) return { failedTests: failed, passedTests: passed, totalTests: failed + passed };
  }

  // mocha: "12 passing" / "3 failing"
  const passing = toInt(lastMatch(text, /^\s*(\d+)\s+passing/gm)?.[1]);
  const failing = toInt(lastMatch(text, /^\s*(\d+)\s+failing/gm)?.[1]);
  if (passing !== undefined || failing !== undefined) {
    const failed = failing ?? 0;
    const passed = passing ?? 0;
    return { failedTests: failed, passedTests: passed, totalTests: failed + passed };
  }

  return {};
}

/** Ошибки и предупреждения линтера/компилятора типов. */
export function parseLintCounters(output: string): ParsedCheckCounters {
  const text = stripAnsi(output ?? '');
  if (!text) return {};

  // eslint: "✖ 12 problems (3 errors, 9 warnings)"
  const eslint = lastMatch(text, /(\d+)\s+problems?\s*\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/g);
  if (eslint) {
    return { errorCount: toInt(eslint[2]) ?? 0, warningCount: toInt(eslint[3]) ?? 0 };
  }

  // tsc: строки вида "src/a.ts(3,1): error TS2304: ..." либо "Found 4 errors."
  const tscTotal = lastMatch(text, /Found\s+(\d+)\s+errors?/g);
  if (tscTotal) return { errorCount: toInt(tscTotal[1]) ?? 0 };

  const tscLines = [...text.matchAll(/\berror\s+TS\d+:/g)].length;
  if (tscLines > 0) return { errorCount: tscLines };

  return {};
}

/** Управляющие escape-последовательности мешают регуляркам: прогонщики красят вывод. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- ANSI SGR по определению состоит из управляющих символов
  return (text ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

/** Счётчики, подходящие виду проверки: тесты считаем тестами, остальное — ошибками/предупреждениями. */
export function parseCheckOutput(kind: CheckKind, output: string): ParsedCheckCounters {
  if (kind === 'test') {
    const tests = parseTestCounters(output);
    return Object.keys(tests).length > 0 ? tests : parseLintCounters(output);
  }
  const lint = parseLintCounters(output);
  if (Object.keys(lint).length > 0) return lint;
  // Сборка может гонять тесты внутри себя (как `npm run build` здесь) — не теряем счётчики.
  return parseTestCounters(output);
}

/** Статус проверки по коду возврата и признаку таймаута. */
export function checkStatusFromExit(exitCode: number | null | undefined, timedOut: boolean): CheckStatus {
  if (timedOut) return 'timeout';
  if (exitCode === 0) return 'passed';
  return 'failed';
}

/** Проверка провалена так, что кандидату нельзя доверять (для блокирующего критерия). */
export function isFailedStatus(status: CheckStatus): boolean {
  return status === 'failed' || status === 'timeout' || status === 'error';
}

/** Проверка учитывается в балле: пропущенные и незапущенные не тянут кандидата вниз. */
export function isCountedStatus(status: CheckStatus): boolean {
  return status === 'passed' || isFailedStatus(status);
}

/** Короткая сводка результата для строки в UI и отчёта ревьюеру. */
export function summarizeCheckResult(result: CheckRunResult): string {
  const parts: string[] = [result.status];
  if (typeof result.failedTests === 'number' && result.failedTests > 0) {
    parts.push(`упавших тестов: ${result.failedTests}${result.totalTests ? ` из ${result.totalTests}` : ''}`);
  } else if (typeof result.errorCount === 'number' && result.errorCount > 0) {
    parts.push(`ошибок: ${result.errorCount}`);
  }
  if (typeof result.durationMs === 'number') parts.push(`${(result.durationMs / 1000).toFixed(1)} с`);
  if (result.detail) parts.push(result.detail);
  return parts.join(', ');
}
