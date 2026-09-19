import type { AIToolCall } from './aiAgentService.js';
import type { ApiToolContext } from './apiToolExecutor.js';
import type { HitlRequest } from './hitlTypes.js';

/**
 * Адаптер чата AI Studio для общего исполнителя API-инструментов (TASK-103, decision-47 п. 1). Переводит
 * события исполнителя в чанки чата прежнего формата и ставит статус проекта. Чистый модуль: канал
 * чанков и статус проекта внедряются, Electron не нужен.
 *
 * Объект вызова меняется на месте: итоговое сообщение `streamChat` собирает статусы из тех же объектов
 * (`loop.toolCalls`), поэтому статус, результат и дифф доживают до конца хода.
 */

/** Подмножество `ClaudeBridgeMessageChunk`, которое шлёт адаптер. */
export interface StudioToolChunk {
  toolCall?: AIToolCall;
  approvalRequest?: HitlRequest;
}

export interface StudioToolAdapterDeps {
  emit(chunk: StudioToolChunk): void;
  /** Статус проекта AI Studio (`claudeBridgeService.setProjectStatus`). */
  setStatus(status: 'running' | 'waiting_approval', message: string, pendingApproval?: HitlRequest): void;
  /** У сессии остались другие ожидающие карточки. */
  hasPendingApprovals(): boolean;
  /** Сессия ещё идёт: после завершения статус проекта не трогаем. */
  isSessionActive(): boolean;
}

export type StudioToolCallbacks = Required<Pick<ApiToolContext, 'onApprovalRequest' | 'onApprovalSettled' | 'onToolUpdate'>>;

export const STUDIO_STATUS_PROCESSING = 'Обработка результатов...';

function commandOf(call: AIToolCall): string {
  const args = call.args ?? {};
  const value = args.command ?? args.cmd;
  return typeof value === 'string' ? value : '';
}

export function createStudioToolCallbacks(deps: StudioToolAdapterDeps): StudioToolCallbacks {
  const backToRunning = () => {
    if (deps.isSessionActive() && !deps.hasPendingApprovals()) deps.setStatus('running', STUDIO_STATUS_PROCESSING);
  };
  return {
    onApprovalRequest(request, call) {
      if (call && request.type === 'file_write' && request.diff) {
        // Карточка записи приходит вместе с вызовом и диффом: по ним список шагов показывает «ждёт дифф».
        call.diff = request.diff;
        deps.emit({ approvalRequest: request, toolCall: { ...call } });
      } else {
        deps.emit({ approvalRequest: request });
      }
      deps.setStatus('waiting_approval', request.title, request);
    },
    onApprovalSettled() {
      backToRunning();
    },
    onToolUpdate(call, update) {
      call.status = update.status;
      if (update.result !== undefined) call.result = update.result;
      deps.emit({ toolCall: { ...call } });
      if (update.kind !== 'command') return;
      if (update.status === 'running') {
        // Статус ставится один раз на запуск, а не на каждый кусок вывода.
        if (update.result === undefined) deps.setStatus('running', `Выполняется: ${commandOf(call)}`);
      } else {
        backToRunning();
      }
    }
  };
}
