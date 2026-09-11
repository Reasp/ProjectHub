import React from 'react';
import {
  Code,
  Terminal,
  FolderOpen,
  GitBranch,
  CircleDot,
  TerminalSquare,
  Sparkles,
  Play,
  Square,
  RefreshCw,
  HelpCircle,
  Bot,
  Globe,
  PanelLeft,
  PanelLeftOpen,
  PanelLeftClose,
  FolderGit2
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { ActionRunnerBar } from '../actions/ActionRunnerBar';
import { McpServerStatusBadge } from '../mcp/McpServerStatusBadge';
import { DiagnosticsBadge } from '../diagnostics/DiagnosticsBadge';
import { RemoteControlBadge } from '../remote/RemoteControlBadge';
import { VoiceControlHeader } from '../voice/VoiceControlHeader';
import { ClaudeUsageButton } from '../ai/ClaudeUsageButton';
import { VoiceBadge } from '../voice/VoiceBadge';
import { HitlBadge } from '../hitl/HitlBadge';

export const Header: React.FC = () => {
  const { language, setLanguage, t } = useTranslation();
  const {
    selectedProject,
    isSidebarOpen,
    toggleSidebar,
    isTerminalOpen,
    setTerminalOpen,
    toggleTerminal,
    setHotkeysHelpOpen,
    startProcessAction,
    stopProcessAction,
    createPtySessionAction,
    ptySessions,
    setActivePtySessionId,
    setTerminalMode,
    setActiveTab,
    projectAgentStatuses,
    worktrees
  } = useProjectStore();

  if (!selectedProject) {
    return (
      <header className="h-14 border-b border-slate-800/80 px-4 flex items-center justify-between bg-[#12151f]/80">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleSidebar}
            className={`p-1.5 rounded-lg border transition flex items-center gap-1.5 ${
              !isSidebarOpen
                ? 'bg-indigo-600/25 border-indigo-500/50 text-indigo-300 hover:bg-indigo-600/35 hover:text-white shadow-sm'
                : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title={isSidebarOpen ? t.sidebar.hideSidebar : t.sidebar.showSidebar}
          >
            {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4 text-indigo-400" />}
            {!isSidebarOpen && <span className="text-xs font-semibold pr-1">{t.sidebar.title}</span>}
            <VoiceBadge command={isSidebarOpen ? t.sidebar.hideMenuCommand : t.sidebar.showMenuCommand} />
          </button>
          <span className="text-xs text-slate-500">{t.header.selectProjectHint}</span>
        </div>
        <div className="flex items-center gap-2">
          <HitlBadge />
          <RemoteControlBadge />
          <McpServerStatusBadge />
          <DiagnosticsBadge />
          <VoiceControlHeader />
          <ClaudeUsageButton />
          {/* Language Switcher */}
          <div className="flex items-center gap-1 bg-[#181c2b] p-1 rounded-lg border border-slate-800 text-xs">
          <Globe className="w-3.5 h-3.5 text-indigo-400 mx-1" />
          <button
            onClick={() => setLanguage('en')}
            className={`px-2 py-0.5 rounded font-semibold transition ${
              language === 'en'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            EN
          </button>
          <button
            onClick={() => setLanguage('ru')}
            className={`px-2 py-0.5 rounded font-semibold transition ${
              language === 'ru'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            RU
          </button>
          </div>
        </div>
      </header>
    );
  }

  const agentStatus = projectAgentStatuses[selectedProject.path];

  const handleOpenCode = () => {
    if (window.api && selectedProject) {
      window.api.openInCode(selectedProject.path);
    }
  };

  const handleOpenTerminal = () => {
    if (window.api && selectedProject) {
      window.api.openTerminal(selectedProject.path);
    }
  };

  const handleOpenExplorer = () => {
    if (window.api && selectedProject) {
      window.api.openInExplorer(selectedProject.path);
    }
  };

  return (
    <header className="h-14 border-b border-slate-800/80 px-4 flex items-center justify-between bg-[#12151f]/80 backdrop-blur-md shrink-0 flex-nowrap overflow-hidden">
      {/* Left: Sidebar toggle, Project title & Git info */}
      <div className="flex items-center gap-3 min-w-0 flex-1 mr-3 overflow-hidden">
        <button
          type="button"
          onClick={toggleSidebar}
          className={`p-1.5 rounded-lg border transition flex items-center gap-1.5 shrink-0 ${
            !isSidebarOpen
              ? 'bg-indigo-600/25 border-indigo-500/50 text-indigo-300 hover:bg-indigo-600/35 hover:text-white shadow-sm'
              : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
          title={isSidebarOpen ? t.sidebar.hideSidebar : t.sidebar.showSidebar}
        >
          {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4 text-indigo-400" />}
          {!isSidebarOpen && <span className="text-xs font-semibold pr-1 hidden md:inline">{t.sidebar.title}</span>}
          <VoiceBadge command={isSidebarOpen ? t.sidebar.hideMenuCommand : t.sidebar.showMenuCommand} />
        </button>

        <div className="min-w-0 truncate">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white tracking-tight flex items-center gap-2 truncate" title={selectedProject.name}>
              <span className="truncate">{selectedProject.name}</span>
              {selectedProject.hasInfraConfig && (
                <span className="text-[10px] text-emerald-400 font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-1 shrink-0 whitespace-nowrap" title={t.header.standardProjectTemplate}>
                  <Sparkles className="w-2.5 h-2.5 shrink-0" /> ProjectTemplate
                </span>
              )}
            </h2>

            {/* Claude Agent Live Badge */}
            {agentStatus && agentStatus.status !== 'idle' && (
              <div className="shrink-0">
                {agentStatus.status === 'waiting_approval' ? (
                  <button
                    onClick={() => setActiveTab('ai')}
                    className="text-[11px] text-amber-300 font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center gap-1.5 shrink-0 animate-pulse hover:bg-amber-500/30 transition shadow-sm"
                    title={t.header.requiresDecisionTooltip}
                  >
                    <span className="text-amber-400 font-bold">⚠️</span>
                    <span>{t.header.requiresDecision}</span>
                  </button>
                ) : agentStatus.status === 'running' ? (
                  <button
                    onClick={() => setActiveTab('ai')}
                    className="text-[11px] text-indigo-300 font-medium px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 flex items-center gap-1.5 shrink-0 hover:bg-indigo-500/25 transition"
                    title={t.header.claudeExecutingTooltip}
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    <span className="font-bold text-amber-400">✳</span>
                    <span className="truncate max-w-[140px]">{agentStatus.lastMessage || t.header.working}</span>
                  </button>
                ) : null}
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-400 font-mono truncate max-w-md" title={selectedProject.path}>
            {selectedProject.path}
          </p>
        </div>

        {selectedProject.hasGit && selectedProject.gitBranch && (
          <div className="flex items-center gap-2 pl-3 border-l border-slate-800 shrink-0 whitespace-nowrap">
            <span className="flex items-center gap-1.5 text-xs text-slate-300 font-mono px-2 py-1 rounded bg-[#181c2b] border border-slate-800 whitespace-nowrap" title={t.header.currentGitBranch.replace('{branch}', selectedProject.gitBranch)}>
              <GitBranch className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              {selectedProject.gitBranch}
            </span>

            {selectedProject.uncommittedCount !== undefined && (
              <span
                className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded border font-mono whitespace-nowrap ${
                  selectedProject.uncommittedCount === 0
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                    : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                }`}
                title={
                  selectedProject.uncommittedCount === 0
                    ? t.git.cleanWorkingTree
                    : `${t.git.unstagedCount.replace('{count}', String(selectedProject.uncommittedCount))}`
                }
              >
                <CircleDot className="w-2.5 h-2.5 shrink-0" />
                {selectedProject.uncommittedCount === 0 ? 'clean' : `${selectedProject.uncommittedCount} dirty`}
              </span>
            )}

            <button
              type="button"
              onClick={() => setActiveTab('git')}
              title={t.header.worktreeCountTooltip.replace('{count}', String(worktrees.length))}
              className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded border font-mono whitespace-nowrap transition ${
                worktrees.filter((w) => !w.isMain).length > 0
                  ? 'text-cyan-300 bg-cyan-950/40 border-cyan-600/50 hover:bg-cyan-900/50 shadow-sm'
                  : 'text-slate-400 bg-[#181c2b] border-slate-800 hover:text-slate-200'
              }`}
            >
              <FolderGit2 className="w-3 h-3 text-cyan-400 shrink-0" />
              <span>WT: {worktrees.filter((w) => !w.isMain).length}</span>
            </button>
          </div>
        )}
      </div>

      {/* Right: Action Runner & System Controls */}
      <div className="flex items-center gap-2 shrink-0 flex-nowrap">
        {/* Configurable Action Runner (Run, Deploy, Test, Settings) */}
        <ActionRunnerBar />

        <div className="w-px h-6 bg-slate-800 mx-0.5 shrink-0" />

        <div className="w-px h-6 bg-slate-800 mx-1 shrink-0" />

        <button
          onClick={handleOpenCode}
          title={t.header.vsCode}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700/60 transition whitespace-nowrap shrink-0"
        >
          <Code className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="hidden xl:inline">{t.header.vsCode}</span>
          <VoiceBadge command={t.voice.voiceBadges.code} />
        </button>

        <button
          onClick={handleOpenExplorer}
          title={t.header.folder}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700/60 transition whitespace-nowrap shrink-0"
        >
          <FolderOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="hidden xl:inline">{t.header.folder}</span>
          <VoiceBadge command={t.voice.voiceBadges.folder} />
        </button>

        <div className="w-px h-6 bg-slate-800 mx-1 shrink-0" />

        <button
          onClick={toggleTerminal}
          title={t.header.console}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition whitespace-nowrap shrink-0 ${
            isTerminalOpen
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/20'
              : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700/60'
          }`}
        >
          <TerminalSquare className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden lg:inline">{t.header.console}</span>
          <VoiceBadge command={t.voice.voiceBadges.terminal} />
        </button>

        {/* Единый HITL-контур: ожидающие решения всех сессий (TASK-57) */}
        <HitlBadge />

        {/* Remote Control Status Badge (TASK-51) */}
        <RemoteControlBadge />

        {/* MCP Remote Control Status Badge */}
        <McpServerStatusBadge />

        {/* Диагностика: версия, автообновление, сбор логов (TASK-58) */}
        <DiagnosticsBadge />

        {/* Global Voice Control Header Bar */}
        <VoiceControlHeader />

        {/* Claude Code Usage & Limits Inspection Button */}
        <ClaudeUsageButton />

        {/* Language Switcher */}
        <div className="flex items-center gap-0.5 bg-[#181c2b] p-0.5 rounded-lg border border-slate-800 text-xs shrink-0">
          <Globe className="w-3.5 h-3.5 text-indigo-400 mx-1" />
          <button
            onClick={() => setLanguage('en')}
            title="English language"
            className={`px-2 py-1 rounded text-[11px] font-semibold transition ${
              language === 'en'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            EN
          </button>
          <button
            onClick={() => setLanguage('ru')}
            title={t.header.ruLanguageTooltip}
            className={`px-2 py-1 rounded text-[11px] font-semibold transition ${
              language === 'ru'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            RU
          </button>
        </div>

        <div className="relative inline-flex items-center shrink-0">
          <button
            onClick={() => setHotkeysHelpOpen(true)}
            title={t.header.hotkeysHelp}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700/60 transition"
          >
            <HelpCircle className="w-3.5 h-3.5 shrink-0" />
          </button>
          <VoiceBadge command={t.voice.voiceBadges.help} position="bottom" />
        </div>
      </div>
    </header>
  );
};

