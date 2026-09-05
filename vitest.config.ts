import { defineConfig } from 'vitest/config';

// Отдельный конфиг, чтобы vitest не подхватывал vite.config.ts с плагином vite-plugin-electron.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
});
