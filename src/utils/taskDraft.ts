/**
 * Черновик карточки задачи (TASK-122): есть ли в форме правки, которые не записаны в файл задачи.
 * Отметка критерия пишется в файл сразу, поэтому критерии сравниваются только по тексту.
 */
export interface TaskDraft {
  title: string;
  status: string;
  milestone: string;
  assignee: string;
  description: string;
  labels: string[];
  criteria: string[];
}

export function isTaskDraftDirty(saved: TaskDraft, draft: TaskDraft): boolean {
  const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, i) => item === b[i]);
  return (
    saved.title !== draft.title ||
    saved.status !== draft.status ||
    saved.milestone !== draft.milestone ||
    saved.assignee.trim() !== draft.assignee.trim() ||
    saved.description !== draft.description ||
    !sameList(saved.labels, draft.labels) ||
    !sameList(saved.criteria, draft.criteria)
  );
}
