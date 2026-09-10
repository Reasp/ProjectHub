import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { ru } from '../../i18n/ru';
import { en } from '../../i18n/en';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ProjectHub ErrorBoundary] Uncaught render error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const t = (useProjectStore.getState().language === 'en' ? en : ru).errorBoundary;

      return (
        <div className="min-h-screen w-full bg-[#0f1117] text-slate-100 flex items-center justify-center p-6 select-none font-sans">
          <div className="bg-[#141724] border border-rose-900/60 rounded-2xl max-w-xl w-full p-6 shadow-2xl flex flex-col gap-4 animate-in fade-in duration-200">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">{t.title}</h2>
                <p className="text-xs text-rose-300/80">{t.subtitle}</p>
              </div>
            </div>

            {this.state.error && (
              <div className="p-3.5 rounded-xl bg-[#0e111a] border border-slate-800 text-xs font-mono text-rose-300 break-all leading-relaxed max-h-48 overflow-y-auto">
                <div className="font-bold text-rose-400 mb-1">{this.state.error.name}: {this.state.error.message}</div>
                {this.state.error.stack && (
                  <pre className="text-[11px] text-slate-400 whitespace-pre-wrap mt-2">{this.state.error.stack}</pre>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-3.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 font-medium transition"
              >
                {t.retry}
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium flex items-center gap-1.5 shadow-md shadow-indigo-600/20 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t.reloadApp}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
