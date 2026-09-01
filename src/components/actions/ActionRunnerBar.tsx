import React, { useState, useEffect } from 'react';
import {
  Play,
  Square,
  Rocket,
  FlaskConical,
  Settings,
  Globe,
  RefreshCw,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { ActionConfigModal } from './ActionConfigModal';
import type { ProjectActionConfig } from '../../types/electron';

export const ActionRunnerBar: React.FC = () => {
  const {
    selectedProject,
    processes,
    startProcessAction,
    stopProcessAction,
    setTerminalOpen
  } = useProjectStore();

  const [config, setConfig] = useState<ProjectActionConfig | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [isStartingDeploy, setIsStartingDeploy] = useState(false);
  const [isStartingTest, setIsStartingTest] = useState(false);

  const loadConfig = async () => {
    if (selectedProject && window.api?.getActionConfig) {
      try {
        const cfg = await window.api.getActionConfig(selectedProject.path);
        setConfig(cfg);
      } catch (e) {
        console.error('Failed to load action config:', e);
      }
    }
  };

  useEffect(() => {
    loadConfig();
  }, [selectedProject?.path]);

  if (!selectedProject || !config) return null;

  // Check if Run process is currently active
  const runningDevProcess = processes.find(
    p => p.status === 'running' && p.cwd === selectedProject.path && (p.name === config.run.name || p.command.includes(config.run.command))
  );

  // Check if Deploy process is active
  const runningDeployProcess = processes.find(
    p => p.status === 'running' && p.cwd === selectedProject.path && (p.name === config.deploy.name || p.command.includes(config.deploy.command))
  );

  const handleToggleRun = async () => {
    if (runningDevProcess) {
      await stopProcessAction(runningDevProcess.id);
    } else {
      setIsStartingRun(true);
      setTerminalOpen(true);
      await startProcessAction(config.run.command, config.run.name);
      setIsStartingRun(false);
    }
  };

  const handleRunDeploy = async () => {
    if (config.deploy.requiresConfirmation) {
      if (!confirm(`Запустить деплой проекта "${selectedProject.name}"?\nКоманда: ${config.deploy.command}`)) {
        return;
      }
    }
    setIsStartingDeploy(true);
    setTerminalOpen(true);
    await startProcessAction(config.deploy.command, config.deploy.name);
    setIsStartingDeploy(false);
  };

  const handleRunTest = async () => {
    setIsStartingTest(true);
    setTerminalOpen(true);
    await startProcessAction(config.test.command, config.test.name);
    setIsStartingTest(false);
  };

  return (
    <div className="flex items-center gap-1.5 bg-slate-900/90 rounded-xl p-1 border border-slate-800 shadow-sm shrink-0">
      {/* ─── 1. RUN / DEV BUTTON ─── */}
      <div className="flex items-center">
        <button
          onClick={handleToggleRun}
          disabled={isStartingRun}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            runningDevProcess
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-700/60'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
          }`}
          title={
            runningDevProcess
              ? `Сервер активен (PID: ${runningDevProcess.pid}). Кликните для остановки.`
              : `Запустить ${config.run.name} (${config.run.command})`
          }
        >
          {isStartingRun ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : runningDevProcess ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
              <span>Стоп Dev</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Запуск</span>
            </>
          )}
        </button>

        {/* Live URL Link if running */}
        {runningDevProcess && config.run.autoOpenUrl && (
          <a
            href={config.run.autoOpenUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-1 p-1.5 rounded-lg bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 hover:text-white hover:bg-emerald-900 transition text-xs"
            title={`Открыть ${config.run.autoOpenUrl}`}
          >
            <Globe className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* ─── 2. DEPLOY BUTTON ─── */}
      <button
        onClick={handleRunDeploy}
        disabled={isStartingDeploy || Boolean(runningDeployProcess)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium transition disabled:opacity-50"
        title={`Запустить деплой (${config.deploy.command})`}
      >
        {isStartingDeploy ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Rocket className="w-3.5 h-3.5 text-indigo-400" />
        )}
        <span className="hidden sm:inline">Деплой</span>
      </button>

      {/* ─── 3. TEST BUTTON ─── */}
      <button
        onClick={handleRunTest}
        disabled={isStartingTest}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
        title={`Запустить тесты (${config.test.command})`}
      >
        {isStartingTest ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
        ) : (
          <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
        )}
        <span className="hidden md:inline">Тест</span>
      </button>

      {/* ─── 4. SETTINGS MODAL TRIGGER ─── */}
      <button
        onClick={() => setIsConfigOpen(true)}
        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
        title="Настройка команд запуска и деплоя (.projecthub.json)"
      >
        <Settings className="w-3.5 h-3.5" />
      </button>

      {/* Config Modal */}
      <ActionConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        projectPath={selectedProject.path}
        onSaved={loadConfig}
      />
    </div>
  );
};
