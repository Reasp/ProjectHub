import fs from 'node:fs/promises';

/** Коды, при которых каталог ещё держит завершающийся процесс или открытый дескриптор. */
const RETRYABLE = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM', 'EACCES']);

/**
 * Удаление временного каталога теста с повторами до дедлайна (TASK-108, decision-57).
 *
 * На Windows `process.kill(pid, 0)` сообщает «процесс мёртв», как только `TerminateProcess`
 * выставил код выхода (libuv смотрит `GetExitCodeProcess`), а таблица дескрипторов процесса — вместе
 * с дескриптором его текущего каталога — закрывается позже. Под нагрузкой это «позже» доходит до
 * секунд, и `rmdir` каталога, который был cwd убитого процесса, падает с EBUSY. Встроенные повторы
 * `fs.rm` (`maxRetries` × `retryDelay`) ограничены числом попыток, а не временем, поэтому здесь —
 * повтор с растущей паузой до `timeoutMs`. Не удалось за это время — ошибка: каталог держит живой
 * процесс, и это утечка, которую тест должен показать.
 */
export async function removeTempDir(dir: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (let delay = 50; ; delay = Math.min(delay * 2, 1000)) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!RETRYABLE.has(code) || Date.now() + delay > deadline) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
