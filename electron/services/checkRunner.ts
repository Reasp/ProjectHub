/**
 * Выполнение одной проверки проекта в рабочем каталоге (decision-20, TASK-61, TASK-75).
 *
 * Общий путь для автосудьи арены и цикла «до готовности»: разовый запуск через
 * `processManager.runOnce`, разбор счётчиков и хвоста вывода — чтобы оба режима видели
 * одинаковые статусы и одинаково обрезанный вывод.
 */
import { processManager } from './processManager.js';
import { CHECK_OUTPUT_TAIL_CHARS, checkStatusFromExit, parseCheckOutput, tailOutput } from './arenaChecks.js';
import type { CheckDefinition, CheckRunResult } from './arenaTypes.js';

/** Пустой результат проверки до запуска. */
export function pendingCheckResult(def: CheckDefinition): CheckRunResult {
  return {
    id: def.id,
    kind: def.kind,
    name: def.name,
    command: def.command,
    status: 'pending',
    blocking: def.blocking !== false
  };
}

/**
 * Запускает команду проверки и заполняет `result` (мутирует — UI видит промежуточные состояния
 * через ссылку на объект в сессии). Не бросает: ошибка запуска оседает в статусе `error`.
 */
export async function executeCheck(
  result: CheckRunResult,
  def: Pick<CheckDefinition, 'command' | 'timeoutMs' | 'portStrategy' | 'port'>,
  workdir: string,
  signal?: AbortSignal
): Promise<CheckRunResult> {
  result.status = 'running';
  result.startedAt = Date.now();

  const run = await processManager.runOnce(def.command, {
    cwd: workdir,
    timeoutMs: def.timeoutMs,
    signal,
    portStrategy: def.portStrategy,
    port: def.port
  });

  const counters = parseCheckOutput(result.kind, run.output);
  const { text, truncated } = tailOutput(run.output, CHECK_OUTPUT_TAIL_CHARS);
  result.exitCode = run.exitCode ?? undefined;
  result.durationMs = run.durationMs;
  result.outputTail = text;
  result.outputTruncated = truncated || run.truncated;
  Object.assign(result, counters);
  if (run.error && run.exitCode === null) {
    result.status = signal?.aborted ? 'skipped' : 'error';
    result.detail = run.error;
  } else {
    result.status = checkStatusFromExit(run.exitCode, run.timedOut);
  }
  return result;
}
