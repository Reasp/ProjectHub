import { ipcMain } from 'electron';
import { assertRegisteredProject } from '../services/projectPathGuard';
import { copySkill, listProjectSkills, listSkillSources, listSourceSkills, type SkillCopyRequest, type SkillSourceRef } from '../services/skillService';
import { isSkillRoot } from '../services/skillCatalog';

/** Источник из рендерера: только известные виды, путь — только у проекта (проверяется по реестру в сервисе). */
function sourceRef(raw: unknown): SkillSourceRef {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { kind?: unknown; path?: unknown };
  if (r.kind === 'template' || r.kind === 'personal') return { kind: r.kind };
  if (r.kind === 'project' && typeof r.path === 'string') return { kind: 'project', path: r.path };
  throw new Error('Неизвестный источник скиллов');
}

function copyRequest(raw: unknown): SkillCopyRequest {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!isSkillRoot(r.fromRoot)) throw new Error('Неизвестный корень скиллов источника');
  const toRoots = Array.isArray(r.toRoots) ? r.toRoots.filter(isSkillRoot) : [];
  if (toRoots.length === 0) throw new Error('Не выбран каталог назначения');
  return { source: sourceRef(r.source), fromRoot: r.fromRoot, id: typeof r.id === 'string' ? r.id : '', toRoots, overwrite: r.overwrite === true };
}

/** Менеджер скиллов проекта (TASK-105, decision-61): .claude/skills и .agents/skills. */
export function registerSkillsIpc() {
  ipcMain.handle('skills:list', async (_event, projectPath: string) => {
    const safeProject = await assertRegisteredProject(projectPath);
    return await listProjectSkills(safeProject);
  });

  ipcMain.handle('skills:sources', async (_event, projectPath: string) => {
    const safeProject = await assertRegisteredProject(projectPath);
    return await listSkillSources(safeProject);
  });

  ipcMain.handle('skills:sourceList', async (_event, projectPath: string, source: unknown) => {
    const safeProject = await assertRegisteredProject(projectPath);
    try {
      return { success: true, listing: await listSourceSkills(sourceRef(source), safeProject) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('skills:copy', async (_event, projectPath: string, request: unknown) => {
    const safeProject = await assertRegisteredProject(projectPath);
    try {
      return { success: true, result: await copySkill(safeProject, copyRequest(request)) };
    } catch (err) {
      console.error('[SkillsIpc] Failed to copy skill:', err instanceof Error ? err.message : String(err));
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
