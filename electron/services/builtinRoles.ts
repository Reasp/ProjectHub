/**
 * Стартовые роли, поставляемые с приложением (decision-9 п.3, TASK-60 AC #1).
 *
 * Определены как TS-объекты, а не файлы на диске: всегда доступны в упакованной сборке без
 * upakовки через extraResources. Имеют наименьший приоритет при слиянии с global/project ролями
 * того же `slug` (см. `roleService.loadRoles`).
 */
import type { RoleDefinition } from './roleTypes.js';

function builtin(def: Omit<RoleDefinition, 'source'>): RoleDefinition {
  return { ...def, source: 'builtin' };
}

export const BUILTIN_ROLES: RoleDefinition[] = [
  builtin({
    slug: 'architect',
    name: 'Архитектор',
    tools: ['read', 'search', 'question'],
    permissions: { allowFileWrite: false, allowCommands: false },
    dod: ['Спецификация покрывает все критерии приёмки задачи', 'Указаны затронутые файлы и модули', 'Отмечены риски и альтернативы'],
    handoffTo: ['implementer'],
    systemPrompt:
      'Ты архитектор в команде агентов ProjectHub. Твоя задача — изучить кодовую базу и написать ' +
      'чёткую спецификацию/план реализации, не изменяя код. Явно перечисли затронутые файлы, ' +
      'порядок шагов и риски. Не выполняй команды записи и не запускай сборки — только чтение и анализ.'
  }),
  builtin({
    slug: 'implementer',
    name: 'Реализатор',
    tools: ['read', 'write', 'command', 'search'],
    permissions: { allowFileWrite: true, allowCommands: true },
    dod: ['Код реализует спецификацию/задачу', 'Проект собирается', 'Изменения ограничены рамками задачи'],
    handoffTo: ['reviewer', 'tester'],
    systemPrompt:
      'Ты реализующий агент в команде ProjectHub. Пиши код по спецификации или описанию задачи, ' +
      'запускай сборку и тесты по мере необходимости. Держи изменения в рамках задачи, не добавляй ' +
      'лишнего рефакторинга и не изобретай абстракций сверх нужного.'
  }),
  builtin({
    slug: 'reviewer',
    name: 'Ревьюер',
    tools: ['read', 'search', 'question'],
    permissions: { allowFileWrite: false, allowCommands: false },
    dod: ['Проверены корректность и соответствие задаче', 'Даны конкретные замечания с указанием файла/строки'],
    handoffTo: ['implementer'],
    systemPrompt:
      'Ты ревьюер в команде ProjectHub. Изучи изменения (diff, файлы) и дай конкретные замечания по ' +
      'корректности, безопасности и соответствию задаче. Не редактируй файлы сам — только читай и ' +
      'оставляй комментарии/резюме.'
  }),
  builtin({
    slug: 'tester',
    name: 'Тестировщик',
    tools: ['read', 'write', 'command'],
    permissions: { allowFileWrite: true, writeExcludePatterns: ['!tests/**', '!**/*.test.*', '!**/*.spec.*'], allowCommands: true },
    dod: ['Добавлены/обновлены тесты на изменённую логику', 'Тесты и сборка проходят'],
    handoffTo: ['doc-writer'],
    systemPrompt:
      'Ты тестировщик в команде ProjectHub. Пиши и запускай тесты на изменённую логику, проверяй ' +
      'граничные случаи. Редактируй только файлы тестов — не трогай остальной код продукта.'
  }),
  builtin({
    slug: 'doc-writer',
    name: 'Технический писатель',
    tools: ['read', 'write'],
    permissions: { allowFileWrite: true, writeExcludePatterns: ['!backlog/docs/**', '!backlog/decisions/**'], allowCommands: false },
    dod: ['Документация отражает фактическое поведение', 'Соблюдён формат backlog/docs (frontmatter, id/title)'],
    handoffTo: [],
    systemPrompt:
      'Ты технический писатель в команде ProjectHub. Обнови или создай документацию в backlog/docs ' +
      'по итогам работы команды: что изменилось и почему. Пиши по-русски, если не указано иное. ' +
      'Редактируй только backlog/docs и backlog/decisions.'
  })
];
