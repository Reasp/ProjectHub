/**
 * IPC Security Health (TASK-73.2, decision-56 п. 2, 9): отчёт аудита из кэша, запуск аудита кнопкой, задача из
 * находки, настройки. Путь проекта проверяется по реестру (decision-5 п. 2); сеть трогает только `runAudit`.
 */
import { ipcMain } from 'electron';
import { assertRegisteredProject } from '../services/projectPathGuard';
import { securityHealthService } from '../services/securityHealthService';
import type { AuditEcosystem } from '../services/dependencyAudit';

const ECOSYSTEMS: AuditEcosystem[] = ['npm', 'pip', 'yarn', 'pnpm', 'cargo'];

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerSecurityIpc() {
  ipcMain.handle('security:getReport', async (_event, projectPath: unknown) => {
    try {
      const root = await assertRegisteredProject(String(projectPath ?? ''));
      return { ok: true, report: await securityHealthService.getReport(root), running: securityHealthService.isRunning(root) };
    } catch (err) {
      return { ok: false, error: errorText(err), report: null, running: false };
    }
  });

  ipcMain.handle('security:runAudit', async (_event, projectPath: unknown) => {
    try {
      const root = await assertRegisteredProject(String(projectPath ?? ''));
      const result = await securityHealthService.runAudit(root, { reason: 'manual' });
      return { ok: true, report: result.report, newFindings: result.newFindings.length };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  });

  ipcMain.handle('security:createTask', async (_event, projectPath: unknown, ecosystem: unknown, pkg: unknown) => {
    try {
      const root = await assertRegisteredProject(String(projectPath ?? ''));
      const eco = ECOSYSTEMS.find((e) => e === ecosystem);
      if (!eco || typeof pkg !== 'string' || !pkg.trim()) return { ok: false, error: 'Неверные параметры находки' };
      return await securityHealthService.createTaskFromFinding(root, eco, pkg.trim());
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  });

  ipcMain.handle('security:getSettings', async () => securityHealthService.getSettings());

  ipcMain.handle('security:saveSettings', async (_event, patch: unknown) => {
    const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
    return securityHealthService.saveSettings(typeof p.registryLookups === 'boolean' ? { registryLookups: p.registryLookups } : {});
  });
}
