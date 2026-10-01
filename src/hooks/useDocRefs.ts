import { useMemo } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { useDialog } from './useDialog';
import { useI18n } from '../i18n';
import { headingAnchorKey, refLeaveGuards, type DocRef } from '../utils/docRefs';

export interface ResolvedDocRef {
  title: string;
  status?: string;
  /** Документ есть, но заголовка из якоря ссылки в нём нет: откроется с начала (decision-69). */
  anchorMissing?: boolean;
}

export interface DocRefNavigation {
  /** Заголовок и статус объекта ссылки либо `null`, если такого документа или задачи нет. */
  resolve: (ref: DocRef) => ResolvedDocRef | null;
  open: (ref: DocRef) => void;
}

/**
 * Разрешение и открытие перекрёстных ссылок Backlog.md для MarkdownViewer (TASK-121, decision-68):
 * решения и документы — во вкладке «Документация», задачи — карточкой на доске, память — в разделе
 * «Память». Факты памяти в сторе не лежат, поэтому ссылка на них считается существующей.
 */
export function useDocRefs(): DocRefNavigation {
  const { t } = useI18n();
  const { confirm } = useDialog();
  const docsList = useProjectStore((state) => state.docsList);
  const tasks = useProjectStore((state) => state.tasks);
  const headings = useProjectStore((state) => state.docLinkIndex.headings);

  return useMemo(() => {
    const docs = new Map(docsList.map((doc) => [doc.id.toLowerCase(), doc]));
    const taskMap = new Map(tasks.map((task) => [task.id.toLowerCase(), task]));

    const resolve = (ref: DocRef): ResolvedDocRef | null => {
      if (ref.kind === 'mem') return { title: ref.id };
      if (ref.kind === 'task') {
        const task = taskMap.get(ref.id);
        return task ? { title: task.title, status: task.status } : null;
      }
      const doc = docs.get(ref.id);
      if (!doc) return null;
      // Пока индекс заголовков не загружен, якорь битым не считаем.
      const known = headings[ref.id];
      const anchorMissing = Boolean(ref.anchor && known && !known.includes(headingAnchorKey(ref.anchor)));
      return { title: doc.title, status: doc.status, ...(anchorMissing ? { anchorMissing } : {}) };
    };

    const open = (ref: DocRef) => {
      void (async () => {
        // Переход закрывает карточку задачи и заменяет открытый документ: несохранённую правку
        // без спроса не теряем (TASK-122).
        const store = useProjectStore.getState();
        const guards = refLeaveGuards(ref, {
          dirtyTaskId: store.dirtyTaskId,
          isDocDirty: store.isDocDirty,
          selectedDocId: store.selectedDoc?.id
        });
        for (const guard of guards) {
          const message = guard === 'task' ? t.markdown.refDiscardTaskConfirm : t.markdown.refDiscardConfirm;
          if (!(await confirm(message))) return;
        }
        const next = useProjectStore.getState();
        if (ref.kind === 'task') next.requestOpenTask(ref.id);
        else if (ref.kind === 'mem') next.requestOpenMemory(ref.id);
        else next.openDocById(ref.id, ref.anchor);
      })();
    };

    return { resolve, open };
  }, [docsList, tasks, headings, confirm, t]);
}
