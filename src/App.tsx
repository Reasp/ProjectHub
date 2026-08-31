import React, { useEffect, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ProjectWorkspace } from './components/projects/ProjectWorkspace';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { OmniSearchModal } from './components/search/OmniSearchModal';
import { HotkeysHelpModal } from './components/layout/HotkeysHelpModal';
import { useProjectStore } from './store/useProjectStore';

export const App: React.FC = () => {
  const {
    fetchProjects,
    selectedProject,
    setActiveTab,
    toggleTerminal,
    isHotkeysHelpOpen,
    setHotkeysHelpOpen,
    loadProjectData,
    refreshSingleProject
  } = useProjectStore();

  const [isOmniSearchOpen, setIsOmniSearchOpen] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

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
        } else if (key === 'p' && !e.shiftKey) {
          e.preventDefault();
          setActiveTab('prs');
        } else if (key === 'd') {
          e.preventDefault();
          setActiveTab('docs');
        } else if (key === 'a') {
          e.preventDefault();
          setActiveTab('analytics');
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
    <div className="flex h-screen w-screen bg-[#0f1117] text-slate-100 overflow-hidden font-sans select-none">
      {/* Left Sidebar */}
      <Sidebar />

      {/* Main App Layout */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header */}
        <Header />

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
    </div>
  );
};
