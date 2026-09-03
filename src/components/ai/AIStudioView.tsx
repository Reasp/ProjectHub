import React, { useState, useEffect, useRef } from 'react';
import {
  BrainCircuit,
  Bot,
  User,
  CheckSquare,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Code2,
  Plus,
  X,
  GitFork,
  Settings,
  Trash2,
  Activity,
  ShieldCheck,
  LogOut,
  Pencil
} from 'lucide-react';
import { useAIStudioStore, type AISession } from '../../store/useAIStudioStore';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { AISettingsModal } from './AISettingsModal';
import { InteractiveApprovalCard } from './InteractiveApprovalCard';
import { SubagentsPanel } from './SubagentsPanel';
import { PromptInputArea } from './PromptInputArea';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';
import { ClaudeUsageButton } from './ClaudeUsageButton';
import { RateLimitWarningBanner } from './RateLimitWarningBanner';
import { AgentStepsAccordion } from './AgentStepsAccordion';
import { LiveActivitySidebar } from './LiveActivitySidebar';
import { MarkdownViewer } from '../common/MarkdownViewer';

export const AIStudioView: React.FC = () => {
  const { t } = useTranslation();
  const { selectedProject, tasks, gitRepoDetails } = useProjectStore();
  const {
    sessions,
    activeSessionId,
    isStreaming,
    config,
    mode,
    isSettingsOpen,
    claudeAuth,
    pendingApprovals,
    subagents,
    rateLimitWarnings,
    projectStatuses,
    liveOutputs,
    isSubagentsPanelOpen,
    isActivitySidebarOpen,
    setIsSubagentsPanelOpen,
    setIsActivitySidebarOpen,
    clearLiveOutput,
    sendApprovalResponse,
    fetchSubagents,
    fetchConfig,
    fetchClaudeAuth,
    startClaudeLogin,
    claudeLogout,
    saveConfig,
    dismissRateLimitWarning,
    setMode,
    setIsSettingsOpen,
    createSession,
    switchSession,
    closeSession,
    renameSession,
    clearSession,
    sendMessage,
    abortStream,
    acceptDiff,
    rejectDiff
  } = useAIStudioStore();

  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const projectPath = selectedProject?.path || '';
  const projectSessions: AISession[] = sessions[projectPath] || [];
  const currentSessionId = activeSessionId[projectPath] || projectSessions[0]?.id;
  const currentSession = projectSessions.find((s) => s.id === currentSessionId) || projectSessions[0];
  const messages = currentSession?.messages || [];
  const projectApprovals = pendingApprovals[projectPath] || [];
  const projectSubagents = subagents[projectPath] || [];
  const projectRateLimitWarning = rateLimitWarnings[projectPath] || null;
  const projectAgentStatus = projectStatuses[projectPath] || null;
  const currentLiveOutput = liveOutputs[projectPath] || '';

  useEffect(() => {
    fetchConfig();
    fetchClaudeAuth();
    if (projectPath) {
      fetchSubagents(projectPath);
    }
  }, [fetchConfig, fetchClaudeAuth, fetchSubagents, projectPath]);

  // Ensure at least one session exists
  useEffect(() => {
    if (projectPath && projectSessions.length === 0) {
      createSession(projectPath);
    }
  }, [projectPath, projectSessions.length, createSession]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming, projectApprovals.length]);

  if (!selectedProject) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-500">
        <Bot className="w-12 h-12 text-slate-700 mb-3" />
        <h3 className="text-sm font-semibold text-slate-300 mb-1">{t.header.noProjectSelected}</h3>
        <p className="text-xs text-slate-500 max-w-sm">{t.header.selectProjectHint}</p>
      </div>
    );
  }

  const toggleThought = (msgId: string) => {
    setExpandedThoughts((prev) => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d0f17] overflow-hidden">
      {/* 1. Multi-Session Tabs Bar (VS Code Extension Style) */}
      <div className="bg-[#12141f] border-b border-slate-800/90 flex items-center justify-between px-2 pt-1.5 shrink-0 select-none relative z-30">
        <div className="flex items-center gap-1 overflow-x-auto max-w-[45%] lg:max-w-[55%] pb-1 scrollbar-none">
          {projectSessions.map((session, idx) => {
            const isActive = session.id === currentSessionId;
            const tabNumber = idx + 1;

            return (
              <div
                key={session.id}
                onClick={() => switchSession(projectPath, session.id)}
                className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-lg border-t-2 text-xs font-medium cursor-pointer transition whitespace-nowrap max-w-xs ${
                  isActive
                    ? 'bg-[#181b2a] border-amber-500 text-slate-100 shadow-sm ring-1 ring-slate-800/40'
                    : 'bg-[#141624]/60 border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#161928]'
                }`}
                title={`${session.title || t.aiStudio.newChat} — Скажите: «Чат ${tabNumber}» или «Сессия ${tabNumber}»`}
              >
                {/* Voice / Tab Order Badge */}
                <span
                  className={`text-[10px] font-mono px-1 py-0.2 rounded border transition ${
                    isActive
                      ? 'bg-amber-500/25 text-amber-200 border-amber-500/50 font-bold'
                      : 'bg-slate-800/80 text-slate-400 border-slate-700/60 group-hover:text-slate-200'
                  }`}
                  title={`Голосовая команда: «Чат ${tabNumber}»`}
                >
                  {tabNumber}
                </span>

                {/* Claude Anthropic Orange Spark Icon */}
                <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                  <span className="text-amber-500 font-bold text-xs">✳</span>
                </div>

                <span
                  className="truncate text-xs font-sans max-w-[120px]"
                  title={session.title}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    const newTitle = window.prompt(t.aiStudio.renamePrompt || 'Название чата / сессии:', session.title);
                    if (newTitle !== null) {
                      renameSession(projectPath, session.id, newTitle);
                    }
                  }}
                >
                  {session.title || t.aiStudio.newChat}
                </span>

                {/* Rename Session Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const newTitle = window.prompt(t.aiStudio.renamePrompt || 'Название чата / сессии:', session.title);
                    if (newTitle !== null) {
                      renameSession(projectPath, session.id, newTitle);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-700/80 text-slate-400 hover:text-amber-300 transition shrink-0"
                  title={t.aiStudio.renameSession || 'Переименовать диалог'}
                >
                  <Pencil className="w-2.5 h-2.5" />
                </button>

                {/* Close Session Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeSession(projectPath, session.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-700/80 text-slate-400 hover:text-white transition shrink-0"
                  title={t.aiStudio.closeSession}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {/* New Session Button (+) */}
          <button
            type="button"
            onClick={() => createSession(projectPath)}
            title={t.aiStudio.newSession}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-amber-500/10 transition text-xs font-medium shrink-0 ml-1"
          >
            <Plus className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] hidden sm:inline">{t.aiStudio.newChat}</span>
          </button>
        </div>

        {/* Studio Controls Header Right */}
        <div className="flex items-center gap-2 pb-1 pr-2">
          {/* Claude.ai Auth Status & Logout Button Group */}
          {claudeAuth?.isLoggedIn ? (
            <div className="flex items-center bg-amber-500/10 border border-amber-500/30 rounded-lg p-0.5 shrink-0">
              <button
                onClick={() => setIsSettingsOpen(true)}
                title={`${t.aiStudio.loggedInAs}: ${claudeAuth.email} (${claudeAuth.seatTier || 'Pro'})`}
                className="flex items-center gap-1.5 px-2 py-1 text-amber-300 hover:text-amber-200 hover:bg-amber-500/15 rounded-md text-[11px] font-medium transition"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="font-bold text-xs text-amber-400">✳</span>
                <span className="max-w-[110px] lg:max-w-[170px] truncate font-sans text-[10px]">
                  {claudeAuth.email}
                </span>
              </button>
              <button
                onClick={async () => {
                  await claudeLogout();
                  await fetchClaudeAuth();
                }}
                title={t.aiStudio.logoutClaudeTitle}
                className="p-1 rounded-md text-slate-400 hover:text-rose-300 hover:bg-rose-500/20 transition ml-0.5"
              >
                <LogOut className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => startClaudeLogin()}
              title={t.aiStudio.loginClaudeTitle}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white text-[11px] font-semibold shadow-md shadow-amber-600/20 border border-amber-400/30 transition shrink-0"
            >
              <span className="font-bold text-xs">✳</span>
              <span>{t.aiStudio.loginClaude}</span>
            </button>
          )}

          {/* Subagents Button */}
          <button
            onClick={() => setIsSubagentsPanelOpen(!isSubagentsPanelOpen)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition ${
              isSubagentsPanelOpen || projectSubagents.some((s) => s.status === 'running')
                ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300 shadow-sm'
                : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200'
            }`}
            title={t.aiStudio.subagentsTitle}
          >
            <GitFork className="w-3 h-3 text-indigo-400" />
            <span className="hidden sm:inline">{t.aiStudio.subagents}</span>
            {projectSubagents.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-500/30 text-indigo-300 font-mono text-[9px]">
                {projectSubagents.length}
              </span>
            )}
          </button>

          {/* Quick Model Selector Dropdown matching official Claude Code UI */}
          <ModelSelectorDropdown
            config={config}
            onSelectModel={(model) => saveConfig({ ...config, model })}
          />

          {/* Claude Code Usage & Limits Inspection Button */}
          <ClaudeUsageButton />

          {/* Auto-Approve Quick Toggle */}
          <button
            type="button"
            onClick={() => saveConfig({ ...config, autoApprove: !config.autoApprove })}
            title={config.autoApprove ? t.aiStudio.autoApproveOn : t.aiStudio.autoApproveOff}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition ${
              config.autoApprove
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 shadow-sm'
                : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className={`w-3.5 h-3.5 ${config.autoApprove ? 'text-emerald-400' : 'text-slate-400'}`} />
            <span className="hidden xl:inline">{t.aiStudio.autoApprove}</span>
            <span
              className={`px-1 py-0.2 rounded text-[9px] font-mono font-bold uppercase ${
                config.autoApprove ? 'bg-emerald-500/30 text-emerald-200' : 'bg-slate-700/80 text-slate-400'
              }`}
            >
              {config.autoApprove ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Mode Switcher */}
          <div className="flex items-center gap-0.5 bg-[#090b10] p-0.5 rounded-lg border border-slate-800 text-[11px]">
            {(['agent', 'chat', 'architect'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition capitalize ${
                  mode === m
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m === 'agent' ? t.aiStudio.input.agentMode : m === 'chat' ? t.aiStudio.input.chatMode : t.aiStudio.input.adrMode}
              </button>
            ))}
          </div>

          <button
            onClick={() => clearSession(projectPath, currentSessionId)}
            title={t.aiStudio.clearSession}
            className="p-1 rounded-lg bg-slate-800/80 hover:bg-rose-950/40 hover:text-rose-300 text-slate-400 border border-slate-700/60 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            title={t.aiStudio.settings}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60 font-medium text-[11px] transition"
          >
            <Settings className="w-3 h-3 text-indigo-400" />
            <span className="hidden md:inline">{t.aiStudio.settings}</span>
          </button>
        </div>
      </div>

      {/* Subagents Panel Drawer */}
      {isSubagentsPanelOpen && (
        <div className="p-3 bg-[#0c0e16] border-b border-slate-800/90 animate-in slide-in-from-top-2 duration-200">
          <SubagentsPanel
            subagents={projectSubagents}
            onClose={() => setIsSubagentsPanelOpen(false)}
          />
        </div>
      )}

      {/* Rate Limit & Quota Warning Banner */}
      {projectRateLimitWarning && (
        <RateLimitWarningBanner
          warning={projectRateLimitWarning}
          config={config}
          onSelectModel={(model) => saveConfig({ ...config, model })}
          onClearSession={() => clearSession(projectPath, currentSessionId)}
          onDismiss={() => dismissRateLimitWarning(projectPath)}
        />
      )}

      {/* 2. Main Content Split: Messages Feed + Live Activity Sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 select-text">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-xl mx-auto space-y-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-indigo-600/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-xl shadow-amber-600/10">
                <span className="text-2xl font-bold text-amber-400">✳</span>
              </div>

              <div className="space-y-2">
                <h3 className="text-base font-semibold text-slate-200">
                  {t.aiStudio.welcomeTitle} — {currentSession?.title || t.aiStudio.newChat}
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {t.aiStudio.welcomeDesc}
                </p>

                {/* Claude.ai Account Status Card */}
                {claudeAuth?.isLoggedIn ? (
                  <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-xs">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                    <span>
                      {t.aiStudio.loggedInAs}: <strong>{claudeAuth.email}</strong> ({claudeAuth.seatTier || 'Pro / Team'})
                    </span>
                    <button
                      onClick={async () => {
                        await claudeLogout();
                        await fetchClaudeAuth();
                      }}
                      title={t.aiStudio.logoutClaudeTitle}
                      className="ml-2 px-2 py-0.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-[10px] font-semibold border border-rose-500/30 transition flex items-center gap-1"
                    >
                      <LogOut className="w-2.5 h-2.5 text-rose-400" />
                      <span>{t.aiStudio.logoutClaude}</span>
                    </button>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 text-left">
                    <div className="text-xs text-amber-200">
                      <p className="font-semibold text-amber-300">{t.aiStudio.useSubscriptionTitle}</p>
                      <p className="text-[11px] text-slate-400">{t.aiStudio.useSubscriptionDesc}</p>
                    </div>
                    <button
                      onClick={() => startClaudeLogin()}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow transition whitespace-nowrap"
                    >
                      {t.aiStudio.loginClaude}
                    </button>
                  </div>
                )}
              </div>

              {/* Quick Prompt Cards */}
              <div className="grid grid-cols-2 gap-2.5 w-full text-left">
                <button
                  onClick={() =>
                    sendMessage(
                      projectPath,
                      'Проанализируй активные задачи в Backlog.md и предложи план реализации следующей задачи.'
                    )
                  }
                  className="p-3 rounded-xl bg-[#131625] border border-slate-800/80 hover:border-indigo-500/50 hover:bg-[#161a2e] transition text-xs text-slate-300 space-y-1 group"
                >
                  <div className="font-semibold text-indigo-300 flex items-center gap-1.5">
                    <CheckSquare className="w-3.5 h-3.5" />
                    {t.aiStudio.promptCards.backlogPlan}
                  </div>
                  <p className="text-[11px] text-slate-500 group-hover:text-slate-400">
                    {t.aiStudio.promptCards.backlogPlanDesc}
                  </p>
                </button>

                <button
                  onClick={() =>
                    sendMessage(
                      projectPath,
                      'Создай архитектурное решение (ADR) для внедрения новой функциональности в этот проект.'
                    )
                  }
                  className="p-3 rounded-xl bg-[#131625] border border-slate-800/80 hover:border-indigo-500/50 hover:bg-[#161a2e] transition text-xs text-slate-300 space-y-1 group"
                >
                  <div className="font-semibold text-purple-300 flex items-center gap-1.5">
                    <BrainCircuit className="w-3.5 h-3.5" />
                    {t.aiStudio.promptCards.adrCreate}
                  </div>
                  <p className="text-[11px] text-slate-500 group-hover:text-slate-400">
                    {t.aiStudio.promptCards.adrCreateDesc}
                  </p>
                </button>

                <button
                  onClick={() =>
                    sendMessage(
                      projectPath,
                      'Проведи аудит кодовой базы и предложи оптимизацию производительности компонентов.'
                    )
                  }
                  className="p-3 rounded-xl bg-[#131625] border border-slate-800/80 hover:border-indigo-500/50 hover:bg-[#161a2e] transition text-xs text-slate-300 space-y-1 group"
                >
                  <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5" />
                    {t.aiStudio.promptCards.auditRefactor}
                  </div>
                  <p className="text-[11px] text-slate-500 group-hover:text-slate-400">
                    {t.aiStudio.promptCards.auditRefactorDesc}
                  </p>
                </button>

                <button
                  onClick={() =>
                    sendMessage(
                      projectPath,
                      'Проверь статус незакоммиченных изменений в Git и сформируй информативное сообщение для коммита.'
                    )
                  }
                  className="p-3 rounded-xl bg-[#131625] border border-slate-800/80 hover:border-indigo-500/50 hover:bg-[#161a2e] transition text-xs text-slate-300 space-y-1 group"
                >
                  <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5" />
                    {t.aiStudio.promptCards.gitCommit}
                  </div>
                  <p className="text-[11px] text-slate-500 group-hover:text-slate-400">
                    {t.aiStudio.promptCards.gitCommitDesc}
                  </p>
                </button>
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const isThoughtOpen = expandedThoughts[msg.id] ?? false;

              return (
                <div
                  key={msg.id}
                  className={`flex gap-3.5 ${isUser ? 'justify-end' : 'justify-start'} animate-in fade-in duration-150`}
                >
                  {/* Assistant Avatar */}
                  {!isUser && (
                    <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5 shadow-md shadow-amber-600/10">
                      <span className="font-bold text-sm text-amber-400">✳</span>
                    </div>
                  )}

                  <div className={`max-w-3xl flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
                    {/* Thinking / Reasoning Accordion */}
                    {msg.thought && (
                      <div className="w-full rounded-xl bg-[#141724] border border-amber-500/20 overflow-hidden text-xs">
                        <button
                          onClick={() => toggleThought(msg.id)}
                          className="w-full px-3.5 py-2 flex items-center justify-between text-amber-300/90 hover:text-amber-200 hover:bg-amber-500/5 transition font-mono text-[11px]"
                        >
                          <span className="flex items-center gap-1.5">
                            <BrainCircuit className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                            {t.aiStudio.thinkingProcess}
                          </span>
                          {isThoughtOpen ? (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                          )}
                        </button>
                        {isThoughtOpen && (
                          <div className="px-4 py-3 bg-[#0d0f17] border-t border-slate-800/80 text-[11px] text-slate-400 font-mono leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto">
                            {msg.thought}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Message Bubble */}
                    <div
                      className={`p-4 rounded-2xl text-xs leading-relaxed ${
                        isUser
                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 rounded-tr-sm'
                          : 'bg-[#151928] text-slate-200 border border-slate-800/80 shadow-md rounded-tl-sm w-full'
                      }`}
                    >
                      {msg.content ? (
                        isUser ? (
                          <div className="whitespace-pre-wrap font-sans">{msg.content}</div>
                        ) : (
                          <MarkdownViewer content={msg.content} emptyMessage={null} className="text-slate-200" />
                        )
                      ) : isStreaming && !msg.thought && (!msg.toolCalls || msg.toolCalls.length === 0) ? (
                        <div className="flex items-center gap-1.5 text-amber-400 py-1 font-mono">
                          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                          {t.aiStudio.generating}
                        </div>
                      ) : null}

                      {/* Collapsible Agent Steps / Tool Calls Accordion (Remark 2) */}
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <AgentStepsAccordion
                          toolCalls={msg.toolCalls}
                          messageId={msg.id}
                          projectPath={projectPath}
                          onAcceptDiff={(mId, tId, fPath, nContent) =>
                            acceptDiff(projectPath, mId, tId, fPath, nContent)
                          }
                          onRejectDiff={(mId, tId) => rejectDiff(projectPath, mId, tId)}
                        />
                      )}
                    </div>

                    <span className="text-[10px] text-slate-500 font-mono px-1">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* User Avatar */}
                  {isUser && (
                    <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 shrink-0 mt-0.5">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Pending Interactive Approval Cards (Queue: One at a time) */}
          {projectApprovals.length > 0 && (
            <InteractiveApprovalCard
              key={projectApprovals[0].id}
              request={projectApprovals[0]}
              queueInfo={{ current: 1, total: projectApprovals.length }}
              onApprove={(customText) =>
                sendApprovalResponse(projectPath, projectApprovals[0].id, true, customText)
              }
              onReject={(customText) =>
                sendApprovalResponse(projectPath, projectApprovals[0].id, false, customText)
              }
            />
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Live Activity Sidebar / Execution Monitor (Remark 3) */}
        <LiveActivitySidebar
          isStreaming={isStreaming}
          activeStatus={projectAgentStatus}
          subagents={projectSubagents}
          liveOutput={currentLiveOutput}
          onClearOutput={() => clearLiveOutput(projectPath)}
          isOpen={isActivitySidebarOpen}
          onToggleOpen={() => setIsActivitySidebarOpen(!isActivitySidebarOpen)}
        />
      </div>

      {/* 3. Isolated Memoized Prompt Input Area (0ms typing lag) */}
      <PromptInputArea
        mode={mode}
        isStreaming={isStreaming}
        tasks={tasks}
        gitRepoDetails={gitRepoDetails}
        onSend={(text) => sendMessage(projectPath, text)}
        onAbort={abortStream}
      />

      {/* Settings Modal */}
      <AISettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
};
