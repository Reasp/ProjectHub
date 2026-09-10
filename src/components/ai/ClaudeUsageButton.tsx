import React, { useState, useEffect } from 'react';
import { Gauge } from 'lucide-react';
import { ClaudeUsageModal } from './ClaudeUsageModal';
import { VoiceBadge } from '../voice/VoiceBadge';
import { useTranslation } from '../../i18n/useTranslation';
import type { ClaudeUsageData } from '../../types/electron';

interface ClaudeUsageButtonProps {
  className?: string;
  showText?: boolean;
}

export const ClaudeUsageButton: React.FC<ClaudeUsageButtonProps> = ({
  className = '',
  showText = true
}) => {
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [usage, setUsage] = useState<ClaudeUsageData | null>(null);

  // Без фонового опроса (аудит 3.9): бейдж читает usage один раз при монтировании и после
  // закрытия модалки (там пользователь мог принудительно обновить данные). Сами данные
  // в main берутся из локального stats-cache.json и rate-limit событий CLI, без спауна claude.
  const loadQuickUsage = async () => {
    try {
      if (window.api?.getClaudeUsage) {
        const data = await window.api.getClaudeUsage(false);
        setUsage(data);
      }
    } catch {
      // Бейдж вторичен: ошибка загрузки показывается в модалке
    }
  };

  useEffect(() => {
    loadQuickUsage();

    const handleOpenEvent = () => {
      setIsModalOpen(true);
    };
    window.addEventListener('projecthub:open-claude-usage', handleOpenEvent);
    return () => {
      window.removeEventListener('projecthub:open-claude-usage', handleOpenEvent);
    };
  }, []);

  const handleModalClose = () => {
    setIsModalOpen(false);
    loadQuickUsage();
  };

  const sessionPercent = usage?.sessionLimit?.percent;
  const weeklyPercent = usage?.weeklyLimit?.percent;
  const fablePercent = usage?.fableLimit?.percent;

  const getBadgeStyle = () => {
    const percent = sessionPercent ?? 0;
    if (percent >= 85) {
      return 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse';
    }
    if (percent >= 60) {
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    }
    return 'bg-slate-800/80 text-slate-300 border-slate-700/60 hover:bg-slate-700 hover:text-white';
  };

  const getPercentColor = () => {
    if (sessionPercent === undefined) return 'text-amber-300';
    if (sessionPercent >= 85) return 'text-rose-300';
    if (sessionPercent >= 60) return 'text-amber-300';
    return 'text-emerald-400';
  };

  const getGaugeColor = () => {
    if (sessionPercent === undefined) return 'text-amber-400';
    if (sessionPercent >= 85) return 'text-rose-400';
    if (sessionPercent >= 60) return 'text-amber-400';
    return 'text-emerald-400';
  };

  const getTooltip = () => {
    if (!usage) return t.claudeUsage.modalDesc;
    const sessionLabel = t.claudeUsage.sessionLimit;
    const sessionText = typeof sessionPercent === 'number' ? `${sessionPercent}%` : '—';
    const weeklyLabel = t.claudeUsage.weeklyLimit;
    const weeklyText = typeof weeklyPercent === 'number' ? `${weeklyPercent}%` : '—';
    const parts = [
      `${sessionLabel}: ${sessionText}`,
      `${weeklyLabel}: ${weeklyText}`
    ];
    if (typeof fablePercent === 'number') {
      const fableLabel = t.claudeUsage.fableLimit;
      parts.push(`${fableLabel}: ${fablePercent}%`);
    }
    return `Claude Code Usage (${sessionLabel}: ${sessionText}). ${parts.join(', ')}.`;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        title={getTooltip()}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition shrink-0 ${getBadgeStyle()} ${className}`}
      >
        <Gauge className={`w-3.5 h-3.5 shrink-0 ${getGaugeColor()}`} />
        {showText && <span>Usage</span>}
        {typeof sessionPercent === 'number' && (
          <span className={`font-mono font-bold text-[10px] ${getPercentColor()}`}>
            {sessionPercent}%
          </span>
        )}
        <VoiceBadge command={t.voice.voiceBadges.limits} />
      </button>

      <ClaudeUsageModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
      />
    </>
  );
};
