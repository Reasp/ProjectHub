/**
 * Загрузчик, валидатор и хранилище файловых ролей агентов (decision-9, TASK-60).
 *
 * Роль — markdown-файл с YAML frontmatter, тело — системный промпт. Источники сливаются по
 * `slug`, приоритет: project (`<project>/.projecthub/roles/`) > global (`<userData>/roles/`) >
 * builtin (`builtinRoles.ts`). `parseRoleFile` — чистая функция без I/O, экспортирована отдельно
 * для unit-тестов (AC #7).
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import { getRolesDir, getProjectRolesDir } from './appPaths.js';
import { BUILTIN_ROLES } from './builtinRoles.js';
import { ALL_TOOL_CATEGORIES, isRoleParseError } from './roleTypes.js';
import type { RoleDefinition, RoleEngine, RoleParseError, RoleSource, ToolCategory } from './roleTypes.js';

const ROLE_ENGINES: RoleEngine[] = ['claude-cli', 'codex-cli', 'gemini-cli', 'api'];
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

function fmString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  return String(value);
}

function fmStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return [String(value)];
  return value.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)));
}

function fmNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function fmBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return Boolean(value);
}

/** Валидирует и парсит одну роль. Чистая функция — без файловой системы. */
export function parseRoleFile(raw: string, filePath: string, source: RoleSource): RoleDefinition | RoleParseError {
  let data: Record<string, unknown>;
  let content: string;
  try {
    const parsed = matter(raw);
    data = parsed.data as Record<string, unknown>;
    content = parsed.content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Ошибка YAML frontmatter: ${message}`, filePath };
  }

  const slug = fmString(data.slug);
  if (!slug || !SLUG_RE.test(slug)) {
    return { error: 'Поле "slug" обязательно и должно состоять из строчных латинских букв, цифр, "-"/"_"', filePath };
  }
  const name = fmString(data.name);
  if (!name) {
    return { error: 'Поле "name" обязательно', filePath };
  }

  let engine: RoleEngine | undefined;
  if (data.engine !== undefined && data.engine !== null && data.engine !== '') {
    const raw = fmString(data.engine);
    if (!raw || !ROLE_ENGINES.includes(raw as RoleEngine)) {
      return { error: `Поле "engine" должно быть одним из: ${ROLE_ENGINES.join(', ')}`, filePath };
    }
    engine = raw as RoleEngine;
  }

  let tools: ToolCategory[] | undefined;
  if (data.tools !== undefined && data.tools !== null) {
    const arr = fmStringArray(data.tools) || [];
    const invalid = arr.filter((t) => !ALL_TOOL_CATEGORIES.includes(t as ToolCategory));
    if (invalid.length > 0) {
      return { error: `Поле "tools" содержит неизвестные категории: ${invalid.join(', ')} (допустимо: ${ALL_TOOL_CATEGORIES.join(', ')})`, filePath };
    }
    tools = arr as ToolCategory[];
  }

  const maxTurns = fmNumber(data.maxTurns ?? data.max_turns);
  const budgetUsd = fmNumber(data.budgetUsd ?? data.budget_usd);
  const dod = fmStringArray(data.dod);
  const handoffTo = fmStringArray(data.handoffTo ?? data.handoff_to);
  const provider = fmString(data.provider);
  const model = fmString(data.model);

  let permissions: RoleDefinition['permissions'];
  if (data.permissions !== undefined && data.permissions !== null) {
    if (typeof data.permissions !== 'object' || Array.isArray(data.permissions)) {
      return { error: 'Поле "permissions" должно быть объектом', filePath };
    }
    const p = data.permissions as Record<string, unknown>;
    permissions = {
      autoApprove: fmBool(p.autoApprove),
      allowCommands: fmBool(p.allowCommands),
      allowFileWrite: fmBool(p.allowFileWrite),
      allowFileRead: fmBool(p.allowFileRead),
      allowSubagents: fmBool(p.allowSubagents),
      writeExcludePatterns: fmStringArray(p.writeExcludePatterns),
      readExcludePatterns: fmStringArray(p.readExcludePatterns),
      commandDenyList: fmStringArray(p.commandDenyList),
      commandTimeoutSec: fmNumber(p.commandTimeoutSec),
      allowedTools: fmStringArray(p.allowedTools),
      approvalTimeoutMin: fmNumber(p.approvalTimeoutMin)
    };
  }

  return {
    slug,
    name,
    engine,
    provider,
    model,
    tools,
    permissions,
    dod,
    handoffTo,
    maxTurns,
    budgetUsd,
    systemPrompt: content.trim(),
    source,
    filePath
  };
}

async function readRolesFromDir(dir: string, source: RoleSource): Promise<{ roles: RoleDefinition[]; errors: RoleParseError[] }> {
  const roles: RoleDefinition[] = [];
  const errors: RoleParseError[] = [];
  if (!existsSync(dir)) return { roles, errors };
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return { roles, errors };
  }
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const fullPath = path.join(dir, file);
    try {
      const raw = await fs.readFile(fullPath, 'utf-8');
      const parsed = parseRoleFile(raw, fullPath, source);
      if (isRoleParseError(parsed)) errors.push(parsed);
      else roles.push(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ error: `Не удалось прочитать файл: ${message}`, filePath: fullPath });
    }
  }
  return { roles, errors };
}

/**
 * Загружает и сливает роли по `slug`: project > global > builtin. Ошибки парсинга не прерывают
 * загрузку остальных ролей — возвращаются отдельным списком для UI/логов.
 */
export async function loadRoles(projectPath?: string): Promise<{ roles: RoleDefinition[]; errors: RoleParseError[] }> {
  const byslug = new Map<string, RoleDefinition>();
  for (const r of BUILTIN_ROLES) byslug.set(r.slug, r);

  const { roles: globalRoles, errors: globalErrors } = await readRolesFromDir(getRolesDir(), 'global');
  for (const r of globalRoles) byslug.set(r.slug, r);

  let projectErrors: RoleParseError[] = [];
  if (projectPath) {
    const { roles: projectRoles, errors } = await readRolesFromDir(getProjectRolesDir(projectPath), 'project');
    for (const r of projectRoles) byslug.set(r.slug, r);
    projectErrors = errors;
  }

  const roles = Array.from(byslug.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return { roles, errors: [...globalErrors, ...projectErrors] };
}

function roleFrontmatter(role: RoleDefinition): Record<string, unknown> {
  const fm: Record<string, unknown> = { slug: role.slug, name: role.name };
  if (role.engine) fm.engine = role.engine;
  if (role.provider) fm.provider = role.provider;
  if (role.model) fm.model = role.model;
  if (role.tools && role.tools.length > 0) fm.tools = role.tools;
  if (role.permissions) fm.permissions = role.permissions;
  if (role.dod && role.dod.length > 0) fm.dod = role.dod;
  if (role.handoffTo && role.handoffTo.length > 0) fm.handoffTo = role.handoffTo;
  if (typeof role.maxTurns === 'number') fm.maxTurns = role.maxTurns;
  if (typeof role.budgetUsd === 'number') fm.budgetUsd = role.budgetUsd;
  return fm;
}

function roleFilePath(scope: 'global' | 'project', slug: string, projectPath?: string): string {
  const dir = scope === 'global' ? getRolesDir() : getProjectRolesDir(projectPath || '');
  return path.join(dir, `${slug}.md`);
}

/** Сохраняет роль (создание/редактирование) в global или project. */
export async function saveRole(scope: 'global' | 'project', role: RoleDefinition, projectPath?: string): Promise<string> {
  if (scope === 'project' && !projectPath) throw new Error('projectPath обязателен для сохранения проектной роли');
  const dir = scope === 'global' ? getRolesDir() : getProjectRolesDir(projectPath!);
  await fs.mkdir(dir, { recursive: true });
  const filePath = roleFilePath(scope, role.slug, projectPath);
  const fileContent = matter.stringify(role.systemPrompt ? `\n${role.systemPrompt}\n` : '\n', roleFrontmatter(role));
  await fs.writeFile(filePath, fileContent, 'utf-8');
  return filePath;
}

export async function deleteRole(scope: 'global' | 'project', slug: string, projectPath?: string): Promise<boolean> {
  const filePath = roleFilePath(scope, slug, projectPath);
  if (!existsSync(filePath)) return false;
  await fs.unlink(filePath);
  return true;
}

/** Копирует global/builtin роль в проект (project переопределит её по slug). */
export async function copyRoleToProject(slug: string, projectPath: string): Promise<RoleDefinition | null> {
  const { roles } = await loadRoles(projectPath);
  const role = roles.find((r) => r.slug === slug);
  if (!role) return null;
  const copy: RoleDefinition = { ...role, source: 'project' };
  const filePath = await saveRole('project', copy, projectPath);
  return { ...copy, filePath };
}
