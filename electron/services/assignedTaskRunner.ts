import { decideAutoStart, type AutoStartDecision } from './assignedTaskRules.js';
import { agentFleetService, isActiveSwarmStatus } from './agentFleetService.js';
import { remoteControlService } from './remoteControlService.js';
import { logger } from './logger.js';
import type { AutomationEvent } from './automationRules.js';

/**
 * Автозапуск задач, назначенных на этот хост (TASK-66, decision-11 п.5), — встроенное правило
 * Automations `builtin:assigned-tasks` (TASK-74, decision-52 п. 7).
 *
 * Сценарий: задача с `assignee: agent:<role>@<hostId>` приезжает на машину через `git pull`,
 * источник событий задач публикует `task:updated`, и хост, чьё имя стоит в назначении, запускает
 * агента в worktree задачи. Сам запуск, лимиты и журнал — в `automationService`; здесь флаг
 * включения (по-прежнему `autoStartAssignedTasks` в настройках Remote Control) и решение по
 * неизменённым правилам `decideAutoStart`. Выключен по умолчанию.
 */
class AssignedTaskRunner {
  private enabled = false;
  private listeners = new Set<(enabled: boolean) => void>();

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    logger.info(`[AssignedTaskRunner] Автозапуск назначенных задач ${enabled ? 'включён' : 'выключен'}`);
    for (const listener of this.listeners) listener(enabled);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /** Подписка на включение/выключение — сервис Automations перестраивает наблюдение за задачами. */
  public onEnabledChange(listener: (enabled: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Решение по событию `task.updated`: роль из назначения и все условия TASK-66. */
  public decide(event: AutomationEvent, lastStartedAt?: number, now = Date.now()): AutoStartDecision {
    const taskId = event.taskId ?? '';
    const hasActiveSwarm = agentFleetService
      .listSwarms(event.projectPath)
      .some((s) => s.taskId === taskId && isActiveSwarmStatus(s.status));
    return decideAutoStart({
      enabled: this.enabled,
      assignee: event.assignee?.[0] ?? '',
      taskStatus: event.status ?? '',
      localHostId: remoteControlService.getHostId(),
      hasActiveSwarm,
      lastStartedAt,
      now
    });
  }
}

export const assignedTaskRunner = new AssignedTaskRunner();
