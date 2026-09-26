/**
 * Боевые зависимости инструментов памяти (TASK-76, decision-51 п. 4): реестр проектов и аудит HITL.
 * Вынесены отдельно, чтобы `memoryTools` тестировался без Electron.
 */
import { projectRegistry } from './projectRegistry.js';
import { hitlService } from './hitlService.js';
import type { MemoryToolDeps } from './memoryTools.js';

export const memoryToolDeps: MemoryToolDeps = {
  async listProjectRoots() {
    return (await projectRegistry.getProjects()).map((p) => p.path);
  },
  recordAutoDecision(info, decision, rule, detail) {
    return hitlService.recordAutoDecision(info, decision, rule, detail);
  }
};
