import React, { useState, useRef, useEffect, memo } from 'react';
import { Send, Square, CheckSquare, GitBranch, BookOpen, Mic, Radio, Zap } from 'lucide-react';
import type { BacklogTask, GitRepoDetails } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';
import { voiceService, type VoiceState } from '../../services/voiceService';

interface PromptInputAreaProps {
  mode: 'agent' | 'chat' | 'architect';
  isStreaming: boolean;
  tasks: BacklogTask[];
  gitRepoDetails: GitRepoDetails | null;
  onSend: (text: string) => void;
  onAbort: () => void;
}

export const PromptInputArea: React.FC<PromptInputAreaProps> = memo(({
  isStreaming,
  tasks,
  gitRepoDetails,
  onSend,
  onAbort
}) => {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const unsub = voiceService.onStateChange((st: VoiceState) => {
      setVoiceState(st);
    });

    const origResult = voiceService.onResult;
    voiceService.onResult((text: string, isFinal: boolean) => {
      if (isFinal && text.trim()) {
        // If recording was initiated, append to input
        setInput((prev) => (prev ? `${prev} ${text.trim()}` : text.trim()));
      }
    });

    return () => {
      // Cleanup
    };
  }, []);

  const isHandsFree = voiceService.isListening;
  const isSpeech = voiceState === 'speech_detected';
  const isTranscribing = voiceState === 'transcribing';

  const handleToggleVoiceDictation = () => {
    voiceService.toggleHandsFree();
  };

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    const textToSend = input.trim();
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    if (textToSend.toLowerCase() === '/usage' || textToSend.toLowerCase() === '/cost') {
      window.dispatchEvent(new CustomEvent('projecthub:open-claude-usage'));
      return;
    }

    onSend(textToSend);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInsertContext = (type: 'task' | 'git' | 'docs') => {
    if (type === 'task') {
      const active = tasks.find((tk) => tk.status === 'In Progress') || tasks[0];
      if (active) {
        setInput((prev) => `${prev} @Task(${active.id}: ${active.title}) `);
      } else {
        setInput((prev) => `${prev} @BacklogTasks `);
      }
    } else if (type === 'git') {
      const branch = gitRepoDetails?.currentBranch || 'main';
      const changed = gitRepoDetails?.files.length || 0;
      setInput((prev) => `${prev} @Git(Branch: ${branch}, Changed Files: ${changed}) `);
    } else if (type === 'docs') {
      setInput((prev) => `${prev} @ProjectDocs `);
    }
    textareaRef.current?.focus();
  };

  return (
    <div className="p-4 bg-[#111420] border-t border-slate-800 shrink-0 space-y-2">
      {/* Context Attachment Pills & Voice Indicator */}
      <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
            {t.aiStudio.input.contextTags}:
          </span>
          <button
            type="button"
            onClick={() => handleInsertContext('task')}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#161a29] border border-slate-800 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-[11px] text-slate-300 transition"
          >
            <CheckSquare className="w-3 h-3 text-amber-400" />
            @Task
          </button>
          <button
            type="button"
            onClick={() => handleInsertContext('git')}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#161a29] border border-slate-800 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-[11px] text-slate-300 transition"
          >
            <GitBranch className="w-3 h-3 text-indigo-400" />
            @GitStatus
          </button>
          <button
            type="button"
            onClick={() => handleInsertContext('docs')}
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#161a29] border border-slate-800 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-[11px] text-slate-300 transition"
          >
            <BookOpen className="w-3 h-3 text-purple-400" />
            @Docs
          </button>
        </div>

        {/* Live Audio Status */}
        {isSpeech && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] animate-pulse">
            <Radio className="w-3 h-3 text-emerald-400" />
            <span>Слушаю речь (Talon Voice)...</span>
          </div>
        )}
        {isTranscribing && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[11px] animate-pulse">
            <Zap className="w-3 h-3 text-amber-400 animate-spin" />
            <span>Инференс Whisper...</span>
          </div>
        )}
      </div>

      {/* Input Textarea & Send / Mic / Stop Button */}
      <div className="flex items-end gap-2 bg-[#171b2a] border border-slate-700/80 rounded-2xl p-2.5 shadow-inner focus-within:border-indigo-500 transition">
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-gramm="false"
          data-enable-grammarly="false"
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder={isHandsFree ? 'Talon Voice активен: говорите текст вслух без кнопок...' : t.aiStudio.input.placeholder}
          className="flex-1 bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none resize-none font-sans px-2 py-1 leading-relaxed max-h-44"
        />

        {/* Voice Dictation Button in Prompt Box */}
        <button
          type="button"
          onClick={handleToggleVoiceDictation}
          className={`p-2 rounded-xl transition flex items-center justify-center shrink-0 ${
            isSpeech
              ? 'bg-emerald-600 text-white ring-2 ring-emerald-500/40 animate-pulse'
              : isTranscribing
              ? 'bg-amber-600 text-white animate-bounce'
              : isHandsFree
              ? 'bg-indigo-600 text-white ring-2 ring-indigo-500/40'
              : 'bg-[#121522] border border-slate-700 hover:border-indigo-500/70 text-slate-400 hover:text-indigo-400'
          }`}
          title={isHandsFree ? 'Talon Voice Hands-Free активен (кликните для отключения)' : 'Включить Talon Voice диктовку промпта'}
        >
          <Mic className="w-4 h-4" />
        </button>

        {isStreaming ? (
          <button
            type="button"
            onClick={onAbort}
            className="p-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-medium shadow-md shadow-rose-600/20 transition flex items-center gap-1 shrink-0 text-xs"
            title={t.aiStudio.input.stop}
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>{t.aiStudio.input.stop}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 transition disabled:opacity-40 disabled:hover:bg-indigo-600 shrink-0"
            title={`${t.aiStudio.input.send} (Enter)`}
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
});
