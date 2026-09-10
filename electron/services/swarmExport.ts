import type { AgentSlotState, SwarmSession } from './swarmTypes.js';
import { addUsage, emptyUsage, formatTokens, formatUsd, type AgentUsage } from './agentCost.js';

/**
 * Экспорт swarm-сессии в Markdown-отчёт и JSON (TASK-56, AC #5) — для вложения в задачу
 * Backlog.md или описание PR. Чистый модуль без Electron.
 */

export interface SwarmSessionTotals {
  usage: AgentUsage;
  costUsd?: number;
  /** Стоимость известна хотя бы по одному агенту. */
  costKnown: boolean;
  durationMs: number;
  agentsCompleted: number;
  agentsFailed: number;
}

export function agentUsage(agent: AgentSlotState): AgentUsage | undefined {
  return agent.metrics?.usage;
}

/** Сводка по сессии: суммарные токены, стоимость и длительность (от старта до завершения). */
export function summarizeSwarmSession(session: SwarmSession): SwarmSessionTotals {
  let usage = emptyUsage();
  let costKnown = false;
  let completed = 0;
  let failed = 0;
  for (const agent of session.agents) {
    const u = agentUsage(agent);
    if (u) {
      usage = addUsage(usage, u);
      if (typeof u.costUsd === 'number') costKnown = true;
    } else if (typeof agent.metrics?.costUsd === 'number') {
      usage = { ...usage, costUsd: (usage.costUsd ?? 0) + agent.metrics.costUsd };
      costKnown = true;
    }
    if (agent.status === 'completed') completed++;
    if (agent.status === 'failed' || agent.status === 'budget_exceeded') failed++;
  }
  const end = session.completedAt ?? Math.max(session.createdAt, ...session.agents.map((a) => a.metrics?.endTime ?? 0));
  return {
    usage,
    costUsd: costKnown ? usage.costUsd ?? 0 : undefined,
    costKnown,
    durationMs: Math.max(0, end - session.createdAt),
    agentsCompleted: completed,
    agentsFailed: failed
  };
}

function fmtDuration(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} с`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} мин ${seconds} с`;
}

function fmtDate(ts: number | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: 'ожидает',
    preparing: 'подготовка',
    running: 'выполняется',
    completed: 'завершён',
    failed: 'ошибка',
    stopped: 'остановлен',
    interrupted: 'прерван',
    budget_exceeded: 'бюджет превышен'
  };
  return map[status] ?? status;
}

function fence(text: string, lang = ''): string {
  // Если внутри уже есть тройные бэктики — удлиняем ограждение.
  let ticks = '```';
  while (text.includes(ticks)) ticks += '`';
  return `${ticks}${lang}\n${text.replace(/\r\n/g, '\n').trimEnd()}\n${ticks}`;
}

export interface MarkdownExportOptions {
  /** Максимум символов вывода агента в отчёте. */
  maxOutputChars?: number;
  /** Максимум символов диффа агента в отчёте. */
  maxPatchChars?: number;
  includePatch?: boolean;
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[усечено: ещё ${text.length - limit} символов]`;
}

/** Markdown-отчёт по сессии: сводка, таблица агентов, вывод и дифф каждого. */
export function exportSwarmSessionMarkdown(session: SwarmSession, options: MarkdownExportOptions = {}): string {
  const maxOutput = options.maxOutputChars ?? 20_000;
  const maxPatch = options.maxPatchChars ?? 30_000;
  const includePatch = options.includePatch !== false;
  const totals = summarizeSwarmSession(session);
  const modeLabel = session.mode === 'handoff' ? 'Handoff (конвейер)' : 'Fan-Out (арена)';
  const lines: string[] = [];

  lines.push(`# Swarm-сессия ${session.id}`);
  lines.push('');
  if (session.taskId) lines.push(`- **Задача:** ${session.taskId}${session.taskTitle ? ` — ${session.taskTitle}` : ''}`);
  lines.push(`- **Проект:** \`${session.projectPath}\``);
  lines.push(`- **Режим:** ${modeLabel}`);
  lines.push(`- **Базовая ветка:** \`${session.baseBranch}\``);
  lines.push(`- **Статус:** ${statusLabel(session.status)}`);
  lines.push(`- **Создана:** ${fmtDate(session.createdAt)}${session.completedAt ? `, завершена: ${fmtDate(session.completedAt)}` : ''}`);
  lines.push(`- **Длительность:** ${fmtDuration(totals.durationMs)}`);
  lines.push(
    `- **Токены:** ${formatTokens(totals.usage.totalTokens)} (вход ${formatTokens(totals.usage.inputTokens)}, выход ${formatTokens(totals.usage.outputTokens)}, кэш чтение ${formatTokens(totals.usage.cacheReadTokens)}, кэш запись ${formatTokens(totals.usage.cacheCreationTokens)})`
  );
  lines.push(`- **Стоимость:** ${totals.costKnown ? formatUsd(totals.costUsd) : 'неизвестна'}${session.budgetUsd ? ` (бюджет ${formatUsd(session.budgetUsd)})` : ''}`);
  if (session.winnerAgentId) {
    const winner = session.agents.find((a) => a.id === session.winnerAgentId);
    lines.push(`- **Победитель:** ${winner?.config.name ?? session.winnerAgentId}`);
  }
  if (session.error) lines.push(`- **Ошибка:** ${session.error}`);
  lines.push('');
  lines.push('## Задание');
  lines.push('');
  lines.push(fence(session.prompt || '', ''));
  lines.push('');

  lines.push('## Агенты');
  lines.push('');
  lines.push('| Агент | Движок | Роль | Статус | Длительность | Токены (вход/выход) | Стоимость | Дифф | Коммит |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const agent of session.agents) {
    const u = agentUsage(agent);
    const tokens = u ? `${formatTokens(u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens)} / ${formatTokens(u.outputTokens)}` : agent.metrics.tokensEstimated ? `~${formatTokens(agent.metrics.tokensEstimated)}` : '—';
    const cost = typeof (u?.costUsd ?? agent.metrics.costUsd) === 'number' ? formatUsd(u?.costUsd ?? agent.metrics.costUsd) : '—';
    const diff = agent.diffSummary ? `${agent.diffSummary.filesChanged} файлов, +${agent.diffSummary.insertions}/-${agent.diffSummary.deletions}` : '—';
    const commit = agent.commitHash ? `\`${agent.commitHash.slice(0, 7)}\`` : agent.stashHash ? `stash \`${agent.stashHash.slice(0, 7)}\`` : '—';
    const name = `${agent.winner || session.winnerAgentId === agent.id ? '🏆 ' : ''}${agent.config.name}`;
    lines.push(
      `| ${name} | ${agent.config.engine} | ${agent.config.role ?? '—'} | ${statusLabel(agent.status)} | ${fmtDuration(agent.metrics.durationMs)} | ${tokens} | ${cost} | ${diff} | ${commit} |`
    );
  }
  lines.push('');

  if (session.mode === 'handoff' && session.handoffStages?.length) {
    lines.push('## Этапы конвейера');
    lines.push('');
    for (const stage of session.handoffStages) {
      lines.push(`${stage.stageIndex + 1}. **${stage.role}** — ${statusLabel(stage.status)}${stage.durationMs ? ` (${fmtDuration(stage.durationMs)})` : ''}`);
    }
    lines.push('');
  }

  for (const agent of session.agents) {
    lines.push(`## ${agent.config.name}`);
    lines.push('');
    if (agent.worktreeBranch) lines.push(`- Ветка: \`${agent.worktreeBranch}\``);
    if (agent.worktreePath) lines.push(`- Worktree: \`${agent.worktreePath}\``);
    if (agent.error) lines.push(`- Ошибка: ${agent.error}`);
    const u = agentUsage(agent);
    if (u) {
      lines.push(
        `- Usage: вход ${formatTokens(u.inputTokens)}, выход ${formatTokens(u.outputTokens)}, кэш чтение ${formatTokens(u.cacheReadTokens)}, кэш запись ${formatTokens(u.cacheCreationTokens)}${u.model ? `, модель \`${u.model}\`` : ''}${typeof u.costUsd === 'number' ? `, стоимость ${formatUsd(u.costUsd)} (${u.costSource})` : ''}`
      );
    }
    lines.push('');
    const output = agent.finalOutput || agent.liveOutput;
    if (output) {
      lines.push('### Вывод');
      lines.push('');
      lines.push(fence(clip(output, maxOutput), ''));
      lines.push('');
    }
    if (includePatch && agent.diffSummary?.patch) {
      lines.push('### Дифф');
      lines.push('');
      lines.push(fence(clip(agent.diffSummary.patch, maxPatch), 'diff'));
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** JSON-экспорт: сессия без хвостов логов/потокового вывода, но с итогами и usage. */
export function exportSwarmSessionJson(session: SwarmSession): string {
  const totals = summarizeSwarmSession(session);
  const payload = {
    exportedAt: new Date().toISOString(),
    format: 'projecthub-swarm-session',
    version: 1,
    totals: {
      usage: totals.usage,
      costUsd: totals.costUsd,
      durationMs: totals.durationMs,
      agentsCompleted: totals.agentsCompleted,
      agentsFailed: totals.agentsFailed
    },
    session: {
      ...session,
      agents: session.agents.map((a) => ({
        ...a,
        logs: undefined,
        liveOutput: undefined,
        liveOutputTruncated: undefined,
        config: a.config.providerConfig
          ? { ...a.config, providerConfig: { ...a.config.providerConfig, apiKey: undefined } }
          : a.config
      }))
    }
  };
  return JSON.stringify(payload, null, 2);
}
