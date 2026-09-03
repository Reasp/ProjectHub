import React, { useState, useEffect } from 'react';
import {
  Radio,
  Zap,
  CheckCircle2
} from 'lucide-react';
import {
  voiceService,
  type VoiceState,
  type VoiceConfig
} from '../../services/voiceService';
import { parseVoiceCommand } from '../../services/voiceCommandParser';
import { useProjectStore } from '../../store/useProjectStore';
import { useAIStudioStore } from '../../store/useAIStudioStore';

export const VoiceControlWidget: React.FC = () => {
  const {
    projects,
    selectedProject,
    selectProject,
    activeTab,
    setActiveTab,
    toggleTerminal,
    startProcessAction,
    stopProcessAction,
    processes,
    language
  } = useProjectStore();

  const {
    sessions,
    activeSessionId,
    createSession,
    switchSession,
    sendMessage,
    pendingApprovals,
    sendApprovalResponse
  } = useAIStudioStore();

  const [voiceState, setVoiceState] = useState<VoiceState>(voiceService.currentState);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [isSpeakingDetected, setIsSpeakingDetected] = useState<boolean>(false);
  const [transcript, setTranscript] = useState('');
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);

  useEffect(() => {
    voiceService.setLanguage(language === 'ru' ? 'ru' : 'en');

    const unsubState = voiceService.onStateChange((state: VoiceState) => {
      setVoiceState(state);
    });

    const unsubAudio = voiceService.onAudioLevel((level: number, speaking: boolean) => {
      setAudioLevel(level);
      setIsSpeakingDetected(speaking);
    });

    const unsubResult = voiceService.onResult((text: string, isFinal: boolean) => {
      setTranscript(text);

      if (isFinal && text.trim()) {
        executeCommand(text.trim());
      }
    });

    // Global Hotkey: Ctrl + Shift + V for Talon Voice Hands-Free Toggle
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        voiceService.toggleHandsFree();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      unsubState();
      unsubAudio();
      unsubResult();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [language, selectedProject, projects, sessions, activeSessionId, pendingApprovals]);

  const executeCommand = async (rawText: string) => {
    const cmd = parseVoiceCommand(rawText);
    setLastFeedback(cmd.feedbackText);

    const config = voiceService.getConfig();
    if (config.ttsEnabled) {
      voiceService.speak(cmd.feedbackText, language === 'ru' ? 'ru' : 'en');
    }

    // ─────────────────────────────────────────────────────────────
    // 1. AI CONTROL (Studio Tabs, Sessions, Prompts, Approvals)
    // ─────────────────────────────────────────────────────────────
    if (cmd.type === 'ai_control') {
      const projectPath = selectedProject?.path;

      // A. Create new AI Session
      if (cmd.intent === 'create_ai_session' && projectPath) {
        setActiveTab('ai');
        createSession(projectPath);
      }

      // B. Switch Studio Tab / Session by index (0, 1, 2...)
      else if (cmd.intent === 'switch_ai_session' && projectPath) {
        setActiveTab('ai');
        const projectSessions = sessions[projectPath] || [];
        const targetIdx = cmd.payload?.sessionIndex ?? 0;
        if (projectSessions[targetIdx]) {
          switchSession(projectPath, projectSessions[targetIdx].id);
        } else if (projectSessions.length > 0) {
          switchSession(projectPath, projectSessions[0].id);
        }
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
    // 2. PROJECT NAVIGATION (Fuzzy Search & Select)
    // ─────────────────────────────────────────────────────────────
    else if (cmd.type === 'navigation' && cmd.intent === 'navigate_project') {
      const query = (cmd.payload?.projectName || '').toLowerCase().trim();
      if (query && projects.length > 0) {
        const matched = projects.find((p) => {
          const pName = p.name.toLowerCase();
          const pPath = p.path.toLowerCase();
          return pName === query || pName.includes(query) || query.includes(pName) || pPath.includes(query);
        });

        if (matched) {
          selectProject(matched);
        }
      }
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
    // 4. ACTION RUNNER
    // ─────────────────────────────────────────────────────────────
    else if (cmd.type === 'action') {
      if (!selectedProject) return;

      if (cmd.intent === 'run_dev') {
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

    setTimeout(() => {
      setTranscript('');
      setLastFeedback(null);
    }, 4500);
  };

  const isHandsFreeActive = voiceService.isListening;
  const isSpeech = voiceState === 'speech_detected' || isSpeakingDetected;
  const isTranscribing = voiceState === 'transcribing';

  // Only display the floating Top HUD when speech, transcribing, transcript, or active feedback occurs
  const shouldShowTopHud = isHandsFreeActive && (isSpeech || isTranscribing || Boolean(transcript) || Boolean(lastFeedback));

  if (!shouldShowTopHud) {
    return null;
  }

  return (
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
  );
};
