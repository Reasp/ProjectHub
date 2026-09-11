import { parseAssignee } from '../../src/utils/assignee.js';

/**
 * Правила автозапуска задачи, назначенной на этот хост (TASK-66, decision-11 п.5).
 *
 * Вынесено в чистый модуль намеренно: это единственное место, где приложение запускает агента
 * САМО, без нажатия человека, — поэтому условия должны быть явными и проверяемыми тестами.
 */

/** Статусы, в которых автозапуск уместен: задача ещё в работе, а не на ревью/закрыта. */
const RUNNABLE_STATUSES = new Set(['to do', 'todo', 'in progress']);

/** Пауза между автозапусками одной и той же задачи — защита от циклов «вотчер → запись → вотчер». */
export const AUTO_START_COOLDOWN_MS = 10 * 60 * 1000;

export interface AutoStartInput {
  /** Включён ли автозапуск в настройках (по умолчанию выключен). */
  enabled: boolean;
  assignee: string | null | undefined;
  taskStatus: string | null | undefined;
  localHostId: string;
  /** По задаче уже работает агент. */
  hasActiveSwarm: boolean;
  /** Когда эта задача автозапускалась в прошлый раз (0 — никогда). */
  lastStartedAt?: number;
  now?: number;
}

export interface AutoStartDecision {
  start: boolean;
  reason:
    | 'disabled'
    | 'not-assigned-to-agent'
    | 'no-explicit-host'
    | 'other-host'
    | 'status-not-runnable'
    | 'already-running'
    | 'cooldown'
    | 'ok';
  roleSlug?: string;
}

/**
 * Решает, запускать ли агента по назначению задачи.
 *
 * Важное ограничение: автозапуск срабатывает только на `agent:<role>@<этот hostId>` — назначение
 * без хоста (`agent:<role>`) НЕ запускается автоматически. Иначе одна задача, синхронизированная
 * через git, стартовала бы сразу на всех машинах пользователя.
 */
export function decideAutoStart(input: AutoStartInput): AutoStartDecision {
  if (!input.enabled) return { start: false, reason: 'disabled' };

  const parsed = parseAssignee(input.assignee);
  if (!parsed || parsed.kind !== 'agent') return { start: false, reason: 'not-assigned-to-agent' };
  if (!parsed.hostId) return { start: false, reason: 'no-explicit-host', roleSlug: parsed.roleSlug };
  if (parsed.hostId !== input.localHostId) return { start: false, reason: 'other-host', roleSlug: parsed.roleSlug };

  const status = String(input.taskStatus || '').trim().toLowerCase();
  if (!RUNNABLE_STATUSES.has(status)) return { start: false, reason: 'status-not-runnable', roleSlug: parsed.roleSlug };
  if (input.hasActiveSwarm) return { start: false, reason: 'already-running', roleSlug: parsed.roleSlug };

  const now = input.now ?? Date.now();
  const last = input.lastStartedAt ?? 0;
  if (last && now - last < AUTO_START_COOLDOWN_MS) return { start: false, reason: 'cooldown', roleSlug: parsed.roleSlug };

  return { start: true, reason: 'ok', roleSlug: parsed.roleSlug };
}
