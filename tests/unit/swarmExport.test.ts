import { describe, expect, it } from 'vitest';
import { exportSwarmSessionJson, exportSwarmSessionMarkdown, summarizeSwarmSession } from '../../electron/services/swarmExport';
import type { SwarmSession } from '../../electron/services/swarmTypes';

function session(): SwarmSession {
  return {
    id: 'swarm-1',
    projectPath: 'C:\\Projects\\Demo',
    taskId: 'TASK-56',
    taskTitle: 'Персистентность',
    mode: 'fan_out',
    prompt: 'Сделай ```что-то```',
    baseBranch: 'master',
    useWorktrees: true,
    status: 'completed',
    createdAt: 1_000,
    completedAt: 61_000,
    budgetUsd: 5,
    winnerAgentId: 'a1',
    agents: [
      {
        id: 'a1',
        config: { id: 'a1', name: 'Claude', engine: 'claude-cli', role: 'implementer', providerConfig: { provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk' } },
        status: 'completed',
        worktreeBranch: 'swarm/1/claude',
        commitHash: 'abcdef1234',
        logs: ['l1'],
        liveOutput: 'stream',
        finalOutput: 'final answer',
        diffSummary: { filesChanged: 2, insertions: 10, deletions: 3, patch: 'diff --git a/x b/x\n+1\n-2' },
        metrics: {
          startTime: 1_000,
          endTime: 31_000,
          durationMs: 30_000,
          usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50, cacheCreationTokens: 0, totalTokens: 1250, costUsd: 0.5, costSource: 'provider', model: 'claude-opus-5' },
          costUsd: 0.5
        },
        winner: true
      },
      {
        id: 'a2',
        config: { id: 'a2', name: 'DeepSeek', engine: 'api', role: 'contender' },
        status: 'budget_exceeded',
        error: 'Бюджет агента $0.10 превышен',
        logs: [],
        liveOutput: 'partial',
        metrics: { startTime: 1_000, durationMs: 5_000, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 15, costUsd: 0.12, costSource: 'price-table' } }
      }
    ]
  };
}

describe('swarmExport (TASK-56)', () => {
  it('summarizeSwarmSession суммирует usage, стоимость и длительность', () => {
    const totals = summarizeSwarmSession(session());
    expect(totals.usage.totalTokens).toBe(1265);
    expect(totals.costUsd).toBeCloseTo(0.62, 6);
    expect(totals.costKnown).toBe(true);
    expect(totals.durationMs).toBe(60_000);
    expect(totals.agentsCompleted).toBe(1);
    expect(totals.agentsFailed).toBe(1);

    const noUsage = { ...session(), agents: [{ ...session().agents[0], metrics: { startTime: 1 } }] };
    expect(summarizeSwarmSession(noUsage).costKnown).toBe(false);
    expect(summarizeSwarmSession(noUsage).costUsd).toBeUndefined();
  });

  it('Markdown-отчёт содержит сводку, таблицу агентов, вывод и дифф; бэктики в промпте не ломают ограждение', () => {
    const md = exportSwarmSessionMarkdown(session());
    expect(md).toContain('# Swarm-сессия swarm-1');
    expect(md).toContain('**Задача:** TASK-56 — Персистентность');
    expect(md).toContain('**Стоимость:** $0.62 (бюджет $5.00)');
    expect(md).toContain('| 🏆 Claude | claude-cli | implementer | завершён | 30.0 с | 1050 / 200 | $0.50 | 2 файлов, +10/-3 | `abcdef1` |');
    expect(md).toContain('| DeepSeek | api | contender | бюджет превышен |');
    expect(md).toContain('````\nСделай ```что-то```\n````');
    expect(md).toContain('### Дифф');
    expect(md).toContain('```diff');
    expect(md).toContain('final answer');
    expect(md).not.toContain('sk');
  });

  it('Markdown усекает длинный вывод и может опустить дифф', () => {
    const s = session();
    s.agents[0].finalOutput = 'y'.repeat(100);
    const md = exportSwarmSessionMarkdown(s, { maxOutputChars: 10, includePatch: false });
    expect(md).toContain('yyyyyyyyyy\n…[усечено: ещё 90 символов]');
    expect(md).not.toContain('### Дифф');
  });

  it('JSON-экспорт валиден, без логов/потокового вывода и ключей провайдера, с итогами', () => {
    const parsed = JSON.parse(exportSwarmSessionJson(session()));
    expect(parsed.format).toBe('projecthub-swarm-session');
    expect(parsed.totals.costUsd).toBeCloseTo(0.62, 6);
    expect(parsed.session.id).toBe('swarm-1');
    expect(parsed.session.agents[0].logs).toBeUndefined();
    expect(parsed.session.agents[0].liveOutput).toBeUndefined();
    expect(parsed.session.agents[0].finalOutput).toBe('final answer');
    expect(parsed.session.agents[0].config.providerConfig.apiKey).toBeUndefined();
    expect(parsed.session.agents[0].metrics.usage.costUsd).toBe(0.5);
  });
});
