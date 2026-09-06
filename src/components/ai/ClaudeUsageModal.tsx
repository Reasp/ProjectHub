import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Gauge,
  RefreshCw,
  Clock,
  Sparkles,
  Server,
  Zap,
  Bot,
  Terminal,
  Activity,
  Calendar,
  Layers,
  FileCode2,
  Database
} from 'lucide-react';
import type { ClaudeUsageData } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';

interface ClaudeUsageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ClaudeUsageModal: React.FC<ClaudeUsageModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [usageData, setUsageData] = useState<ClaudeUsageData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'limits' | 'models' | 'raw'>('limits');
  const [breakdownPeriod, setBreakdownPeriod] = useState<'24h' | '7d'>('24h');

  const loadUsage = async (force = false) => {
    setIsLoading(true);
    setError(null);
    try {
      if (window.api?.getClaudeUsage) {
        const data = await window.api.getClaudeUsage(force);
        setUsageData(data);
      } else {
        setError('API получения usage Claude Code недоступно');
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки статистики usage');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadUsage(false);
    }
  }, [isOpen]);

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

  const sessionPercent = usageData?.sessionLimit?.percent ?? 0;
  const weeklyPercent = usageData?.weeklyLimit?.percent ?? 0;
  const fablePercent = usageData?.fableLimit?.percent ?? 0;
  const hasFable = !!usageData?.fableLimit;
  const currentBreakdown = breakdownPeriod === '24h' ? usageData?.last24h : usageData?.last7d;

  const getProgressColor = (percent: number) => {
    if (percent >= 85) return 'from-rose-500 to-red-600 shadow-rose-500/30';
    if (percent >= 60) return 'from-amber-500 to-orange-600 shadow-amber-500/30';
    return 'from-emerald-500 to-teal-500 shadow-emerald-500/30';
  };

  const getBadgeColor = (percent: number) => {
    if (percent >= 85) return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    if (percent >= 60) return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  };

  const formatTokens = (num: number) => {
    if (!num) return '0';
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150 select-none"
    >
      <div className={`w-full ${hasFable ? 'max-w-4xl' : 'max-w-2xl'} bg-[#10131f] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-200 font-sans transition-all duration-200`}>
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-[#141827]/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 shadow-sm">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">{t.claudeUsage.modalTitle}</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {usageData?.planType || 'Subscription'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {t.claudeUsage.modalDesc}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => loadUsage(true)}
              disabled={isLoading}
              title={t.claudeUsage.refreshTitle}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium border border-slate-700/60 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
              <span className="hidden sm:inline">{t.claudeUsage.refresh}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Tabs Bar */}
        <div className="px-5 pt-3 pb-0 border-b border-slate-800/80 flex items-center gap-2 bg-[#0e111c]">
          <button
            onClick={() => setActiveTab('limits')}
            className={`pb-2.5 px-2 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'limits'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            {t.claudeUsage.tabLimits}
          </button>
          <button
            onClick={() => setActiveTab('models')}
            className={`pb-2.5 px-2 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'models'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            {t.claudeUsage.tabModels}
          </button>
          <button
            onClick={() => setActiveTab('raw')}
            className={`pb-2.5 px-2 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'raw'
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            {t.claudeUsage.tabRaw}
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-5 custom-scrollbar flex-1">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
              <X className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isLoading && !usageData && (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <RefreshCw className="w-7 h-7 text-amber-400 animate-spin" />
              <p className="text-xs text-slate-400">Считывание квот и истории сессий Claude Code...</p>
            </div>
          )}

          {/* TAB 1: LIMITS & FACTORS */}
          {activeTab === 'limits' && usageData && (
            <div className="space-y-5">
              {/* Top Row: Limit Cards (Session + Weekly + Fable) */}
              <div className={`grid grid-cols-1 ${hasFable ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-4`}>
                {/* Session Limit Card */}
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-indigo-400" />
                      {t.claudeUsage.sessionLimit}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-mono font-bold border ${getBadgeColor(
                        sessionPercent
                      )}`}
                    >
                      {sessionPercent}% used
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-800/80 rounded-full h-2.5 overflow-hidden p-0.5">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${getProgressColor(sessionPercent)} transition-all duration-500`}
                      style={{ width: `${Math.min(100, Math.max(2, sessionPercent))}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{t.claudeUsage.sessionResetLabel}</span>
                    <span className="font-medium text-slate-300">
                      {usageData.sessionLimit?.resetsAt || t.claudeUsage.resetsInHours}
                    </span>
                  </div>
                </div>

                {/* Weekly Limit Card */}
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-amber-400" />
                      {t.claudeUsage.weeklyLimit}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-mono font-bold border ${getBadgeColor(
                        weeklyPercent
                      )}`}
                    >
                      {weeklyPercent}% used
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-800/80 rounded-full h-2.5 overflow-hidden p-0.5">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${getProgressColor(weeklyPercent)} transition-all duration-500`}
                      style={{ width: `${Math.min(100, Math.max(2, weeklyPercent))}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{t.claudeUsage.weeklyResetLabel}</span>
                    <span className="font-medium text-slate-300">
                      {usageData.weeklyLimit?.resetsAt || t.claudeUsage.resetsInWeek}
                    </span>
                  </div>
                </div>

                {/* Fable Limit Card */}
                {hasFable && (
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-purple-500/30 space-y-3 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full blur-2xl pointer-events-none" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        {t.claudeUsage.fableLimit}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-mono font-bold border ${getBadgeColor(
                          fablePercent
                        )}`}
                      >
                        {fablePercent}% used
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-800/80 rounded-full h-2.5 overflow-hidden p-0.5">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${getProgressColor(fablePercent)} transition-all duration-500`}
                        style={{ width: `${Math.min(100, Math.max(2, fablePercent))}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{t.claudeUsage.fableResetLabel}</span>
                      <span className="font-medium text-purple-300">
                        {usageData.fableLimit?.resetsAt || t.claudeUsage.resetsInWeek}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Contributing Factors Section */}
              <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      Факторы потребления лимитов
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Статистика локальных сессий Claude Code на этой машине
                    </p>
                  </div>

                  {/* Period Switcher */}
                  <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
                    <button
                      onClick={() => setBreakdownPeriod('24h')}
                      className={`px-2.5 py-1 rounded font-medium transition ${
                        breakdownPeriod === '24h'
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      За 24 часа
                    </button>
                    <button
                      onClick={() => setBreakdownPeriod('7d')}
                      className={`px-2.5 py-1 rounded font-medium transition ${
                        breakdownPeriod === '7d'
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      За 7 дней
                    </button>
                  </div>
                </div>

                {/* Key Metrics Grid */}
                {currentBreakdown ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/60">
                      <div className="text-lg font-bold text-white font-mono">
                        {currentBreakdown.requests ?? '—'}
                      </div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">
                        Запросов
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/60">
                      <div className="text-lg font-bold text-white font-mono">
                        {currentBreakdown.sessions ?? '—'}
                      </div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">
                        Сессий
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/60">
                      <div className="text-lg font-bold text-amber-300 font-mono">
                        {currentBreakdown.contextAbove150kPercent ? `${currentBreakdown.contextAbove150kPercent}%` : '—'}
                      </div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">
                        Контекст &gt;150k
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/60">
                      <div className="text-lg font-bold text-indigo-300 font-mono">
                        {currentBreakdown.subagentHeavyPercent ? `${currentBreakdown.subagentHeavyPercent}%` : '—'}
                      </div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">
                        Подагенты
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 py-3 text-center">
                    Нет данных за выбранный период.
                  </div>
                )}

                {/* Top Skills, MCP Servers, Subagents */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                  {/* Top Skills */}
                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                      <FileCode2 className="w-3 h-3 text-indigo-400" />
                      Топ скиллов
                    </div>
                    {currentBreakdown?.topSkills && currentBreakdown.topSkills.length > 0 ? (
                      <div className="space-y-1.5">
                        {currentBreakdown.topSkills.map((s, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-[11px] text-slate-300 truncate">{s.name}</span>
                            <span className="font-mono font-bold text-indigo-400">{s.percent}%</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500">Нет активности</div>
                    )}
                  </div>

                  {/* Top MCP Servers */}
                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                      <Server className="w-3 h-3 text-emerald-400" />
                      Топ MCP серверов
                    </div>
                    {currentBreakdown?.topMcpServers && currentBreakdown.topMcpServers.length > 0 ? (
                      <div className="space-y-1.5">
                        {currentBreakdown.topMcpServers.map((m, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-[11px] text-slate-300 truncate">{m.name}</span>
                            <span className="font-mono font-bold text-emerald-400">{m.percent}%</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500">Нет активности</div>
                    )}
                  </div>

                  {/* Top Subagents */}
                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/60 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                      <Bot className="w-3 h-3 text-amber-400" />
                      Топ подагентов
                    </div>
                    {currentBreakdown?.topSubagents && currentBreakdown.topSubagents.length > 0 ? (
                      <div className="space-y-1.5">
                        {currentBreakdown.topSubagents.map((sub, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-[11px] text-slate-300 truncate">{sub.name}</span>
                            <span className="font-mono font-bold text-amber-400">{sub.percent}%</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500">Нет активности</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MODELS & TOKENS FROM STATS CACHE */}
          {activeTab === 'models' && (
            <div className="space-y-4">
              {/* Summary Stats Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div className="text-xs text-slate-400">Всего сессий</div>
                  <div className="text-lg font-bold text-white font-mono mt-0.5">
                    {usageData?.totalSessions ?? '—'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div className="text-xs text-slate-400">Всего сообщений</div>
                  <div className="text-lg font-bold text-white font-mono mt-0.5">
                    {usageData?.totalMessages?.toLocaleString() ?? '—'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 col-span-2">
                  <div className="text-xs text-slate-400">Обновлено</div>
                  <div className="text-xs font-mono text-slate-300 mt-1">
                    {usageData?.updatedAt ? new Date(usageData.updatedAt).toLocaleString() : '—'}
                  </div>
                </div>
              </div>

              {/* Models Breakdown */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  Расход токенов по моделям Claude
                </h4>

                {usageData?.modelUsage && Object.keys(usageData.modelUsage).length > 0 ? (
                  <div className="space-y-2.5">
                    {Object.entries(usageData.modelUsage).map(([modelName, stats]) => (
                      <div
                        key={modelName}
                        className="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-white">{modelName}</span>
                          <span className="text-[11px] font-mono text-amber-300">
                            Выход: {formatTokens(stats.outputTokens)} токенов
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                          <div className="p-2 rounded bg-slate-950/70 border border-slate-800/50">
                            <span className="text-slate-400 block text-[10px]">Входные токены</span>
                            <span className="text-slate-200">{formatTokens(stats.inputTokens)}</span>
                          </div>
                          <div className="p-2 rounded bg-slate-950/70 border border-slate-800/50">
                            <span className="text-slate-400 block text-[10px]">Кэш (Чтение)</span>
                            <span className="text-emerald-300">{formatTokens(stats.cacheReadInputTokens)}</span>
                          </div>
                          <div className="p-2 rounded bg-slate-950/70 border border-slate-800/50">
                            <span className="text-slate-400 block text-[10px]">Кэш (Создание)</span>
                            <span className="text-indigo-300">{formatTokens(stats.cacheCreationInputTokens)}</span>
                          </div>
                          <div className="p-2 rounded bg-slate-950/70 border border-slate-800/50">
                            <span className="text-slate-400 block text-[10px]">Экономия кэша</span>
                            <span className="text-teal-300">
                              {stats.cacheReadInputTokens > 0 ? '90%+' : '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 py-4 text-center">
                    Нет подробной статистики моделей в локальном stats-cache.json.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: RAW CLI TEXT */}
          {activeTab === 'raw' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Прямой вывод команды <code>claude -p /usage</code>:</span>
              </div>
              <pre className="p-4 rounded-xl bg-black/90 border border-slate-800 text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-[50vh]">
                {usageData?.rawText || 'Нет данных'}
              </pre>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800/80 bg-[#121522] flex items-center justify-between text-xs">
          <div className="text-slate-500 text-[11px] flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {t.claudeUsage.syncedWithCli}
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold transition"
          >
            {t.claudeUsage.close}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
