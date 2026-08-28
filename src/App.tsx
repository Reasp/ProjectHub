import React, { useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ProjectWorkspace } from './components/projects/ProjectWorkspace';
import { ProcessTerminal } from './components/terminal/ProcessTerminal';
import { useProjectStore } from './store/useProjectStore';

export const App: React.FC = () => {
  const { fetchProjects } = useProjectStore();

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

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

        {/* Bottom Process / Terminal Drawer */}
        <ProcessTerminal />
      </div>
    </div>
  );
};
