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
import { useProjectStore, isProcessOfAction } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import { useDialog } from '../../hooks/useDialog';
import { ActionConfigModal } from './ActionConfigModal';
import { VoiceBadge } from '../voice/VoiceBadge';

export const ActionRunnerBar: React.FC = () => {
  const { t } = useTranslation();
  const dialog = useDialog();
  const {
    selectedProject,
    processes,
    actionConfig: config,
    loadActionConfig,
    runProjectAction,
    stopProcessAction,
    setTerminalOpen
  } = useProjectStore();

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [isStartingDeploy, setIsStartingDeploy] = useState(false);
  const [isStartingTest, setIsStartingTest] = useState(false);

  const projectPath = selectedProject?.path;
  // Действия запускаются в активном рабочем дереве, там же ищем уже запущенный процесс (TASK-62).
  const workspaceRoot = useProjectStore((s) => s.workspaceRoot);
  useEffect(() => {
    if (projectPath) void loadActionConfig(projectPath);
  }, [projectPath, loadActionConfig]);

  if (!selectedProject || !config) return null;

  // Check if Run process is currently active
  const runningDevProcess = processes.find(
    (p) => p.status === 'running' && isProcessOfAction(p, workspaceRoot || selectedProject.path, config.run)
  );

  // Check if Deploy process is active
  const runningDeployProcess = processes.find(
    (p) => p.status === 'running' && isProcessOfAction(p, workspaceRoot || selectedProject.path, config.deploy)
  );

  const confirmDeploy = (def: { command: string }) =>
    dialog.confirm({
      message: t.actions.confirmDeploy
        .replace('{name}', selectedProject.name)
        .replace('{command}', def.command)
    });

  const handleToggleRun = async () => {
    if (runningDevProcess) {
      await stopProcessAction(runningDevProcess.id);
    } else {
      setIsStartingRun(true);
      setTerminalOpen(true);
      await runProjectAction('run');
      setIsStartingRun(false);
    }
  };

  const handleRunDeploy = async () => {
    setIsStartingDeploy(true);
    setTerminalOpen(true);
    await runProjectAction('deploy', { confirm: confirmDeploy });
    setIsStartingDeploy(false);
  };

  const handleRunTest = async () => {
    setIsStartingTest(true);
    setTerminalOpen(true);
    await runProjectAction('test');
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
              ? t.actions.serverActive.replace('{pid}', String(runningDevProcess.pid))
              : t.actions.startProcess.replace('{name}', config.run.name).replace('{command}', config.run.command)
          }
        >
          {isStartingRun ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : runningDevProcess ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
              <span>{t.actions.stopDev}</span>
              <VoiceBadge command={t.voice.voiceBadges.stopDev} variant="amber" />
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{t.actions.run}</span>
              <VoiceBadge command={t.voice.voiceBadges.startDev} variant="emerald" />
            </>
          )}
        </button>

        {/* Live URL Link if running */}
        {runningDevProcess && config.run.autoOpenUrl && (
          <button
            type="button"
            onClick={() => void window.api.openExternal(config.run.autoOpenUrl!)}
            className="ml-1 p-1.5 rounded-lg bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 hover:text-white hover:bg-emerald-900 transition text-xs"
            title={`Open ${config.run.autoOpenUrl}`}
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* ─── 2. DEPLOY BUTTON ─── */}
      <button
        onClick={handleRunDeploy}
        disabled={isStartingDeploy || Boolean(runningDeployProcess)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium transition disabled:opacity-50"
        title={t.actions.startDeploy.replace('{command}', config.deploy.command)}
      >
        {isStartingDeploy ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Rocket className="w-3.5 h-3.5 text-indigo-400" />
        )}
        <span className="hidden sm:inline">{t.actions.deploy}</span>
        <VoiceBadge command={t.voice.voiceBadges.deploy} variant="indigo" />
      </button>

      {/* ─── 3. TEST BUTTON ─── */}
      <button
        onClick={handleRunTest}
        disabled={isStartingTest}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
        title={t.actions.startTest.replace('{command}', config.test.command)}
      >
        {isStartingTest ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
        ) : (
          <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
        )}
        <span className="hidden md:inline">{t.actions.test}</span>
        <VoiceBadge command={t.voice.voiceBadges.test} variant="amber" />
      </button>

      {/* ─── 4. SETTINGS MODAL TRIGGER ─── */}
      <button
        onClick={() => setIsConfigOpen(true)}
        className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
        title={t.actions.configure}
      >
        <Settings className="w-3.5 h-3.5" />
      </button>

      {/* Config Modal */}
      <ActionConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        projectPath={selectedProject.path}
        initialConfig={config}
        onSaved={() => void loadActionConfig(selectedProject.path)}
      />
    </div>
  );
};
