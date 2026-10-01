import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Brain, CheckCircle2, Edit3, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';
import { useTimeoutState } from '../../hooks/useTimeoutState';
import { useDialogStore } from '../../store/useDialogStore';
import { useProjectStore } from '../../store/useProjectStore';
import { MarkdownViewer } from '../common/MarkdownViewer';
import { describeMemoryFailure } from './memoryErrorView';
import type { MemoryDraftInput, MemoryFactInfo, MemoryFactType, MemoryIssueInfo } from '../../types/electron';

/**
 * Память проекта во вкладке документов (TASK-76, decision-51): факты `backlog/memory`, их просмотр,
 * правка, удаление и создание человеком. Backlog.md память не показывает — только ProjectHub.
 */

const TYPES: MemoryFactType[] = ['project', 'feedback', 'reference'];

const TYPE_BADGE: Record<MemoryFactType, string> = {
  project: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  feedback: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  reference: 'bg-violet-500/15 text-violet-300 border-violet-500/30'
};

const EMPTY_DRAFT: MemoryDraftInput = { title: '', description: '', body: '', type: 'project' };

interface Props {
  projectPath: string;
}

export const MemoryView: React.FC<Props> = ({ projectPath }) => {
  const { t } = useTranslation();
  const m = t.memory;
  const dialog = useDialogStore();

  const [facts, setFacts] = useState<MemoryFactInfo[]>([]);
  const [invalid, setInvalid] = useState<Array<{ fileName: string; issues: MemoryIssueInfo[] }>>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<MemoryFactType | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Черновик формы: `replace` — id редактируемого факта, без него — новый факт. */
  const [editing, setEditing] = useState<{ draft: MemoryDraftInput; replace?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, showNotice] = useTimeoutState<string | null>(null, 3000);

  const load = useCallback(async () => {
    if (!window.api?.listMemory) return;
    setLoading(true);
    try {
      const res = await window.api.listMemory(projectPath);
      if (res.ok) {
        setFacts(res.facts);
        setInvalid(res.invalid);
        setError(null);
      } else {
        setError(describeMemoryFailure(m, res));
      }
    } finally {
      setLoading(false);
    }
  }, [projectPath, m]);

  // Смена проекта — другой каталог памяти: выбор и форма сбрасываются (decision-23)
  useEffect(() => {
    setSelectedId(null);
    setEditing(null);
    setQuery('');
    void load();
  }, [projectPath, load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...facts]
      .reverse()
      .filter((f) => typeFilter === 'all' || f.type === typeFilter)
      .filter((f) => !q || `${f.id} ${f.title} ${f.description} ${f.body}`.toLowerCase().includes(q));
  }, [facts, query, typeFilter]);

  const selected = facts.find((f) => f.id === selectedId) ?? null;

  // Переход по ссылке `[[mem-N]]` из документа (TASK-121): выбрать факт, когда список загружен.
  const memoryRefToOpen = useProjectStore((state) => state.memoryRefToOpen);
  const requestOpenMemory = useProjectStore((state) => state.requestOpenMemory);
  useEffect(() => {
    if (!memoryRefToOpen || loading) return;
    const target = facts.find((f) => f.id.toLowerCase() === memoryRefToOpen.toLowerCase());
    if (target) {
      setQuery('');
      setTypeFilter('all');
      setSelectedId(target.id);
    }
    requestOpenMemory(null);
  }, [memoryRefToOpen, facts, loading, requestOpenMemory]);

  const startEdit = (fact?: MemoryFactInfo) => {
    setError(null);
    setEditing(
      fact
        ? {
            replace: fact.id,
            draft: { title: fact.title, description: fact.description, body: fact.body, type: fact.type, source: fact.source, author: fact.author }
          }
        : { draft: { ...EMPTY_DRAFT } }
    );
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await window.api.writeMemory(projectPath, editing.draft, editing.replace);
      if (!res.ok) {
        setError(describeMemoryFailure(m, res));
        return;
      }
      setEditing(null);
      setSelectedId(res.fact.id);
      showNotice(m.saved);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (fact: MemoryFactInfo) => {
    const ok = await dialog.confirm({
      title: m.deleteConfirmTitle,
      message: m.deleteConfirmMessage.replace('{id}', fact.id).replace('{title}', fact.title),
      confirmText: m.deleteConfirmOk,
      danger: true
    });
    if (!ok) return;
    const res = await window.api.deleteMemory(projectPath, fact.id);
    if (!res.ok) {
      setError(describeMemoryFailure(m, res));
      return;
    }
    setSelectedId(null);
    showNotice(m.deleted);
    await load();
  };

  const setDraft = (patch: Partial<MemoryDraftInput>) =>
    setEditing((cur) => (cur ? { ...cur, draft: { ...cur.draft, ...patch } } : cur));

  return (
    <div className="flex-1 flex gap-5 overflow-hidden" data-testid="memory-view">
      {/* Список фактов */}
      <div className="w-80 bg-[#141724]/70 border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
        <div className="p-3 border-b border-slate-800 space-y-2.5 bg-[#111422]">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={m.searchPlaceholder}
                className="w-full bg-[#10121d] border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              onClick={() => void load()}
              title={m.refresh}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-300"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
            <button
              onClick={() => startEdit()}
              title={m.newFact}
              className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1 bg-[#10121d] p-1 rounded-lg border border-slate-800 text-[11px]">
            {(['all', ...TYPES] as const).map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`flex-1 py-1 rounded-md font-medium transition ${
                  typeFilter === type ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {type === 'all' ? `${m.allTypes} (${facts.length})` : m.types[type]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {invalid.length > 0 && (
            <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span title={invalid.map((f) => f.fileName).join('\n')}>{m.invalidFiles.replace('{n}', String(invalid.length))}</span>
            </div>
          )}
          {facts.length === 0 && !loading && (
            <div className="p-6 text-center text-xs text-slate-500 space-y-1.5">
              <p>{m.empty}</p>
              <p className="text-[11px]">{m.emptyHint}</p>
            </div>
          )}
          {visible.map((fact) => (
            <div
              key={fact.id}
              onClick={() => {
                setSelectedId(fact.id);
                setEditing(null);
                setError(null);
              }}
              className={`p-3 rounded-xl border transition cursor-pointer flex flex-col gap-1 ${
                selectedId === fact.id
                  ? 'bg-indigo-600/15 border-indigo-500/50 text-white shadow-sm'
                  : 'bg-[#10121d]/40 border-slate-800/60 text-slate-300 hover:bg-[#181c2d]'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-mono text-slate-500 shrink-0">{fact.id}</span>
                <span className="text-xs font-semibold truncate">{fact.title}</span>
              </div>
              <div className="text-[11px] text-slate-400 line-clamp-2">{fact.description}</div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className={`px-1.5 py-0.5 rounded border ${TYPE_BADGE[fact.type]}`}>{m.types[fact.type]}</span>
                {fact.source && <span className="text-slate-500 font-mono truncate">{fact.source}</span>}
                <span className="text-slate-600 ml-auto shrink-0">{fact.updated ?? fact.created}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Карточка факта или форма */}
      <div className="flex-1 bg-[#141724]/70 border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 bg-[#111422] flex items-center gap-3">
          <Brain className="w-4 h-4 text-indigo-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white truncate">{m.title}</div>
            <div className="text-[11px] text-slate-500 truncate">{m.subtitle}</div>
          </div>
          {notice && (
            <span className="text-[11px] text-emerald-300 flex items-center gap-1 shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" /> {notice}
            </span>
          )}
        </div>

        {error && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-xs text-red-200 flex items-start gap-2" data-testid="memory-error">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          {editing ? (
            <div className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="text-slate-400">{m.fieldTitle}</span>
                <input
                  value={editing.draft.title}
                  onChange={(e) => setDraft({ title: e.target.value })}
                  maxLength={100}
                  className="w-full bg-[#10121d] border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-400">{m.fieldDescription}</span>
                <input
                  value={editing.draft.description}
                  onChange={(e) => setDraft({ description: e.target.value })}
                  maxLength={200}
                  className="w-full bg-[#10121d] border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-slate-400">{m.fieldType}</span>
                <select
                  value={editing.draft.type}
                  onChange={(e) => setDraft({ type: e.target.value as MemoryFactType })}
                  className="w-full bg-[#10121d] border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                >
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {m.types[type]} — {m.typeHints[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-slate-400">{m.fieldBody}</span>
                <textarea
                  value={editing.draft.body}
                  onChange={(e) => setDraft({ body: e.target.value })}
                  rows={10}
                  className="w-full bg-[#10121d] border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-indigo-500"
                />
                <span className="text-[11px] text-slate-500">{m.bodyHint}</span>
              </label>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => void save()}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" /> {saving ? m.saving : m.save}
                </button>
                <button
                  onClick={() => {
                    setEditing(null);
                    setError(null);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/60"
                >
                  <X className="w-3.5 h-3.5" /> {m.cancel}
                </button>
              </div>
            </div>
          ) : selected ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-500">{selected.id}</span>
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] ${TYPE_BADGE[selected.type]}`}>{m.types[selected.type]}</span>
                  </div>
                  <h2 className="text-base font-semibold text-white">{selected.title}</h2>
                  <p className="text-xs text-slate-400">{selected.description}</p>
                </div>
                <button
                  onClick={() => startEdit(selected)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700/60"
                >
                  <Edit3 className="w-3.5 h-3.5" /> {m.edit}
                </button>
                <button
                  onClick={() => void remove(selected)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/50 text-xs text-red-300 border border-red-500/30"
                >
                  <Trash2 className="w-3.5 h-3.5" /> {m.delete}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-slate-400">
                {selected.source && (
                  <span>
                    {m.source}: <span className="font-mono text-slate-300">{selected.source}</span>
                  </span>
                )}
                {selected.author && (
                  <span>
                    {m.author}: <span className="font-mono text-slate-300">{selected.author}</span>
                  </span>
                )}
                <span>
                  {m.created}: <span className="text-slate-300">{selected.created}</span>
                </span>
                {selected.updated && (
                  <span>
                    {m.updated}: <span className="text-slate-300">{selected.updated}</span>
                  </span>
                )}
              </div>
              <div className="border-t border-slate-800 pt-4">
                <MarkdownViewer content={selected.body} />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-500">{m.noSelection}</div>
          )}
        </div>
      </div>
    </div>
  );
};
