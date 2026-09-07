// ESLint (flat config) для ProjectHub — TASK-49, аудит 7.2.
// Ошибки блокируют сборку (npm run build → npm run lint). Правила, дающие только «шум» на текущей
// кодовой базе (any, неиспользуемые переменные, зависимости хуков), оставлены предупреждениями —
// это baseline техдолга, счётчик зафиксирован в задаче и должен только уменьшаться.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'release/**',
      'release_tmp*/**',
      '.rag-index/**',
      '.rag-cache/**',
      '.lightrag-index/**',
      '.env-state/**',
      'scripts/lightrag/.venv/**',
      'backlog/**',
      'public/**',
      'build/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Скрипты инфраструктуры и main-процесс Electron — Node.
    files: ['electron/**/*.{ts,mjs,js}', 'scripts/**/*.{mjs,js}', 'tests/**/*.ts', '*.{ts,mjs,js}'],
    languageOptions: { globals: { ...globals.node, ...globals.es2022 } }
  },
  {
    // Рендерер — браузер + React.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.es2022 } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['electron/preload.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } }
  },
  {
    rules: {
      // Baseline техдолга (аудит 7.1: 118 any) — предупреждение, не ошибка.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ],
      // `catch {}`/`catch (e) {}` с пустым телом используется намеренно как «игнорировать ошибку».
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Тип `{}`/Function и `namespace` в d.ts — не блокируем.
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn'
    }
  }
);
