import path from 'node:path';
import fs from 'node:fs/promises';
import { getUserDataDir } from './appPaths.js';
import { appEventBus } from './eventBus.js';
import { AutomationEngine, type SwarmSnapshot } from './automationEngine.js';
import { AutomationStore } from './automationStore.js';
import type { ActionDeps } from './automationActions.js';
import { agentFleetService, isActiveSwarmStatus } from './agentFleetService.js';
import { assignedTaskRunner } from './assignedTaskRunner.js';
import { remoteControlService } from './remoteControlService.js';
import { projectRegistry } from './projectRegistry.js';
import { actionConfigService } from './actionConfigService.js';
import { loadArenaConfig, readProjectStack } from './arenaConfig.js';
import { executeCheck, pendingCheckResult } from './checkRunner.js';
import { processManager } from './processManager.js';
import { findTaskFile } from './taskFileLookup.js';
import { taskEventSource } from './taskEventSource.js';
import { backlogWatcher } from './backlogWatcher.js';
import { logger } from './logger.js';
import { prReviewService, prWatcher } from './prReviewApp.js';
import type { SwarmEventPayload, SwarmSession } from './swarmTypes.js';

/**
 * Automations в приложении (TASK-74, decision-52): движок `AutomationEngine` со всеми настоящими
 * зависимостями — флот агентов, проверки проекта, разовые команды, реестр проектов, шина событий,
 * источник событий задач и флаг встроенного правила назначенных задач.
 */

const CONFIG_FILENAME = '.projecthub.json';

function snapshot(session: SwarmSession): SwarmSnapshot {
  return {
    id: session.id,
    status: session.status,
    ...(session.totalCostUsd !== undefined ? { totalCostUsd: session.totalCostUsd } : {}),
    ...(session.error ? { error: session.error } : {}),
    agents: session.agents.map((a) => ({ id: a.id, status: a.status, ...(a.error ? { error: a.error } : {}) }))
  };
}

const actions: ActionDeps = {
  startRoleAgent: async (req) =>
    agentFleetService.startRoleAgent({
      projectPath: req.projectPath,
      roleSlug: req.roleSlug,
      prompt: req.prompt,
      mode: req.mode,
      useWorktrees: true,
      ...(req.taskId ? { taskId: req.taskId } : {}),
      ...(req.taskTitle ? { taskTitle: req.taskTitle } : {}),
      ...(req.budgetUsd !== undefined ? { budgetUsd: req.budgetUsd } : {}),
      ...(req.maxIterations ? { maxIterations: req.maxIterations } : {}),
      // Встроенное правило сохраняет прежний источник HITL «назначенная задача».
      origin: req.automation.ruleKey.startsWith('builtin:') ? 'assigned' : 'automation',
      automation: req.automation
    }),
  findTaskTitle: async (root, taskId) => {
    const task = await findTaskFile(root, taskId).catch(() => null);
    return task && typeof task.data.title === 'string' ? task.data.title : null;
  },
  loadChecks: async (root) => (await loadArenaConfig(root)).checks,
  runCheck: (def, workdir) => executeCheck(pendingCheckResult(def), def, workdir),
  readProjectStack: (root) => readProjectStack(root),
  getProjectConfig: (root) => actionConfigService.getConfig(root),
  runOnce: (command, options) => processManager.runOnce(command, options),
  startPrReview: (req) =>
    prReviewService.start({
      projectPath: req.projectPath,
      prNumber: req.prNumber,
      ...(req.headSha ? { headSha: req.headSha } : {}),
      reviewers: req.reviewers,
      ...(req.verifier ? { verifier: req.verifier } : {}),
      ...(req.budgetUsd !== undefined ? { budgetUsd: req.budgetUsd } : {}),
      publish: req.publish,
      origin: 'automation',
      automation: req.automation,
      onSessionStarted: req.onSessionStarted
    }),
  publish: (event) => appEventBus.publish(event)
};

export const automationEngine = new AutomationEngine({
  store: new AutomationStore(getUserDataDir()),
  listProjects: async () => (await projectRegistry.getProjects()).map((p) => p.path),
  statProjectConfig: async (root) =>
    fs
      .stat(path.join(root, CONFIG_FILENAME))
      .then((s) => s.mtimeMs)
      .catch(() => null),
  readProjectRules: async (root) => {
    const file = path.join(root, CONFIG_FILENAME);
    try {
      const [text, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
      const parsed = JSON.parse(text) as { automations?: unknown };
      return { raw: parsed.automations, mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  },
  actions,
  subscribeBus: (listener) => appEventBus.subscribe(listener),
  publish: (event) => appEventBus.publish(event),
  subscribeSwarms: (listener) => {
    const handler = (event: SwarmEventPayload) => {
      if (event.session) listener(snapshot(event.session));
    };
    agentFleetService.on('swarmEvent', handler);
    return () => agentFleetService.off('swarmEvent', handler);
  },
  getSwarm: (id) => {
    const session = agentFleetService.getSwarm(id);
    return session ? snapshot(session) : undefined;
  },
  hasActiveSwarm: (root, taskId) =>
    agentFleetService.listSwarms(root).some((s) => s.taskId === taskId && isActiveSwarmStatus(s.status)),
  builtin: {
    isEnabled: () => assignedTaskRunner.isEnabled(),
    // Флаг по-прежнему живёт в настройках Remote Control: оба переключателя пишут одно поле.
    setEnabled: async (enabled) => {
      await remoteControlService.updateConfig({ autoStartAssignedTasks: enabled });
    },
    onEnabledChange: (listener) => assignedTaskRunner.onEnabledChange(listener),
    decide: (event, lastStartedAt, now) => assignedTaskRunner.decide(event, lastStartedAt, now)
  },
  // Лениво: модуль входит в цикл импортов через mcpServerService — значение берётся при вызове.
  taskEvents: { setProjects: (roots) => taskEventSource.setProjects(roots) },
  prEvents: { setProjects: (roots) => prWatcher.setProjects(roots) },
  getOpenProject: () => backlogWatcher.currentProject(),
  onOpenProjectChange: (listener) => backlogWatcher.onProjectChange(() => listener()),
  now: () => Date.now(),
  log: (level, message) => (level === 'warn' ? logger.warn(message) : logger.info(message))
});
