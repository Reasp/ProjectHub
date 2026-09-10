/**
 * Типы единого HITL-контура (TASK-57, decision-10).
 *
 * Модуль намеренно без зависимостей от Electron и сервисов: его импортируют и `hitlService`,
 * и `claudeBridgeService`, и `agentFleetService`, и unit-тесты. Зеркало для рендерера —
 * `src/types/electron.d.ts` (ApprovalRequest, HitlAuditEntry, AppBusEvent).
 */

/** Откуда пришёл агент, запросивший разрешение. */
export type HitlOrigin = 'studio' | 'swarm' | 'handoff' | 'assigned';

export type HitlEngine = 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'api';

export type HitlRequestType = 'command' | 'file_write' | 'question' | 'subagent_dispatch';

export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface QuestionData {
  title: string;
  subtitle?: string;
  options: QuestionOption[];
  isMultiSelect?: boolean;
  allowOther?: boolean;
}

/**
 * Запрос на решение человека. Поля до `createdAt` — исторический `ApprovalRequest` карточки
 * AI Studio; остальные добавлены в TASK-57 для адресации, политики роли и аудита.
 */
export interface HitlRequest {
  id: string;
  sessionId: string;
  projectPath: string;
  type: HitlRequestType;
  title: string;
  details?: string;
  command?: string;
  filePath?: string;
  diff?: {
    filePath: string;
    oldContent: string;
    newContent: string;
    patch: string;
  };
  questionData?: QuestionData;
  createdAt: number;
  /** Источник агента (AI Studio, Swarm, Handoff, назначенная задача). */
  origin?: HitlOrigin;
  engine?: HitlEngine;
  /** Идентификатор агента внутри Swarm/Handoff; для AI Studio отсутствует. */
  agentId?: string;
  agentName?: string;
  /** Роль агента (decision-9); для AI Studio отсутствует. */
  role?: string;
  /** Хост, на котором работает агент (federation, decision-11). */
  hostId?: string;
  /** Имя инструмента движка (Bash, Write, run_command …). */
  tool?: string;
  /** Момент, после которого запрос считается истёкшим (решение deny). */
  expiresAt?: number;
  /**
   * Запрос восстановлен из `pending.json` после перезапуска: агент уже не ждёт ответа,
   * решение попадёт только в аудит.
   */
  orphaned?: boolean;
}

export type ApprovalResponse = { approved: boolean; text?: string };

export type HitlDecisionSourceKind =
  /** Пользователь в окне ProjectHub. */
  | 'local'
  /** Удалённое устройство (Remote Control, Telegram Mini App). */
  | 'remote'
  /** Внешний MCP-клиент (Claude Code, Cursor …) через встроенный MCP-сервер. */
  | 'mcp'
  /** Авто-правило политики (auto-approve, deny-list, путь вне проекта). */
  | 'auto'
  /** Истёк срок ожидания — решение deny по умолчанию. */
  | 'timeout'
  /** Сессия завершена/прервана до решения. */
  | 'cancelled'
  /** Приложение закрывается. */
  | 'shutdown';

export interface HitlDecisionSource {
  kind: HitlDecisionSourceKind;
  deviceId?: string;
  deviceName?: string;
  /** Имя сработавшего правила для `auto`. */
  rule?: string;
}

export type HitlDecideResult =
  | { ok: true; request: HitlRequest }
  | { ok: false; reason: 'not_found' | 'already_decided' };

export type HitlOutcome = 'executed' | 'failed' | 'not_executed' | 'session_gone';

/** Строка аудит-лога `<userData>/audit/hitl-<yyyy-mm>.jsonl`. Без секретов и содержимого файлов. */
export interface HitlAuditEntry {
  /** ISO-время записи. */
  ts: string;
  kind: 'decision' | 'outcome' | 'fallback';
  requestId: string;
  sessionId: string;
  projectPath: string;
  hostId?: string;
  origin?: HitlOrigin;
  engine?: HitlEngine;
  agentId?: string;
  agentName?: string;
  role?: string;
  tool?: string;
  type?: HitlRequestType;
  title?: string;
  filePath?: string;
  /** SHA-256 команды (hex). */
  commandHash?: string;
  /** Начало команды с вырезанными секретами. */
  commandPreview?: string;
  decision?: 'allow' | 'deny';
  decidedBy?: HitlDecisionSourceKind;
  deviceId?: string;
  deviceName?: string;
  rule?: string;
  /** Комментарий пользователя (усечённый). */
  comment?: string;
  /** Сколько запрос ждал решения. */
  waitedMs?: number;
  outcome?: HitlOutcome;
  detail?: string;
}

export interface HitlAuditQuery {
  /** `YYYY-MM`; без него — все месяцы. */
  month?: string;
  sessionId?: string;
  projectPath?: string;
  decidedBy?: HitlDecisionSourceKind;
  decision?: 'allow' | 'deny';
  kind?: HitlAuditEntry['kind'];
  origin?: HitlOrigin;
  /** Подстрока в title/tool/filePath/commandPreview/agentName/role. */
  search?: string;
  limit?: number;
}

/**
 * Права роли (decision-9). Любое поле только сужает глобальные настройки пользователя:
 * `false` запрещает, списки объединяются, таймауты берутся минимальные.
 */
export interface RolePermissions {
  autoApprove?: boolean;
  allowCommands?: boolean;
  allowFileWrite?: boolean;
  allowFileRead?: boolean;
  allowSubagents?: boolean;
  writeExcludePatterns?: string[];
  readExcludePatterns?: string[];
  commandDenyList?: string[];
  commandTimeoutSec?: number;
  /** Allow-список инструментов; всё вне списка отклоняется без карточки. Пустой/отсутствует — без ограничений. */
  allowedTools?: string[];
  /** Таймаут ожидания решения человека в минутах. */
  approvalTimeoutMin?: number;
}

// ─────────────────────────── Шина событий (decision-10, п. 5) ───────────────────────────

export interface AgentEventBase {
  sessionId: string;
  projectPath: string;
  origin: HitlOrigin;
  engine?: HitlEngine;
  agentId?: string;
  agentName?: string;
  role?: string;
  hostId?: string;
  at: number;
}

export type AppBusEvent =
  | { type: 'hitl:requested'; request: HitlRequest }
  | { type: 'hitl:decided'; request: HitlRequest; approved: boolean; source: HitlDecisionSource; comment?: string }
  | { type: 'hitl:expired'; request: HitlRequest }
  | { type: 'hitl:cancelled'; request: HitlRequest; reason?: string }
  | {
      type: 'hitl:fallback';
      sessionId: string;
      projectPath: string;
      origin: HitlOrigin;
      engine: HitlEngine;
      agentId?: string;
      agentName?: string;
      role?: string;
      reason: string;
      at: number;
    }
  | ({ type: 'agent:started' } & AgentEventBase)
  | ({ type: 'agent:finished'; outcome: 'done' | 'aborted'; durationMs?: number } & AgentEventBase)
  | ({ type: 'agent:failed'; error: string; durationMs?: number } & AgentEventBase);

export type AppBusEventType = AppBusEvent['type'];
