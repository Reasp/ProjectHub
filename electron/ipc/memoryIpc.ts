/**
 * IPC памяти проекта для UI (TASK-76, decision-51): список фактов, запись и правка человеком, удаление.
 *
 * Путь проекта приходит из рендерера и проверяется по реестру (decision-5 п. 2). Ошибки уходят кодом:
 * строки интерфейса живут в i18n рендерера. Правки человека в аудит HITL не пишутся — как и правки
 * задач из GUI; агентские записи аудирует `memoryTools`.
 */
import { ipcMain } from 'electron';
import { assertRegisteredProject } from '../services/projectPathGuard';
import { MemoryError, deleteMemoryFact, readMemory, writeMemoryFact } from '../services/memoryStore';
import type { MemoryDraft } from '../services/memoryFormat';

type Failure = { ok: false; error: string; errorCode?: string; details?: MemoryError['details'] };

function toFailure(err: unknown): Failure {
  if (err instanceof MemoryError) return { ok: false, error: err.message, errorCode: err.code, details: err.details };
  const message = err instanceof Error ? err.message : String(err);
  // Отказ проверки пути — отдельный код, чтобы рендерер не показывал сырой текст
  if (err instanceof Error && err.name === 'PathOutsideProjectError') return { ok: false, error: message, errorCode: 'invalid_project' };
  return { ok: false, error: message };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function toDraft(raw: unknown): MemoryDraft {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    title: str(r.title),
    description: str(r.description),
    body: str(r.body),
    type: str(r.type) as MemoryDraft['type'],
    source: str(r.source).trim() || 'user',
    ...(str(r.author).trim() ? { author: str(r.author).trim() } : {})
  };
}

export function registerMemoryIpc() {
  ipcMain.handle('memory:list', async (_event, projectPath: string) => {
    try {
      const root = await assertRegisteredProject(projectPath);
      const snapshot = await readMemory(root);
      return { ok: true as const, ...snapshot };
    } catch (err) {
      return toFailure(err);
    }
  });

  ipcMain.handle('memory:write', async (_event, projectPath: string, draft: unknown, replace?: string) => {
    try {
      const root = await assertRegisteredProject(projectPath);
      const result = await writeMemoryFact(root, toDraft(draft), { replace: typeof replace === 'string' && replace ? replace : undefined });
      return { ok: true as const, fact: result.fact, replaced: result.replaced };
    } catch (err) {
      return toFailure(err);
    }
  });

  ipcMain.handle('memory:delete', async (_event, projectPath: string, id: string) => {
    try {
      const root = await assertRegisteredProject(projectPath);
      await deleteMemoryFact(root, id);
      return { ok: true as const };
    } catch (err) {
      return toFailure(err);
    }
  });
}
