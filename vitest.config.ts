import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Временный домашний каталог на весь прогон (decision-29, TASK-84): сервисы main-процесса пишут в
// `os.homedir()/.projecthub` (секреты, ai-config, сессии), и без изоляции тесты перезаписывали файл
// секретов пользователя. Каталог задаётся через `test.env` с самого старта воркеров — смена
// USERPROFILE/HOME во время загрузки воркера ломает сам vitest. Удаляется в teardown globalSetup.
// Конфиг вычисляется несколько раз за прогон (главный процесс и воркеры наследуют env) — каталог
// создаётся один раз, иначе teardown удалил бы только последний.
const inherited = process.env.PROJECTHUB_TEST_HOME;
const testHome =
  inherited && inherited.includes('projecthub-test-home-') && fs.existsSync(inherited)
    ? inherited
    : fs.mkdtempSync(path.join(os.tmpdir(), 'projecthub-test-home-'));
process.env.PROJECTHUB_TEST_HOME = testHome;

// Отдельный конфиг, чтобы vitest не подхватывал vite.config.ts с плагином vite-plugin-electron.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: {
      USERPROFILE: testHome,
      HOME: testHome,
      PROJECTHUB_TEST_HOME: testHome,
      PROJECTHUB_TEST_REAL_HOME: os.homedir()
    },
    globalSetup: ['tests/setup/testHomeGlobalSetup.ts']
  }
});
