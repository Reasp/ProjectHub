import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Tag,
  Calendar,
  CheckCircle2,
  Clock,
  CheckSquare,
  Square,
  Plus,
  Trash2,
  Save,
  Eye,
  Edit3,
  FileCode,
  AlertTriangle,
  FolderOpen,
  Target,
  Sparkles,
  Maximize2,
  Minimize2,
  FolderGit2,
  Zap,
  Bot,
  PlayCircle,
  Loader2
} from 'lucide-react';
import type { BacklogTask, TaskCriterion } from '../../types/electron';
import { useProjectStore, samePath } from '../../store/useProjectStore';
import { useSwarmStore } from '../../store/useSwarmStore';
import { useRolesStore } from '../../store/useRolesStore';
import { useTranslation } from '../../i18n/useTranslation';
import { parseAssignee, formatAgentAssignee } from '../../utils/assignee';
import { useFederationStore } from '../../store/useFederationStore';
import { useDialog } from '../../hooks/useDialog';
import { generateTaskDraft } from '../../services/aiAssistantService';
import { MarkdownViewer } from '../common/MarkdownViewer';

const ACTIVE_AGENT_STATUSES = new Set(['pending', 'preparing', 'running']);

interface TaskDetailModalProps {
  task: BacklogTask | null;
  onClose: () => void;
  onSave: (updatedTask: BacklogTask) => Promise<void>;
  onDelete: (filePath: string) => Promise<void>;
  onToggleCriterion: (filePath: string, index: number, completed: boolean) => Promise<void>;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  task,
  onClose,
  onSave,
  onDelete,
  onToggleCriterion
}) => {
  const { t } = useTranslation();
  const dialog = useDialog();
  const {
    milestones,
    worktrees,
    workspaceRoot,
    setActiveWorktree,
    createWorktreeAction,
    createPtySessionAction,
    selectedProject,
    updateTaskStatusLocal,
    setActiveTab: setMainTab
  } = useProjectStore();
  const { openNewSwarmModal, swarms, runAssignedAgentAction } = useSwarmStore();
  const federationPeers = useFederationStore((s) => s.peers);
  const { rolesByProject, loadRolesAction } = useRolesStore();
  const roles = rolesByProject[selectedProject?.path || ''] || [];

  const [activeTab, setActiveTab] = useState<'editor' | 'raw'>('editor');
  const [previewMode, setPreviewMode] = useState(true);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [isWorktreeLoading, setIsWorktreeLoading] = useState(false);
  const [isRunningAssignedAgent, setIsRunningAssignedAgent] = useState(false);

  const [title, setTitle] = useState(task?.title || '');
  const [status, setStatus] = useState<BacklogTask['status']>(task?.status || 'To Do');
  const [milestone, setMilestone] = useState(task?.milestone || '');
  const [assignee, setAssignee] = useState(task?.assignee?.[0] || '');
  const [description, setDescription] = useState(task?.description || '');
  const [labels, setLabels] = useState<string[]>(task?.labels || []);
  const [newLabelInput, setNewLabelInput] = useState('');
  const [criteria, setCriteria] = useState<TaskCriterion[]>(task?.acceptanceCriteria || []);
  const [newCriterionInput, setNewCriterionInput] = useState('');
  // Сырой markdown грузится по требованию при открытии вкладки Raw (TASK-38): в списке задач его нет.
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [isRawLoading, setIsRawLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  const taskIdNorm = task?.id?.toLowerCase() || '';
  const existingWorktree = worktrees.find(
    (w) =>
      (w.taskId && w.taskId.toLowerCase() === taskIdNorm) ||
      (w.branch && w.branch.toLowerCase().includes(taskIdNorm)) ||
      w.path.toLowerCase().includes(taskIdNorm)
  );

  const handleOpenOrCreateWorktree = async () => {
    if (!task || !selectedProject) return;
    setIsWorktreeLoading(true);
    try {
      if (existingWorktree) {
        await createPtySessionAction(
          selectedProject.path,
          'claude',
          `[WT: ${task.id}] Claude`,
          existingWorktree.path,
          existingWorktree.branch || undefined
        );
      } else {
        const branchName = `task/${taskIdNorm}`;
        const wt = await createWorktreeAction(branchName, true, 'HEAD');
        if (wt) {
          if (status === 'To Do') {
            setStatus('In Progress');
            await updateTaskStatusLocal(task.id, 'In Progress');
          }
          await createPtySessionAction(
            selectedProject.path,
            'claude',
            `[WT: ${task.id}] Claude`,
            wt.path,
            wt.branch || undefined
          );
        }
      }
    } finally {
      setIsWorktreeLoading(false);
    }
  };

  const parsedAssignee = parseAssignee(assignee);
  const assignedRoleSlug = parsedAssignee?.kind === 'agent' ? parsedAssignee.roleSlug : null;
  const assignedHostId = parsedAssignee?.kind === 'agent' ? parsedAssignee.hostId : undefined;
  // Хост из назначения может быть чужим: тогда агент стартует там через hub-соединение (TASK-66).
  const assignedPeer = assignedHostId ? federationPeers.find((peer) => peer.hostId === assignedHostId) : undefined;
  const assignedRole = assignedRoleSlug ? roles.find((r) => r.slug === assignedRoleSlug) : undefined;
  const projectSwarms = (selectedProject && swarms[selectedProject.path]) || [];
  const activeAssignedSwarm = projectSwarms.find(
    (s) => s.taskId === task?.id && ACTIVE_AGENT_STATUSES.has(s.status as string)
  );
  const lastAssignedSwarm = projectSwarms.find((s) => s.taskId === task?.id);

  const handleRunAssignedAgent = async () => {
    if (!task || !selectedProject || !assignedRoleSlug) return;
    setIsRunningAssignedAgent(true);
    try {
      const result = await runAssignedAgentAction({
        projectPath: selectedProject.path,
        taskId: task.id,
        taskTitle: task.title,
        prompt: `[${task.id}]: ${task.title}\n\n${task.description || ''}`,
        roleSlug: assignedRoleSlug,
        hostId: assignedHostId
      });
      if (result && 'error' in result && typeof result.error === 'string') {
        await dialog.alert({ message: result.error });
      }
    } finally {
      setIsRunningAssignedAgent(false);
    }
  };

  const handleAIGenerate = async () => {
    if (!title.trim()) return;
    setIsGeneratingAI(true);
    try {
      const draft = await generateTaskDraft(title);
      setDescription(draft.description);
      setCriteria(draft.criteria);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  useEffect(() => {
    if (selectedProject?.path) void loadRolesAction(selectedProject.path);
  }, [selectedProject?.path, loadRolesAction]);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title || '');
    setStatus(task.status || 'To Do');
    setMilestone(task.milestone || '');
    setAssignee(task.assignee?.[0] || '');
    setDescription(task.description || '');
    setLabels(task.labels || []);
    setCriteria(task.acceptanceCriteria || []);
    setRawContent(task.content ?? null);
    setActiveTab('editor');
    setWarningMessage(null);
    setPreviewMode(true);
    setIsDescriptionExpanded(false);
  }, [task]);

  useEffect(() => {
    if (activeTab !== 'raw' || rawContent !== null || !task?.filePath || !window.api?.getTaskContent) return;
    let cancelled = false;
    setIsRawLoading(true);
    window.api
      .getTaskContent(task.filePath)
      .then((text) => {
        if (!cancelled) setRawContent(text ?? '');
      })
      .catch(() => {
        if (!cancelled) setRawContent('');
      })
      .finally(() => {
        if (!cancelled) setIsRawLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, rawContent, task?.filePath]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!task) return null;

  const handleStatusChange = (newStatus: BacklogTask['status']) => {
    if (newStatus === 'Done' && (status === 'To Do' || status === 'In Progress')) {
      setWarningMessage(t.taskDetail.reviewWarningRule5);
    } else {
      setWarningMessage(null);
    }
    setStatus(newStatus);
  };

  const handleAddLabel = () => {
    const trimmed = newLabelInput.trim();
    if (trimmed && !labels.includes(trimmed)) {
      setLabels([...labels, trimmed]);
      setNewLabelInput('');
    }
  };

  const handleRemoveLabel = (labelToRemove: string) => {
    setLabels(labels.filter((l) => l !== labelToRemove));
  };

  const handleToggleCriterion = async (index: number) => {
    const updated = [...criteria];
    updated[index].completed = !updated[index].completed;
    setCriteria(updated);
    if (task.filePath) {
      await onToggleCriterion(task.filePath, index, updated[index].completed);
    }
  };

  const handleAddCriterion = () => {
    const trimmed = newCriterionInput.trim();
    if (trimmed) {
      setCriteria([...criteria, { text: trimmed, completed: false }]);
      setNewCriterionInput('');
    }
  };

  const handleRemoveCriterion = (index: number) => {
    setCriteria(criteria.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updated: BacklogTask = {
        ...task,
        title,
        status,
        labels,
        milestone: milestone || undefined,
        assignee: assignee.trim() ? [assignee.trim()] : [],
        description,
        acceptanceCriteria: criteria
      };
      await onSave(updated);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      await dialog.confirm({
        message: `${t.taskDetail.confirmDelete} (${task.id}: ${task.filePath})`,
        danger: true
      })
    ) {
      await onDelete(task.filePath);
      onClose();
    }
  };

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150 select-text"
    >
      <div className={`bg-[#131622] border border-slate-800 rounded-2xl w-full shadow-2xl overflow-hidden flex flex-col transition-all duration-150 select-text ${
        isDescriptionExpanded ? 'max-w-5xl h-[92vh]' : 'max-w-3xl max-h-[90vh]'
      }`}>
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#171b2b]/70">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 px-2.5 py-1 rounded-md">
              {task.id}
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="font-semibold text-sm text-white bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none px-1 py-0.5 transition truncate max-w-md select-text cursor-text"
              placeholder={t.taskDetail.title}
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#10121c] p-0.5 rounded-lg border border-slate-800">
              <button
                onClick={() => setActiveTab('editor')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                  activeTab === 'editor' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.common.edit}
              </button>
              <button
                onClick={() => setActiveTab('raw')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                  activeTab === 'raw' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Raw Markdown
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Warning Alert if any */}
        {warningMessage && (
          <div className="px-6 py-2.5 bg-amber-950/40 border-b border-amber-800/50 flex items-center gap-2.5 text-xs text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{warningMessage}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className={`p-6 overflow-y-auto flex-1 text-xs ${isDescriptionExpanded ? 'flex flex-col space-y-3 min-h-0' : 'space-y-5'}`}>
          {activeTab === 'editor' ? (
            <>
              {!isDescriptionExpanded && (
                <>
                  {/* Meta Row: Status, Milestone, Assignee & Labels */}
                  <div className="grid grid-cols-4 gap-3 p-4 rounded-xl bg-[#171b2b]/50 border border-slate-800">
                <div>
                  <label className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] block mb-1.5">
                    {t.taskDetail.status}
                  </label>
                  <select
                    value={status}
                    onChange={(e) => handleStatusChange(e.target.value as any)}
                    className="w-full bg-[#10121d] border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-500"
                  >
                    <option value="To Do">○ To Do ({t.kanban.todo})</option>
                    <option value="In Progress">◒ In Progress ({t.kanban.inProgress})</option>
                    <option value="Review">◆ Review ({t.kanban.review})</option>
                    <option value="Done">✔ Done ({t.kanban.done})</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] block mb-1.5 flex items-center gap-1">
                    <Target className="w-3 h-3 text-indigo-400" />
                    {t.taskDetail.milestone}
                  </label>
                  <select
                    value={milestone}
                    onChange={(e) => setMilestone(e.target.value)}
                    className="w-full bg-[#10121d] border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">({t.taskDetail.noMilestone})</option>
                    {(milestones || []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {String(m.id)}: {String(m.title)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] block mb-1.5 flex items-center gap-1">
                    <Bot className="w-3 h-3 text-indigo-400" />
                    {t.taskDetail.assignee}
                  </label>
                  <input
                    type="text"
                    list="task-assignee-roles"
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                    placeholder={t.taskDetail.assigneePlaceholder}
                    className="w-full bg-[#10121d] border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 text-xs font-medium focus:outline-none focus:border-indigo-500 select-text cursor-text"
                  />
                  <datalist id="task-assignee-roles">
                    {roles.map((r) => (
                      <option key={r.slug} value={formatAgentAssignee(r.slug)}>{r.name}</option>
                    ))}
                    {/* Назначение на другую машину федерации (TASK-66, decision-11 п.5) */}
                    {federationPeers.flatMap((peer) =>
                      roles.map((r) => (
                        <option key={`${peer.hostId}:${r.slug}`} value={formatAgentAssignee(r.slug, peer.hostId)}>
                          {r.name} — {peer.machineName}
                        </option>
                      ))
                    )}
                  </datalist>
                  {assignedHostId && (
                    <p className="text-[10px] mt-1 text-slate-400">
                      {assignedPeer
                        ? `${assignedPeer.machineName} · ${t.federation.status[assignedPeer.status]}`
                        : t.federation.notConnected}
                    </p>
                  )}
                  {assignedRoleSlug && !assignedRole && (
                    <p className="text-[10px] text-amber-400 mt-1">{t.taskDetail.assigneeRoleNotFound}</p>
                  )}
                </div>

                <div>
                  <label className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] block mb-1.5">
                    {t.taskDetail.labels}
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {labels.map((l, lIdx) => (
                      <span
                        key={typeof l === 'string' ? l : lIdx}
                        className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700/60 flex items-center gap-1 text-[11px]"
                      >
                        <Tag className="w-2.5 h-2.5 text-indigo-400" />
                        {typeof l === 'string' ? l : String(l)}
                        <button
                          type="button"
                          onClick={() => handleRemoveLabel(l)}
                          className="hover:text-rose-400 ml-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newLabelInput}
                      onChange={(e) => setNewLabelInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddLabel())}
                      placeholder={t.taskDetail.addLabel}
                      className="bg-[#10121d] border border-slate-800 rounded-md px-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-500 flex-1 focus:outline-none focus:border-indigo-500 select-text cursor-text"
                    />
                    <button
                      type="button"
                      onClick={handleAddLabel}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md border border-slate-700 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Acceptance Criteria Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                    {t.taskDetail.acceptanceCriteria}
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleAIGenerate}
                      disabled={isGeneratingAI}
                      className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-medium px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 transition disabled:opacity-50"
                      title={t.taskDetail.generateCriteria}
                    >
                      <Sparkles className={`w-3 h-3 ${isGeneratingAI ? 'animate-spin' : ''}`} />
                      {isGeneratingAI ? t.common.loading : t.taskDetail.aiAssistant}
                    </button>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {criteria.filter((c) => c.completed).length} / {criteria.length} {t.kanban.criteriaCount}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {criteria.length === 0 ? (
                    <div className="p-3 rounded-lg border border-dashed border-slate-800 text-center text-slate-500 text-xs">
                      {t.taskDetail.criterionPlaceholder}
                    </div>
                  ) : (
                    criteria.map((crit, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#161a29] border border-slate-800/80 group hover:border-slate-700 transition"
                      >
                        <div
                          onClick={() => handleToggleCriterion(index)}
                          className="flex items-center gap-2.5 flex-1 cursor-pointer select-none"
                        >
                          {crit.completed ? (
                            <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500 group-hover:text-slate-400 shrink-0" />
                          )}
                          <span
                            className={`text-xs ${
                              crit.completed ? 'line-through text-slate-500' : 'text-slate-200'
                            }`}
                          >
                            {typeof crit.text === 'string' ? crit.text : String(crit.text || '')}
                          </span>
                        </div>

                        <button
                          onClick={() => handleRemoveCriterion(index)}
                          className="p-1 text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition"
                          title={t.common.delete}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}

                  {/* Add criterion input */}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={newCriterionInput}
                      onChange={(e) => setNewCriterionInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCriterion())}
                      placeholder={t.taskDetail.criterionPlaceholder}
                      className="w-full bg-[#10121d] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 select-text cursor-text"
                    />
                    <button
                      type="button"
                      onClick={handleAddCriterion}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition flex items-center gap-1 shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t.taskDetail.addCriterion}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Description & Markdown Editor */}
          <div className={`space-y-2 ${isDescriptionExpanded ? 'flex-1 flex flex-col min-h-0' : ''}`}>
            <div className="flex items-center justify-between shrink-0">
              <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
                {t.taskDetail.description} (Markdown)
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewMode(!previewMode)}
                  className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 font-medium px-2 py-1 rounded hover:bg-slate-800/60 transition"
                  title={previewMode ? t.common.edit : t.docs.viewDoc}
                >
                  {previewMode ? (
                    <>
                      <Edit3 className="w-3 h-3" />
                      {t.common.edit}
                    </>
                  ) : (
                    <>
                      <Eye className="w-3 h-3" />
                      {t.docs.viewDoc}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                  className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded transition ${
                    isDescriptionExpanded
                      ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                  title={isDescriptionExpanded ? t.common.collapse : t.common.expand}
                >
                  {isDescriptionExpanded ? (
                    <>
                      <Minimize2 className="w-3 h-3" />
                      {t.common.collapse}
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-3 h-3" />
                      {t.common.expand}
                    </>
                  )}
                </button>
              </div>
            </div>

            {previewMode ? (
              <div
                className={`bg-[#0e111a] p-4 rounded-xl text-xs text-slate-300 border border-slate-800 leading-relaxed overflow-y-auto select-text selection:bg-indigo-600/40 ${
                  isDescriptionExpanded ? 'flex-1 min-h-0' : 'min-h-[140px] max-h-[380px]'
                }`}
              >
                {description.trim() ? (
                  <MarkdownViewer content={description} />
                ) : (
                  <div className="text-slate-500 italic py-2 select-none">
                    {t.taskDetail.noDescription}
                  </div>
                )}
              </div>
            ) : (
              <textarea
                autoFocus
                rows={isDescriptionExpanded ? undefined : 8}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.createTask.descriptionPlaceholder}
                className={`w-full bg-[#10121d] border border-slate-800 rounded-xl p-3.5 text-xs text-slate-200 font-mono placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 leading-relaxed transition select-text cursor-text selection:bg-indigo-600/40 ${
                  isDescriptionExpanded ? 'flex-1 min-h-0 resize-none' : 'resize-y'
                }`}
              />
            )}
          </div>
        </>
      ) : (
        /* Raw Markdown source viewer */
        <div className="space-y-2">
          <label className="font-semibold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
            <FileCode className="w-3.5 h-3.5 text-indigo-400" />
            {t.docs.markdownEditor}
          </label>
          <pre className="bg-[#0e111a] p-4 rounded-xl text-xs text-slate-300 font-mono border border-slate-800 leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-[50vh] select-text selection:bg-indigo-600/40">
            {isRawLoading || rawContent === null ? (
              <span className="text-slate-500 italic">{t.common.loading}</span>
            ) : (
              rawContent
            )}
          </pre>
        </div>
      )}

      {/* File location footer info */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-800/60 font-mono shrink-0">
            <span className="truncate max-w-lg" title={task.filePath}>
              {task.filePath}
            </span>
            {task.created && <span>{String(task.created)}</span>}
          </div>

          {/* Branch/worktree/PR записаны автоматически при создании worktree и PR (TASK-64) */}
          {(task.branch || task.worktree || task.pr) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono shrink-0">
              {task.branch && (
                <span className="flex items-center gap-1 text-slate-400" title={task.branch}>
                  <FolderGit2 className="w-3 h-3 text-cyan-400" />
                  {task.branch}
                </span>
              )}
              {task.worktree && (
                <span className="flex items-center gap-1 text-slate-400" title={task.worktree}>
                  <FolderOpen className="w-3 h-3 text-cyan-400" />
                  {task.worktree}
                </span>
              )}
              {task.pr && (
                <button
                  type="button"
                  onClick={() => void window.api.openExternal(task.pr!)}
                  className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 hover:underline"
                  title={task.pr}
                >
                  <FileCode className="w-3 h-3" />
                  Pull Request
                </button>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-[#171b2b]/70 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 border border-rose-900/40 transition text-xs font-medium"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t.taskDetail.deleteTask}
            </button>

            {/* Активное рабочее дерево задачи (TASK-62): контекст приложения переключается сюда */}
            {selectedProject?.hasGit && existingWorktree && (
              samePath(existingWorktree.path, workspaceRoot) ? (
                <span
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-200 border border-cyan-500/40 text-xs font-semibold"
                  title={t.worktrees.switcherTitle}
                >
                  <FolderGit2 className="w-3.5 h-3.5" />
                  {t.worktrees.activeBadge}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void setActiveWorktree(existingWorktree.path)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/70 hover:bg-slate-700 text-slate-200 border border-slate-700/60 text-xs font-semibold transition"
                  title={t.worktrees.switchTo.replace('{branch}', existingWorktree.branch || existingWorktree.path)}
                >
                  <FolderGit2 className="w-3.5 h-3.5 text-cyan-400" />
                  {t.worktrees.switcherLabel}
                </button>
              )
            )}

            {/* Git Worktree Action (TASK-53) */}
            {selectedProject?.hasGit && (
              existingWorktree ? (
                <button
                  type="button"
                  onClick={handleOpenOrCreateWorktree}
                  disabled={isWorktreeLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-700/50 text-xs font-semibold shadow-sm transition"
                  title={t.taskDetail.worktreeActiveTooltip.replace('{path}', existingWorktree.path)}
                >
                  <FolderGit2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Worktree: {existingWorktree.branch || 'wt'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleOpenOrCreateWorktree}
                  disabled={isWorktreeLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/50 text-xs font-semibold shadow-sm transition"
                  title={t.taskDetail.createWorktreeTooltip.replace('{id}', task.id)}
                >
                  <FolderGit2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{isWorktreeLoading ? t.taskDetail.creatingWorktree : t.taskDetail.openInWorktree}</span>
                </button>
              )
            )}

            {/* Swarm Arena Action (TASK-54) */}
            <button
              type="button"
              onClick={() => {
                onClose();
                openNewSwarmModal({
                  taskId: task.id,
                  taskTitle: task.title,
                  prompt: `[${task.id}]: ${task.title}\n\n${task.description || ''}`
                });
                setMainTab('ai');
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-700/50 text-xs font-semibold shadow-sm transition"
              title={t.taskDetail.swarmArenaTooltip}
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>{t.taskDetail.inSwarmArena}</span>
            </button>

            {/* Запуск назначенного агента (decision-9, TASK-60) */}
            {assignedRoleSlug && (
              <button
                type="button"
                onClick={handleRunAssignedAgent}
                disabled={isRunningAssignedAgent || Boolean(activeAssignedSwarm) || !assignedRole}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/50 text-xs font-semibold shadow-sm transition disabled:opacity-50"
                title={assignedRole ? t.taskDetail.runAssignedAgentTooltip.replace('{role}', assignedRole.name) : t.taskDetail.assigneeRoleNotFound}
              >
                {isRunningAssignedAgent || activeAssignedSwarm ? (
                  <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                ) : (
                  <PlayCircle className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>
                  {activeAssignedSwarm
                    ? t.taskDetail.assignedAgentRunning
                    : t.taskDetail.runAssignedAgent}
                </span>
              </button>
            )}
            {!activeAssignedSwarm && lastAssignedSwarm && (
              <span
                className={`text-[11px] px-2 py-1 rounded-md border ${
                  lastAssignedSwarm.status === 'completed'
                    ? 'text-emerald-400 border-emerald-800 bg-emerald-950/40'
                    : lastAssignedSwarm.status === 'failed'
                    ? 'text-rose-400 border-rose-800 bg-rose-950/40'
                    : 'text-slate-400 border-slate-700 bg-slate-900/40'
                }`}
              >
                {lastAssignedSwarm.status}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 font-medium transition text-xs"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/20 transition flex items-center gap-1.5 text-xs disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {isSaving ? t.taskDetail.saving : t.common.save}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
