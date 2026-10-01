import { useMemo } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { useDialog } from './useDialog';
import { useI18n } from '../i18n';
import type { DocRef } from '../utils/docRefs';

export interface ResolvedDocRef {
  title: string;
  status?: string;
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
      return doc ? { title: doc.title, status: doc.status } : null;
    };

    const open = (ref: DocRef) => {
      const store = useProjectStore.getState();
      if (ref.kind === 'task') {
        store.requestOpenTask(ref.id);
        return;
      }
      void (async () => {
        // Переход заменяет открытый документ: несохранённую правку без спроса не теряем.
        const leavesDirtyDoc = store.isDocDirty && (ref.kind === 'mem' || store.selectedDoc?.id.toLowerCase() !== ref.id);
        if (leavesDirtyDoc && !(await confirm(t.markdown.refDiscardConfirm))) return;
        if (ref.kind === 'mem') useProjectStore.getState().requestOpenMemory(ref.id);
        else useProjectStore.getState().openDocById(ref.id);
      })();
    };

    return { resolve, open };
  }, [docsList, tasks, confirm, t]);
}
