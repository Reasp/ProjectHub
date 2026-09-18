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
import { parseVoiceCommand, type ParsedVoiceCommand } from '../../services/voiceCommandParser';
import { isFuzzyDictationStop } from '../../services/dictationStopMatch';
import { applyWakeGate, createWakeWindow } from '../../services/wakeWord';
import { summarizeForSpeech } from '../../services/ttsSummary';
import { useProjectStore } from '../../store/useProjectStore';
import { useAIStudioStore } from '../../store/useAIStudioStore';
import { useHitlStore } from '../../store/useHitlStore';
import { getDictionary } from '../../i18n';
import { toExecutableVoiceCommand } from '../../services/voiceClassifiedCommand';
import { useDialog } from '../../hooks/useDialog';
import { useTimers, useToast } from '../../hooks/useTimeoutState';

export const VoiceControlWidget: React.FC = () => {
  const dialog = useDialog();
  // Единственное значение стора, на которое компонент подписан реактивно:
  // язык нужен для синхронизации с voiceService. Всё остальное (проекты, сессии,
  // approvals, процессы) читается через getState() в момент выполнения команды,
  // чтобы стриминговые обновления sessions не перерисовывали виджет и не
  // пересоздавали подписки на voiceService.
  const language = useProjectStore((s) => s.language);
  const t = getDictionary(language);

  const [voiceState, setVoiceState] = useState<VoiceState>(voiceService.currentState);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [isSpeakingDetected, setIsSpeakingDetected] = useState<boolean>(false);
  const [transcript, setTranscript] = useState('');
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);
  // Сообщение об ошибке гаснет само; таймеры компонента снимаются при размонтировании (TASK-50)
  const [errorMessage, showErrorMessage, clearErrorMessage] = useToast<string>(10000);
  const { setTimer } = useTimers();

  const transcriptRef = useRef(transcript);
  /** Оверлей показывает итог последней команды крупно; подписки живут вне рендера, отсюда ref. */
  const feedbackRef = useRef<string | null>(lastFeedback);
  const audioLevelRef = useRef(audioLevel);
  const lastAudioSyncRef = useRef<number>(0);
  /** Окно ожидания команды после ключевого слова (TASK-83). */
  const wakeWindowRef = useRef(createWakeWindow());

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    feedbackRef.current = lastFeedback;
  }, [lastFeedback]);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  // Язык voiceService синхронизируется только при фактическом изменении language
  useEffect(() => {
    voiceService.setLanguage(language === 'ru' ? 'ru' : 'en');
  }, [language]);

  const executeCommand = useCallback(async (cmd: ParsedVoiceCommand) => {
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
      runProjectAction,
      findActionProcess,
      stopProcessAction,
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
        const feedback = t.voice.feedback.chatCreated;
        setLastFeedback(feedback);
        return;
      }

      // B. Close Current Chat / Session: «закрой чат», «закрой сессию»
      else if (cmd.intent === 'close_ai_session' && projectPath) {
        setActiveTab('ai');
        closeCurrentSession(projectPath);
        const feedback = t.voice.feedback.chatClosed;
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
          const chatTitle = projectSessions[idx].title || t.voice.feedback.defaultChatTitle.replace('{n}', String(idx + 1));
          const feedback = t.voice.feedback.chatOpened.replace('{title}', chatTitle);
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
          const feedback = t.voice.feedback.chatOpened.replace('{title}', matched.title);
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
        setLastFeedback(t.voice.feedback.promptNextTask);
        return;
      }
      else if (cmd.intent === 'quick_commit' && projectPath) {
        setActiveTab('ai');
        const dict = getDictionary(language);
        await sendMessage(projectPath, dict.aiStudio.quickActions.commitPrompt);
        setLastFeedback(t.voice.feedback.promptCommit);
        return;
      }
      else if (cmd.intent === 'quick_deploy' && projectPath) {
        setActiveTab('ai');
        const dict = getDictionary(language);
        await sendMessage(projectPath, dict.aiStudio.quickActions.deployPrompt);
        setLastFeedback(t.voice.feedback.promptDeploy);
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

      // D. Human-in-the-Loop: сначала карточка активной сессии AI Studio, затем общая очередь HITL.
      // Второе важно: запросы внешних сессий и `computer_action` от MCP-моста в pendingApprovals
      // AI Studio не попадают вовсе — голосом они раньше были недоступны (TASK-83 п. 3).
      else {
        const studioTop = projectPath ? (pendingApprovals[projectPath] || [])[0] : undefined;
        const hitlTop = useHitlStore.getState().pending[0];

        const decide = async (approved: boolean, text?: string): Promise<boolean> => {
          if (studioTop && projectPath) {
            await sendApprovalResponse(projectPath, studioTop.id, approved, text);
            return true;
          }
          if (hitlTop) {
            await useHitlStore.getState().decide(hitlTop.id, approved, text);
            return true;
          }
          return false;
        };

        if (cmd.intent === 'agent_approve' || cmd.intent === 'agent_reject') {
          const handled = await decide(cmd.intent === 'agent_approve');
          if (!handled) setLastFeedback(t.voice.feedback.hitlNothingPending);
        } else if (cmd.intent === 'agent_select_option') {
          const target = studioTop?.questionData ? studioTop : hitlTop?.questionData ? hitlTop : null;
          const options = target?.questionData?.options || [];
          const optIdx = cmd.payload?.optionIndex ?? 0;
          const picked = optIdx === -1 ? options[options.length - 1] : options[optIdx];
          if (picked) {
            await decide(true, picked.label);
          } else {
            setLastFeedback(t.voice.feedback.hitlNothingPending);
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
      const feedback = curName
        ? t.voice.feedback.projectClosed.replace('{name}', curName)
        : t.voice.feedback.projectClosed.replace(' «{name}»', '').replace(' "{name}"', '');
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
        const feedback = t.voice.feedback.projectOpened.replace('{name}', activeProjects[idx].name);
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
          const feedback = t.voice.feedback.projectOpened.replace('{name}', matched.name);
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
      } else if (cmd.intent === 'toggle_sidebar') {
        // Фразы меню проектов из настроек приходят с типом navigation, регулярки — с action:
        // обрабатываем в обеих ветках, иначе голосовые «меню проектов», «скрой меню» не работали
        toggleSidebar();
      } else if (cmd.intent === 'hide_sidebar') {
        setSidebarOpen(false);
      } else if (cmd.intent === 'show_sidebar') {
        setSidebarOpen(true);
      } else if (cmd.payload) {
        setActiveTab(cmd.payload);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 4. ACTION RUNNER & QUICK ACTIONS
    // ─────────────────────────────────────────────────────────────
    else if (cmd.type === 'action') {
      // Диктовка печатает в чужие окна, поэтому первое включение подтверждается явно (TASK-83 п. 5).
      if (cmd.intent === 'dictation_start') {
        const status = await window.api?.getComputerUseStatus?.().catch(() => null);
        if (!status?.enabled) {
          setLastFeedback(t.voice.feedback.computerUseDisabled);
          return;
        }
        if (!voiceService.getConfig().dictationConfirmed) {
          const confirmed = await dialog.confirm(t.voice.settingsModal.dictationConfirm);
          if (!confirmed) return;
          voiceService.saveConfig({ dictationConfirmed: true });
        }
        voiceService.setDictationActive(true);
        setLastFeedback(t.voice.feedback.dictationOn);
        return;
      }

      if (cmd.intent === 'dictation_stop') {
        voiceService.setDictationActive(false);
        setLastFeedback(t.voice.feedback.dictationOff);
        return;
      }

      if (cmd.intent === 'toggle_pause') {
        voiceService.togglePause();
        return;
      }

      if (cmd.intent === 'stop_reading') {
        // Останавливаем оба движка: системный speechSynthesis и локальный Piper —
        // отмена генерации по jobId плюс очистка очереди воспроизведения (TASK-69)
        void voiceService.stopSpeaking();
        return;
      }

      if (cmd.intent === 'read_tasks' && selectedProject) {
        try {
          const projectTasks = tasks.length > 0 ? tasks : (await window.api?.getTasks(selectedProject.path)) || [];
          const activeTasks = projectTasks.filter((t) => t.status === 'In Progress' || t.status === 'To Do');
          if (activeTasks.length === 0) {
            const noTasksMsg = t.voice.feedback.noActiveTasks;
            setLastFeedback(noTasksMsg);
            voiceService.speak(noTasksMsg, language === 'ru' ? 'ru' : 'en');
          } else {
            const listText = activeTasks.slice(0, 5).map((t, i) => `${i + 1}. ${t.title}`).join('. ');
            const summary = t.voice.feedback.activeTasksList
              .replace('{count}', String(activeTasks.length))
              .replace('{list}', listText);
            setLastFeedback(summary);
            voiceService.speak(summary, language === 'ru' ? 'ru' : 'en');
          }
        } catch (e) {
          console.error('[Voice] Failed to read tasks:', e);
        }
        return;
      }

      if (cmd.intent === 'read_doc' && selectedProject) {
        const docMsg = t.voice.feedback.docsSection.replace('{name}', selectedProject.name);
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
        // Команды берутся из .projecthub.json (actionConfigService), не из хардкода.
        await runProjectAction('run');
      } else if (cmd.intent === 'stop_dev') {
        const p = findActionProcess('run');
        if (p) await stopProcessAction(p.id);
      } else if (cmd.intent === 'run_deploy') {
        const dict = getDictionary(language);
        await runProjectAction('deploy', {
          confirm: (def) =>
            dialog.confirm(
              dict.actions.confirmDeploy
                .replace('{name}', selectedProject.name)
                .replace('{command}', def.command)
            )
        });
      } else if (cmd.intent === 'run_tests') {
        await runProjectAction('test');
      }
    }

    setTimer(() => {
      setTranscript('');
      setLastFeedback(null);
    }, 4500);
  }, [setTimer]);

  /**
   * Путь распознанной фразы до команды (TASK-83).
   *
   * Сначала — ключевое слово: пока оно включено, выполняются только фразы с обращением. Дальше
   * быстрый разбор регулярками, и лишь то, что он не узнал, уходит на разбор настроенной модели.
   * Такой порядок держит привычные команды мгновенными и бесплатными, а модель подключает только
   * к свободной речи.
   */
  const handleTranscript = useCallback(async (rawText: string) => {
    const config = voiceService.getConfig();
    const { language: lang } = useProjectStore.getState();
    const dict = getDictionary(lang);
    const speakLang = lang === 'ru' ? 'ru' : 'en';

    // Режим диктовки: всё услышанное печатается в активное окно, кроме явной команды выхода.
    // Ключевое слово здесь намеренно не применяется — диктуют прозу, а не команды, и требовать
    // обращения перед каждой фразой было бы бессмысленно.
    if (voiceService.isDictationActive) {
      const phrases = voiceService.getCommandPhrases();
      const spoken = parseVoiceCommand(rawText, phrases);
      // Стоп-фраза — единственный выход из диктовки, поэтому узнаём её и с ошибкой распознавания
      // («Коронец диктовки.»), иначе режим не выключится, а фраза напечатается (TASK-98).
      if (spoken.intent === 'dictation_stop' || isFuzzyDictationStop(rawText, phrases)) {
        voiceService.setDictationActive(false);
        setLastFeedback(dict.voice.feedback.dictationOff);
        return;
      }

      const typedResponse = await window.api
        ?.dictateVoiceText?.({
          text: rawText,
          projectPath: useProjectStore.getState().selectedProject?.path || '',
          punctuate: config.dictationPunctuation === true
        })
        .catch(() => null);

      if (!typedResponse?.ok) {
        const reason =
          typedResponse?.error === 'computer_use_disabled'
            ? dict.voice.feedback.computerUseDisabled
            : typedResponse?.error || dict.voice.feedback.computerTaskFailed;
        setLastFeedback(dict.voice.feedback.dictationFailed.replace('{error}', reason));
        return;
      }
      setLastFeedback(dict.voice.feedback.dictationTyped.replace('{text}', typedResponse.typed || rawText));
      return;
    }

    const gate = applyWakeGate(
      rawText,
      {
        enabled: config.wakeWordEnabled === true,
        phrases: config.wakeWordPhrases,
        now: Date.now()
      },
      wakeWindowRef.current
    );

    if (gate.awaitingCommand) {
      setLastFeedback(dict.voice.feedback.wakeWordArmed);
      return;
    }
    if (!gate.accepted || !gate.command) return;

    const parsed = parseVoiceCommand(gate.command, voiceService.getCommandPhrases());
    if (parsed.type !== 'dictation') {
      await executeCommand(parsed);
      return;
    }

    // Регулярки не узнали фразу. Без разрешения пользователя или без доступного IPC остаёмся на
    // прежнем поведении — показываем распознанный текст и ничего не выполняем.
    if (config.llmFallbackEnabled === false || !window.api?.classifyVoiceCommand) {
      await executeCommand(parsed);
      return;
    }

    setLastFeedback(dict.voice.feedback.classifying);

    const { projects, activeProjectPaths, selectedProject } = useProjectStore.getState();
    const { pendingApprovals } = useAIStudioStore.getState();
    const response = await window.api
      .classifyVoiceCommand({
        transcript: gate.command,
        language: speakLang,
        projectNames: projects.filter((p) => activeProjectPaths.includes(p.path)).map((p) => p.name),
        hasPendingApproval: (pendingApprovals[selectedProject?.path || ''] || []).length > 0
      })
      .catch(() => null);

    if (!response?.ok || !response.result) {
      setLastFeedback(dict.voice.feedback.modelUnavailable);
      return;
    }

    const result = response.result;
    if (result.intent === 'unknown') {
      setLastFeedback(dict.voice.feedback.notUnderstood.replace('{text}', gate.command));
      // Модели (и локальная, и облачная) двусмысленную фразу отдают как unknown, а не как интент с
      // низкой уверенностью, поэтому голосовой переспрос нужен и здесь. Только для фраз, обращённых
      // к приложению по ключевому слову: иначе фоновые разговоры вызывали бы озвучку.
      if (config.wakeWordEnabled === true) void voiceService.speak(dict.voice.feedback.confirmIntent, speakLang);
      return;
    }

    // Низкая уверенность — не гадаем, а переспрашиваем голосом (AC #2).
    if (!response.confident) {
      const question = dict.voice.feedback.confirmIntent;
      setLastFeedback(question);
      void voiceService.speak(question, speakLang);
      return;
    }

    // Голос → компьютер (TASK-83 п. 4): задача уходит агенту с инструментами computer_*, а HITL,
    // allowlist и kill-switch остаются на стороне прокси. Итог короткий и озвучивается.
    if (result.type === 'computer') {
      setLastFeedback(dict.voice.feedback.computerTaskRunning);
      const task = typeof result.payload?.task === 'string' ? result.payload.task : gate.command;
      const taskResponse = await window.api
        ?.runVoiceComputerTask?.({
          task,
          projectPath: useProjectStore.getState().selectedProject?.path || ''
        })
        .catch(() => null);

      const spoken =
        taskResponse?.ok && taskResponse.text
          ? summarizeForSpeech(taskResponse.text, { maxChars: 200 })
          : taskResponse?.error === 'computer_use_disabled'
            ? dict.voice.feedback.computerUseDisabled
            : dict.voice.feedback.computerTaskFailed;

      setLastFeedback(spoken);
      void voiceService.speak(spoken, speakLang);
      return;
    }

    const title = dict.voice.settingsModal.commandTitles[result.intent] || result.intent;
    // Ответ модели приводится к форме парсера регулярок: вкладка в payload, меню проектов и
    // диктовка — в ветке действий (иначе распознанная команда ничего не делала).
    await executeCommand(toExecutableVoiceCommand(result, dict.voice.feedback.classified.replace('{command}', title)));
  }, [executeCommand]);

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
          audioLevel: partial?.audioLevel ?? audioLevelRef.current,
          // Диктовку показываем крупно на весь экран, запись по клавише — широкой полосой.
          mode: voiceService.isDictationActive ? 'full' : voiceService.isPushToTalkActive ? 'wide' : 'compact',
          feedback: feedbackRef.current ?? undefined
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
        void handleTranscript(text.trim());
      }
    });

    const unsubError = voiceService.onError((msg: string) => {
      showErrorMessage(msg);
      syncToOverlay();
    });

    const unsubExternal = window.api?.onVoiceExternalControl?.((action: 'toggle-pause' | 'stop') => {
      if (action === 'stop') {
        voiceService.stopListening();
      } else if (action === 'toggle-pause') {
        voiceService.togglePause();
      }
    });

    // Глобальный push-to-talk: клавиша зарегистрирована в main, поэтому работает и при свёрнутом
    // окне — сюда приходят только команды «начать/закончить запись» (TASK-83, AC #1).
    const unsubPushToTalk = window.api?.onPushToTalk?.((event) => {
      if (event.active) {
        void voiceService.beginPushToTalk();
      } else {
        void voiceService.endPushToTalk();
      }
    });

    const unsubPushToTalkState = voiceService.onPushToTalkChange((active) => {
      if (active) {
        setLastFeedback(getDictionary(useProjectStore.getState().language).voice.feedback.pushToTalkRecording);
      }
      syncToOverlay();
    });

    // Вход и выход из диктовки меняют размер оверлея — без пересинхронизации окно осталось бы полосой.
    const unsubDictation = voiceService.onDictationChange(() => syncToOverlay());

    // Озвучка финального ответа агента (TASK-83 п. 3). Стор лишь сообщает, что ответ готов; что
    // именно читать и читать ли вообще — решается здесь, где живут настройки голоса.
    const handleAgentAnswer = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string }>).detail;
      const cfg = voiceService.getConfig();
      if (!cfg.speakAgentAnswers || !cfg.ttsEnabled) return;
      const spoken = summarizeForSpeech(detail?.text || '');
      if (!spoken) return;
      // Предыдущую реплику всегда гасим: два speak() внахлёст подвешивают первый промис.
      void voiceService.stopSpeaking().then(() => voiceService.speak(spoken));
    };
    window.addEventListener('projecthub:agent-answer', handleAgentAnswer);

    // Вопрос агента, вынесенный на подтверждение, проговаривается вслух — ответить можно голосом.
    let lastSpokenHitlId: string | null = null;
    const unsubHitl = useHitlStore.subscribe((state) => {
      const cfg = voiceService.getConfig();
      const top = state.pending[0];
      if (!top) {
        lastSpokenHitlId = null;
        return;
      }
      if (!cfg.speakHitlQuestions || !cfg.ttsEnabled || top.id === lastSpokenHitlId) return;
      lastSpokenHitlId = top.id;
      const dict = getDictionary(useProjectStore.getState().language);
      const title = top.questionData?.title || top.title;
      void voiceService.speak(dict.voice.feedback.hitlSpokenPrefix.replace('{title}', title));
    });

    const unsubDeviceNotice = voiceService.onDeviceNotice((notice) => {
      setLastFeedback(notice.message);
      setTimer(() => {
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
      unsubPushToTalk?.();
      unsubPushToTalkState();
      unsubDictation();
      unsubHitl();
      unsubDeviceNotice();
      window.removeEventListener('projecthub:agent-answer', handleAgentAnswer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleTranscript, setTimer]);

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
                <span>{t.voice.voiceUnavailable}</span>
                <button
                  type="button"
                  onClick={clearErrorMessage}
                  className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  title={t.common.close}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-slate-200 leading-relaxed text-[12px]">
                {errorMessage}
              </p>
              <div
                className="pt-1 text-[11px] text-indigo-300 bg-indigo-950/40 p-2 rounded-lg border border-indigo-500/30"
                dangerouslySetInnerHTML={{ __html: t.voice.rdpHint }}
              />
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
                  <span className="text-amber-300">{t.voice.whisperInferring}</span>
                </>
              ) : isSpeech ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                  <span className="text-emerald-300 font-semibold">{t.voice.listeningSpeech}</span>
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
                  <span className="text-slate-300">{t.voice.talonActive}</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
