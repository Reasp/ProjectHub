import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Radio,
  Zap,
  CheckCircle2,
  AlertTriangle,
  X
} from 'lucide-react';
import {
  voiceService,
  type VoiceState
} from '../../services/voiceService';
import { parseVoiceCommand } from '../../services/voiceCommandParser';
import { useProjectStore } from '../../store/useProjectStore';
import { useAIStudioStore } from '../../store/useAIStudioStore';
import { getDictionary } from '../../i18n';

export const VoiceControlWidget: React.FC = () => {
  // Единственное значение стора, на которое компонент подписан реактивно:
  // язык нужен для синхронизации с voiceService. Всё остальное (проекты, сессии,
  // approvals, процессы) читается через getState() в момент выполнения команды,
  // чтобы стриминговые обновления sessions не перерисовывали виджет и не
  // пересоздавали подписки на voiceService.
  const language = useProjectStore((s) => s.language);

  const [voiceState, setVoiceState] = useState<VoiceState>(voiceService.currentState);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [isSpeakingDetected, setIsSpeakingDetected] = useState<boolean>(false);
  const [transcript, setTranscript] = useState('');
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const transcriptRef = useRef(transcript);
  const audioLevelRef = useRef(audioLevel);
  const lastAudioSyncRef = useRef<number>(0);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  // Таймеры, которые должны быть отменены при размонтировании компонента
  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }, []);

  // Язык voiceService синхронизируется только при фактическом изменении language
  useEffect(() => {
    voiceService.setLanguage(language === 'ru' ? 'ru' : 'en');
  }, [language]);

  const executeCommand = useCallback(async (rawText: string) => {
    const {
      projects,
      selectedProject,
      selectProject,
      activeProjectPaths,
      switchToNextProject,
      switchToPrevProject,
      switchToLastActiveProject,
      closeCurrentProject,
      setActiveTab,
      toggleTerminal,
      toggleSidebar,
      setSidebarOpen,
      setHotkeysHelpOpen,
      loadProjectData,
      refreshSingleProject,
      startProcessAction,
      stopProcessAction,
      processes,
      tasks,
      language
    } = useProjectStore.getState();

    const {
      sessions,
      createSession,
      switchSession,
      switchToNextSession,
      switchToPrevSession,
      switchToLastActiveSession,
      closeCurrentSession,
      sendMessage,
      pendingApprovals,
      sendApprovalResponse
    } = useAIStudioStore.getState();

    const cmd = parseVoiceCommand(rawText, voiceService.getCommandPhrases());
    setLastFeedback(cmd.feedbackText);

    // No voiceService.speak(...) here — all routine action feedback is purely visual
    // (TTS is reserved strictly for reading tasks or documents on explicit demand)

    // ─────────────────────────────────────────────────────────────
    // 1. AI CONTROL (Studio Tabs, Sessions, Prompts, Approvals)
    // ─────────────────────────────────────────────────────────────
    if (cmd.type === 'ai_control') {
      const projectPath = selectedProject?.path;

      // A. Create new Chat / Session: «новый чат», «создай чат»
      if ((cmd.intent === 'create_ai_session' || cmd.intent === 'new_ai_session') && projectPath) {
        setActiveTab('ai');
        createSession(projectPath);
        const feedback = language === 'ru' ? 'Создан новый чат' : 'Created new chat session';
        setLastFeedback(feedback);
        return;
      }

      // B. Close Current Chat / Session: «закрой чат», «закрой сессию»
      else if (cmd.intent === 'close_ai_session' && projectPath) {
        setActiveTab('ai');
        closeCurrentSession(projectPath);
        const feedback = language === 'ru' ? 'Чат закрыт' : 'Chat session closed';
        setLastFeedback(feedback);
        return;
      }

      // C. Cyclic Chat Navigation: «следующий чат», «предыдущий чат», «прошлый чат / назад»
      else if (cmd.intent === 'switch_session_next' && projectPath) {
        setActiveTab('ai');
        switchToNextSession(projectPath);
        return;
      }

      else if (cmd.intent === 'switch_session_prev' && projectPath) {
        setActiveTab('ai');
        switchToPrevSession(projectPath);
        return;
      }

      else if (cmd.intent === 'switch_session_last' && projectPath) {
        setActiveTab('ai');
        switchToLastActiveSession(projectPath);
        return;
      }

      // D. Switch Studio Session by index (1..N or last): «чат 1», «сессия 2», «первый чат»
      else if ((cmd.intent === 'switch_session_index' || cmd.intent === 'switch_ai_session') && projectPath) {
        setActiveTab('ai');
        let idx = cmd.payload?.sessionIndex ?? 0;
        const projectSessions = sessions[projectPath] || [];
        if (idx === -1) {
          idx = Math.max(0, projectSessions.length - 1);
        }
        if (projectSessions[idx]) {
          switchSession(projectPath, projectSessions[idx].id);
          const feedback = language === 'ru'
            ? `Открыт ${projectSessions[idx].title || `чат ${idx + 1}`}`
            : `Switched to ${projectSessions[idx].title || `chat ${idx + 1}`}`;
          setLastFeedback(feedback);
        }
        return;
      }

      // E. Search & Switch Studio Session by Title: «открой чат [X]», «перейди в чат [X]»
      else if (cmd.intent === 'navigate_ai_session' && projectPath) {
        setActiveTab('ai');
        const query = (cmd.payload?.sessionTitle || '').toLowerCase().trim();
        const projectSessions = sessions[projectPath] || [];
        const matched = projectSessions.find((s) => {
          const tName = (s.title || '').toLowerCase();
          return tName === query || tName.includes(query) || query.includes(tName);
        });
        if (matched) {
          switchSession(projectPath, matched.id);
          const feedback = language === 'ru'
            ? `Открыт чат ${matched.title}`
            : `Switched to ${matched.title}`;
          setLastFeedback(feedback);
        }
        return;
      }

      // Open Claude Code Usage & Limits
      else if (cmd.intent === 'show_claude_usage') {
        window.dispatchEvent(new CustomEvent('projecthub:open-claude-usage'));
      }

      // Quick Action Prompts: Next Task, Commit, Deploy
      else if (cmd.intent === 'quick_next_task' && projectPath) {
        setActiveTab('ai');
        const dict = getDictionary(language);
        await sendMessage(projectPath, dict.aiStudio.quickActions.nextTaskPrompt);
        setLastFeedback(language === 'ru' ? 'Запущен промпт «Следующая задача»' : 'Prompt "Next Task" sent');
        return;
      }
      else if (cmd.intent === 'quick_commit' && projectPath) {
        setActiveTab('ai');
        const dict = getDictionary(language);
        await sendMessage(projectPath, dict.aiStudio.quickActions.commitPrompt);
        setLastFeedback(language === 'ru' ? 'Запущен промпт «Комить»' : 'Prompt "Commit" sent');
        return;
      }
      else if (cmd.intent === 'quick_deploy' && projectPath) {
        setActiveTab('ai');
        const dict = getDictionary(language);
        await sendMessage(projectPath, dict.aiStudio.quickActions.deployPrompt);
        setLastFeedback(language === 'ru' ? 'Запущен промпт «Деплой»' : 'Prompt "Deploy" sent');
        return;
      }

      // C. Send / Dictate Prompt
      else if (cmd.intent === 'send_prompt' && projectPath) {
        setActiveTab('ai');
        const promptText = cmd.payload?.text;
        if (promptText) {
          await sendMessage(projectPath, promptText);
        }
      }

      // D. Human-in-the-Loop Approvals (Approve / Reject / Option Select)
      else if (projectPath) {
        const activeApprovals = pendingApprovals[projectPath] || [];
        const topApproval = activeApprovals[0];

        if (cmd.intent === 'agent_approve') {
          if (topApproval) {
            await sendApprovalResponse(projectPath, topApproval.id, true);
          }
        } else if (cmd.intent === 'agent_reject') {
          if (topApproval) {
            await sendApprovalResponse(projectPath, topApproval.id, false);
          }
        } else if (cmd.intent === 'agent_select_option' && topApproval?.questionData) {
          const optIdx = cmd.payload?.optionIndex ?? 0;
          const options = topApproval.questionData.options || [];
          if (options[optIdx]) {
            await sendApprovalResponse(projectPath, topApproval.id, true, options[optIdx].label);
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 2. MULTI-PROJECT VOICE NAVIGATION
    // ─────────────────────────────────────────────────────────────
    // A. Close current tab: «закрой проект», «закрой вкладку»
    else if (cmd.type === 'navigation' && cmd.intent === 'close_current_project') {
      const curName = selectedProject?.name || '';
      closeCurrentProject();
      const feedback = language === 'ru'
        ? (curName ? `Проект «${curName}» закрыт` : 'Проект закрыт')
        : (curName ? `Closed ${curName}` : 'Project closed');
      setLastFeedback(feedback);
      return;
    }

    // B. Switch to next project: «следующий проект»
    else if (cmd.type === 'navigation' && cmd.intent === 'switch_project_next') {
      switchToNextProject();
      return;
    }

    // C. Switch to previous project: «предыдущий проект»
    else if (cmd.type === 'navigation' && cmd.intent === 'switch_project_prev') {
      switchToPrevProject();
      return;
    }

    // D. Switch to last active project: «прошлый проект / назад»
    else if (cmd.type === 'navigation' && cmd.intent === 'switch_project_last') {
      switchToLastActiveProject();
      return;
    }

    // E. Switch to project by index (1..N or last): «проект 1», «вкладка 2», «последний проект»
    else if (cmd.type === 'navigation' && cmd.intent === 'switch_project_index') {
      let idx = cmd.payload?.tabIndex ?? 0;
      const activeProjects = projects.filter((p) => activeProjectPaths.includes(p.path));
      if (idx === -1) {
        idx = Math.max(0, activeProjects.length - 1);
      }
      if (activeProjects[idx]) {
        selectProject(activeProjects[idx]);
        const feedback = language === 'ru'
          ? `Открыт проект ${activeProjects[idx].name}`
          : `Switched to ${activeProjects[idx].name}`;
        setLastFeedback(feedback);
      }
      return;
    }

    // F. Search & Select by Voice Alias or Project Name
    else if (cmd.type === 'navigation' && cmd.intent === 'navigate_project') {
      const query = (cmd.payload?.projectName || '').toLowerCase().trim();
      if (query && projects.length > 0) {
        const activeProjects = projects.filter((p) => activeProjectPaths.includes(p.path));

        // 1) Match by voiceAlias first
        let matched = projects.find(
          (p) => p.voiceAlias && p.voiceAlias.toLowerCase().trim() === query
        );

        // 2) Match by voiceAlias substring
        if (!matched) {
          matched = projects.find(
            (p) => p.voiceAlias && (p.voiceAlias.toLowerCase().includes(query) || query.includes(p.voiceAlias.toLowerCase()))
          );
        }

        // 3) Match among active open tabs first
        if (!matched) {
          matched = activeProjects.find((p) => {
            const pName = p.name.toLowerCase();
            return pName === query || pName.includes(query) || query.includes(pName);
          });
        }

        // 4) Match among all projects
        if (!matched) {
          matched = projects.find((p) => {
            const pName = p.name.toLowerCase();
            const pPath = p.path.toLowerCase();
            return pName === query || pName.includes(query) || query.includes(pName) || pPath.includes(query);
          });
        }

        if (matched) {
          selectProject(matched);
          const feedback = language === 'ru'
            ? `Открыт проект ${matched.name}`
            : `Switched to ${matched.name}`;
          setLastFeedback(feedback);
        }
      }
      return;
    }

    // ─────────────────────────────────────────────────────────────
    // 3. MAIN TAB NAVIGATION
    // ─────────────────────────────────────────────────────────────
    else if (cmd.type === 'navigation') {
      if (cmd.intent === 'toggle_terminal') {
        toggleTerminal();
      } else if (cmd.payload) {
        setActiveTab(cmd.payload);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 4. ACTION RUNNER & QUICK ACTIONS
    // ─────────────────────────────────────────────────────────────
    else if (cmd.type === 'action') {
      if (cmd.intent === 'toggle_pause') {
        voiceService.togglePause();
        return;
      }

      if (cmd.intent === 'stop_reading') {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        return;
      }

      if (cmd.intent === 'read_tasks' && selectedProject) {
        try {
          const projectTasks = tasks.length > 0 ? tasks : (await window.api?.getTasks(selectedProject.path)) || [];
          const activeTasks = projectTasks.filter((t) => t.status === 'In Progress' || t.status === 'To Do');
          if (activeTasks.length === 0) {
            const noTasksMsg = language === 'ru'
              ? 'В текущем проекте нет активных задач'
              : 'No active tasks in current project';
            setLastFeedback(noTasksMsg);
            voiceService.speak(noTasksMsg, language === 'ru' ? 'ru' : 'en');
          } else {
            const listText = activeTasks.slice(0, 5).map((t, i) => `${i + 1}. ${t.title}`).join('. ');
            const summary = language === 'ru'
              ? `Открытых задач ${activeTasks.length}: ${listText}`
              : `Active tasks (${activeTasks.length}): ${listText}`;
            setLastFeedback(summary);
            voiceService.speak(summary, language === 'ru' ? 'ru' : 'en');
          }
        } catch (e) {
          console.error('[Voice] Failed to read tasks:', e);
        }
        return;
      }

      if (cmd.intent === 'read_doc' && selectedProject) {
        const docMsg = language === 'ru'
          ? `Раздел документации проекта ${selectedProject.name}`
          : `Documentation for ${selectedProject.name}`;
        setLastFeedback(docMsg);
        voiceService.speak(docMsg, language === 'ru' ? 'ru' : 'en');
        return;
      }

      if (cmd.intent === 'open_help') {
        setHotkeysHelpOpen(true);
        return;
      } else if (cmd.intent === 'open_search') {
        window.dispatchEvent(new CustomEvent('projecthub:open-search'));
        return;
      } else if (cmd.intent === 'toggle_sidebar') {
        toggleSidebar();
        return;
      } else if (cmd.intent === 'hide_sidebar') {
        setSidebarOpen(false);
        return;
      } else if (cmd.intent === 'show_sidebar') {
        setSidebarOpen(true);
        return;
      }

      if (!selectedProject) return;

      if (cmd.intent === 'open_code') {
        if (window.api) {
          window.api.openInCode(selectedProject.path);
        }
      } else if (cmd.intent === 'open_explorer') {
        if (window.api) {
          window.api.openInExplorer(selectedProject.path);
        }
      } else if (cmd.intent === 'refresh_project') {
        loadProjectData(selectedProject);
        refreshSingleProject(selectedProject.path);
      } else if (cmd.intent === 'run_dev') {
        await startProcessAction('npm run dev', 'dev');
      } else if (cmd.intent === 'stop_dev') {
        const p = processes.find((proc) => proc.status === 'running' && proc.name === 'dev');
        if (p) await stopProcessAction(p.id);
      } else if (cmd.intent === 'run_deploy') {
        await startProcessAction('npm run deploy', 'deploy');
      } else if (cmd.intent === 'run_tests') {
        await startProcessAction('npm test', 'test');
      }
    }

    scheduleTimeout(() => {
      setTranscript('');
      setLastFeedback(null);
    }, 4500);
  }, [scheduleTimeout]);

  // Подписки на voiceService и внешние события создаются один раз при монтировании.
  // executeCommand стабилен (все данные читаются через getState()), поэтому эффект
  // не пересоздаётся при изменении сторов.
  useEffect(() => {
    const syncToOverlay = (partial?: Partial<{ state: string; transcript: string; audioLevel: number }>) => {
      if (window.api?.syncVoiceOverlay) {
        window.api.syncVoiceOverlay({
          isListening: voiceService.isListening,
          isPaused: voiceService.isPausedActive,
          state: partial?.state ?? voiceService.currentState,
          transcript: partial?.transcript ?? transcriptRef.current,
          audioLevel: partial?.audioLevel ?? audioLevelRef.current
        });
      }
    };

    const unsubState = voiceService.onStateChange((state: VoiceState) => {
      setVoiceState(state);
      syncToOverlay({ state });
    });

    const unsubPause = voiceService.onPauseChange(() => {
      syncToOverlay();
    });

    const unsubAudio = voiceService.onAudioLevel((level: number, speaking: boolean) => {
      setAudioLevel(level);
      setIsSpeakingDetected(speaking);
      const now = Date.now();
      // Throttle audio level IPC updates to max once every 120ms
      if (now - lastAudioSyncRef.current >= 120) {
        lastAudioSyncRef.current = now;
        syncToOverlay({ audioLevel: level });
      }
    });

    const unsubResult = voiceService.onResult((text: string, isFinal: boolean) => {
      setTranscript(text);
      syncToOverlay({ transcript: text });

      if (isFinal && text.trim()) {
        void executeCommand(text.trim());
      }
    });

    const unsubError = voiceService.onError((msg: string) => {
      setErrorMessage(msg);
      syncToOverlay();
    });

    const unsubExternal = window.api?.onVoiceExternalControl?.((action: 'toggle-pause' | 'stop') => {
      if (action === 'stop') {
        voiceService.stopListening();
      } else if (action === 'toggle-pause') {
        voiceService.togglePause();
      }
    });

    const unsubDeviceNotice = voiceService.onDeviceNotice((notice) => {
      setLastFeedback(notice.message);
      scheduleTimeout(() => {
        setLastFeedback((prev) => (prev === notice.message ? null : prev));
      }, 5000);
    });

    // Global Hotkey: Ctrl + Shift + V for Talon Voice Hands-Free Toggle
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        voiceService.toggleHandsFree();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    syncToOverlay();

    return () => {
      unsubState();
      unsubPause();
      unsubAudio();
      unsubResult();
      unsubError();
      unsubExternal?.();
      unsubDeviceNotice();
      window.removeEventListener('keydown', handleKeyDown);
      timersRef.current.forEach((id) => clearTimeout(id));
      timersRef.current.clear();
    };
  }, [executeCommand, scheduleTimeout]);
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => setErrorMessage(null), 10000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  const isHandsFreeActive = voiceService.isListening;
  const isSpeech = voiceState === 'speech_detected' || isSpeakingDetected;
  const isTranscribing = voiceState === 'transcribing';

  // Only display the floating Top HUD when speech, transcribing, transcript, or active feedback occurs
  const shouldShowTopHud = isHandsFreeActive && (isSpeech || isTranscribing || Boolean(transcript) || Boolean(lastFeedback));

  return (
    <>
      {/* Voice Error Modal / Notification Banner */}
      {errorMessage && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[9999] pointer-events-auto select-none max-w-lg w-full px-4 animate-in slide-in-from-top-3 fade-in duration-200">
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-[#16131d] border-2 border-rose-500/80 shadow-2xl shadow-rose-950/60 backdrop-blur-xl text-xs text-white">
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5 animate-pulse" />
            </div>
            <div className="flex-1 space-y-1.5">
              <div className="font-bold text-rose-300 text-sm flex items-center justify-between">
                <span>Голосовое управление недоступно</span>
                <button
                  type="button"
                  onClick={() => setErrorMessage(null)}
                  className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  title="Закрыть"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-slate-200 leading-relaxed text-[12px]">
                {errorMessage}
              </p>
              <div className="pt-1 text-[11px] text-indigo-300 bg-indigo-950/40 p-2 rounded-lg border border-indigo-500/30">
                💡 <b>RDP / Удаленный рабочий стол:</b> откройте <code>mstsc.exe</code> → <i>Параметры</i> → <i>Локальные ресурсы</i> → <i>Удаленное аудио</i> → <i>Настройка...</i> → <i>Запись звука: «Записывать с этого компьютера»</i>.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top HUD */}
      {shouldShowTopHud && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none select-none animate-in slide-in-from-top-2 duration-150">
          <div className="flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-slate-900/90 border border-indigo-500/50 shadow-2xl backdrop-blur-xl text-xs text-white">
            {/* Audio Wave Visualizer Bars */}
            <div className="flex items-center gap-0.5 h-3.5 px-1 bg-slate-950/80 rounded-md border border-slate-800 shrink-0">
              <span
                className="w-1 bg-indigo-400 rounded-full transition-all duration-75"
                style={{ height: `${Math.max(3, audioLevel * 14)}px` }}
              />
              <span
                className="w-1 bg-indigo-400 rounded-full transition-all duration-75"
                style={{ height: `${Math.max(4, audioLevel * 18)}px` }}
              />
              <span
                className="w-1 bg-indigo-400 rounded-full transition-all duration-75"
                style={{ height: `${Math.max(3, audioLevel * 12)}px` }}
              />
            </div>

            {/* Status Text & Transcribed Content */}
            <div className="flex items-center gap-1.5 max-w-md truncate font-medium">
              {isTranscribing ? (
                <>
                  <Zap className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                  <span className="text-amber-300">⚡ Whisper инференс...</span>
                </>
              ) : isSpeech ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                  <span className="text-emerald-300 font-semibold">Слушаю речь...</span>
                </>
              ) : lastFeedback ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span className="text-indigo-200">{lastFeedback}</span>
                </>
              ) : transcript ? (
                <>
                  <Radio className="w-3.5 h-3.5 text-indigo-400 animate-pulse shrink-0" />
                  <span className="text-slate-200 truncate">«{transcript}»</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse shrink-0" />
                  <span className="text-slate-300">Talon Voice активен</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
