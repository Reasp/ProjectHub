import path from 'node:path';
import fs from 'node:fs/promises';
import matter from 'gray-matter';
import {
  fallbackStatusConfig,
  DEFAULT_TASK_STATUS,
  matchStatus,
  normalizeStatusKey,
  type BacklogProjectConfig
} from '../../src/utils/taskStatus.js';

/**
 * Чтение `backlog/config.yml` открытого проекта (TASK-68).
 *
 * До TASK-68 конфиг разбирался регуляркой ради одного `project_name`, а `statuses` не
 * читались вообще — состав колонок канбана был зашит в код. Теперь конфиг проекта является
 * источником истины по составу статусов (decision-24), поэтому парсим его настоящим
 * YAML-парсером — тем же `gray-matter` (js-yaml), которым читается frontmatter задач.
 *
 * Любая ошибка (нет файла, битый YAML, `statuses` не список) не должна ломать открытие
 * проекта: возвращается fallback из четырёх стандартных статусов.
 */

/**
 * `gray-matter` умеет парсить только frontmatter, поэтому содержимое конфига оборачивается
 * в разделители. Разделитель намеренно не `---`: строка `---` внутри YAML оборвала бы
 * разбор на середине файла.
 */
const CONFIG_DELIMITER = '~~~projecthub-backlog-config~~~';

/**
 * Приведение значения конфига к строке (правило 16 CLAUDE.md): YAML сам превращает
 * `2026-09-03` в `Date`, а `Blocked: yes` — в boolean. В UI такие значения должны
 * приходить строками, иначе рендерер падает на объекте вместо текста.
 */
function cfgString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function parseYamlConfig(raw: string): Record<string, unknown> | null {
  try {
    const body = raw.replace(/\r\n/g, '\n');
    const wrapped = `${CONFIG_DELIMITER}\n${body}\n${CONFIG_DELIMITER}\n`;
    const parsed = matter(wrapped, { delimiters: CONFIG_DELIMITER });
    const data = parsed.data as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Список статусов: строки, без пустых, без дублей (регистр и пробелы не значимы). */
function parseStatuses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const status = cfgString(item);
    if (!status) continue;
    const key = normalizeStatusKey(status);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(status);
  }
  return result;
}

/**
 * Разбор содержимого `backlog/config.yml`. Пустой/битый ввод и пустой `statuses` дают
 * fallback-конфиг с `fromConfig: false`.
 */
export function parseBacklogConfig(raw: string | null | undefined): BacklogProjectConfig {
  if (!raw || !raw.trim()) return fallbackStatusConfig();

  const data = parseYamlConfig(raw);
  if (!data) return fallbackStatusConfig();

  const projectName = cfgString(data.project_name);
  const taskPrefix = cfgString(data.task_prefix);
  const statuses = parseStatuses(data.statuses);

  if (statuses.length === 0) {
    return { ...fallbackStatusConfig(), projectName, taskPrefix };
  }

  const defaultStatus =
    matchStatus(statuses, cfgString(data.default_status)) ||
    matchStatus(statuses, DEFAULT_TASK_STATUS) ||
    statuses[0];

  return { statuses, defaultStatus, fromConfig: true, projectName, taskPrefix };
}

/** Путь к конфигу Backlog.md внутри проекта. */
export function backlogConfigPath(projectPath: string): string {
  return path.join(projectPath, 'backlog', 'config.yml');
}

/** Чтение и разбор конфига проекта; при любой ошибке — fallback без выброса исключения. */
export async function readBacklogConfig(projectPath: string): Promise<BacklogProjectConfig> {
  try {
    const raw = await fs.readFile(backlogConfigPath(projectPath), 'utf-8');
    return parseBacklogConfig(raw);
  } catch {
    return fallbackStatusConfig();
  }
}
