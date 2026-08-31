import React from 'react';
import { X, Keyboard, Command, Sparkles, Navigation, Zap, Terminal } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  icon: any;
  items: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Навигация по разделам',
    icon: Navigation,
    items: [
      { keys: ['Ctrl', 'B'], description: 'Вкладка "Задачи & Backlog" (Канбан-доска)' },
      { keys: ['Ctrl', 'M'], description: 'Вкладка "Майлстоуны & Roadmap"' },
      { keys: ['Ctrl', 'G'], description: 'Вкладка "Git Репозиторий" (История, Ветки, Diffs)' },
      { keys: ['Ctrl', 'P'], description: 'Вкладка "Pull / Merge Requests"' },
      { keys: ['Ctrl', 'D'], description: 'Вкладка "Документация & ADR / RAG"' },
      { keys: ['Ctrl', 'A'], description: 'Вкладка "Аналитика и метрики проекта"' }
    ]
  },
  {
    title: 'Быстрые действия',
    icon: Zap,
    items: [
      { keys: ['Ctrl', 'K'], description: 'Omni-Search: глобальный поиск и Vector RAG' },
      { keys: ['Ctrl', 'N'], description: 'Создать новую задачу в активном проекте' },
      { keys: ['Ctrl', 'Shift', 'P'], description: 'Мастер создания проекта из ProjectTemplate' },
      { keys: ['Ctrl', 'R'], description: 'Обновить метаданные проекта и статус Git' }
    ]
  },
  {
    title: 'Окружение и справка',
    icon: Terminal,
    items: [
      { keys: ['Ctrl', '\\'], description: 'Показать / скрыть панель терминала и логов' },
      { keys: ['?'], description: 'Открыть эту справку по горячим клавишам' },
      { keys: ['Esc'], description: 'Закрыть активное модальное окно' }
    ]
  }
];

export const HotkeysHelpModal: React.FC<Props> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-[#161922] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#12151e]/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Горячие клавиши (Keyboard Shortcuts)</h2>
              <p className="text-[11px] text-slate-400">
                Быстрое управление ProjectHub без использования мыши
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Shortcuts Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {SHORTCUT_GROUPS.map((group) => {
            const GroupIcon = group.icon;
            return (
              <div key={group.title} className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  <GroupIcon className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{group.title}</span>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {group.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-[#12151e]/70 border border-slate-800/80 hover:border-slate-700/80 transition text-xs"
                    >
                      <span className="text-slate-300 font-medium">{item.description}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.keys.map((k, kIdx) => (
                          <React.Fragment key={kIdx}>
                            {kIdx > 0 && <span className="text-[10px] text-slate-500 font-mono">+</span>}
                            <kbd className="min-w-[24px] text-center px-2 py-1 rounded-md bg-slate-800 border border-slate-700/80 font-mono text-[11px] font-semibold text-slate-200 shadow-sm shadow-black/40">
                              {k}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-[#12151e]/80 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <span>Нажмите <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]">?</kbd> в любое время для вызова справки</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-sm"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
};
