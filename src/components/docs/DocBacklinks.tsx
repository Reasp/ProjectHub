import React from 'react';
import { CheckSquare, FileText, Link2, ShieldCheck } from 'lucide-react';
import { useDocRefs } from '../../hooks/useDocRefs';
import type { DocBacklink } from '../../types/electron';

const KIND_ICON = {
  decision: <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />,
  doc: <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />,
  task: <CheckSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
};

/**
 * Блок «На этот документ ссылаются» под текстом документа (TASK-122, decision-69): решения,
 * документы и задачи, в тексте которых есть ссылка на открытый документ. Переход — тем же
 * `useDocRefs`, что и по ссылке в тексте, с тем же подтверждением несохранённых правок.
 */
export const DocBacklinks: React.FC<{ title: string; items: DocBacklink[] }> = ({ title, items }) => {
  const nav = useDocRefs();
  if (items.length === 0) return null;

  return (
    <div className="mt-8 pt-4 border-t border-slate-800" data-testid="doc-backlinks">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
        <Link2 className="w-3.5 h-3.5 text-indigo-400" />
        {title}
        <span className="font-mono font-normal text-slate-500">{items.length}</span>
      </div>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              data-backlink={item.id.toLowerCase()}
              onClick={() => nav.open({ kind: item.kind, id: item.id.toLowerCase(), label: item.id, wiki: true })}
              className="w-full flex items-center gap-2 px-2 py-1 rounded-lg text-left text-xs text-slate-300 hover:bg-slate-800/60 hover:text-white transition"
            >
              {KIND_ICON[item.kind]}
              <span className="font-mono text-[11px] text-slate-500 shrink-0">{item.id}</span>
              <span className="truncate">{item.title}</span>
              {item.status && <span className="ml-auto text-[10px] font-mono text-slate-500 shrink-0">{item.status}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
