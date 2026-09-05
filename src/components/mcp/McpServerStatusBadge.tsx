import React, { useState, useEffect } from 'react';
import {
  Server,
  Radio,
  Copy,
  Check,
  RefreshCw,
  Power,
  Shield,
  ExternalLink,
  Terminal,
  Activity,
  X
} from 'lucide-react';

interface McpStatus {
  isRunning: boolean;
  port: number;
  activeSessions: number;
  token: string;
  url: string;
  lastError?: string | null;
}

export const McpServerStatusBadge: React.FC = () => {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fetchStatus = async () => {
    if (window.api?.getMcpStatus) {
      try {
        const st = await window.api.getMcpStatus();
        setStatus(st);
      } catch (e) {
        console.error('Failed to get MCP status:', e);
      }
    }
  };

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleToggle = async () => {
    if (!status || !window.api?.toggleMcpServer) return;
    try {
      const next = await window.api.toggleMcpServer(!status.isRunning);
      setStatus(next);
    } catch (e) {
      console.error('Failed to toggle MCP server:', e);
    }
  };

  const handleRegenerate = async () => {
    if (!window.api?.regenerateMcpToken) return;
    try {
      const nextToken = await window.api.regenerateMcpToken();
      setStatus((prev) => (prev ? { ...prev, token: nextToken } : null));
    } catch (e) {
      console.error('Failed to regenerate token:', e);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  if (!status) return null;

  const mcpJsonConfig = JSON.stringify(
    {
      mcpServers: {
        projecthub: {
          url: status.url,
          transport: 'sse',
          headers: {
            Authorization: `Bearer ${status.token}`
          }
        }
      }
    },
    null,
    2
  );

  const curlExample = `curl -X POST http://127.0.0.1:${status.port}/api/action \\
  -H "Authorization: Bearer ${status.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"switch_tab","payload":{"tab":"ai"}}'`;

  return (
    <>
      {/* Header Pill Button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition border ${
          status.isRunning
            ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/50 hover:border-emerald-500/50'
            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
        }`}
        title="Встроенный MCP Remote Server (управление приложением из внешних агентов)"
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            status.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
          }`}
        />
        <span className="font-mono">MCP:{status.port}</span>
        {status.activeSessions > 0 && (
          <span className="px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
            {status.activeSessions}
          </span>
        )}
      </button>

      {/* Settings / Info Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-[#121522] border border-slate-700/80 rounded-2xl shadow-2xl p-6 space-y-5 text-slate-200 font-sans">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    Встроенный MCP HTTP/SSE Сервер
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-normal border ${
                        status.isRunning
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                    >
                      {status.isRunning ? '● RUNNING' : 'STOPPED'}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Управление окном ProjectHub из Claude Code, Cursor, Windsurf и Antigravity
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Controls Bar */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
              <div className="space-y-0.5">
                <div className="font-semibold text-slate-200">Эндпоинт SSE:</div>
                <div className="font-mono text-indigo-300 text-[11px] select-all">{status.url}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggle}
                  className={`px-3 py-1.5 rounded-lg font-medium text-xs flex items-center gap-1.5 transition ${
                    status.isRunning
                      ? 'bg-rose-600/20 border border-rose-500/30 text-rose-300 hover:bg-rose-600/30'
                      : 'bg-emerald-600 text-white hover:bg-emerald-500'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{status.isRunning ? 'Остановить' : 'Запустить'}</span>
                </button>
              </div>
            </div>

            {/* Startup error (e.g. no free port) */}
            {!status.isRunning && status.lastError && (
              <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-[11px] leading-relaxed">
                Ошибка запуска: {status.lastError}
              </div>
            )}

            {/* Token & Security */}
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span className="flex items-center gap-1 font-semibold text-slate-300">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  Сессионный токен доступа (Bearer Token):
                </span>
                <button
                  type="button"
                  onClick={handleRegenerate}
                  className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  Обновить
                </button>
              </div>
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-[11px] text-slate-300">
                <span className="flex-1 truncate">{status.token}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(status.token, 'token')}
                  className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800"
                  title="Скопировать токен"
                >
                  {copiedKey === 'token' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Quick Config Copy */}
            <div className="space-y-2 text-xs">
              <div className="font-semibold text-slate-300 flex items-center justify-between">
                <span>Конфигурация для Claude Desktop / Cursor (`.mcp.json`):</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(mcpJsonConfig, 'config')}
                  className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 text-[11px]"
                >
                  {copiedKey === 'config' ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Скопировано!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Копировать JSON</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto select-all max-h-36 leading-relaxed">
                {mcpJsonConfig}
              </pre>
            </div>

            {/* Direct REST / cURL Example */}
            <div className="space-y-1.5 text-xs">
              <div className="font-semibold text-slate-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                  Быстрый HTTP REST вызов (cURL / Скрипты):
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(curlExample, 'curl')}
                  className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 text-[11px]"
                >
                  {copiedKey === 'curl' ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Скопировано!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Копировать cURL</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[10px] text-slate-400 overflow-x-auto select-all leading-tight">
                {curlExample}
              </pre>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                Привязан строго к <strong className="text-slate-300">127.0.0.1</strong> (без внешнего доступа)
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
