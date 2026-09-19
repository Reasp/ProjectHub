import path from 'node:path';
import { planApiToolCall, type ApiToolPlan } from './apiToolPolicy.js';
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
 * Исполнитель инструментов API-агента Swarm (TASK-101, decision-46): политика (`apiToolPolicy`),
 * единая очередь HITL и аудит (decision-10), исполнение в worktree слота. Зависимости внедряются —
 * сервис тестируется без Electron, сети и настоящего HITL. Боевые зависимости собирает
 * `createApiToolExecutorDeps` в `apiToolExecutorDeps.ts`.
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
    options: { sessionId: string; timeoutMs?: number }
  ): Promise<{ output: string; exitCode: number | null; timedOut: boolean; truncated?: boolean }>;
  searchDocs(projectPath: string, query: string): Promise<string>;
  parseQuestion(args: Record<string, unknown>): QuestionData;
  callComputerTool?(name: string, args: Record<string, unknown>, ctx: ApiToolContext): Promise<ToolExecutionResult>;
}

export interface ApiToolContext {
  /** `swarm-<agentId>`. */
  sessionId: string;
  /** Рабочий каталог слота (worktree) — корень файлов и команд; он же `projectPath` запросов HITL. */
  workDir: string;
  /** Основное дерево проекта — для поиска по документации (`backlog/` общий). */
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
  /** Агент ещё работает: перед каждым инструментом (стоп, бюджет). */
  isActive(): boolean;
  /** Инструмент прошёл политику и начинает исполняться — для запрета fallback модели (decision-44 п. 6). */
  onExecute?(call: AIToolCall, plan: ApiToolPlan): void;
  /** Карточка ушла в очередь — для лога слота. */
  onApprovalRequest?(request: HitlRequest): void;
}

/** Лимит прочитанного файла, отдаваемого модели до общей усечки результата. */
const READ_MAX_CHARS = 100_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60_000;

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
    if (!ctx.isActive()) return { content: 'Агент остановлен — инструмент не исполнен.', isError: true };
    const args: Record<string, unknown> = call.args && typeof call.args === 'object' ? call.args : {};
    const plan = planApiToolCall(ctx.config, ctx.workDir, call.name, args);
    try {
      return await this.run(call, args, plan, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.name === 'ApprovalCancelledError') return { content: message, isError: true };
      return { content: `Ошибка инструмента ${call.name}: ${message}`, isError: true };
    }
  }

  private meta(ctx: ApiToolContext, tool: string) {
    return {
      sessionId: ctx.sessionId,
      projectPath: ctx.workDir,
      origin: ctx.origin,
      engine: ctx.engine ?? ('api' as const),
      ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
      ...(ctx.agentName ? { agentName: ctx.agentName } : {}),
      ...(ctx.role ? { role: ctx.role } : {}),
      tool
    };
  }

  private async run(call: AIToolCall, args: Record<string, unknown>, plan: ApiToolPlan, ctx: ApiToolContext): Promise<ToolExecutionResult> {
    if (plan.kind === 'computer') {
      if (!this.deps.callComputerTool) return { content: 'Управление компьютером агенту недоступно.', isError: true };
      ctx.onExecute?.(call, plan);
      return this.deps.callComputerTool(call.name, args, ctx);
    }

    const meta = this.meta(ctx, call.name);
    const detailOf = () => ({
      ...(plan.filePath ? { filePath: plan.filePath } : {}),
      ...(plan.command ? { command: plan.command } : {})
    });

    if (plan.verdict === 'deny') {
      this.deps.recordAutoDecision({ ...meta, type: plan.approvalType, title: `${call.name}: ${plan.rule}`, ...detailOf() }, 'deny', plan.rule, plan.reason);
      return { content: plan.reason || `Инструмент ${call.name} отклонён политикой (${plan.rule}).`, isError: true };
    }

    let requestId: string;
    let answer: ApprovalResponse | undefined;
    if (plan.verdict === 'allow') {
      requestId = this.deps.recordAutoDecision({ ...meta, type: plan.approvalType, title: `${call.name}: ${plan.rule}`, ...detailOf() }, 'allow', plan.rule);
    } else {
      const request = await this.buildApprovalRequest(call, args, plan, ctx, meta);
      requestId = request.id;
      ctx.onApprovalRequest?.(request);
      answer = await this.deps.requestApproval(request, { timeoutMs: approvalTimeoutMs(ctx.config) });
      const allowed = plan.kind === 'question' ? true : plan.approvalType === 'question' ? approvedRead(answer) : answer.approved;
      if (!allowed) {
        return { content: `Отклонено пользователем${answer.text ? `: ${answer.text}` : ''}`, isError: true };
      }
    }

    if (!ctx.isActive()) {
      this.deps.recordOutcome(requestId, 'not_executed', 'Агент остановлен');
      return { content: 'Агент остановлен — инструмент не исполнен.', isError: true };
    }
    ctx.onExecute?.(call, plan);
    try {
      const result = await this.perform(call, args, plan, ctx, answer);
      this.deps.recordOutcome(requestId, result.isError ? 'failed' : 'executed', result.isError ? result.content.slice(0, 200) : undefined);
      return { ...result, content: truncateToolResult(result.content) };
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
          title: `${who}${plan.rule === 'command-denied' ? '⚠️ Команда из списка запрещённых' : 'Запуск команды'}: ${plan.command}`,
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
        const timeoutMs = commandTimeoutMs(ctx.config);
        const res = await this.deps.runCommand(plan.command!, ctx.workDir, { sessionId: ctx.sessionId, timeoutMs });
        if (res.timedOut) {
          return { content: `Команда прервана по таймауту (${Math.round(timeoutMs / 1000)} с).\n${res.output}`, isError: true };
        }
        const output = res.truncated ? `[… вывод усечён …]\n${res.output}` : res.output;
        if (res.exitCode === 0) return { content: output || 'Команда успешно выполнена (код 0)' };
        return { content: `Команда завершилась с кодом ${res.exitCode}:\n${output}`, isError: true };
      }
      case 'question':
        return { content: answer?.text || (answer?.approved ? 'Подтверждено пользователем' : 'Без ответа') };
      default:
        return { content: `Инструмент ${call.name} недоступен агенту Swarm.`, isError: true };
    }
  }
}
