/**
 * Типы файлового реестра ролей агентов (decision-9, TASK-60).
 *
 * Роль — markdown-файл с YAML frontmatter (по аналогии с задачами Backlog.md); тело файла —
 * системный промпт роли. Источники сливаются по `slug`: project > global > builtin.
 * Без зависимостей от Electron — импортируется unit-тестами напрямую.
 */
import type { RolePermissions } from './hitlTypes.js';

export type RoleEngine = 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'api';
export type RoleSource = 'builtin' | 'global' | 'project';

/**
 * Канонические, движко-независимые категории инструментов. Каждый движок сопоставляет их со
 * своими нативными именами (Claude CLI: Read/Write/Bash/…; API-движок: read_file/write_file/…)
 * в `roleEngineAdapter.ts` — так `tools` роли значит одно и то же для любого движка.
 */
export type ToolCategory = 'read' | 'write' | 'command' | 'search' | 'subagent' | 'question';

export const ALL_TOOL_CATEGORIES: ToolCategory[] = ['read', 'write', 'command', 'search', 'subagent', 'question'];

export interface RoleDefinition {
  slug: string;
  name: string;
  /** Предпочтительный движок роли; UI слота может переопределить. Без поля — подходит любому. */
  engine?: RoleEngine;
  provider?: string;
  model?: string;
  /** Allow-список категорий инструментов; пусто/отсутствует — без ограничений. */
  tools?: ToolCategory[];
  permissions?: RolePermissions;
  /** Чеклист Definition of Done роли (показывается в UI, не проверяется автоматически). */
  dod?: string[];
  /** Роли, которым можно передать результат в Handoff. */
  handoffTo?: string[];
  maxTurns?: number;
  budgetUsd?: number;
  /** Тело файла — системный промпт роли. */
  systemPrompt: string;
  source: RoleSource;
  /** Отсутствует у builtin-ролей (не файлы на диске). */
  filePath?: string;
}

export interface RoleParseError {
  error: string;
  filePath: string;
}

export function isRoleParseError(value: unknown): value is RoleParseError {
  return Boolean(value && typeof value === 'object' && 'error' in (value as object));
}
