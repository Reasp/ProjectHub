/**
 * Инструменты памяти проекта для агентов (TASK-76, decision-51 п. 3–4).
 *
 * Одна реализация для всех поверхностей: встроенный MCP-сервер (Claude CLI, внешние MCP-клиенты) и
 * общий исполнитель инструментов API-агента. Здесь — каталог инструментов (описания и JSON-схемы),
 * разбор аргументов, приведение пути сессии (часто worktree агента) к корню зарегистрированного
 * проекта и запись в аудит. Реестр проектов и аудит внедряются, поэтому модуль тестируется без
 * Electron; боевые зависимости собирает `memoryToolDeps.ts`.
 */
import { findOwningProject } from './pathGuard.js';
import { MEMORY_LIMITS, MEMORY_TYPES, type MemoryDraft } from './memoryFormat.js';
import {
  MemoryError,
  deleteMemoryFact,
  searchMemory,
  writeMemoryFact,
  type MemoryEntry
} from './memoryStore.js';
import type { HitlEngine, HitlOrigin, HitlRequest } from './hitlTypes.js';

export const MEMORY_TOOL_PREFIX = 'memory_';
export const MEMORY_TOOL_NAMES = ['memory_write', 'memory_search', 'memory_delete'] as const;
export type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[number];

export function isMemoryToolName(name: string): name is MemoryToolName {
  return (MEMORY_TOOL_NAMES as readonly string[]).includes(name);
}

/** Правило в аудите для записей и удалений памяти. */
export const MEMORY_AUDIT_RULE = 'memory';

const DESCRIPTIONS: Record<MemoryToolName, string> = {
  memory_write:
    'Сохранить факт в память проекта (backlog/memory), чтобы следующие сессии и другие агенты его знали. '
    + 'Сохраняй неочевидное: что пробовали и почему не сработало, ловушки окружения, договорённости с человеком. '
    + 'Не сохраняй то, что уже есть в коде, задачах и ADR, и никогда не сохраняй секреты. '
    + 'Похожий факт уже есть — запись будет отклонена с его id: обнови его через replace.',
  memory_search: 'Найти факты в памяти проекта по словам запроса (заголовок, описание, текст факта).',
  memory_delete: 'Удалить устаревший или ошибочный факт из памяти проекта по id (mem-N).'
};

/** Определения в формате Anthropic tools (`input_schema`) — их же получает MCP-сервер как описания. */
export const MEMORY_TOOL_DEFINITIONS: ReadonlyArray<{ name: MemoryToolName; description: string; input_schema: Record<string, unknown> }> = [
  {
    name: 'memory_write',
    description: DESCRIPTIONS.memory_write,
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: `Короткий заголовок факта (до ${MEMORY_LIMITS.title} символов)` },
        description: { type: 'string', description: `Одна строка: о чём факт и когда он нужен (до ${MEMORY_LIMITS.description} символов)` },
        body: { type: 'string', description: `Сам факт; для project и feedback — строки «Почему:» и «Как применять:» (до ${MEMORY_LIMITS.body} символов)` },
        type: { type: 'string', enum: [...MEMORY_TYPES], description: 'project — о проекте и окружении, feedback — как работать, reference — где что искать' },
        replace: { type: 'string', description: 'id факта (mem-N), который нужно обновить целиком' }
      },
      required: ['title', 'description', 'body', 'type']
    }
  },
  {
    name: 'memory_search',
    description: DESCRIPTIONS.memory_search,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Слова для поиска' },
        limit: { type: 'number', description: 'Сколько фактов вернуть (1–10, по умолчанию 5)' }
      },
      required: ['query']
    }
  },
  {
    name: 'memory_delete',
    description: DESCRIPTIONS.memory_delete,
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'id факта, например mem-3' } },
      required: ['id']
    }
  }
];

export function memoryToolDescription(name: MemoryToolName): string {
  return DESCRIPTIONS[name];
}

/** Кто вызывает инструмент: для корня проекта, аудита и поля `author` факта. */
export interface MemoryToolContext {
  /** Путь сессии: корень проекта или worktree агента внутри него. */
  sessionPath: string;
  sessionId: string;
  origin: HitlOrigin;
  engine?: HitlEngine;
  agentId?: string;
  agentName?: string;
  role?: string;
  /** Задача сессии — пишется в `source` факта. */
  taskId?: string;
}

export interface MemoryToolDeps {
  /** Корни зарегистрированных проектов. */
  listProjectRoots(): Promise<string[]>;
  recordAutoDecision(info: Omit<HitlRequest, 'id' | 'createdAt'>, decision: 'allow' | 'deny', rule: string, detail?: string): string;
}

export interface MemoryToolResult {
  text: string;
  isError: boolean;
}

/** Корень зарегистрированного проекта, внутри которого лежит путь сессии; иначе null. */
export async function resolveMemoryProjectRoot(sessionPath: string, deps: Pick<MemoryToolDeps, 'listProjectRoots'>): Promise<string | null> {
  if (typeof sessionPath !== 'string' || !sessionPath.trim()) return null;
  return findOwningProject(await deps.listProjectRoots(), sessionPath);
}

const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

function authorOf(ctx: MemoryToolContext): string | undefined {
  const parts = [ctx.engine, ctx.role || ctx.agentName].filter(Boolean);
  return parts.length > 0 ? parts.join('/').slice(0, MEMORY_LIMITS.author) : undefined;
}

function formatFact(f: MemoryEntry): string {
  return [`### ${f.id}: ${f.title}`, `${f.description} (${f.type}, ${f.updated ?? f.created}${f.source ? `, ${f.source}` : ''})`, '', f.body].join('\n');
}

/** Текст отказа для модели: причина и что делать дальше, без значений секретов. */
export function memoryErrorText(err: MemoryError): string {
  switch (err.code) {
    case 'secret_detected':
      return `Не сохранено: в факте похоже на секрет (${(err.details.secretKinds ?? []).join(', ')}). Убери значение и опиши факт без него.`;
    case 'duplicate':
      return `Не сохранено: похожий факт уже есть — ${err.details.duplicateOf} «${err.details.duplicateTitle}». Обнови его: memory_write с replace: "${err.details.duplicateOf}".`;
    case 'invalid_draft':
      return `Не сохранено: ${(err.details.issues ?? []).map((i) => (i.field ? `${i.field}: ${i.code}` : i.code)).join(', ')}.`;
    case 'not_found':
      return `Факт не найден: ${err.message}`;
    case 'invalid_project':
      return 'Память недоступна: путь сессии не принадлежит зарегистрированному проекту ProjectHub.';
    default:
      return err.message;
  }
}

/** Выполняет инструмент памяти. Ошибки не бросает — возвращает текст для модели с `isError`. */
export async function callMemoryTool(
  name: string,
  args: Record<string, unknown>,
  ctx: MemoryToolContext,
  deps: MemoryToolDeps
): Promise<MemoryToolResult> {
  if (!isMemoryToolName(name)) return { text: `Неизвестный инструмент памяти: ${name}`, isError: true };

  const root = await resolveMemoryProjectRoot(ctx.sessionPath, deps);
  const audit = (decision: 'allow' | 'deny', title: string, filePath?: string, detail?: string) =>
    deps.recordAutoDecision(
      {
        sessionId: ctx.sessionId,
        projectPath: root ?? ctx.sessionPath,
        type: 'file_write',
        title,
        origin: ctx.origin,
        engine: ctx.engine,
        ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
        ...(ctx.agentName ? { agentName: ctx.agentName } : {}),
        ...(ctx.role ? { role: ctx.role } : {}),
        tool: name,
        ...(filePath ? { filePath } : {})
      },
      decision,
      MEMORY_AUDIT_RULE,
      detail
    );

  if (!root) {
    if (name !== 'memory_search') audit('deny', `${name}: invalid_project`, undefined, 'invalid_project');
    return { text: memoryErrorText(new MemoryError('invalid_project', 'invalid_project')), isError: true };
  }

  try {
    if (name === 'memory_search') {
      const query = str(args.query).trim();
      if (!query) return { text: 'Не указан запрос (query).', isError: true };
      const limitRaw = Number(args.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(10, Math.floor(limitRaw)) : 5;
      const found = await searchMemory(root, query, limit);
      if (found.length === 0) return { text: 'В памяти проекта ничего не найдено.', isError: false };
      return { text: found.map(formatFact).join('\n\n'), isError: false };
    }

    if (name === 'memory_delete') {
      const id = str(args.id).trim();
      const { relativePath } = await deleteMemoryFact(root, id);
      audit('allow', `memory_delete: ${id.toLowerCase()}`, relativePath);
      return { text: `Удалено: ${id.toLowerCase()} (${relativePath}).`, isError: false };
    }

    const type = str(args.type).trim();
    const draft: MemoryDraft = {
      title: str(args.title),
      description: str(args.description),
      body: str(args.body),
      // Неизвестный тип отклонит проверка черновика с понятным кодом invalid_type
      type: type as MemoryDraft['type'],
      ...(ctx.taskId ? { source: ctx.taskId.toLowerCase() } : { source: 'session' }),
      ...(authorOf(ctx) ? { author: authorOf(ctx) } : {})
    };
    const replace = str(args.replace).trim() || undefined;
    const result = await writeMemoryFact(root, draft, { replace });
    audit('allow', `memory_write: ${result.fact.id}${result.replaced ? ' (обновлён)' : ''}`, result.relativePath);
    return {
      text: `${result.replaced ? 'Обновлено' : 'Сохранено'}: ${result.fact.id} (${result.relativePath}).`,
      isError: false
    };
  } catch (err) {
    if (err instanceof MemoryError) {
      if (name !== 'memory_search') audit('deny', `${name}: ${err.code}`, undefined, err.code);
      return { text: memoryErrorText(err), isError: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { text: `Ошибка памяти проекта: ${message}`, isError: true };
  }
}

/**
 * Инструкция агенту, у которого есть запись в память: одна для всех движков, `toolPrefix` — как
 * инструменты видны движку (`memory_` у API-агента, `mcp__projecthub-hitl__memory_` у Claude CLI).
 */
export function buildMemoryInstructions(toolPrefix = MEMORY_TOOL_PREFIX): string {
  return [
    `Память проекта пополняется инструментом ${toolPrefix}write. Сохраняй туда неочевидные выводы, которые пригодятся в следующих сессиях: `
      + 'что пробовали и почему не сработало, ловушки окружения, договорённости с человеком. '
      + `Не дублируй код, задачи и ADR, не сохраняй секреты. Перед записью можно проверить похожее через ${toolPrefix}search.`
  ].join('\n');
}
