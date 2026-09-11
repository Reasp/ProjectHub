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

function runGitNexus(args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('gitnexus', args, { cwd, timeout: TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
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
