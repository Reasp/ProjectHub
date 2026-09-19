import path from 'node:path';
import { planApiToolCall, type ApiToolKind, type ApiToolPlan } from './apiToolPolicy.js';
import { truncateToolResult, type ToolExecutionResult } from './apiToolLoop.js';
import type { AIProviderConfig, AIToolCall } from './aiAgentService.js';
import type {
  ApprovalResponse,
  HitlEngine,
  HitlOrigin,
  HitlOutcome,
  HitlRequest,
  QuestionData
} from './hitlTypes.js';

/**
 * Исполнитель инструментов API-агента Swarm и AI Studio (TASK-101, TASK-103, decision-46, decision-47):
 * политика (`apiToolPolicy`), единая очередь HITL и аудит (decision-10), исполнение в рабочем каталоге
 * агента. Зависимости внедряются — сервис тестируется без Electron, сети и настоящего HITL. Боевые
 * зависимости собирает `createApiToolExecutorDeps` в `apiToolExecutorDeps.ts`. Чат AI Studio получает
 * события вызова через колбэки контекста (`studioToolAdapter.ts`).
 */

export interface ApiToolExecutorDeps {
  newRequestId(): string;
  /** Карточка в единую очередь HITL; отмена сессии — reject. */
  requestApproval(request: HitlRequest, options: { timeoutMs?: number }): Promise<ApprovalResponse>;
  recordAutoDecision(info: Omit<HitlRequest, 'id' | 'createdAt'>, decision: 'allow' | 'deny', rule: string, detail?: string): string;
  recordOutcome(requestId: string, outcome: HitlOutcome, detail?: string): void;
  readFile(absPath: string): Promise<string>;
  fileExists(absPath: string): boolean;
  listDir(absPath: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
  /** Запись файла в рабочий каталог (создаёт каталоги). */
  writeFile(workDir: string, filePath: string, content: string): Promise<void>;
  generateDiff(oldContent: string, newContent: string, filePath: string): string;
  runCommand(
    command: string,
    cwd: string,
    options: { sessionId: string; timeoutMs?: number; onOutput?: (outputSoFar: string) => void }
  ): Promise<{ output: string; exitCode: number | null; timedOut: boolean; truncated?: boolean }>;
  /** Фоновый процесс через менеджер процессов (только при `allowBackground`, decision-47 п. 3). */
  startBackgroundProcess?(
    projectPath: string,
    command: string,
    name: string,
    workDir: string
  ): Promise<{ id: string; name: string; pid?: number }>;
  searchDocs(projectPath: string, query: string): Promise<string>;
  parseQuestion(args: Record<string, unknown>): QuestionData;
  callComputerTool?(name: string, args: Record<string, unknown>, ctx: ApiToolContext): Promise<ToolExecutionResult>;
}

/** Статус вызова для чата: те же значения, что у `AIToolCall.status`, кроме `pending`. */
export type ApiToolStatus = 'running' | 'done' | 'accepted' | 'rejected' | 'error';

export interface ApiToolUpdate {
  kind: ApiToolKind;
  status: ApiToolStatus;
  /** Итог вызова или накопленный вывод команды (`running`). */
  result?: string;
}

export interface ApiToolContext {
  /** `swarm-<agentId>` или id сессии AI Studio. */
  sessionId: string;
  /** Рабочий каталог (worktree слота или сессии) — корень файлов и команд. */
  workDir: string;
  /**
   * `projectPath` запросов HITL и аудита. По умолчанию `workDir` (Swarm, decision-46 п. 2). AI Studio
   * передаёт корень проекта: по нему ключуются статус проекта и карточки окна (decision-47 п. 1).
   */
  hitlProjectPath?: string;
  /** Основное дерево проекта — для поиска по документации (`backlog/` общий) и фоновых процессов. */
  projectPath: string;
  /** Глобальные правила auto-approve, уже суженные правами роли. */
  config: AIProviderConfig;
  origin: HitlOrigin;
  engine?: HitlEngine;
  agentId?: string;
  agentName?: string;
  role?: string;
  doneLoop?: boolean;
  taskAllowsComputerUse?: boolean;
  /** `autoApprove` прав роли — сужает allowlist приложений (decision-27 п. 6 реализации). */
  roleAutoApprove?: boolean;
  /** Разрешить `run_command` с `background: true` (AI Studio, decision-47 п. 3). */
  allowBackground?: boolean;
  /** Агент ещё работает: перед каждым инструментом (стоп, бюджет). */
  isActive(): boolean;
  /** Инструмент прошёл политику и начинает исполняться — для запрета fallback модели (decision-44 п. 6). */
  onExecute?(call: AIToolCall, plan: ApiToolPlan): void;
  /** Карточка ушла в очередь — для лога слота и чата AI Studio. `call` есть у карточек исполнителя, у прокси `computer_*` его нет. */
  onApprovalRequest?(request: HitlRequest, call?: AIToolCall): void;
  /** Ответ на карточку получен или ожидание отменено. */
  onApprovalSettled?(request: HitlRequest): void;
  /** Статус вызова: запуск, вывод команды, итог (чат AI Studio, decision-47 п. 1). */
  onToolUpdate?(call: AIToolCall, update: ApiToolUpdate): void;
}

/** Исход вызова вместе со статусом для чата. */
interface Outcome {
  result: ToolExecutionResult;
  status: ApiToolStatus;
  /** Текст итога для чата, если он отличается от результата модели. */
  chatResult?: string;
}

/** Лимит прочитанного файла, отдаваемого модели до общей усечки результата. */
const READ_MAX_CHARS = 100_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60_000;
const STOPPED = 'Агент остановлен — инструмент не исполнен.';

function approvalTimeoutMs(config: AIProviderConfig): number | undefined {
  const min = config.autoApproveRules?.approvalTimeoutMin;
  return typeof min === 'number' && min > 0 ? min * 60_000 : undefined;
}

function commandTimeoutMs(config: AIProviderConfig): number {
  const sec = config.autoApproveRules?.commandTimeoutSec;
  return typeof sec === 'number' && sec > 0 ? sec * 1000 : DEFAULT_COMMAND_TIMEOUT_MS;
}

/** Ответ на карточку чтения: одобрение, если человек не выбрал «запретить» явно. */
function approvedRead(res: ApprovalResponse): boolean {
  if (!res.approved) return false;
  const t = (res.text || '').toLowerCase();
  return !(t.includes('deny') || t.includes('запретить'));
}

export class ApiToolExecutor {
  constructor(private readonly deps: ApiToolExecutorDeps) {}

  /** Исполняет вызов модели. Никогда не бросает: ошибки и отказы возвращаются модели как `isError`. */
  public async execute(call: AIToolCall, ctx: ApiToolContext): Promise<ToolExecutionResult> {
    const args: Record<string, unknown> = call.args && typeof call.args === 'object' ? call.args : {};
    const plan = planApiToolCall(ctx.config, ctx.workDir, call.name, args, { allowBackground: ctx.allowBackground });
    let outcome: Outcome;
    if (!ctx.isActive()) {
      outcome = { result: { content: STOPPED, isError: true }, status: 'rejected' };
    } else {
      try {
        outcome = await this.run(call, args, plan, ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outcome = err instanceof Error && err.name === 'ApprovalCancelledError'
          ? { result: { content: message, isError: true }, status: 'rejected' }
          : { result: { content: `Ошибка инструмента ${call.name}: ${message}`, isError: true }, status: 'error' };
      }
    }
    ctx.onToolUpdate?.(call, { kind: plan.kind, status: outcome.status, result: outcome.chatResult ?? outcome.result.content });
    return outcome.result;
  }

  private meta(ctx: ApiToolContext, tool: string) {
    return {
      sessionId: ctx.sessionId,
      projectPath: ctx.hitlProjectPath || ctx.workDir,
      origin: ctx.origin,
      engine: ctx.engine ?? ('api' as const),
      ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
      ...(ctx.agentName ? { agentName: ctx.agentName } : {}),
      ...(ctx.role ? { role: ctx.role } : {}),
      tool
    };
  }

  private async run(call: AIToolCall, args: Record<string, unknown>, plan: ApiToolPlan, ctx: ApiToolContext): Promise<Outcome> {
    if (plan.kind === 'computer' && plan.verdict !== 'deny') {
      if (!this.deps.callComputerTool) {
        return { result: { content: 'Управление компьютером агенту недоступно.', isError: true }, status: 'error' };
      }
      ctx.onExecute?.(call, plan);
      ctx.onToolUpdate?.(call, { kind: plan.kind, status: 'running' });
      const result = await this.deps.callComputerTool(call.name, args, ctx);
      // Чату — текст и число картинок, модели — результат прокси целиком, с изображениями.
      const images = result.images?.length ? `[изображений: ${result.images.length}]` : '';
      return {
        result,
        status: result.isError ? 'error' : 'done',
        chatResult: [result.content, images].filter(Boolean).join('\n')
      };
    }

    const meta = this.meta(ctx, call.name);
    const detailOf = () => ({
      ...(plan.filePath ? { filePath: plan.filePath } : {}),
      ...(plan.command ? { command: plan.command } : {})
    });

    if (plan.verdict === 'deny') {
      this.deps.recordAutoDecision({ ...meta, type: plan.approvalType, title: `${call.name}: ${plan.rule}`, ...detailOf() }, 'deny', plan.rule, plan.reason);
      return { result: { content: plan.reason || `Инструмент ${call.name} отклонён политикой (${plan.rule}).`, isError: true }, status: 'rejected' };
    }

    let requestId: string;
    let answer: ApprovalResponse | undefined;
    if (plan.verdict === 'allow') {
      requestId = this.deps.recordAutoDecision({ ...meta, type: plan.approvalType, title: `${call.name}: ${plan.rule}`, ...detailOf() }, 'allow', plan.rule);
    } else {
      const request = await this.buildApprovalRequest(call, args, plan, ctx, meta);
      requestId = request.id;
      ctx.onApprovalRequest?.(request, call);
      try {
        answer = await this.deps.requestApproval(request, { timeoutMs: approvalTimeoutMs(ctx.config) });
      } finally {
        ctx.onApprovalSettled?.(request);
      }
      const allowed = plan.kind === 'question' ? true : plan.approvalType === 'question' ? approvedRead(answer) : answer.approved;
      if (!allowed) {
        return { result: { content: `Отклонено пользователем${answer.text ? `: ${answer.text}` : ''}`, isError: true }, status: 'rejected' };
      }
    }

    if (!ctx.isActive()) {
      this.deps.recordOutcome(requestId, 'not_executed', 'Агент остановлен');
      return { result: { content: STOPPED, isError: true }, status: 'rejected' };
    }
    ctx.onExecute?.(call, plan);
    try {
      const result = await this.perform(call, args, plan, ctx, answer);
      this.deps.recordOutcome(requestId, result.isError ? 'failed' : 'executed', result.isError ? result.content.slice(0, 200) : undefined);
      const readOnly = plan.kind === 'read' || plan.kind === 'list' || plan.kind === 'search';
      return {
        result: { ...result, content: truncateToolResult(result.content) },
        status: result.isError ? 'error' : readOnly ? 'done' : 'accepted'
      };
    } catch (err) {
      this.deps.recordOutcome(requestId, 'failed', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async buildApprovalRequest(
    call: AIToolCall,
    args: Record<string, unknown>,
    plan: ApiToolPlan,
    ctx: ApiToolContext,
    meta: ReturnType<ApiToolExecutor['meta']>
  ): Promise<HitlRequest> {
    const base = { id: this.deps.newRequestId(), ...meta, createdAt: Date.now() };
    const who = ctx.agentName ? `${ctx.agentName}: ` : '';
    const explanation = typeof args.explanation === 'string' ? args.explanation : undefined;
    switch (plan.kind) {
      case 'write': {
        const filePath = plan.filePath!;
        const abs = path.resolve(ctx.workDir, filePath);
        const oldContent = this.deps.fileExists(abs) ? await this.deps.readFile(abs).catch(() => '') : '';
        const newContent = typeof args.content === 'string' ? args.content : '';
        return {
          ...base,
          type: 'file_write',
          title: `${who}${plan.rule === 'write-excluded' ? '⚠️ Файл в списке исключений' : 'Запись файла'}: ${filePath}`,
          filePath,
          details: explanation || 'Изменение содержимого файла',
          diff: { filePath, oldContent, newContent, patch: this.deps.generateDiff(oldContent, newContent, filePath) }
        };
      }
      case 'command':
        return {
          ...base,
          type: 'command',
          title: `${who}${plan.rule === 'command-denied' ? '⚠️ Команда из списка запрещённых' : plan.background ? 'Фоновый процесс' : 'Запуск команды'}: ${plan.command}`,
          command: plan.command,
          details: explanation || 'Выполнение команды в рабочем каталоге агента'
        };
      case 'question': {
        const questionData = this.deps.parseQuestion(args);
        return { ...base, type: 'question', title: `${who}${questionData.title}`, details: questionData.subtitle, questionData };
      }
      default: {
        const target = plan.filePath || String(args.query || '');
        return {
          ...base,
          type: 'question',
          title: `${who}Чтение: ${target}`,
          ...(plan.filePath ? { filePath: plan.filePath } : {}),
          details: plan.rule === 'read-outside'
            ? `Путь ${target} вне рабочего каталога агента. Разрешить чтение?`
            : `Разрешить агенту прочитать ${target}?`,
          questionData: {
            title: 'Чтение файла',
            subtitle: `Разрешить агенту прочитать ${target}?`,
            options: [
              { id: 'allow', label: 'Разрешить чтение' },
              { id: 'deny', label: 'Запретить чтение' }
            ],
            isMultiSelect: false,
            allowOther: false
          }
        };
      }
    }
  }

  private async perform(
    call: AIToolCall,
    args: Record<string, unknown>,
    plan: ApiToolPlan,
    ctx: ApiToolContext,
    answer?: ApprovalResponse
  ): Promise<ToolExecutionResult> {
    switch (plan.kind) {
      case 'read': {
        const abs = path.resolve(ctx.workDir, plan.filePath || '');
        const content = await this.deps.readFile(abs);
        return { content: content.length > READ_MAX_CHARS ? `${content.slice(0, READ_MAX_CHARS)}\n…[файл усечён]` : content };
      }
      case 'list': {
        const entries = await this.deps.listDir(path.resolve(ctx.workDir, plan.filePath || '.'));
        return { content: entries.map((e) => (e.isDirectory ? `${e.name}/` : e.name)).sort().join('\n') || '(пусто)' };
      }
      case 'search':
        return { content: await this.deps.searchDocs(ctx.projectPath, String(args.query || '')) };
      case 'write': {
        const content = typeof args.content === 'string' ? args.content : '';
        await this.deps.writeFile(ctx.workDir, plan.filePath!, content);
        return { content: `Файл ${plan.filePath} записан (${content.length} символов).` };
      }
      case 'command': {
        const onUpdate = ctx.onToolUpdate;
        onUpdate?.(call, { kind: plan.kind, status: 'running' });
        if (plan.background) {
          if (!this.deps.startBackgroundProcess) return { content: 'Фоновые процессы агенту недоступны.', isError: true };
          const name = String(args.name || `agent-${Date.now().toString(36)}`).trim();
          const info = await this.deps.startBackgroundProcess(ctx.projectPath, plan.command!, name, ctx.workDir);
          return {
            content: `Процесс "${info.name}" запущен в фоне (pid ${info.pid ?? '?'}, id "${info.id}"). `
              + 'Цикл агента не блокируется; логи и остановка — во вкладке Processes.'
          };
        }
        const timeoutMs = commandTimeoutMs(ctx.config);
        const res = await this.deps.runCommand(plan.command!, ctx.workDir, {
          sessionId: ctx.sessionId,
          timeoutMs,
          ...(onUpdate ? { onOutput: (outputSoFar: string) => onUpdate(call, { kind: plan.kind, status: 'running', result: outputSoFar }) } : {})
        });
        if (res.timedOut) {
          const hint = ctx.allowBackground
            ? ' Для долгоживущих процессов (dev-серверы, вотчеры) запускай run_command с background: true.'
            : '';
          return { content: `Команда прервана по таймауту (${Math.round(timeoutMs / 1000)} с).${hint}\n${res.output}`, isError: true };
        }
        const output = res.truncated ? `[… вывод усечён …]\n${res.output}` : res.output;
        if (res.exitCode === 0) return { content: output || 'Команда успешно выполнена (код 0)' };
        return { content: `Команда завершилась с кодом ${res.exitCode}:\n${output}`, isError: true };
      }
      case 'question':
        return { content: answer?.text || (answer?.approved ? 'Подтверждено пользователем' : 'Без ответа') };
      default:
        return { content: `Инструмент ${call.name} недоступен агенту.`, isError: true };
    }
  }
}
