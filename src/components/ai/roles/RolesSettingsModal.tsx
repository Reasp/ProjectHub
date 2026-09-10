import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Save, Trash2, Copy, TriangleAlert, Bot } from 'lucide-react';
import { useRolesStore } from '../../../store/useRolesStore';
import { useProjectStore } from '../../../store/useProjectStore';
import { useTranslation } from '../../../i18n';
import { unsupportedRoleFeatures } from '../../../lib/engineCapabilities';
import type { RoleDefinition, RoleEngine, ToolCategory } from '../../../types/electron';

interface RolesSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ENGINES: (RoleEngine | '')[] = ['', 'claude-cli', 'codex-cli', 'gemini-cli', 'api'];
const TOOL_CATEGORIES: ToolCategory[] = ['read', 'write', 'command', 'search', 'subagent', 'question'];

function emptyRole(slug = ''): RoleDefinition {
  return { slug, name: '', systemPrompt: '', source: 'project' };
}

function ChipListEditor({
  label,
  values,
  onChange,
  placeholder
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState('');
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className="px-2 py-0.5 rounded-md bg-secondary text-foreground border border-border flex items-center gap-1 text-[11px]">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="hover:text-destructive">×</button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const trimmed = input.trim();
              if (trimmed && !values.includes(trimmed)) onChange([...values, trimmed]);
              setInput('');
            }
          }}
          placeholder={placeholder}
          className="flex-1 text-xs rounded-sm border border-border bg-background px-2 py-1 text-foreground"
        />
      </div>
    </div>
  );
}

export const RolesSettingsModal: React.FC<RolesSettingsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { selectedProject } = useProjectStore();
  const { rolesByProject, loadRolesAction, saveRoleAction, deleteRoleAction, copyRoleToProjectAction } = useRolesStore();
  const roles = useMemo(() => rolesByProject[selectedProject?.path || ''] || [], [rolesByProject, selectedProject?.path]);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoleDefinition>(emptyRole());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) void loadRolesAction(selectedProject?.path);
  }, [isOpen, selectedProject?.path, loadRolesAction]);

  const selected = useMemo(() => roles.find((r) => r.slug === selectedSlug) || null, [roles, selectedSlug]);

  useEffect(() => {
    setDraft(selected ? { ...selected } : emptyRole());
    setError(null);
  }, [selected]);

  if (!isOpen) return null;

  const isNew = !selectedSlug;
  const scope: 'global' | 'project' = draft.source === 'project' && selectedProject ? 'project' : 'global';
  const warnings = unsupportedRoleFeatures((draft.engine as RoleEngine) || 'claude-cli', draft);

  const handleNew = () => {
    setSelectedSlug(null);
    setDraft(emptyRole());
  };

  const handleSave = async () => {
    if (!draft.slug.trim() || !draft.name.trim()) {
      setError(t.roles.slugNameRequired);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const targetScope: 'global' | 'project' = draft.source === 'project' ? 'project' : 'global';
      const result = await saveRoleAction(targetScope, draft, selectedProject?.path);
      if (result.success) {
        setSelectedSlug(draft.slug);
      } else {
        setError(result.error || t.roles.saveFailed);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || selected.source === 'builtin') return;
    const ok = await deleteRoleAction(selected.source as 'global' | 'project', selected.slug, selectedProject?.path);
    if (ok) handleNew();
  };

  const handleCopyToProject = async () => {
    if (!selected || !selectedProject) return;
    const copy = await copyRoleToProjectAction(selected.slug, selectedProject.path);
    if (copy) setSelectedSlug(copy.slug);
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-4xl h-[85vh] rounded-xl border border-border bg-card shadow-2xl text-card-foreground flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-secondary/20">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold tracking-tight">{t.roles.title}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Список ролей */}
          <div className="w-64 border-r border-border overflow-y-auto p-3 space-y-1.5">
            <button
              type="button"
              onClick={handleNew}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 mb-2"
            >
              <Plus className="w-3.5 h-3.5" /> {t.roles.newRole}
            </button>
            {roles.map((r) => (
              <button
                key={r.slug}
                type="button"
                onClick={() => setSelectedSlug(r.slug)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs border transition ${
                  selectedSlug === r.slug ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-secondary/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-[10px] text-muted-foreground uppercase">{r.source}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">{r.slug}</div>
              </button>
            ))}
          </div>

          {/* Редактор */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">{t.roles.slug}</label>
                <input
                  type="text"
                  value={draft.slug}
                  disabled={!isNew}
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') })}
                  className="w-full text-xs rounded-sm border border-border bg-background px-2 py-1.5 text-foreground disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">{t.roles.name}</label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full text-xs rounded-sm border border-border bg-background px-2 py-1.5 text-foreground"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">{t.roles.engine}</label>
                <select
                  value={draft.engine || ''}
                  onChange={(e) => setDraft({ ...draft, engine: (e.target.value || undefined) as RoleEngine | undefined })}
                  className="w-full text-xs rounded-sm border border-border bg-background px-2 py-1.5 text-foreground"
                >
                  {ENGINES.map((e) => (
                    <option key={e} value={e}>{e || t.roles.anyEngine}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">{t.roles.model}</label>
                <input
                  type="text"
                  value={draft.model || ''}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value || undefined })}
                  className="w-full text-xs rounded-sm border border-border bg-background px-2 py-1.5 text-foreground font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">{t.roles.budgetUsd}</label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={draft.budgetUsd ?? ''}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setDraft({ ...draft, budgetUsd: Number.isFinite(v) && v > 0 ? v : undefined });
                  }}
                  className="w-full text-xs rounded-sm border border-border bg-background px-2 py-1.5 text-foreground"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">{t.roles.tools}</label>
              <div className="flex flex-wrap gap-2">
                {TOOL_CATEGORIES.map((cat) => {
                  const active = (draft.tools || []).includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        const current = draft.tools || [];
                        setDraft({
                          ...draft,
                          tools: active ? current.filter((c) => c !== cat) : [...current, cat]
                        });
                      }}
                      className={`px-2.5 py-1 rounded-md text-[11px] border transition ${
                        active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary/50'
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
              {warnings.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2 text-[11px] text-amber-500">
                  <TriangleAlert className="w-3.5 h-3.5" />
                  {t.roles.unsupportedWarning}: {warnings.join(', ')}
                </div>
              )}
            </div>

            <ChipListEditor
              label={t.roles.dod}
              values={draft.dod || []}
              onChange={(v) => setDraft({ ...draft, dod: v })}
              placeholder={t.roles.dodPlaceholder}
            />

            <ChipListEditor
              label={t.roles.handoffTo}
              values={draft.handoffTo || []}
              onChange={(v) => setDraft({ ...draft, handoffTo: v })}
              placeholder={t.roles.handoffToPlaceholder}
            />

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">{t.roles.systemPrompt}</label>
              <textarea
                value={draft.systemPrompt}
                onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                rows={8}
                className="w-full text-xs rounded-lg border border-border bg-secondary/30 p-3 text-foreground font-mono"
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-3.5 border-t border-border bg-secondary/20">
          <div className="flex items-center gap-2">
            {selected && selected.source !== 'builtin' && (
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-destructive hover:bg-destructive/10 border border-destructive/30"
              >
                <Trash2 className="w-3.5 h-3.5" /> {t.roles.delete}
              </button>
            )}
            {selected && selected.source !== 'project' && selectedProject && (
              <button
                onClick={handleCopyToProject}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-foreground hover:bg-secondary border border-border"
              >
                <Copy className="w-3.5 h-3.5" /> {t.roles.copyToProject}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:bg-secondary">
              {t.common.cancel}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> {t.common.save}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
