import fs from 'node:fs';

/**
 * Удаление временного домашнего каталога тестов после прогона (decision-29, TASK-84).
 * Сам каталог создаёт `vitest.config.ts` и передаёт воркерам через `test.env`.
 */
export default function setup(): () => void {
  return () => {
    const dir = process.env.PROJECTHUB_TEST_HOME;
    if (!dir || !dir.includes('projecthub-test-home-')) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* временный каталог уберёт ОС */
    }
  };
}
