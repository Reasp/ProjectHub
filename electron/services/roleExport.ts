/**
 * Экспорт ролей ProjectHub в нативные субагенты движков и записи хуков терминальных сессий
 * (TASK-77, decision-54 п. 1–3).
 *
 * Чистый модуль без Electron и файловой системы: строит содержимое файлов и решает, что с каждым
 * файлом делать (`planFileWrite`). Запись на диск — `roleSyncService`.
 *
 * - Claude Code: `.claude/agents/<name>.md` (frontmatter `name`, `description`, `tools`, `model`, `maxTurns`).
 * - Codex: `.codex/agents/<slug>.toml` (`name`, `description`, `developer_instructions`, `model`, `sandbox_mode`).
 * - Google Antigravity: `.agents/agents/<name>.md` (`name`, `description`, `tools`, `model`), хуки — ключ `projecthub`
 *   в `.agents/hooks.json` (TASK-106, decision-62).
 * - Сгенерированный файл помечен комментарием-маркером с хэшем содержимого: так отличаются «устарел»
 *   (роль изменилась), «изменён вручную» и чужие файлы без маркера.
 */
import crypto from 'node:crypto';
import { claudeToolNamesForCategories } from './roleEngineAdapter.js';
import { CLAUDE_CLI_MODEL_ALIASES, buildModelChain, type ModelTierSettings, type TierEngine } from './modelTiers.js';
import { ALL_TOOL_CATEGORIES, type RoleDefinition, type RoleEngine, type ToolCategory } from './roleTypes.js';

export type ExportTarget = 'claude' | 'codex' | 'antigravity';
export const EXPORT_TARGETS: readonly ExportTarget[] = ['claude', 'codex', 'antigravity'];

export const EXPORT_MARKER = 'projecthub:generated';
/** Скрипт хуков терминальных сессий относительно корня проекта. */
export const HOOK_SCRIPT_REL_PATH = '.projecthub/hooks/projecthub-hook.mjs';
export const HOOK_SCRIPT_NAME = 'projecthub-hook.mjs';
export const CLAUDE_AGENTS_DIR = '.claude/agents';
export const CODEX_AGENTS_DIR = '.codex/agents';
export const ANTIGRAVITY_AGENTS_DIR = '.agents/agents';
export const CLAUDE_SETTINGS_REL_PATH = '.claude/settings.json';
export const CODEX_HOOKS_REL_PATH = '.codex/hooks.json';
export const ANTIGRAVITY_HOOKS_REL_PATH = '.agents/hooks.json';
/** Ключ группы хуков ProjectHub в `.agents/hooks.json`: корень файла — именованные группы, чужие не трогаются. */
export const ANTIGRAVITY_HOOK_GROUP = 'projecthub';

/** Движок ролей, соответствующий цели; у Antigravity своего движка в ролях нет. */
const TARGET_ENGINE: Record<ExportTarget, (RoleEngine & TierEngine) | null> = { claude: 'claude-cli', codex: 'codex-cli', antigravity: null };
const DESCRIPTION_LIMIT = 600;
const HASH_LENGTH = 16;

// ─────────────────────────────── Маркер и хэш ───────────────────────────────

/** Нормализация перед хэшем и сравнением: CRLF → LF, ровно один перевод строки в конце. */
export function normalizeContent(text: string): string {
  return `${text.replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`;
}

export function contentHash(text: string): string {
  return crypto.createHash('sha256').update(normalizeContent(text), 'utf8').digest('hex').slice(0, HASH_LENGTH);
}

const MARKER_RE = /^[ \t]*(?:#|\/\/)[ \t]*projecthub:generated\b[^\n]*?\bhash=([0-9a-f]{16})[^\n]*\n?/m;

export interface ExportMarker {
  hash: string;
  role?: string;
}

/** Маркер в первых строках файла (комментарий `#` для YAML/TOML, `//` для скрипта). */
export function readMarker(content: string): ExportMarker | null {
  const head = content.replace(/\r\n/g, '\n').split('\n').slice(0, 6).join('\n');
  const match = MARKER_RE.exec(head);
  if (!match) return null;
  const role = /\brole=([a-z0-9_-]+)/.exec(match[0])?.[1];
  return { hash: match[1], ...(role ? { role } : {}) };
}

/** Содержимое без строки маркера — то, от чего считается хэш. */
export function stripMarker(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(MARKER_RE, '');
}

function markerLine(comment: '#' | '//', hash: string, role?: string): string {
  const who = role ? ` role=${role}` : '';
  return `${comment} ${EXPORT_MARKER}${who} hash=${hash} — сгенерировано ProjectHub, правьте роль в ProjectHub, а не этот файл`;
}

/**
 * Вставляет маркер: в YAML-frontmatter — сразу после открывающего `---`, иначе первой строкой.
 * Хэш — от содержимого без маркера, поэтому `stripMarker(result)` даёт исходный текст.
 */
export function withMarker(body: string, comment: '#' | '//', role?: string): string {
  const normalized = normalizeContent(body);
  const line = markerLine(comment, contentHash(normalized), role);
  if (normalized.startsWith('---\n')) return `---\n${line}\n${normalized.slice(4)}`;
  return `${line}\n${normalized}`;
}

// ─────────────────────────────── План записи ───────────────────────────────

export type FileAction = 'create' | 'unchanged' | 'update' | 'conflict' | 'foreign' | 'orphan';

export interface FilePlanDecision {
  action: FileAction;
  /** Файл с маркером, содержимое которого правили руками (для `conflict` и `orphan`). */
  modified?: boolean;
}

/**
 * Что делать с файлом, помеченным маркером (decision-54 п. 2). `desired === null` — роли для файла больше нет.
 * Чужой файл без маркера не трогается никогда; правленный вручную — только по явному выбору.
 */
export function planFileWrite(current: string | null, desired: string | null): FilePlanDecision {
  if (current === null) return desired === null ? { action: 'unchanged' } : { action: 'create' };
  const marker = readMarker(current);
  if (!marker) return { action: 'foreign' };
  const modified = contentHash(stripMarker(current)) !== marker.hash;
  if (desired === null) return { action: 'orphan', ...(modified ? { modified } : {}) };
  if (normalizeContent(current) === normalizeContent(desired)) return { action: 'unchanged' };
  if (modified) {
    // Правка руками, совпавшая с новым содержимым, — не конфликт: перезапись только обновит маркер.
    return normalizeContent(stripMarker(current)) === normalizeContent(stripMarker(desired))
      ? { action: 'update' }
      : { action: 'conflict', modified: true };
  }
  return { action: 'update' };
}

/** Файл без маркера (настройки движка), который синхронизация сливает, а не генерирует целиком. */
export function planMergedFile(current: string | null, merged: string): FilePlanDecision {
  if (current === null) return { action: 'create' };
  return normalizeContent(current) === normalizeContent(merged) ? { action: 'unchanged' } : { action: 'update' };
}

// ─────────────────────────────── Модели ───────────────────────────────

export function isClaudeModel(model: string): boolean {
  return CLAUDE_CLI_MODEL_ALIASES.includes(model) || /^claude-[\w.[\]-]+$/i.test(model);
}

export interface ResolvedExportModel {
  /** Модель для файла; `undefined` у Codex — поле не пишется (наследование). */
  model?: string;
  source: 'explicit' | 'tier' | 'inherit';
  note?: string;
}

function tierModel(role: RoleDefinition, engine: TierEngine, tiers?: ModelTierSettings): string | undefined {
  if (!role.modelTier || !tiers) return undefined;
  return buildModelChain(tiers, { engine, tier: role.modelTier })[0]?.model;
}

function explicitModel(role: RoleDefinition): string | undefined {
  const model = role.model?.trim();
  return model && model !== 'default' ? model : undefined;
}

/** Модель субагента Claude Code: модель Claude из роли, затем тир для `claude-cli`, затем `inherit` (decision-54 п. 1). */
export function resolveClaudeModel(role: RoleDefinition, tiers?: ModelTierSettings): ResolvedExportModel {
  const explicit = explicitModel(role);
  const foreign = explicit && !isClaudeModel(explicit) ? `модель роли «${explicit}» — не модель Claude` : undefined;
  if (explicit && !foreign) return { model: explicit, source: 'explicit' };
  const fromTier = tierModel(role, 'claude-cli', tiers);
  if (fromTier) return { model: fromTier, source: 'tier', ...(foreign ? { note: `${foreign}, взят тир ${role.modelTier}` } : {}) };
  const why = role.modelTier ? `в тире ${role.modelTier} нет модели для claude-cli` : undefined;
  const note = [foreign, why].filter(Boolean).join('; ');
  return { model: 'inherit', source: 'inherit', ...(note ? { note: `${note} — модель основной сессии (inherit)` } : {}) };
}

/** Модель агента Codex: явная модель роли движка codex-cli, затем тир для `codex-cli`, иначе наследование. */
export function resolveCodexModel(role: RoleDefinition, tiers?: ModelTierSettings): ResolvedExportModel {
  const explicit = explicitModel(role);
  if (explicit && role.engine === 'codex-cli') return { model: explicit, source: 'explicit' };
  const fromTier = tierModel(role, 'codex-cli', tiers);
  if (fromTier) return { model: fromTier, source: 'tier' };
  const note = explicit
    ? `модель роли «${explicit}» не привязана к codex-cli — модель сессии Codex`
    : role.modelTier ? `в тире ${role.modelTier} нет модели для codex-cli — модель сессии Codex` : undefined;
  return { source: 'inherit', ...(note ? { note } : {}) };
}

// ─────────────────────────────── Файлы агентов ───────────────────────────────

export interface ExportedRoleFile {
  target: ExportTarget;
  roleSlug: string;
  /** Путь относительно корня проекта, всегда через `/`. */
  relPath: string;
  content: string;
  /** Что движок не может выразить или откуда взята модель — для предпросмотра. */
  notes: string[];
}

export interface SkippedRoleExport {
  target: ExportTarget;
  roleSlug: string;
  reason: string;
}

export function isSkippedExport(value: ExportedRoleFile | SkippedRoleExport): value is SkippedRoleExport {
  return 'reason' in value;
}

export interface RoleExportContext {
  tiers?: ModelTierSettings;
}

/** Имя субагента Claude Code: строчные буквы, цифры и дефисы. */
export function claudeAgentName(slug: string): string {
  return slug.toLowerCase().replace(/_/g, '-');
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const match = /^(.+?[.!?])(\s|$)/.exec(flat);
  return (match ? match[1] : flat).slice(0, 300);
}

/** Описание для автоделегирования: имя роли, первая фраза промпта и DoD. */
export function roleDescription(role: RoleDefinition): string {
  const parts = [`Роль ProjectHub «${role.name}».`];
  if (role.systemPrompt.trim()) parts.push(firstSentence(role.systemPrompt));
  if (role.dod?.length) parts.push(`Готово, когда: ${role.dod.join('; ')}.`);
  const text = parts.join(' ');
  return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT - 1)}…` : text;
}

function engineSkip(role: RoleDefinition, target: ExportTarget): SkippedRoleExport | null {
  if (!role.engine || role.engine === TARGET_ENGINE[target]) return null;
  return { target, roleSlug: role.slug, reason: `роль привязана к движку ${role.engine}` };
}

function buildAgentFile(target: ExportTarget, role: RoleDefinition, ctx: RoleExportContext): ExportedRoleFile | SkippedRoleExport {
  if (target === 'claude') return buildClaudeAgentFile(role, ctx);
  if (target === 'codex') return buildCodexAgentFile(role, ctx);
  return buildAntigravityAgentFile(role, ctx);
}

/** Имена инструментов Claude Code для субагента. `Task` — прежнее имя `Agent`, в файл не пишется. */
function claudeAgentTools(categories: ToolCategory[]): string[] {
  return claudeToolNamesForCategories(categories).filter((t) => t !== 'Task');
}

export function buildClaudeAgentFile(role: RoleDefinition, ctx: RoleExportContext = {}): ExportedRoleFile | SkippedRoleExport {
  const skip = engineSkip(role, 'claude');
  if (skip) return skip;
  const name = claudeAgentName(role.slug);
  const notes: string[] = [];
  const lines = ['---', `name: ${yamlString(name)}`, `description: ${yamlString(roleDescription(role))}`];
  if (role.tools?.length) lines.push(`tools: ${yamlString(claudeAgentTools(role.tools).join(', '))}`);
  const model = resolveClaudeModel(role, ctx.tiers);
  lines.push(`model: ${yamlString(model.model ?? 'inherit')}`);
  if (model.note) notes.push(model.note);
  if (typeof role.maxTurns === 'number' && role.maxTurns > 0) lines.push(`maxTurns: ${Math.floor(role.maxTurns)}`);
  if (typeof role.budgetUsd === 'number') notes.push('бюджет роли субагенту не передаётся');
  lines.push('---', '', role.systemPrompt.trim() || `Ты работаешь в роли «${role.name}».`);
  return {
    target: 'claude',
    roleSlug: role.slug,
    relPath: `${CLAUDE_AGENTS_DIR}/${name}.md`,
    content: withMarker(lines.join('\n'), '#', role.slug),
    notes
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

/** Многострочный литерал TOML (без экранирования), если текст не содержит `'''`; иначе обычная строка. */
function tomlMultiline(value: string): string {
  const text = value.replace(/\r\n/g, '\n');
  if (!text.includes("'''")) return `'''\n${text}\n'''`;
  return tomlString(text);
}

/** `read-only`, если роль не может ни писать, ни запускать команды; `danger-full-access` не генерируется никогда. */
export function codexSandboxMode(role: RoleDefinition): 'read-only' | 'workspace-write' {
  const p = role.permissions;
  const byPermissions = p?.allowFileWrite === false && p?.allowCommands === false;
  const byTools = Boolean(role.tools?.length) && !role.tools!.includes('write') && !role.tools!.includes('command');
  return byPermissions || byTools ? 'read-only' : 'workspace-write';
}

export function buildCodexAgentFile(role: RoleDefinition, ctx: RoleExportContext = {}): ExportedRoleFile | SkippedRoleExport {
  const skip = engineSkip(role, 'codex');
  if (skip) return skip;
  const notes: string[] = [];
  const lines = [`name = ${tomlString(role.slug)}`, `description = ${tomlString(roleDescription(role))}`];
  const model = resolveCodexModel(role, ctx.tiers);
  if (model.model) lines.push(`model = ${tomlString(model.model)}`);
  if (model.note) notes.push(model.note);
  lines.push(`sandbox_mode = ${tomlString(codexSandboxMode(role))}`);
  if (role.tools?.length) notes.push('Codex не ограничивает набор инструментов по категориям роли — только sandbox');
  if (typeof role.maxTurns === 'number') notes.push('лимит ходов роли Codex не передаётся');
  lines.push(`developer_instructions = ${tomlMultiline(role.systemPrompt.trim() || `Ты работаешь в роли «${role.name}».`)}`);
  return {
    target: 'codex',
    roleSlug: role.slug,
    relPath: `${CODEX_AGENTS_DIR}/${role.slug}.toml`,
    content: withMarker(lines.join('\n'), '#', role.slug),
    notes
  };
}

// ─────────────────────────────── Antigravity ───────────────────────────────

/**
 * Инструменты Antigravity по категориям ролей (decision-62 п. 2). Только имена, которые реестр agy 1.2.12 принял в
 * `tools` субагента: неизвестное имя не даёт субагенту запуститься («tool not found in registry»). `send_message` и
 * `manage_task` движок выдаёт субагенту всегда; `define_subagent` (создать нового агента на лету) не выдаётся.
 */
export const ANTIGRAVITY_TOOLS_BY_CATEGORY: Record<ToolCategory, readonly string[]> = {
  read: ['view_file', 'list_dir', 'grep_search', 'find_by_name'],
  write: ['write_to_file', 'replace_file_content', 'multi_replace_file_content'],
  command: ['run_command'],
  search: ['search_web', 'read_url_content'],
  subagent: ['invoke_subagent', 'manage_subagents'],
  question: ['ask_question']
};

/** Категория, которую права роли запрещают целиком (`allowX: false`). */
const PERMISSION_OF_CATEGORY: Partial<Record<ToolCategory, 'allowFileRead' | 'allowFileWrite' | 'allowCommands' | 'allowSubagents'>> = {
  read: 'allowFileRead',
  write: 'allowFileWrite',
  command: 'allowCommands',
  subagent: 'allowSubagents'
};

/**
 * Инструменты субагента Antigravity. Роль без категорий получает все: без поля `tools` движок выдаёт урезанный набор
 * по умолчанию (без записи и команд), а не «все инструменты». Хук не знает, какой субагент вызвал инструмент, поэтому
 * запрет категории в правах роли здесь убирает инструменты, а не отправляет вызов человеку (decision-62 п. 3).
 */
export function antigravityToolsForRole(role: RoleDefinition): { tools: string[]; removed: ToolCategory[] } {
  const categories = role.tools?.length ? role.tools : ALL_TOOL_CATEGORIES;
  const removed: ToolCategory[] = [];
  const tools: string[] = [];
  for (const category of ALL_TOOL_CATEGORIES) {
    if (!categories.includes(category)) continue;
    const permission = PERMISSION_OF_CATEGORY[category];
    if (permission && role.permissions?.[permission] === false) {
      removed.push(category);
      continue;
    }
    for (const tool of ANTIGRAVITY_TOOLS_BY_CATEGORY[category]) if (!tools.includes(tool)) tools.push(tool);
  }
  return { tools, removed };
}

export const ANTIGRAVITY_MODEL_ALIASES = ['inherit', 'flash', 'pro'] as const;

/** Модель Gemini (алиас или id) → алиас Antigravity `flash | pro`; остальное не выражается. */
export function antigravityModelAlias(model: string): 'flash' | 'pro' | 'inherit' | undefined {
  const m = model.trim().toLowerCase();
  if ((ANTIGRAVITY_MODEL_ALIASES as readonly string[]).includes(m)) return m as 'flash' | 'pro' | 'inherit';
  if (!/^gemini-/.test(m)) return undefined;
  if (/-pro(\b|-)/.test(m)) return 'pro';
  if (/-flash(\b|-)/.test(m)) return 'flash';
  return undefined;
}

/**
 * Модель субагента Antigravity: движок принимает только `inherit | flash | pro`. Явная модель роли, если она
 * выражается алиасом, затем первое звено тира для `gemini-cli`, иначе `inherit` (вендорских дефолтов нет).
 */
export function resolveAntigravityModel(role: RoleDefinition, tiers?: ModelTierSettings): ResolvedExportModel {
  const explicit = explicitModel(role);
  const fromExplicit = explicit ? antigravityModelAlias(explicit) : undefined;
  if (fromExplicit) return { model: fromExplicit, source: 'explicit' };
  const tier = tierModel(role, 'gemini-cli', tiers);
  const fromTier = tier ? antigravityModelAlias(tier) : undefined;
  const foreign = explicit ? `модель роли «${explicit}» не выражается в Antigravity (inherit | flash | pro)` : undefined;
  if (fromTier) return { model: fromTier, source: 'tier', ...(foreign ? { note: `${foreign}, взят тир ${role.modelTier}` } : {}) };
  const why = role.modelTier ? `тир ${role.modelTier} не даёт модели Gemini flash/pro` : undefined;
  const note = [foreign, why].filter(Boolean).join('; ');
  return { model: 'inherit', source: 'inherit', ...(note ? { note: `${note} — модель основной сессии (inherit)` } : {}) };
}

export function buildAntigravityAgentFile(role: RoleDefinition, ctx: RoleExportContext = {}): ExportedRoleFile | SkippedRoleExport {
  // У Antigravity нет движка в ролях: роль, привязанная к любому движку, туда не экспортируется.
  const skip = engineSkip(role, 'antigravity');
  if (skip) return skip;
  const name = claudeAgentName(role.slug);
  const notes: string[] = [];
  const { tools, removed } = antigravityToolsForRole(role);
  if (removed.length) notes.push(`права роли запрещают ${removed.join(', ')} — инструменты убраны (хук не знает имени субагента)`);
  if (!tools.length) notes.push('у субагента не остаётся инструментов');
  const model = resolveAntigravityModel(role, ctx.tiers);
  if (model.note) notes.push(model.note);
  if (typeof role.maxTurns === 'number') notes.push('лимит ходов роли Antigravity не передаётся');
  if (typeof role.budgetUsd === 'number') notes.push('бюджет роли субагенту не передаётся');
  const lines = [
    '---',
    `name: ${yamlString(name)}`,
    `description: ${yamlString(roleDescription(role))}`,
    `tools: [${tools.map(yamlString).join(', ')}]`,
    `model: ${yamlString(model.model ?? 'inherit')}`,
    '---',
    '',
    role.systemPrompt.trim() || `Ты работаешь в роли «${role.name}».`
  ];
  return {
    target: 'antigravity',
    roleSlug: role.slug,
    relPath: `${ANTIGRAVITY_AGENTS_DIR}/${name}.md`,
    content: withMarker(lines.join('\n'), '#', role.slug),
    notes
  };
}

export function buildRoleExport(
  roles: RoleDefinition[],
  targets: readonly ExportTarget[],
  ctx: RoleExportContext = {}
): { files: ExportedRoleFile[]; skipped: SkippedRoleExport[] } {
  const files: ExportedRoleFile[] = [];
  const skipped: SkippedRoleExport[] = [];
  for (const target of targets) {
    for (const role of roles) {
      const result = buildAgentFile(target, role, ctx);
      if (isSkippedExport(result)) skipped.push(result);
      else files.push(result);
    }
  }
  return { files, skipped };
}

/** Роль по имени субагента из входа хука (`agent_type`): только роли, которые экспортирует ProjectHub. */
export function roleForAgentType(roles: RoleDefinition[], agentType: string | undefined): RoleDefinition | undefined {
  if (!agentType) return undefined;
  const wanted = agentType.trim().toLowerCase();
  return roles.find((r) => r.slug === wanted || claudeAgentName(r.slug) === wanted);
}

// ─────────────────────────────── Записи хуков ───────────────────────────────

/** События хуков по движку (decision-54 п. 3). */
export const HOOK_EVENTS: Record<ExportTarget, readonly string[]> = {
  claude: ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop'],
  codex: ['PreToolUse', 'PostToolUse', 'Stop'],
  antigravity: ['PreToolUse', 'PostToolUse', 'Stop']
};

export const DEFAULT_HOOK_TIMEOUT_SEC = 1800;
export const MIN_HOOK_TIMEOUT_SEC = 60;
export const MAX_HOOK_TIMEOUT_SEC = 3600;

export function clampHookTimeoutSec(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_HOOK_TIMEOUT_SEC;
  return Math.min(Math.max(n, MIN_HOOK_TIMEOUT_SEC), MAX_HOOK_TIMEOUT_SEC);
}

/**
 * Команда хука. `event` нужен только Antigravity: имени события нет во входе хука, оно передаётся аргументом.
 */
export function hookCommand(target: ExportTarget, timeoutSec: number, event?: string): string {
  const budget = `--budget ${clampHookTimeoutSec(timeoutSec)}`;
  // Claude Code раскрывает $CLAUDE_PROJECT_DIR у command-хуков; у Codex такой переменной нет — путь от корня.
  if (target === 'claude') return `node "$CLAUDE_PROJECT_DIR/${HOOK_SCRIPT_REL_PATH}" claude ${budget}`;
  if (target === 'codex') return `node ${HOOK_SCRIPT_REL_PATH} codex ${budget}`;
  // Antigravity запускает хук через cmd /C в каталоге `.agents/` (проверено вживую): путь от него, без кавычек.
  return `node ../${HOOK_SCRIPT_REL_PATH} antigravity ${event ?? 'PreToolUse'} ${budget}`;
}

interface HookHandler {
  type?: string;
  command?: string;
  [key: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookHandler[];
  [key: string]: unknown;
}

function isOurHandler(handler: unknown): boolean {
  return Boolean(handler && typeof handler === 'object' && String((handler as HookHandler).command ?? '').includes(HOOK_SCRIPT_NAME));
}

/** Убирает наши обработчики из групп события; группы, оставшиеся пустыми, удаляются. */
function withoutOurHandlers(groups: unknown): HookGroup[] {
  if (!Array.isArray(groups)) return [];
  const out: HookGroup[] = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    const g = group as HookGroup;
    if (!Array.isArray(g.hooks)) {
      out.push(g);
      continue;
    }
    const hooks = g.hooks.filter((h) => !isOurHandler(h));
    if (hooks.length === 0 && g.hooks.length > 0) continue;
    out.push({ ...g, hooks });
  }
  return out;
}

export type MergeHookResult = { ok: true; content: string } | { ok: false; error: string };

function parseSettingsRoot(current: string | null): { ok: true; root: Record<string, unknown> } | { ok: false; error: string } {
  if (current === null || !current.trim()) return { ok: true, root: {} };
  try {
    const parsed = JSON.parse(current);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'файл настроек не является JSON-объектом' };
    return { ok: true, root: parsed as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: `невалидный JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * `.agents/hooks.json` Antigravity: корень — именованные группы хуков, ProjectHub владеет только группой
 * `projecthub`. У PreToolUse/PostToolUse обработчики вложены в `{ matcher, hooks }`, у Stop — плоские: вложенный
 * Stop agy 1.2.12 читает без команды (проверено вживую).
 */
function mergeAntigravityHooks(root: Record<string, unknown>, options: { timeoutSec: number; install: boolean }): MergeHookResult {
  const next: Record<string, unknown> = { ...root };
  delete next[ANTIGRAVITY_HOOK_GROUP];
  if (options.install) {
    const timeout = clampHookTimeoutSec(options.timeoutSec);
    const handler = (event: string): HookHandler => ({ type: 'command', command: hookCommand('antigravity', timeout, event), timeout });
    const group: Record<string, unknown> = {};
    for (const event of HOOK_EVENTS.antigravity) {
      group[event] = event === 'Stop' ? [handler(event)] : [{ matcher: '*', hooks: [handler(event)] }];
    }
    next[ANTIGRAVITY_HOOK_GROUP] = group;
  }
  return { ok: true, content: `${JSON.stringify(next, null, 2)}\n` };
}

/**
 * Сливает записи хуков ProjectHub в настройки движка (`.claude/settings.json`, `.codex/hooks.json`,
 * `.agents/hooks.json`): чужие ключи, события и обработчики сохраняются, наши заменяются. `install: false` — только
 * убрать наши.
 */
export function mergeHookSettings(current: string | null, target: ExportTarget, options: { timeoutSec: number; install: boolean }): MergeHookResult {
  const parsedRoot = parseSettingsRoot(current);
  if (!parsedRoot.ok) return parsedRoot;
  const root = parsedRoot.root;
  if (target === 'antigravity') return mergeAntigravityHooks(root, options);
  const rawHooks = root.hooks;
  if (rawHooks !== undefined && (!rawHooks || typeof rawHooks !== 'object' || Array.isArray(rawHooks))) {
    return { ok: false, error: 'поле hooks не является объектом' };
  }
  const hooks: Record<string, unknown> = { ...((rawHooks as Record<string, unknown>) ?? {}) };
  for (const event of Object.keys(hooks)) {
    const cleaned = withoutOurHandlers(hooks[event]);
    if (cleaned.length) hooks[event] = cleaned;
    else delete hooks[event];
  }
  if (options.install) {
    const timeout = clampHookTimeoutSec(options.timeoutSec);
    const handler: HookHandler = { type: 'command', command: hookCommand(target, timeout), timeout };
    for (const event of HOOK_EVENTS[target]) {
      // Stop не имеет matcher; инструментальные события — все инструменты.
      const group: HookGroup = event === 'Stop' ? { hooks: [handler] } : { matcher: target === 'claude' ? '*' : '.*', hooks: [handler] };
      hooks[event] = [...withoutOurHandlers(hooks[event]), group];
    }
  }
  const next: Record<string, unknown> = { ...root };
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  return { ok: true, content: `${JSON.stringify(next, null, 2)}\n` };
}

/** Есть ли где-либо в JSON обработчик с нашим скриптом (формы Claude/Codex и Antigravity, вложенные и плоские). */
function containsOurHandler(value: unknown, depth = 0): boolean {
  if (depth > 6 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => containsOurHandler(v, depth + 1));
  if (isOurHandler(value)) return true;
  return Object.values(value as Record<string, unknown>).some((v) => containsOurHandler(v, depth + 1));
}

/** Установлены ли наши хуки в настройках движка (для индикатора; невалидный JSON — нет). */
export function hasOurHooks(current: string | null): boolean {
  if (!current) return false;
  try {
    const parsed = JSON.parse(current) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return false;
    // Claude/Codex — объект `hooks`; Antigravity — именованные группы в корне файла.
    return containsOurHandler(parsed.hooks) || containsOurHandler(parsed[ANTIGRAVITY_HOOK_GROUP]);
  } catch {
    return false;
  }
}
