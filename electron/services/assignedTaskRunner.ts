import path from 'node:path';
import fs from 'node:fs/promises';
import matter from 'gray-matter';
import { decideAutoStart } from './assignedTaskRules.js';
import { agentFleetService } from './agentFleetService.js';
import { remoteControlService } from './remoteControlService.js';
import { logger } from './logger.js';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Автозапуск задач, назначенных на этот хост (TASK-66, decision-11 п.5).
 *
 * Сценарий: задача с `assignee: agent:<role>@<hostId>` приезжает на машину через `git pull`,
 * backlog-вотчер видит изменённый файл — и хост, чьё имя стоит в назначении, запускает агента
 * в worktree задачи. Выключен по умолчанию: приложение, которое само стартует агентов по
 * появлению файла, включается осознанно.
 */
class AssignedTaskRunner {
  private enabled = false;
  /** taskId -> момент последнего автозапуска (защита от цикла «вотчер → запись → вотчер»). */
  private lastStarts = new Map<string, number>();

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    logger.info(`[AssignedTaskRunner] Автозапуск назначенных задач ${enabled ? 'включён' : 'выключен'}`);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /** Вызывается backlog-вотчером на каждое добавление/изменение файла задачи. */
  public async handleTaskFile(projectPath: string, filePath: string): Promise<void> {
    if (!this.enabled) return;
    if (!filePath.toLowerCase().endsWith('.md')) return;

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = matter(raw);
      const data = parsed.data as Record<string, unknown>;

      const taskId = this.taskIdOf(data, filePath);
      if (!taskId) return;

      const assignee = Array.isArray(data.assignee) ? String(data.assignee[0] ?? '') : String(data.assignee ?? '');
      const localHostId = remoteControlService.getHostId();
      const hasActiveSwarm = agentFleetService
        .listSwarms(projectPath)
        .some((s) => s.taskId === taskId && (s.status === 'running' || s.status === 'preparing'));

      const decision = decideAutoStart({
        enabled: this.enabled,
        assignee,
        taskStatus: typeof data.status === 'string' ? data.status : '',
        localHostId,
        hasActiveSwarm,
        lastStartedAt: this.lastStarts.get(taskId)
      });

      if (!decision.start || !decision.roleSlug) return;

      this.lastStarts.set(taskId, Date.now());
      const title = typeof data.title === 'string' ? data.title : taskId;
      logger.info(`[AssignedTaskRunner] Запуск роли "${decision.roleSlug}" по назначению задачи ${taskId}`);

      const result = await agentFleetService.startAssignedAgent({
        projectPath,
        taskId,
        taskTitle: title,
        prompt: `Выполни задачу ${taskId}: ${title}`,
        roleSlug: decision.roleSlug,
        useWorktrees: true
      });

      if ('error' in result) {
        logger.warn(`[AssignedTaskRunner] Не удалось запустить агента по задаче ${taskId}: ${result.error}`);
      }
    } catch (err) {
      logger.warn(`[AssignedTaskRunner] Ошибка обработки файла задачи ${filePath}: ${errorText(err)}`);
    }
  }

  private taskIdOf(data: Record<string, unknown>, filePath: string): string {
    if (typeof data.id === 'string' && data.id.trim()) return data.id.trim();
    const base = path.basename(filePath, '.md');
    const match = base.match(/^task-(\d+)/i);
    return match ? `TASK-${match[1]}` : base.split(' - ')[0].trim();
  }
}

export const assignedTaskRunner = new AssignedTaskRunner();
