/**
 * Тонкая обвязка над GitNexus CLI для контекста агента (TASK-64, decision-18).
 *
 * GitNexus не даёт JSON-вывод для `context`/`impact` (проверено `gitnexus --help`, 2026-09-11),
 * поэтому берём человекочитаемый stdout как есть — это и есть желаемый формат для системного
 * промпта LLM, парсить его не нужно. Любая ошибка (бинарник не установлен, репозиторий не
 * проиндексирован, символ не найден) не должна ронять сборку контекста — только пропускать
 * секцию GitNexus.
 */
import { execFile } from 'node:child_process';

const TIMEOUT_MS = 8000;

function runGitNexus(args: string[], cwd: string, timeoutMs = TIMEOUT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('gitnexus', args, { cwd, timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const trimmed = stdout?.trim();
      resolve(trimmed || null);
    });
  });
}

export interface GitNexusContextOptions {
  projectPath: string;
  /** Пути файлов (обычно из `references` задачи), для каждого запрашивается 360-обзор. */
  files: string[];
  /** Ограничение GitNexus на число callers/callees/processes в ответе по одному файлу. */
  limitPerFile?: number;
}

/** Текстовые секции `### <file>` с 360-обзором GitNexus по каждому файлу; пустая строка, если нечего показать. */
export async function fetchGitNexusContext(options: GitNexusContextOptions): Promise<string> {
  const { projectPath, files, limitPerFile = 5 } = options;
  const sections: string[] = [];

  for (const file of files) {
    const output = await runGitNexus(['context', '-f', file, '--limit', String(limitPerFile)], projectPath);
    if (output) sections.push(`### ${file}\n${output}`);
  }

  return sections.join('\n\n');
}

/** Метрики радиуса изменения по `gitnexus detect-changes` (TASK-61). */
export interface GitNexusDiffImpact {
  changedFiles?: number;
  /** Индексированные символы, задетые диффом, — «число зависимых символов» в скоринге. */
  changedSymbols?: number;
  affectedProcesses?: number;
  riskLevel?: string;
}

/**
 * Разбор человекочитаемого вывода `gitnexus detect-changes` (JSON он не отдаёт, проверено
 * `gitnexus detect-changes --help`, 2026-09-11). Чистая функция — покрыта unit-тестами.
 */
export function parseDetectChangesOutput(output: string): GitNexusDiffImpact | null {
  const text = output ?? '';
  if (!text.trim()) return null;
  if (/^No changes detected\.?$/im.test(text.trim())) return { changedFiles: 0, changedSymbols: 0 };

  const changes = /Changes:\s*(\d+)\s*files?,\s*(\d+)\s*symbols?/i.exec(text);
  const processes = /Affected processes:\s*(\d+)/i.exec(text);
  const risk = /Risk level:\s*(\w+)/i.exec(text);
  if (!changes && !processes && !risk) return null;

  return {
    ...(changes ? { changedFiles: Number.parseInt(changes[1], 10), changedSymbols: Number.parseInt(changes[2], 10) } : {}),
    ...(processes ? { affectedProcesses: Number.parseInt(processes[1], 10) } : {}),
    ...(risk ? { riskLevel: risk[1].toLowerCase() } : {})
  };
}

/**
 * Радиус изменений worktree кандидата относительно базовой ветки. Требует проиндексированного
 * репозитория; любая ошибка (нет бинарника, нет индекса, несколько репозиториев без `--repo`)
 * возвращает `null` — метрика просто не участвует в скоринге.
 */
export async function fetchDiffImpact(options: {
  /** Каталог, в котором запускается CLI: worktree кандидата либо корень проекта. */
  cwd: string;
  baseRef: string;
  /** Имя репозитория в реестре GitNexus, если индексов несколько. */
  repo?: string;
  timeoutMs?: number;
}): Promise<GitNexusDiffImpact | null> {
  const args = ['detect-changes', '--scope', 'compare', '--base-ref', options.baseRef, '--limit', '1'];
  if (options.repo) args.push('--repo', options.repo);
  const output = await runGitNexus(args, options.cwd, options.timeoutMs ?? TIMEOUT_MS);
  return output ? parseDetectChangesOutput(output) : null;
}
