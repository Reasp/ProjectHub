import React, { useEffect, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ProjectWorkspace } from './components/projects/ProjectWorkspace';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { OmniSearchModal } from './components/search/OmniSearchModal';
import { useProjectStore } from './store/useProjectStore';

export const App: React.FC = () => {
  const { fetchProjects } = useProjectStore();
  const [isOmniSearchOpen, setIsOmniSearchOpen] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Global Ctrl + K / Cmd + K Shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOmniSearchOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
    </div>
  );
};


