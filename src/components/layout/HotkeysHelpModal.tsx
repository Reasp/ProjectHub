import React from 'react';
import { X, Keyboard, Navigation, Zap, Terminal } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const HotkeysHelpModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const shortcutGroups = [
    {
      title: t.hotkeys.navigation,
      icon: Navigation,
      items: [
        { keys: ['Ctrl', 'B'], description: t.hotkeys.tasksTab },
        { keys: ['Ctrl', 'M'], description: t.hotkeys.milestonesTab },
        { keys: ['Ctrl', 'G'], description: t.hotkeys.gitTab },
        { keys: ['Ctrl', 'P'], description: t.hotkeys.prsTab },
        { keys: ['Ctrl', 'D'], description: t.hotkeys.docsTab },
        { keys: ['Ctrl', 'A'], description: t.hotkeys.analyticsTab },
        { keys: ['Ctrl', 'I'], description: t.hotkeys.aiTab },
        { keys: ['Ctrl', 'T'], description: t.hotkeys.claudeCliTab }
      ]
    },
    {
      title: t.hotkeys.quickActions,
      icon: Zap,
      items: [
        { keys: ['Ctrl', 'K'], description: t.hotkeys.omniSearch },
        { keys: ['Ctrl', 'N'], description: t.hotkeys.newTask },
        { keys: ['Ctrl', 'Shift', 'P'], description: t.hotkeys.templateWizard },
        { keys: ['Ctrl', 'R'], description: t.hotkeys.refreshData }
      ]
    },
    {
      title: t.hotkeys.environment,
      icon: Terminal,
      items: [
        { keys: ['Ctrl', '\\'], description: t.hotkeys.toggleTerminal },
        { keys: ['?'], description: t.hotkeys.openHelp },
        { keys: ['Esc'], description: t.hotkeys.closeModal }
      ]
    }
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-2xl bg-[#161922] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#12151e]/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">{t.hotkeys.title}</h2>
              <p className="text-[11px] text-slate-400">
                {t.hotkeys.subtitle}
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
          {shortcutGroups.map((group) => {
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
          <span>{t.hotkeys.openHelp}: <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]">?</kbd></span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition border border-slate-700/60"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
};
