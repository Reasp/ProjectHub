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

/** Ключи, ради которых имеет смысл спасать частично битый конфиг. */
const RECOVERABLE_KEYS = ['project_name', 'default_status', 'statuses', 'task_prefix'] as const;

/**
 * Разбивает YAML на блоки верхнего уровня `ключ: значение` (со всеми строками-продолжениями,
 * то есть блочными списками и многострочными flow-списками).
 */
function splitTopLevelBlocks(body: string): Map<string, string> {
  const blocks = new Map<string, string>();
  let currentKey: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentKey && !blocks.has(currentKey)) blocks.set(currentKey, currentLines.join('\n'));
    currentKey = null;
    currentLines = [];
  };

  for (const line of body.split('\n')) {
    const header = /^([A-Za-z_][A-Za-z0-9_.-]*):(?:\s|$)/.exec(line);
    if (header) {
      flush();
      currentKey = header[1];
      currentLines = [line];
    } else if (currentKey && (line.trim() === '' || /^\s/.test(line))) {
      currentLines.push(line);
    } else {
      // Строка вне блока (например, элемент списка верхнего уровня) — конфиг не наш формат.
      flush();
    }
  }
  flush();
  return blocks;
}

/**
 * Спасательный разбор: конфиг целиком не парсится из-за постороннего ключа, но нужные нам
 * значения читаются поблочно. Реальный случай — `backlog/config.yml`, сгенерированный
 * Backlog.md на Windows: `default_editor: "C:\Windows\notepad.exe"` содержит недопустимую
 * escape-последовательность `\W` в двойных кавычках, и js-yaml отвергает весь документ.
 * Из-за этого доска теряла все кастомные статусы проекта, хотя ключ `statuses` корректен.
 */
function recoverConfigKeys(raw: string): Record<string, unknown> | null {
  const blocks = splitTopLevelBlocks(raw.replace(/\r\n/g, '\n'));
  const recovered: Record<string, unknown> = {};
  for (const key of RECOVERABLE_KEYS) {
    const block = blocks.get(key);
    if (!block) continue;
    const parsed = parseYamlConfig(block);
    if (parsed && key in parsed) recovered[key] = parsed[key];
  }
  return Object.keys(recovered).length > 0 ? recovered : null;
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
 * Разбор содержимого `backlog/config.yml`. Если документ не парсится целиком, делается
 * попытка прочитать нужные ключи по отдельности; и только когда не удаётся и это,
 * возвращается fallback-конфиг с `fromConfig: false`.
 */
export function parseBacklogConfig(raw: string | null | undefined): BacklogProjectConfig {
  if (!raw || !raw.trim()) return fallbackStatusConfig();

  // Битый посторонний ключ не должен стоить проекту всех его статусов: если документ целиком
  // не парсится, читаем интересующие ключи по отдельности.
  const data = parseYamlConfig(raw) || recoverConfigKeys(raw);
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
