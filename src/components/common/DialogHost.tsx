import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, HelpCircle, Info, X } from 'lucide-react';
import { useDialogStore } from '../../store/useDialogStore';
import { useTranslation } from '../../i18n/useTranslation';

export const DialogHost: React.FC = () => {
  const { t } = useTranslation();
  const { activeDialog, close } = useDialogStore();
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (activeDialog?.type === 'prompt') {
      setInputValue(activeDialog.options.defaultValue || '');
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    } else if (activeDialog) {
      setTimeout(() => {
        confirmButtonRef.current?.focus();
      }, 50);
    }
  }, [activeDialog]);

  useEffect(() => {
    if (!activeDialog) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Enter' && activeDialog.type === 'prompt') {
        e.preventDefault();
        activeDialog.resolve(inputValue);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDialog, inputValue, close]);

  if (!activeDialog) return null;

  const handleConfirm = () => {
    if (activeDialog.type === 'confirm') {
      activeDialog.resolve(true);
    } else if (activeDialog.type === 'prompt') {
      activeDialog.resolve(inputValue);
    } else if (activeDialog.type === 'alert') {
      activeDialog.resolve();
    }
  };

  const handleCancel = () => {
    if (activeDialog.type === 'confirm') {
      activeDialog.resolve(false);
    } else if (activeDialog.type === 'prompt') {
      activeDialog.resolve(null);
    } else if (activeDialog.type === 'alert') {
      activeDialog.resolve();
    }
  };

  const defaultTitle =
    activeDialog.type === 'confirm'
      ? activeDialog.options.danger
        ? t.dialogs.confirmDangerTitle
        : t.dialogs.confirmTitle
      : activeDialog.type === 'prompt'
      ? t.dialogs.promptTitle
      : t.dialogs.alertTitle;

  const title = activeDialog.options.title || defaultTitle;
  const isDanger = activeDialog.type === 'confirm' && activeDialog.options.danger;

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            {isDanger ? (
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            ) : activeDialog.type === 'prompt' ? (
              <HelpCircle className="w-5 h-5 text-indigo-400 shrink-0" />
            ) : (
              <Info className="w-5 h-5 text-sky-400 shrink-0" />
            )}
            <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          </div>
          <button
            onClick={handleCancel}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-3">
          <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap select-text">
            {activeDialog.options.message}
          </p>

          {activeDialog.type === 'prompt' && (
            <input
              ref={inputRef}
              type={activeDialog.options.inputType || 'text'}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={activeDialog.options.placeholder}
              className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-slate-800/80 bg-slate-950/40">
          {activeDialog.type !== 'alert' && (
            <button
              type="button"
              onClick={handleCancel}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 transition-colors"
            >
              {activeDialog.options.cancelText || t.common.cancel}
            </button>
          )}
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={handleConfirm}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium text-white transition-colors shadow-xs ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-500 border border-rose-500/50'
                : 'bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/50'
            }`}
          >
            {activeDialog.options.confirmText ||
              (activeDialog.type === 'confirm'
                ? isDanger
                  ? t.common.delete
                  : t.dialogs.confirmButton
                : t.dialogs.okButton)}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
