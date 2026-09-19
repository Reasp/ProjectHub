import { evaluateToolRequest, isToolAllowed, type PolicyVerdict } from './hitlPolicy.js';
import { DEFAULT_MAX_TOOL_STEPS } from './apiToolLoop.js';
import type { AIProviderConfig } from './aiAgentService.js';
import type { HitlRequestType } from './hitlTypes.js';

/**
 * Политика инструментов API-агента Swarm и AI Studio (TASK-101, TASK-103, decision-46 п. 1, 2, 4, 6, decision-47): чистые функции без
 * Electron, сети и файловой системы. Вердикт даёт та же `evaluateToolRequest`, что решает за Claude CLI
 * в Swarm (decision-10), поэтому у двух движков одного слота одни правила. Исполнение — `apiToolExecutor.ts`.
 */

/** Инструменты API-движка (`aiAgentService.getAnthropicTools`), которые умеет исполнять общий исполнитель. */
export type ApiToolKind = 'read' | 'list' | 'search' | 'write' | 'command' | 'question' | 'computer' | 'unknown';

/** Префикс инструментов прокси управления компьютером (`computerToolCatalog.COMPUTER_TOOL_PREFIX`). */
const COMPUTER_PREFIX = 'computer_';

const KIND_BY_NAME: Record<string, ApiToolKind> = {
  read_file: 'read',
  read: 'read',
  list_dir: 'list',
  search_rag: 'search',
  write_file: 'write',
  write_to_file: 'write',
  run_command: 'command',
  bash: 'command',
  ask_question: 'question'
};

/**
 * Имена-аналоги Claude Code для allow-списка роли (`permissions.allowedTools`): роль, написанная под
 * Claude CLI (`Read`, `Bash`), так же разрешает соответствующие инструменты API-движка.
 */
const CLAUDE_ALIASES: Record<Exclude<ApiToolKind, 'computer' | 'unknown'>, string[]> = {
  read: ['Read'],
  list: ['Read', 'Glob', 'LS'],
  search: ['Grep'],
  write: ['Write', 'Edit'],
  command: ['Bash'],
  question: ['AskUserQuestion']
};

export function apiToolKind(name: string): ApiToolKind {
  if (name.startsWith(COMPUTER_PREFIX)) return 'computer';
  return KIND_BY_NAME[name] ?? 'unknown';
}

/** Инструмент разрешён allow-списком роли под своим именем или под именем-аналогом Claude Code. */
export function isApiToolAllowed(name: string, allowedTools?: string[]): boolean {
  if (!allowedTools || allowedTools.length === 0) return true;
  if (isToolAllowed(name, allowedTools)) return true;
  const kind = apiToolKind(name);
  if (kind === 'computer' || kind === 'unknown') return false;
  return CLAUDE_ALIASES[kind].some((alias) => isToolAllowed(alias, allowedTools));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

export interface ApiToolPlan {
  kind: ApiToolKind;
  verdict: PolicyVerdict['verdict'];
  rule: string;
  reason?: string;
  /** Тип карточки и записи аудита. */
  approvalType: HitlRequestType;
  filePath?: string;
  command?: string;
  /** `run_command` с `background: true`, разрешённый контекстом (AI Studio, decision-47 п. 3). */
  background?: boolean;
}

export interface ApiToolPlanOptions {
  /** Фоновые команды разрешены (AI Studio). В Swarm их нет: процесс пережил бы агента (decision-46 п. 2). */
  allowBackground?: boolean;
}

/**
 * План вызова: вид инструмента, вердикт политики (`allow | deny | ask`) с правилом для аудита.
 * `config` — уже суженная правами роли конфигурация (`applyRolePermissions`), `workDir` — worktree слота.
 * `computer_*` здесь только разрешаются allow-списком: их политику применяет прокси (decision-27).
 */
export function planApiToolCall(
  config: AIProviderConfig,
  workDir: string,
  name: string,
  args: Record<string, unknown>,
  options: ApiToolPlanOptions = {}
): ApiToolPlan {
  const kind = apiToolKind(name);
  const rules = config.autoApproveRules;
  const deny = (rule: string, reason: string, approvalType: HitlRequestType = 'command'): ApiToolPlan =>
    ({ kind, verdict: 'deny', rule, reason, approvalType });

  if (kind === 'unknown') {
    return deny('unknown-tool', `Инструмент ${name} недоступен агенту.`);
  }
  if (!isApiToolAllowed(name, rules?.allowedTools)) {
    return deny('tool-not-allowed', `Инструмент ${name} не входит в allow-список роли.`, kind === 'computer' ? 'computer_action' : 'command');
  }
  if (kind === 'computer') {
    return { kind, verdict: 'allow', rule: 'computer-proxy', approvalType: 'computer_action' };
  }

  // Allow-список уже проверен с алиасами — дальше политика видит его пустым, чтобы не отклонить
  // `read_file` у роли, где разрешён только `Read`.
  const narrowed: AIProviderConfig = rules?.allowedTools
    ? { ...config, autoApproveRules: { ...rules, allowedTools: undefined } }
    : config;
  const filePath = text(args.filePath ?? args.file_path ?? args.path);
  const command = text(args.command ?? args.cmd);

  let verdict: PolicyVerdict;
  let approvalType: HitlRequestType;
  switch (kind) {
    case 'read':
      verdict = evaluateToolRequest(narrowed, workDir, 'read_file', { filePath });
      approvalType = 'question';
      break;
    case 'list':
      verdict = evaluateToolRequest(narrowed, workDir, 'read_file', { filePath: text(args.subDir) || '.' });
      approvalType = 'question';
      break;
    case 'search':
      verdict = evaluateToolRequest(narrowed, workDir, 'read_file', {});
      approvalType = 'question';
      break;
    case 'write':
      verdict = evaluateToolRequest(narrowed, workDir, 'write_file', { filePath });
      approvalType = 'file_write';
      if (!filePath) verdict = { verdict: 'deny', rule: 'bad-args', reason: 'Не указан путь файла (filePath).' };
      break;
    case 'command':
      verdict = evaluateToolRequest(narrowed, workDir, 'run_command', { command });
      approvalType = 'command';
      if (!command.trim()) verdict = { verdict: 'deny', rule: 'bad-args', reason: 'Не указана команда (command).' };
      else if (args.background === true && !options.allowBackground) {
        verdict = {
          verdict: 'deny',
          rule: 'background-not-allowed',
          reason: 'Фоновые процессы агенту Swarm недоступны: процесс пережил бы агента. Запусти команду без background, с ожиданием результата.'
        };
      }
      break;
    default:
      verdict = evaluateToolRequest(narrowed, workDir, 'ask_question', {});
      approvalType = 'question';
  }
  return {
    kind,
    verdict: verdict.verdict,
    rule: verdict.rule,
    ...(verdict.reason ? { reason: verdict.reason } : {}),
    approvalType,
    ...(kind === 'read' || kind === 'write' ? { filePath } : {}),
    ...(kind === 'list' ? { filePath: text(args.subDir) || '.' } : {}),
    ...(kind === 'command' ? { command } : {}),
    ...(kind === 'command' && args.background === true && options.allowBackground ? { background: true } : {})
  };
}

/** Абсолютный предел лимита шагов: `maxTurns` роли больше него считается опечаткой. */
export const MAX_API_TOOL_STEPS = 100;

/**
 * Лимит шагов tool-loop API-слота: ход API — запрос к модели (decision-45 п. 3), поэтому `maxTurns` роли
 * и есть лимит шагов (1…100). Без него — `DEFAULT_MAX_TOOL_STEPS`.
 */
export function resolveApiMaxSteps(maxTurns?: number): number {
  if (typeof maxTurns !== 'number' || !Number.isFinite(maxTurns) || maxTurns <= 0) return DEFAULT_MAX_TOOL_STEPS;
  return Math.min(MAX_API_TOOL_STEPS, Math.max(1, Math.floor(maxTurns)));
}

export interface ComputerToolsGate {
  /** Режим сессии Swarm. */
  mode: string;
  /** Задача цикла явно разрешила управление компьютером (label `computer-use`). */
  taskAllowsComputerUse: boolean;
  /** Allow-список имён инструментов роли по категориям (`apiToolNamesForCategories`); нет — без ограничений. */
  allowedToolNames?: string[];
}

/**
 * Инструменты `computer_*` API-слоту (правило 20 infra-dev, decision-27 п. 6): только в цикле «до
 * готовности» по задаче с label `computer-use`. Список `available` пуст, если управление компьютером
 * выключено в ProjectHub. Категории `tools` роли `computer_*` не содержат, поэтому роль с явным списком
 * их не получает.
 */
export function selectComputerTools<T extends { name: string }>(available: T[], gate: ComputerToolsGate): T[] {
  if (gate.mode !== 'done_loop' || !gate.taskAllowsComputerUse) return [];
  return available.filter((t) => isToolAllowed(t.name, gate.allowedToolNames));
}
