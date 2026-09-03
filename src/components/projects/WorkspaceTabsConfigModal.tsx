import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  SlidersHorizontal,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  RotateCcw,
  Check,
  Kanban,
  Target,
  GitBranch,
  FolderTree,
  GitPullRequest,
  BookOpen,
  BarChart2,
  Sparkles,
  Bot,
  Cpu
} from 'lucide-react';
import type { TabConfigItem, WorkspaceTabId } from '../../hooks/useWorkspaceTabs';
import { useTranslation } from '../../i18n/useTranslation';

interface WorkspaceTabsConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  tabsConfig: TabConfigItem[];
  onToggleVisibility: (id: WorkspaceTabId) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onMoveTab: (id: WorkspaceTabId, direction: 'up' | 'down') => void;
  onReset: () => void;
  onShowAll: () => void;
}

export const WorkspaceTabsConfigModal: React.FC<WorkspaceTabsConfigModalProps> = ({
  isOpen,
  onClose,
  tabsConfig,
  onToggleVisibility,
  onReorder,
  onMoveTab,
  onReset,
  onShowAll
}) => {
  const { t } = useTranslation();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const tabMetadata: Record<
    WorkspaceTabId,
    { label: string; icon: React.ComponentType<{ className?: string }>; hotkey: string }
  > = {
    kanban: { label: t.tabs.tasks, icon: Kanban, hotkey: 'Ctrl+B' },
    milestones: { label: t.tabs.milestones, icon: Target, hotkey: 'Ctrl+M' },
    git: { label: t.tabs.git, icon: GitBranch, hotkey: 'Ctrl+G' },
    files: { label: t.tabs.files, icon: FolderTree, hotkey: 'Ctrl+E' },
    prs: { label: t.tabs.prs, icon: GitPullRequest, hotkey: 'Ctrl+P' },
    docs: { label: t.tabs.docs, icon: BookOpen, hotkey: 'Ctrl+D' },
    analytics: { label: t.tabs.analytics, icon: BarChart2, hotkey: 'Ctrl+A' },
    ai: { label: t.tabs.ai, icon: Sparkles, hotkey: 'Ctrl+I' },
    'claude-cli': { label: t.tabs.claudeCli, icon: Bot, hotkey: 'Ctrl+T' },
    processes: { label: t.tabs.processes, icon: Cpu, hotkey: 'Ctrl+\\' }
  };

  const visibleCount = tabsConfig.filter((t) => t.visible).length;

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150 select-none"
    >
      <div className="w-full max-w-lg bg-[#111420] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-slate-200 font-sans max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-[#141827]/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">{t.tabs.modalTitle}</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {t.tabs.modalDesc}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Toolbar Actions */}
        <div className="px-5 py-2.5 border-b border-slate-800/80 bg-[#0d101a] flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span>
              {t.tabs.displayed}: <strong className="text-white font-mono">{visibleCount}</strong> {t.tabs.of} {tabsConfig.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onShowAll}
              className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition flex items-center gap-1.5 text-[11px] font-medium"
            >
              <Eye className="w-3.5 h-3.5 text-indigo-400" />
              <span>{t.tabs.showAll}</span>
            </button>
            <button
              onClick={onReset}
              className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition flex items-center gap-1.5 text-[11px] font-medium"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>{t.tabs.reset}</span>
            </button>
          </div>
        </div>

        {/* Tabs List */}
        <div className="p-4 overflow-y-auto space-y-2 flex-1 custom-scrollbar">
          {tabsConfig.map((item, idx) => {
            const meta = tabMetadata[item.id] || {
              label: item.id,
              icon: Kanban,
              hotkey: ''
            };
            const Icon = meta.icon;
            const isFirst = idx === 0;
            const isLast = idx === tabsConfig.length - 1;
            const isOnlyVisible = item.visible && visibleCount <= 1;

            return (
              <div
                key={item.id}
                draggable
                onDragStart={() => setDraggedIndex(idx)}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={() => {
                  if (draggedIndex !== null && draggedIndex !== idx) {
                    onReorder(draggedIndex, idx);
                  }
                  setDraggedIndex(null);
                }}
                className={`p-3 rounded-xl border transition flex items-center justify-between gap-3 group ${
                  item.visible
                    ? 'bg-slate-900/60 border-slate-800/80 text-white hover:border-indigo-500/40'
                    : 'bg-slate-950/40 border-slate-800/40 text-slate-500'
                } ${draggedIndex === idx ? 'opacity-40 scale-[0.98]' : ''}`}
              >
                {/* Left Drag Handle & Icon & Name */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    title={t.tabs.dragHint}
                    className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-slate-800/60 text-slate-500 group-hover:text-slate-300 transition"
                  >
                    <GripVertical className="w-4 h-4" />
                  </div>

                  <div
                    className={`p-2 rounded-lg ${
                      item.visible ? 'bg-indigo-500/15 text-indigo-400' : 'bg-slate-800/40 text-slate-600'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>

                  <div className="truncate">
                    <div className="font-semibold text-xs truncate flex items-center gap-2">
                      <span className={item.visible ? 'text-white' : 'text-slate-400 line-through'}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {t.tabs.hotkey}: {meta.hotkey}
                    </div>
                  </div>
                </div>

                {/* Right Reorder Buttons & Visibility Toggle */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Up / Down Move Buttons */}
                  <button
                    onClick={() => onMoveTab(item.id, 'up')}
                    disabled={isFirst}
                    title={t.tabs.moveLeft}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onMoveTab(item.id, 'down')}
                    disabled={isLast}
                    title={t.tabs.moveRight}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>

                  {/* Visibility Toggle Button */}
                  <button
                    onClick={() => onToggleVisibility(item.id)}
                    disabled={isOnlyVisible}
                    title={
                      isOnlyVisible
                        ? t.tabs.cannotHideLast
                        : item.visible
                        ? t.tabs.hideTab
                        : t.tabs.restoreTab
                    }
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ml-1 ${
                      item.visible
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                        : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200'
                    } ${isOnlyVisible ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {item.visible ? (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{t.tabs.visible}</span>
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{t.tabs.hidden}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-[#121522] flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            {t.tabs.footerHint}
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 transition"
          >
            {t.tabs.done}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
