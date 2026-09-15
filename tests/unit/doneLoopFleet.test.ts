import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { AgentFleetService, type AgentSlotConfig, type SwarmSession } from '../../electron/services/agentFleetService';
import { aiAgentService, type AIMessage } from '../../electron/services/aiAgentService';
import { processManager, type RunOnceResult } from '../../electron/services/processManager';
import { appEventBus } from '../../electron/services/eventBus';
import { migrateStoredSession } from '../../electron/services/swarmSessionStore';
import { REPORT_FENCE } from '../../electron/services/doneLoop';

const TASK_FILE = [
  '---',
  'id: TASK-1',
  'title: Сумма',
  'status: In Progress',
  "created_date: '2026-09-15 10:00'",
  '---',
  '',
  '## Description',
  '',
  '<!-- SECTION:DESCRIPTION:BEGIN -->',
  'Реализовать сумму',
  '<!-- SECTION:DESCRIPTION:END -->',
  '',
  '## Acceptance Criteria',
  '<!-- AC:BEGIN -->',
  '- [ ] #1 Функция sum складывает числа',
  '- [x] #2 Задача заведена',
  '<!-- AC:END -->',
  ''
].join('\n');

const report = (status: string, evidence: string) =>
  `Работаю.\n\`\`\`${REPORT_FENCE}\n${JSON.stringify({ summary: `ход: ${status}`, criteria: [{ index: 1, status, evidence }] })}\n\`\`\``;

const runOnceResult = (exitCode: number, output: string): RunOnceResult => ({
  exitCode,
  output,
  truncated: false,
  timedOut: false,
  durationMs: 5,
  startedAt: Date.now()
});

const agent: AgentSlotConfig = {
  id: 'done-agent',
  name: 'Implementer',
  engine: 'api',
  providerConfig: { provider: 'anthropic', model: 'claude-sonnet-5' }
};

async function waitForEnd(fleet: AgentFleetService, id: string): Promise<SwarmSession> {
  await vi.waitFor(
    () => {
      const status = fleet.getSwarm(id)?.status;
      if (status === 'running' || status === 'preparing') throw new Error(`still ${status}`);
    },
    { timeout: 5000, interval: 20 }
  );
  return fleet.getSwarm(id)!;
}

describe('agentFleetService: цикл «до готовности» (TASK-75)', () => {
  let projectDir: string;
  let taskFile: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-doneloop-'));
    await fs.mkdir(path.join(projectDir, 'backlog', 'tasks'), { recursive: true });
    taskFile = path.join(projectDir, 'backlog', 'tasks', 'task-1 - Сумма.md');
    await fs.writeFile(taskFile, TASK_FILE, 'utf-8');
    await fs.writeFile(
      path.join(projectDir, '.projecthub.json'),
      JSON.stringify({
        checks: [{ id: 'test', kind: 'test', name: 'Tests', command: 'npm test' }],
        doneLoop: { docChecks: false }
      }),
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('повторяет ход с ошибками проверок в той же истории и при успехе переводит задачу в Review', async () => {
    const requests: AIMessage[][] = [];
    const replies = [report('done', 'готово'), report('done', 'src/sum.ts:1 — sum(a, b); tests/sum.test.ts проходит')];
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (req, onChunk, onComplete) => {
      requests.push(req.messages.map((m) => ({ ...m })));
      const content = replies[requests.length - 1];
      onChunk({ text: content });
      onComplete({ id: `m${requests.length}`, role: 'assistant', content, timestamp: new Date().toISOString() });
    });
    const runOnce = vi
      .spyOn(processManager, 'runOnce')
      .mockResolvedValueOnce(runOnceResult(1, 'FAIL tests/sum.test.ts > sum\nTests  1 failed | 2 passed (3)'))
      .mockResolvedValueOnce(runOnceResult(0, 'Tests  3 passed (3)'));
    const publish = vi.spyOn(appEventBus, 'publish');

    const fleet = new AgentFleetService();
    const started = await fleet.startDoneLoop({
      projectPath: projectDir,
      taskId: 'TASK-1',
      prompt: '[TASK-1]: Сумма',
      agent,
      useWorktrees: false
    });
    const session = await waitForEnd(fleet, started.id);

    expect(session.status).toBe('completed');
    const loop = session.doneLoop!;
    expect(loop.outcome).toBe('success');
    expect(loop.iterations).toHaveLength(2);
    expect(loop.iterations[0]).toMatchObject({ decision: 'retry', reportFound: true });
    expect(loop.iterations[0].checks[0]).toMatchObject({ status: 'failed', failedTests: 1 });
    // Evidence «готово» слишком короткий — критерий не засчитан, хотя агент заявил done.
    expect(loop.iterations[0].criteria[0]).toMatchObject({ accepted: false, reported: 'done' });
    expect(loop.iterations[1]).toMatchObject({ decision: 'finish' });
    expect(runOnce).toHaveBeenCalledTimes(2);

    // Второй ход — продолжение того же диалога: история + промпт повтора с хвостом ошибки.
    expect(requests[1]).toHaveLength(3);
    expect(requests[1][1].role).toBe('assistant');
    expect(requests[1][2].content).toContain('FAIL tests/sum.test.ts > sum');
    expect(requests[1][2].content).toContain('#1 Функция sum складывает числа');

    const saved = await fs.readFile(taskFile, 'utf-8');
    expect(saved).toMatch(/status: Review/);
    expect(saved).toContain('- [x] #1 Функция sum складывает числа');
    expect(saved).toContain('<!-- SECTION:FINAL_SUMMARY:BEGIN -->');
    expect(saved).toContain('итераций 2 из 5');
    expect(saved).not.toMatch(/status: Done/);
    expect(loop.task).toMatchObject({ movedToReview: true, criteriaChecked: [1], finalSummaryWritten: true });

    const outcomes = publish.mock.calls.map(([e]) => e.type).filter((t) => t === 'agent:finished' || t === 'agent:failed');
    expect(outcomes).toEqual(['agent:finished']);
  });

  it('при исчерпании лимита итераций не трогает задачу и публикует agent:failed с причиной', async () => {
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (_req, _onChunk, onComplete) => {
      onComplete({ id: 'm', role: 'assistant', content: report('not_done', 'не успел'), timestamp: new Date().toISOString() });
    });
    vi.spyOn(processManager, 'runOnce').mockResolvedValue(runOnceResult(0, 'ok'));
    const publish = vi.spyOn(appEventBus, 'publish');

    const fleet = new AgentFleetService();
    const started = await fleet.startDoneLoop({
      projectPath: projectDir,
      taskId: 'TASK-1',
      prompt: 'x',
      agent,
      useWorktrees: false,
      maxIterations: 2
    });
    const session = await waitForEnd(fleet, started.id);

    expect(session.status).toBe('failed');
    expect(session.doneLoop).toMatchObject({ outcome: 'iteration_limit', phase: 'failed' });
    expect(session.error).toMatch(/лимит итераций \(2\)/);
    expect(await fs.readFile(taskFile, 'utf-8')).toBe(TASK_FILE);

    const failed = publish.mock.calls.map(([e]) => e).filter((e) => e.type === 'agent:failed');
    expect(failed).toHaveLength(1);
    expect((failed[0] as { error: string }).error).toMatch(/До готовности: .*лимит итераций/);
  });

  it('откатывает отметки критериев, поставленные агентом в файле задачи', async () => {
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (_req, _onChunk, onComplete) => {
      // Агент «сам» закрывает критерий в файле — ProjectHub должен это откатить.
      const raw = await fs.readFile(taskFile, 'utf-8');
      await fs.writeFile(taskFile, raw.replace('- [ ] #1', '- [x] #1'), 'utf-8');
      onComplete({ id: 'm', role: 'assistant', content: 'без отчёта', timestamp: new Date().toISOString() });
    });
    vi.spyOn(processManager, 'runOnce').mockResolvedValue(runOnceResult(0, 'ok'));

    const fleet = new AgentFleetService();
    const started = await fleet.startDoneLoop({ projectPath: projectDir, taskId: 'TASK-1', prompt: 'x', agent, useWorktrees: false, maxIterations: 1 });
    const session = await waitForEnd(fleet, started.id);

    expect(session.doneLoop!.iterations[0].tamperedCriteria).toBe(true);
    expect(session.doneLoop!.iterations[0].reportError).toMatch(/нет отчёта/);
    expect(await fs.readFile(taskFile, 'utf-8')).toContain('- [ ] #1 Функция sum складывает числа');
  });

  it('без задачи Backlog.md цикл не стартует', async () => {
    const fleet = new AgentFleetService();
    await expect(
      fleet.startDoneLoop({ projectPath: projectDir, taskId: 'TASK-404', prompt: 'x', agent, useWorktrees: false })
    ).rejects.toThrow(/не найдена/);
  });

  it('хранилище сессий сохраняет режим done_loop при миграции', () => {
    const migrated = migrateStoredSession({ id: 'swarm-1', projectPath: 'p', agents: [], mode: 'done_loop' });
    expect(migrated?.mode).toBe('done_loop');
  });
});
