import type { AgentSlotState, AgentUsage, SwarmSession } from '../types/electron';

/**
 * Форматирование метрик Swarm для рендерера (TASK-56). Зеркалит форматтеры из
 * `electron/services/agentCost.ts`, но не тянет main-код в бандл рендерера.
 */

export function formatUsd(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function formatTokens(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function formatDuration(ms: number | undefined, secondsUnit = 's'): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} ${secondsUnit}`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}${secondsUnit}`;
}

export interface SwarmTotals {
  usage: AgentUsage;
  costUsd?: number;
  costKnown: boolean;
  durationMs: number;
}

export function agentInputTokens(usage: AgentUsage): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

/** Суммарные токены/стоимость/длительность по сессии (для сводки в шапке арены). */
export function summarizeSwarm(session: SwarmSession): SwarmTotals {
  const usage: AgentUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    costSource: 'unknown'
  };
  let cost = 0;
  let costKnown = false;
  for (const agent of session.agents) {
    const u = agent.metrics?.usage;
    if (u) {
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
      usage.cacheReadTokens += u.cacheReadTokens;
      usage.cacheCreationTokens += u.cacheCreationTokens;
      usage.totalTokens += u.totalTokens;
    }
    const c = u?.costUsd ?? agent.metrics?.costUsd;
    if (typeof c === 'number') {
      cost += c;
      costKnown = true;
    }
  }
  const end =
    session.completedAt ??
    Math.max(session.createdAt, ...session.agents.map((a: AgentSlotState) => a.metrics?.endTime ?? 0));
  return {
    usage,
    costUsd: costKnown ? cost : undefined,
    costKnown,
    durationMs: session.status === 'running' ? Date.now() - session.createdAt : Math.max(0, end - session.createdAt)
  };
}
