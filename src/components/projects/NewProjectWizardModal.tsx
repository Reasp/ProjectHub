import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  Folder,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Cpu,
  Layers,
  Terminal,
  GitBranch,
  BrainCircuit,
  Loader2
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useTranslation } from '../../i18n/useTranslation';
import type { CreateProjectOptions } from '../../types/electron';

interface NewProjectWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewProjectWizardModal: React.FC<NewProjectWizardModalProps> = ({
  isOpen,
  onClose
}) => {
  const { t } = useTranslation();
  const { fetchProjects, selectProject, setActiveTab, addTerminalLog } = useProjectStore();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [projectName, setProjectName] = useState('');
  const [parentDir, setParentDir] = useState(
    typeof navigator !== 'undefined' && navigator.userAgent.includes('Win') ? 'F:\\' : '/Users'
  );
  const [initGit, setInitGit] = useState(true);

  const [features, setFeatures] = useState({
    docsRag: true,
    envTools: true,
    backlogMcp: true,
    bootstrap: true,
    lightrag: false
  });

  const [isCreating, setIsCreating] = useState(false);
  const [currentCreationStep, setCurrentCreationStep] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setProjectName('');
      setErrorMessage(null);
      setIsCreating(false);
      setCurrentCreationStep('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const targetPath = parentDir
    ? `${parentDir.replace(/[\\/]+$/, '')}\\${projectName.trim()}`
    : projectName.trim();

  const handleSelectParentDir = async () => {
    if (window.api) {
      const selected = await window.api.selectDirectory();
      if (selected) {
        setParentDir(selected);
      }
    }
  };

  const handleToggleFeature = (key: keyof typeof features) => {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleCreate = async () => {
    if (!projectName.trim() || !window.api) return;

    setStep(3);
    setIsCreating(true);
    setErrorMessage(null);

    try {
      setCurrentCreationStep('Копирование структуры шаблона ProjectTemplate...');
      await new Promise((r) => setTimeout(r, 400));

      const options: CreateProjectOptions = {
        name: projectName.trim(),
        targetDir: targetPath,
        features,
        initGit
      };

      setCurrentCreationStep('Параметризация конфигураций и запуск setup...');
      const createdProject = await window.api.createProjectFromTemplate(options);

      setCurrentCreationStep('Регистрация проекта в каталоге Hub...');
      await fetchProjects();
      selectProject(createdProject);
      setActiveTab('kanban');

      addTerminalLog(`[ProjectHub] Успешно создан новый проект: ${createdProject.name} (${createdProject.path})`);
      onClose();
    } catch (err: any) {
      console.error('Project creation failed:', err);
      setErrorMessage(err.message || 'Произошла ошибка при создании проекта.');
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150 select-none">
      <div className="bg-[#131622] border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#171b2b]/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white">
              <Sparkles className="w-4 h-4 text-amber-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">{t.wizard.title}</h2>
              <p className="text-xs text-slate-400">{t.wizard.step} {step} / 3</p>
            </div>
          </div>
          {!isCreating && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Wizard Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/50 flex items-center gap-2.5 text-rose-300">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] block mb-1.5">
                  {t.wizard.projectName} *
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder={t.wizard.projectNamePlaceholder}
                  className="w-full bg-[#171a29] border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition font-medium"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] block mb-1.5">
                  {t.wizard.parentDirectory}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={parentDir}
                    onChange={(e) => setParentDir(e.target.value)}
                    className="flex-1 bg-[#171a29] border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleSelectParentDir}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition flex items-center gap-1.5 border border-slate-700"
                  >
                    <Folder className="w-3.5 h-3.5 text-indigo-400" />
                    {t.wizard.selectFolder}
                  </button>
                </div>
              </div>

              {projectName.trim() && (
                <div className="p-3 rounded-xl bg-[#171a2b]/60 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                  <span className="text-slate-500 font-semibold block">{t.wizard.resultingPath}:</span>
                  <span className="font-mono text-indigo-300 break-all">{targetPath}</span>
                </div>
              )}

              <div className="pt-2">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={initGit}
                    onChange={(e) => setInitGit(e.target.checked)}
                    className="w-4 h-4 rounded bg-[#171a29] border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-slate-300 font-medium flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
                    {t.wizard.initGit}
                  </span>
                </label>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] mb-1">
                  Выберите модули и возможности шаблона
                </h4>
                <p className="text-slate-400 text-[11px]">
                  Все выбранные опции будут сконфигурированы в <code>infra.config.json</code> и согласованы с агентами.
                </p>
              </div>

              <div className="space-y-2.5">
                {/* Feature 1: Vector RAG */}
                <div
                  onClick={() => handleToggleFeature('docsRag')}
                  className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                    features.docsRag
                      ? 'bg-indigo-600/10 border-indigo-500/40 text-white'
                      : 'bg-[#171a29]/60 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center text-indigo-400">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-semibold text-xs text-slate-200 block">
                        Vector RAG по документации (`docsRag`)
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Семантический поиск по <code>backlog/docs/</code> и <code>decisions/</code> через LanceDB
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={features.docsRag}
                    onChange={() => {}}
                    className="w-4 h-4 rounded text-indigo-600 cursor-pointer"
                  />
                </div>

                {/* Feature 2: Env Tools */}
                <div
                  onClick={() => handleToggleFeature('envTools')}
                  className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                    features.envTools
                      ? 'bg-indigo-600/10 border-indigo-500/40 text-white'
                      : 'bg-[#171a29]/60 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center text-indigo-400">
                      <Cpu className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-semibold text-xs text-slate-200 block">
                        Менеджер процессов (`envTools`)
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Управление dev-серверами, трекинг pid'ов и логов через MCP
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={features.envTools}
                    onChange={() => {}}
                    className="w-4 h-4 rounded text-indigo-600 cursor-pointer"
                  />
                </div>

                {/* Feature 3: Backlog MCP */}
                <div
                  onClick={() => handleToggleFeature('backlogMcp')}
                  className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                    features.backlogMcp
                      ? 'bg-indigo-600/10 border-indigo-500/40 text-white'
                      : 'bg-[#171a29]/60 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center text-indigo-400">
                      <Layers className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-semibold text-xs text-slate-200 block">
                        Backlog.md MCP Сервер (`backlogMcp`)
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Прямой доступ AI-агентов к задачам, майлстоунам и решениям
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={features.backlogMcp}
                    onChange={() => {}}
                    className="w-4 h-4 rounded text-indigo-600 cursor-pointer"
                  />
                </div>

                {/* Feature 4: Bootstrap */}
                <div
                  onClick={() => handleToggleFeature('bootstrap')}
                  className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                    features.bootstrap
                      ? 'bg-indigo-600/10 border-indigo-500/40 text-white'
                      : 'bg-[#171a29]/60 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center text-indigo-400">
                      <Terminal className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-semibold text-xs text-slate-200 block">
                        Кроссплатформенный Bootstrap (`bootstrap`)
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Скрипты быстрой установки зависимостей окружения под Windows / macOS / Linux
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={features.bootstrap}
                    onChange={() => {}}
                    className="w-4 h-4 rounded text-indigo-600 cursor-pointer"
                  />
                </div>

                {/* Feature 5: LightRAG */}
                <div
                  onClick={() => handleToggleFeature('lightrag')}
                  className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                    features.lightrag
                      ? 'bg-purple-600/15 border-purple-500/40 text-white'
                      : 'bg-[#171a29]/60 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center text-purple-400">
                      <BrainCircuit className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-semibold text-xs text-slate-200 flex items-center gap-1.5">
                        LightRAG Knowledge Graph (`lightrag`)
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300">
                          Тяжелая
                        </span>
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Построение графа сущностей документации через локальную Ollama (требует Python)
                      </span>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={features.lightrag}
                    onChange={() => {}}
                    className="w-4 h-4 rounded text-purple-600 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="py-8 flex flex-col items-center justify-center space-y-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 animate-pulse shadow-lg shadow-indigo-600/20">
                <Loader2 className="w-7 h-7 animate-spin" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Создание проекта {projectName}...</h3>
                <p className="text-xs text-slate-400 font-mono mt-1">{currentCreationStep}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-[#171b2b]/70 flex items-center justify-between">
          {step > 1 && !isCreating ? (
            <button
              onClick={() => setStep((s) => (s - 1) as any)}
              className="flex items-center gap-1 px-3.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 font-medium transition text-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t.wizard.back}
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            {!isCreating && (
              <button
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 font-medium transition text-xs"
              >
                {t.common.cancel}
              </button>
            )}

            {step === 1 && (
              <button
                onClick={() => {
                  if (!projectName.trim()) {
                    alert('Please enter a project name.');
                    return;
                  }
                  setStep(2);
                }}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 transition flex items-center gap-1 text-xs"
              >
                {t.wizard.next}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {step === 2 && (
              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="px-5 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-medium shadow-lg shadow-indigo-600/30 transition flex items-center gap-1.5 text-xs"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                {t.wizard.createButton}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
