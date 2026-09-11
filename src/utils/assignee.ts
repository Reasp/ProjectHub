/**
 * Разбор поля `assignee` задачи Backlog.md (decision-9 п.4, decision-11 п.5, TASK-66).
 *
 * Форматы:
 * - `agent:<roleSlug>` — агент с ролью на текущей машине;
 * - `agent:<roleSlug>@<hostId>` — агент с ролью на конкретном хосте федерации;
 * - всё остальное — человек (`@user`, `user@example.com`, «Иван»).
 *
 * Чистый модуль без Electron/React: используется и в рендерере (`TaskDetailModal`), и в
 * main-процессе (маршрутизация назначений между машинами), и покрыт unit-тестами.
 */

/** Тот же формат slug, что и в реестре ролей (`roleService.SLUG_RE`). */
const ROLE_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;
/** `hostId` хоста: `ph_host_<hex>`, но допускаем любой безопасный идентификатор без `@` и пробелов. */
const HOST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const AGENT_ASSIGNEE_PREFIX = 'agent:';

export interface AgentAssignee {
  kind: 'agent';
  roleSlug: string;
  /** Не задан — агент запускается на локальном хосте. */
  hostId?: string;
  raw: string;
}

export interface HumanAssignee {
  kind: 'human';
  /** Имя без ведущего `@` (Backlog.md пишет исполнителей-людей как `@name`). */
  name: string;
  raw: string;
}

/** Строка начинается с `agent:`, но роль/хост в ней невалидны — это ошибка, а не человек. */
export interface InvalidAssignee {
  kind: 'invalid';
  reason: 'empty-role' | 'bad-role' | 'bad-host';
  raw: string;
}

export type ParsedAssignee = AgentAssignee | HumanAssignee | InvalidAssignee | null;

/**
 * Разбирает значение `assignee`. Возвращает `null` для пустой строки.
 *
 * Важно: `@` разделяет роль и хост ТОЛЬКО в форме `agent:`. У людей `@` — часть имени
 * (`veshiy666@gmail.com`), и трактовать хвост как `hostId` нельзя.
 */
export function parseAssignee(raw: string | null | undefined): ParsedAssignee {
  const value = String(raw ?? '').trim();
  if (!value) return null;

  if (!value.toLowerCase().startsWith(AGENT_ASSIGNEE_PREFIX)) {
    return { kind: 'human', name: value.replace(/^@+/, ''), raw: value };
  }

  const rest = value.slice(AGENT_ASSIGNEE_PREFIX.length).trim();
  if (!rest) return { kind: 'invalid', reason: 'empty-role', raw: value };

  const at = rest.indexOf('@');
  const roleSlug = (at === -1 ? rest : rest.slice(0, at)).trim();
  const hostId = at === -1 ? '' : rest.slice(at + 1).trim();

  if (!roleSlug || !ROLE_SLUG_RE.test(roleSlug)) {
    return { kind: 'invalid', reason: 'bad-role', raw: value };
  }
  if (at !== -1 && (!hostId || !HOST_ID_RE.test(hostId))) {
    return { kind: 'invalid', reason: 'bad-host', raw: value };
  }

  return { kind: 'agent', roleSlug, ...(hostId ? { hostId } : {}), raw: value };
}

/** Собирает каноничное значение `assignee` для агента. */
export function formatAgentAssignee(roleSlug: string, hostId?: string): string {
  const slug = String(roleSlug || '').trim();
  const host = String(hostId || '').trim();
  return host ? `${AGENT_ASSIGNEE_PREFIX}${slug}@${host}` : `${AGENT_ASSIGNEE_PREFIX}${slug}`;
}

/** Назначение адресовано агенту (валидному), а не человеку. */
export function isAgentAssignee(raw: string | null | undefined): boolean {
  return parseAssignee(raw)?.kind === 'agent';
}

/**
 * Кому адресована задача относительно текущей машины:
 * - `local` — агенту на этом хосте (хост не указан или совпадает с `localHostId`);
 * - `remote` — агенту на другой машине федерации;
 * - `none` — человеку, пусто или невалидно.
 */
export function resolveAssigneeTarget(
  raw: string | null | undefined,
  localHostId: string
): { target: 'local' | 'remote' | 'none'; roleSlug?: string; hostId?: string } {
  const parsed = parseAssignee(raw);
  if (!parsed || parsed.kind !== 'agent') return { target: 'none' };
  if (!parsed.hostId || parsed.hostId === localHostId) {
    return { target: 'local', roleSlug: parsed.roleSlug, hostId: parsed.hostId };
  }
  return { target: 'remote', roleSlug: parsed.roleSlug, hostId: parsed.hostId };
}
