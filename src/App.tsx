import React, { useEffect, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ProjectTabsBar } from './components/layout/ProjectTabsBar';
import { ProjectWorkspace } from './components/projects/ProjectWorkspace';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { OmniSearchModal } from './components/search/OmniSearchModal';
import { HotkeysHelpModal } from './components/layout/HotkeysHelpModal';
import { VoiceControlWidget } from './components/voice/VoiceControlWidget';
import { useProjectStore } from './store/useProjectStore';
import { useAIStudioStore } from './store/useAIStudioStore';
import { Bot } from 'lucide-react';

export const App: React.FC = () => {
  const {
    projects,
    fetchProjects,
    selectedProject,
    selectProject,
    activeTab,
    setActiveTab,
    toggleTerminal,
    isHotkeysHelpOpen,
    setHotkeysHelpOpen,
    loadProjectData,
    refreshSingleProject
  } = useProjectStore();

  const [isOmniSearchOpen, setIsOmniSearchOpen] = useState(false);
  const [remoteActionToast, setRemoteActionToast] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Sync state with built-in MCP server
  useEffect(() => {
    if (window.api?.setMcpAppState) {
      window.api.setMcpAppState({
        activeProject: selectedProject ? { name: selectedProject.name, path: selectedProject.path } : null,
        activeTab
      });
    }
  }, [selectedProject, activeTab]);

  // Handle remote actions from external MCP clients (Claude Code, Cursor, Antigravity)
  useEffect(() => {
    if (!window.api?.onRemoteAction) return;

    const unsub = window.api.onRemoteAction((action) => {
      console.log('[App] Remote MCP Action received:', action);

      if (action.type === 'switch_project') {
        const query = (action.payload?.query || '').toLowerCase().trim();
        if (query && projects.length > 0) {
          const matched = projects.find((p) => {
            const pName = p.name.toLowerCase();
            const pPath = p.path.toLowerCase();
            return pName === query || pPath === query || pName.includes(query) || pPath.includes(query);
          });
          if (matched) {
            selectProject(matched);
            showRemoteToast(`Внешний агент открыл проект «${matched.name}»`);
          }
        }
      } else if (action.type === 'switch_tab') {
        const tab = action.payload?.tab;
        if (tab) {
          setActiveTab(tab);
          showRemoteToast(`Внешний агент переключил вкладку на «${tab}»`);
        }
      } else if (action.type === 'send_studio_prompt') {
        const { prompt, sendImmediately } = action.payload || {};
        if (prompt && selectedProject) {
          setActiveTab('ai');
          showRemoteToast(`Внешний агент передал промпт в Claude Studio`);
          if (sendImmediately) {
            useAIStudioStore.getState().sendMessage(selectedProject.path, prompt);
          }
        }
      } else if (action.type === 'approve_action') {
        const { requestId, approved, reason } = action.payload || {};
        if (selectedProject) {
          const list = useAIStudioStore.getState().pendingApprovals[selectedProject.path] || [];
          const top = requestId ? list.find((a) => a.id === requestId) : list[0];
          if (top) {
            useAIStudioStore.getState().sendApprovalResponse(selectedProject.path, top.id, approved, reason);
            showRemoteToast(`Внешний агент ${approved ? 'одобрил' : 'отклонил'} действие`);
          }
        }
      }
    });

    return unsub;
  }, [projects, selectedProject, selectProject, setActiveTab]);

  const showRemoteToast = (msg: string) => {
    setRemoteActionToast(msg);
    setTimeout(() => setRemoteActionToast(null), 4000);
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable;

      // 1. Help modal with '?' or F1 (when not typing in an input)
      if (!isInput && (e.key === '?' || e.key === 'F1')) {
        e.preventDefault();
        setHotkeysHelpOpen(true);
        return;
      }

      // 2. Escape: close modals
      if (e.key === 'Escape') {
        if (isHotkeysHelpOpen) {
          setHotkeysHelpOpen(false);
          return;
        }
        if (isOmniSearchOpen) {
          setIsOmniSearchOpen(false);
          return;
        }
      }

      // 3. Ctrl / Cmd Hotkeys
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();

        // Ctrl + K: Search
        if (key === 'k') {
          e.preventDefault();
          setIsOmniSearchOpen((prev) => !prev);
        }
        // Ctrl + \ or Ctrl + `: Toggle Terminal
        else if (key === '\\' || key === '`') {
          e.preventDefault();
          toggleTerminal();
        }
        // Navigation: Ctrl + B, Ctrl + M, Ctrl + G, Ctrl + P, Ctrl + D
        else if (key === 'b') {
          e.preventDefault();
          setActiveTab('kanban');
        } else if (key === 'm') {
          e.preventDefault();
          setActiveTab('milestones');
        } else if (key === 'g') {
          e.preventDefault();
          setActiveTab('git');
        } else if (key === 'e') {
          e.preventDefault();
          setActiveTab('files');
        } else if (key === 'p' && !e.shiftKey) {
          e.preventDefault();
          setActiveTab('prs');
        } else if (key === 'd') {
          e.preventDefault();
          setActiveTab('docs');
        } else if (key === 'a') {
          e.preventDefault();
          setActiveTab('analytics');
        } else if (key === 'i') {
          e.preventDefault();
          setActiveTab('ai');
        } else if (key === 't' && !e.shiftKey) {
          e.preventDefault();
          setActiveTab('claude-cli');
        }
        // Ctrl + R: Refresh project
        else if (key === 'r') {
          if (selectedProject) {
            e.preventDefault();
            loadProjectData(selectedProject);
            refreshSingleProject(selectedProject.path);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isHotkeysHelpOpen,
    isOmniSearchOpen,
    selectedProject,
    setActiveTab,
    toggleTerminal,
    setHotkeysHelpOpen,
    loadProjectData,
    refreshSingleProject
  ]);

  return (
    <div className="flex h-screen w-screen bg-[#0f1117] text-slate-100 overflow-hidden font-sans">
      {/* Left Sidebar */}
      <Sidebar />

      {/* Main App Layout */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header */}
        <Header />

        {/* Active Projects Session Tabs Bar */}
        <ProjectTabsBar />

        {/* Workspace Area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <ProjectWorkspace />
        </div>

        {/* Bottom Interactive Terminal & Process Drawer */}
        <TerminalPanel />
      </div>

      {/* Global Omni-search Modal (Ctrl + K) */}
      <OmniSearchModal
        isOpen={isOmniSearchOpen}
        onClose={() => setIsOmniSearchOpen(false)}
      />

      {/* Hotkeys Help Modal (?) */}
      <HotkeysHelpModal
        isOpen={isHotkeysHelpOpen}
        onClose={() => setHotkeysHelpOpen(false)}
      />

      {/* Global Voice Control Widget (STT/TTS) */}
      <VoiceControlWidget />

      {/* Remote MCP Action Toast Notification */}
      {remoteActionToast && (
        <div className="fixed top-16 right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-indigo-950/95 border border-indigo-500/60 shadow-2xl text-xs text-white backdrop-blur-md animate-in slide-in-from-top-3 duration-200">
          <Bot className="w-4 h-4 text-indigo-400 shrink-0 animate-pulse" />
          <span className="font-medium">{remoteActionToast}</span>
        </div>
      )}
    </div>
  );
};
