import type { SkillCopy, SkillEntry, SkillImportItem, SkillRoot } from '../../../types/electron';

/** Решения панели скиллов (TASK-105) без React: какие копирования доступны и что потребует перезаписи. */

export const SKILL_ROOT_ORDER: SkillRoot[] = ['claude', 'agents'];

export interface SkillEntryCopyAction {
  from: SkillRoot;
  to: SkillRoot;
  /** Копия в `to` уже есть и отличается — нужна явная перезапись. */
  overwrite: boolean;
}

/** Копию нельзя использовать как источник: слишком большая, со ссылками или без SKILL.md (как `skillCopyBlocker`). */
export function copyBlocked(copy: SkillCopy | undefined): boolean {
  if (!copy) return true;
  return !copy.hash || copy.problems.some((p) => p === 'tooLarge' || p === 'symlinks' || p === 'noSkillMd');
}

/** Копирования между корнями проекта для скилла: недостающую копию — создать, расходящуюся — заменить. */
export function entryCopyActions(entry: SkillEntry): SkillEntryCopyAction[] {
  const other = (r: SkillRoot): SkillRoot => (r === 'claude' ? 'agents' : 'claude');
  if (entry.status === 'synced') return [];
  const froms: SkillRoot[] = entry.status === 'claudeOnly' ? ['claude'] : entry.status === 'agentsOnly' ? ['agents'] : SKILL_ROOT_ORDER;
  return froms
    .filter((from) => !copyBlocked(entry.copies[from]))
    .map((from) => ({ from, to: other(from), overwrite: entry.status === 'diverged' }));
}

/** Импорт скилла в выбранные корни: куда реально пишем и где это перезапись. */
export function importPlan(item: SkillImportItem, toRoots: SkillRoot[]): { roots: SkillRoot[]; overwrite: SkillRoot[] } {
  const roots = SKILL_ROOT_ORDER.filter((r) => toRoots.includes(r) && item.actions[r] !== 'unchanged');
  return { roots, overwrite: roots.filter((r) => item.actions[r] === 'overwrite') };
}
