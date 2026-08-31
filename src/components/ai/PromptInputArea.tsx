import React, { useState, useRef, memo } from 'react';
import { Send, Square, CheckSquare, GitBranch, BookOpen } from 'lucide-react';
import type { BacklogTask, GitRepoDetails } from '../../types/electron';

interface PromptInputAreaProps {
  mode: 'agent' | 'chat' | 'architect';
  isStreaming: boolean;
  tasks: BacklogTask[];
  gitRepoDetails: GitRepoDetails | null;
  onSend: (text: string) => void;
  onAbort: () => void;
}

export const PromptInputArea: React.FC<PromptInputAreaProps> = memo(({
  mode,
  isStreaming,
  tasks,
  gitRepoDetails,
  onSend,
  onAbort
}) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    const textToSend = input;
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
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
      {/* Context Attachment Pills */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
          Прикрепить контекст:
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
          className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#161a29] border border-slate-800 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-[11px] text-slate-300 transition"
        >
          <BookOpen className="w-3 h-3 text-purple-400" />
          @Docs
        </button>
      </div>

      {/* Input Textarea & Send / Stop Button */}
      <div className="flex items-end gap-2 bg-[#171b2a] border border-slate-700/80 rounded-2xl p-2.5 shadow-inner focus-within:border-indigo-500 transition">
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === 'agent'
              ? 'Опишите задачу или изменение в коде (Agent Mode предложит визуальный Diff)...'
              : mode === 'architect'
              ? 'Задайте вопрос по архитектуре, ADR или C4-модели...'
              : 'Задайте вопрос по проекту...'
          }
          className="flex-1 bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none resize-none font-sans px-2 py-1 leading-relaxed max-h-44"
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={onAbort}
            className="p-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-medium shadow-md shadow-rose-600/20 transition flex items-center gap-1 shrink-0 text-xs"
            title="Остановить генерацию"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Стоп</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 transition disabled:opacity-40 disabled:hover:bg-indigo-600 shrink-0"
            title="Отправить запрос (Enter)"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
});
