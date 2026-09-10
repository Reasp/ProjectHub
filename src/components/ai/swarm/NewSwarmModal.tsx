import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Zap,
  GitFork,
  Bot,
  Layers,
  Sparkles,
  Play,
  ArrowRight,
  Plus,
  Trash2,
  CheckCircle2,
  ListTodo,
  DollarSign
} from 'lucide-react';
import { useSwarmStore } from '../../../store/useSwarmStore';
import { useProjectStore } from '../../../store/useProjectStore';
import { useTranslation } from '../../../i18n';
import type { AgentSlotConfig, SwarmMode } from '../../../types/electron';

interface PresetOption {
  id: string;
  name: string;
  mode: SwarmMode;
  description: string;
  agents: AgentSlotConfig[];
  stages?: { role: string; instructions: string }[];
}

const getPresets = (t: any): PresetOption[] => [
  {
    id: 'claude-vs-deepseek',
    name: t.swarm.presetDuelTitle,
    mode: 'fan_out',
    description: t.swarm.presetDuelDesc,
    agents: [
      {
        id: 'agent-claude',
        name: 'Claude 3.7 Sonnet',
        engine: 'api',
        role: t.swarm.roleContenderA,
        providerConfig: {
          provider: 'anthropic',
          model: 'claude-3-7-sonnet-latest',
          temperature: 0.2
        }
      },
      {
        id: 'agent-deepseek',
        name: 'DeepSeek V3 / R1',
        engine: 'api',
        role: t.swarm.roleContenderB,
        providerConfig: {
          provider: 'deepseek',
          model: 'deepseek-chat',
          temperature: 0.2
        }
      }
    ]
  },
  {
    id: 'tri-duel',
    name: t.swarm.presetTripleTitle,
    mode: 'fan_out',
    description: t.swarm.presetTripleDesc,
    agents: [
      {
        id: 'agent-claude-cli',
        name: 'Claude Code CLI',
        engine: 'claude-cli',
        role: t.swarm.roleCliAgent
      },
      {
        id: 'agent-codex',
        name: 'OpenAI GPT-4o',
        engine: 'api',
        role: t.swarm.roleOpenAiAgent,
        providerConfig: {
          provider: 'openrouter',
          model: 'openai/gpt-4o',
          temperature: 0.2
        }
      },
      {
        id: 'agent-deepseek',
        name: 'DeepSeek V3',
        engine: 'api',
        role: t.swarm.roleDeepSeekAgent,
        providerConfig: {
          provider: 'deepseek',
          model: 'deepseek-chat',
          temperature: 0.2
        }
      }
    ]
  },
  {
    id: 'pipeline-trio',
    name: t.swarm.presetPipelineTitle,
    mode: 'handoff',
    description: t.swarm.presetPipelineDesc,
    agents: [
      {
        id: 'agent-architect',
        name: 'Claude 3.7 Architect',
        engine: 'api',
        role: t.swarm.roleArchitect,
        providerConfig: {
          provider: 'anthropic',
          model: 'claude-3-7-sonnet-latest',
          temperature: 0.2
        }
      },
      {
        id: 'agent-coder',
        name: 'DeepSeek Coder',
        engine: 'api',
        role: t.swarm.roleLeadCoder,
        providerConfig: {
          provider: 'deepseek',
          model: 'deepseek-chat',
          temperature: 0.1
        }
      },
      {
        id: 'agent-qa',
        name: 'QA & Test Reviewer',
        engine: 'api',
        role: t.swarm.roleTester,
        providerConfig: {
          provider: 'anthropic',
          model: 'claude-3-7-sonnet-latest',
          temperature: 0.2
        }
      }
    ],
    stages: [
      {
        role: t.swarm.roleArchitect,
        instructions: t.swarm.instructionsArchitect
      },
      {
        role: t.swarm.roleLeadCoder,
        instructions: t.swarm.instructionsLeadCoder
      },
      {
        role: t.swarm.roleTester,
        instructions: t.swarm.instructionsTester
      }
    ]
  }
];

export const NewSwarmModal: React.FC = () => {
  const { t } = useTranslation();
  const presets = useMemo(() => getPresets(t), [t]);

  const { isNewSwarmModalOpen, closeNewSwarmModal, initialNewSwarmConfig, startFanOutAction, startHandoffAction, isLoading } =
    useSwarmStore();
  const { selectedProject, tasks } = useProjectStore();

  const [mode, setMode] = useState<SwarmMode>('fan_out');
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [prompt, setPrompt] = useState<string>('');
  const [useWorktrees, setUseWorktrees] = useState<boolean>(true);
  const [budgetUsd, setBudgetUsd] = useState<string>('');
  const [agents, setAgents] = useState<AgentSlotConfig[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('claude-vs-deepseek');

  useEffect(() => {
    if (agents.length === 0 && presets.length > 0) {
      setAgents(presets[0].agents);
      setSelectedPresetId(presets[0].id);
    }
  }, [presets, agents.length]);

  useEffect(() => {
    if (initialNewSwarmConfig) {
      if (initialNewSwarmConfig.taskId) setSelectedTaskId(initialNewSwarmConfig.taskId);
      if (initialNewSwarmConfig.prompt) setPrompt(initialNewSwarmConfig.prompt);
    }
  }, [initialNewSwarmConfig]);

  if (!isNewSwarmModalOpen) return null;

  const handleApplyPreset = (preset: PresetOption) => {
    setSelectedPresetId(preset.id);
    setMode(preset.mode);
    setAgents(preset.agents);
  };

  const handleSelectTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    if (!taskId) return;
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      const taskPrompt = `${t.swarm.taskPromptPrefix.replace('{id}', task.id).replace('{title}', task.title)}\n\n${task.description || ''}`;
      setPrompt(taskPrompt);
    }
  };

  const handleAddAgent = () => {
    const newAgent: AgentSlotConfig = {
      id: `agent-${Date.now().toString(36)}`,
      name: t.swarm.agentDefaultName.replace('{n}', String(agents.length + 1)),
      engine: 'api',
      role: mode === 'fan_out'
        ? t.swarm.contenderDefaultRole.replace('{n}', String(agents.length + 1))
        : t.swarm.executorDefaultRole,
      providerConfig: {
        provider: 'anthropic',
        model: 'claude-3-7-sonnet-latest',
        temperature: 0.2
      }
    };
    setAgents([...agents, newAgent]);
  };

  const handleRemoveAgent = (idx: number) => {
    if (agents.length <= 1) return;
    setAgents(agents.filter((_, i) => i !== idx));
  };

  const handleUpdateAgent = (idx: number, updates: Partial<AgentSlotConfig>) => {
    setAgents(
      agents.map((a, i) => (i === idx ? { ...a, ...updates } : a))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !prompt.trim() || agents.length === 0) return;

    const taskObj = tasks.find((t) => t.id === selectedTaskId);
    const parsedBudgetRaw = Number(budgetUsd.replace(',', '.'));
    const parsedBudget = Number.isFinite(parsedBudgetRaw) && parsedBudgetRaw > 0 ? parsedBudgetRaw : undefined;

    if (mode === 'fan_out') {
      await startFanOutAction({
        projectPath: selectedProject.path,
        prompt: prompt.trim(),
        taskId: selectedTaskId || undefined,
        taskTitle: taskObj?.title,
        useWorktrees,
        budgetUsd: parsedBudget,
        agents
      });
    } else {
      const preset = presets.find((p) => p.id === selectedPresetId);
      const stages = agents.map((ag, idx) => ({
        role: ag.role || t.swarm.stageDefaultRole.replace('{n}', String(idx + 1)),
        agent: ag,
        instructions: preset?.stages?.[idx]?.instructions || t.swarm.stageDefaultInstructions.replace('{role}', ag.role || '')
      }));

      await startHandoffAction({
        projectPath: selectedProject.path,
        prompt: prompt.trim(),
        taskId: selectedTaskId || undefined,
        taskTitle: taskObj?.title,
        useWorktrees,
        budgetUsd: parsedBudget,
        stages
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-3xl rounded-xl border border-border bg-card shadow-2xl text-card-foreground flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-secondary/20">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                {t.swarm.multiAgentSwarmTitle}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t.swarm.multiAgentSwarmDesc}
              </p>
            </div>
          </div>
          <button
            onClick={closeNewSwarmModal}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Режим работы */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
              {t.swarm.orchestrationMode}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMode('fan_out')}
                className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                  mode === 'fan_out'
                    ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/40'
                    : 'border-border bg-secondary/30 hover:bg-secondary/60 text-muted-foreground'
                }`}
              >
                <Zap className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-foreground">{t.swarm.fanOutArenaTitle}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t.swarm.fanOutArenaDesc}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode('handoff')}
                className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                  mode === 'handoff'
                    ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary/40'
                    : 'border-border bg-secondary/30 hover:bg-secondary/60 text-muted-foreground'
                }`}
              >
                <Layers className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-foreground">{t.swarm.handoffPipelineTitle}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t.swarm.handoffPipelineDesc}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Быстрые пресеты */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
              {t.swarm.readyPresets}
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {presets.map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'border-border/70 bg-card hover:bg-secondary/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">{preset.name}</span>
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-primary" />}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Привязка к задаче Backlog */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <ListTodo className="w-3.5 h-3.5" />
                {t.swarm.linkBacklogTask}
              </label>
              {selectedTaskId && (
                <button
                  type="button"
                  onClick={() => handleSelectTask('')}
                  className="text-xs text-primary hover:underline"
                >
                  {t.swarm.resetSelection}
                </button>
              )}
            </div>
            <select
              value={selectedTaskId}
              onChange={(e) => handleSelectTask(e.target.value)}
              className="w-full text-xs rounded-lg border border-border bg-secondary/40 px-3 py-2 text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
            >
              <option value="">{t.swarm.noBacklogLink}</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  [{t.id}] {t.title} ({t.status})
                </option>
              ))}
            </select>
          </div>

          {/* Промпт задачи */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">
              {t.swarm.taskPromptLabel}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t.swarm.taskPromptPlaceholderDetailed}
              rows={4}
              required
              className="w-full text-xs rounded-lg border border-border bg-secondary/30 p-3 text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary font-mono"
            />
          </div>

          {/* Участники состязания / этапы */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {mode === 'fan_out' ? t.swarm.arenaContenders : t.swarm.pipelineStages} ({agents.length})
              </label>
              <button
                type="button"
                onClick={handleAddAgent}
                className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> {t.swarm.addContender}
              </button>
            </div>

            <div className="space-y-2.5">
              {agents.map((agent, idx) => (
                <div
                  key={agent.id || idx}
                  className="p-3 rounded-lg border border-border/70 bg-secondary/20 flex flex-col md:flex-row items-start md:items-center gap-3 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-44">
                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[10px]">
                      {idx + 1}
                    </span>
                    <input
                      type="text"
                      value={agent.name}
                      onChange={(e) => handleUpdateAgent(idx, { name: e.target.value })}
                      placeholder={t.swarm.agentNamePlaceholder}
                      className="px-2 py-1 rounded-sm border border-border bg-background text-foreground font-medium text-xs w-full"
                    />
                  </div>

                  <div className="flex items-center gap-2 flex-1 w-full md:w-auto">
                    <select
                      value={agent.engine}
                      onChange={(e) =>
                        handleUpdateAgent(idx, {
                          engine: e.target.value as AgentSlotConfig['engine']
                        })
                      }
                      className="px-2 py-1 rounded-sm border border-border bg-background text-foreground text-xs"
                    >
                      <option value="api">API Agent (LLM)</option>
                      <option value="claude-cli">Claude Code CLI</option>
                      <option value="codex-cli">Codex / Aider CLI</option>
                    </select>

                    {agent.engine === 'api' && (
                      <select
                        value={agent.providerConfig?.provider || 'anthropic'}
                        onChange={(e) =>
                          handleUpdateAgent(idx, {
                            providerConfig: {
                              ...agent.providerConfig,
                              provider: e.target.value as any,
                              model:
                                e.target.value === 'anthropic'
                                  ? 'claude-3-7-sonnet-latest'
                                  : e.target.value === 'deepseek'
                                  ? 'deepseek-chat'
                                  : 'openai/gpt-4o'
                            }
                          })
                        }
                        className="px-2 py-1 rounded-sm border border-border bg-background text-foreground text-xs"
                      >
                        <option value="anthropic">Anthropic (Claude)</option>
                        <option value="deepseek">DeepSeek V3/R1</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="ollama">{t.swarm.providerOllamaLocal}</option>
                      </select>
                    )}

                    <input
                      type="text"
                      value={agent.role || ''}
                      onChange={(e) => handleUpdateAgent(idx, { role: e.target.value })}
                      placeholder={t.swarm.rolePlaceholder}
                      className="px-2 py-1 rounded-sm border border-border bg-background text-foreground text-xs w-32"
                    />

                    {agent.engine !== 'codex-cli' && (
                      <input
                        type="text"
                        value={agent.providerConfig?.model || ''}
                        onChange={(e) =>
                          handleUpdateAgent(idx, {
                            providerConfig: {
                              provider: agent.providerConfig?.provider || 'anthropic',
                              ...agent.providerConfig,
                              model: e.target.value
                            }
                          })
                        }
                        placeholder={t.swarm.modelPlaceholder}
                        className="px-2 py-1 rounded-sm border border-border bg-background text-foreground text-xs w-36 font-mono"
                      />
                    )}

                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={agent.budgetUsd ?? ''}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        handleUpdateAgent(idx, { budgetUsd: Number.isFinite(v) && v > 0 ? v : undefined });
                      }}
                      placeholder={t.swarm.agentBudgetPlaceholder}
                      title={t.swarm.agentBudgetTooltip}
                      className="px-2 py-1 rounded-sm border border-border bg-background text-foreground text-xs w-20"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveAgent(idx)}
                    disabled={agents.length <= 1}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-30 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Бюджет сессии (TASK-56) */}
          <div className="flex items-center justify-between p-3.5 rounded-xl border border-border bg-secondary/20 gap-4">
            <div className="flex items-center gap-2.5">
              <DollarSign className="w-4 h-4 text-primary" />
              <div>
                <div className="text-xs font-semibold text-foreground">{t.swarm.sessionBudgetLabel}</div>
                <div className="text-[11px] text-muted-foreground">{t.swarm.sessionBudgetDesc}</div>
              </div>
            </div>
            <input
              type="number"
              min={0}
              step={0.5}
              value={budgetUsd}
              onChange={(e) => setBudgetUsd(e.target.value)}
              placeholder="0"
              className="px-2 py-1 rounded-sm border border-border bg-background text-foreground text-xs w-24 text-right"
            />
          </div>

          {/* Изоляция в Git Worktrees */}
          <div className="flex items-center justify-between p-3.5 rounded-xl border border-border bg-secondary/20">
            <div className="flex items-center gap-2.5">
              <GitFork className="w-4 h-4 text-primary" />
              <div>
                <div className="text-xs font-semibold text-foreground">
                  {t.swarm.isolateInWorktreesTitle}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t.swarm.isolateInWorktreesDesc}
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={useWorktrees}
              onChange={(e) => setUseWorktrees(e.target.checked)}
              className="w-4 h-4 rounded-sm border-border text-primary focus:ring-primary accent-primary"
            />
          </div>

          {/* Кнопки */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closeNewSwarmModal}
              className="px-4 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              {t.swarm.cancel}
            </button>
            <button
              type="submit"
              disabled={isLoading || !prompt.trim() || agents.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shadow-md transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {mode === 'fan_out' ? t.swarm.launchArena : t.swarm.launchPipeline}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
