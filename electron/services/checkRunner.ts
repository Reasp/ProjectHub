/**
 * Выполнение одной проверки проекта в рабочем каталоге (decision-20, TASK-61, TASK-75).
 *
 * Общий путь для автосудьи арены и цикла «до готовности»: разовый запуск через
 * `processManager.runOnce`, разбор счётчиков и хвоста вывода — чтобы оба режима видели
 * одинаковые статусы и одинаково обрезанный вывод. Проверка `ui-smoke` получает каталог
 * артефактов в `<userData>/visual` и сдаёт скриншоты/trace (TASK-78, decision-55).
 */
import { processManager } from './processManager.js';
import { CHECK_OUTPUT_TAIL_CHARS, checkStatusFromExit, parseCheckOutput, tailOutput } from './arenaChecks.js';
import { ARTIFACTS_DIR_ENV, isUiSmokeCheck, substituteArtifactsDir } from './visualArtifacts.js';
import { visualArtifactService, type PreparedArtifactsDir } from './visualArtifactService.js';
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

/** Где хранить артефакты `ui-smoke`: сессия, агент и прогон (`judge-…`, `iter-N`). Без него — `adhoc`. */
export interface CheckArtifactsTarget {
  scope: string;
  agentId?: string;
  run: string;
}

export interface ExecuteCheckOptions {
  artifacts?: CheckArtifactsTarget;
}

/**
 * Запускает команду проверки и заполняет `result` (мутирует — UI видит промежуточные состояния
 * через ссылку на объект в сессии). Не бросает: ошибка запуска оседает в статусе `error`.
 */
export async function executeCheck(
  result: CheckRunResult,
  def: Pick<CheckDefinition, 'command' | 'timeoutMs' | 'portStrategy' | 'port'> & Partial<Pick<CheckDefinition, 'artifacts'>>,
  workdir: string,
  signal?: AbortSignal,
  options: ExecuteCheckOptions = {}
): Promise<CheckRunResult> {
  result.status = 'running';
  result.startedAt = Date.now();

  let prepared: PreparedArtifactsDir | null = null;
  let command = def.command;
  const env: Record<string, string> = {};
  if (isUiSmokeCheck(result)) {
    const target = options.artifacts ?? { scope: 'adhoc', run: `run-${result.startedAt}` };
    try {
      prepared = await visualArtifactService.prepare({ ...target, checkId: result.id });
      env[ARTIFACTS_DIR_ENV] = prepared.absDir;
      command = substituteArtifactsDir(command, prepared.absDir);
    } catch (err) {
      console.warn('[CheckRunner] Не удалось подготовить каталог артефактов:', err);
    }
  }

  const run = await processManager.runOnce(command, {
    cwd: workdir,
    timeoutMs: def.timeoutMs,
    signal,
    env,
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

  if (prepared) {
    // Скриншоты собираем и у упавшей проверки: по ним видно, что сломалось.
    await visualArtifactService.collect(result, prepared, workdir, def.artifacts);
    void visualArtifactService.prune(options.artifacts?.scope).catch(() => {});
  }
  return result;
}
