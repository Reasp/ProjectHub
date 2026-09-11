import { describe, expect, it, vi } from 'vitest';

// arenaJudgeService тянет processManager и aiAgentService — обоим нужен electron.
vi.mock('electron', () => ({
  shell: { openExternal: async () => {} },
  app: { getPath: () => process.cwd(), getName: () => 'ProjectHub', getVersion: () => '0.0.0' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => {}, on: () => {} },
  safeStorage: { isEncryptionAvailable: () => false }
}));

const { filesFromPatch, judgeableAgents, modulesFromPatch, runWithConcurrency } = await import(
  '../../electron/services/arenaJudgeService'
);
const { parseDetectChangesOutput } = await import('../../electron/services/gitNexusClient');

import type { AgentSlotState, SwarmSession } from '../../electron/services/swarmTypes';

const PATCH = [
  'diff --git a/electron/services/a.ts b/electron/services/a.ts',
  '+const a = 1;',
  'diff --git a/electron/ipc/b.ts b/electron/ipc/b.ts',
  '-const b = 2;',
  'diff --git a/src/components/ai/c.tsx b/src/components/ai/c.tsx',
  '+const c = 3;',
  'diff --git a/README.md b/README.md',
  '+doc'
].join('\n');

describe('modulesFromPatch', () => {
  it('модуль это два первых сегмента пути, файл в корне даёт "."', () => {
    expect(modulesFromPatch(PATCH)).toEqual(['electron/services', 'electron/ipc', 'src/components', '.']);
  });

  it('пустой патч не даёт модулей', () => {
    expect(modulesFromPatch('')).toEqual([]);
    expect(modulesFromPatch('просто текст')).toEqual([]);
  });
});

describe('filesFromPatch', () => {
  it('собирает изменённые файлы без дублей и без префикса a/', () => {
    expect(filesFromPatch(PATCH)).toEqual([
      'electron/services/a.ts',
      'electron/ipc/b.ts',
      'src/components/ai/c.tsx',
      'README.md'
    ]);
  });

  it('повторный заголовок того же файла не дублируется', () => {
    const patch = 'diff --git a/x.ts b/x.ts\n+1\ndiff --git a/x.ts b/x.ts\n+2';
    expect(filesFromPatch(patch)).toEqual(['x.ts']);
  });
});

describe('judgeableAgents', () => {
  function agent(id: string, status: AgentSlotState['status'], worktreeMissing = false): AgentSlotState {
    return {
      id,
      config: { id, name: id, engine: 'api' },
      status,
      worktreeMissing: worktreeMissing || undefined,
      logs: [],
      liveOutput: '',
      metrics: { startTime: 0 }
    };
  }

  const session = (agents: AgentSlotState[]): SwarmSession =>
    ({
      id: 's',
      projectPath: '.',
      mode: 'fan_out',
      prompt: 'p',
      baseBranch: 'main',
      useWorktrees: true,
      status: 'completed',
      createdAt: 0,
      agents
    }) as SwarmSession;

  it('судятся завершённые кандидаты, включая упавших и упёршихся в бюджет', () => {
    const agents = [
      agent('done', 'completed'),
      agent('failed', 'failed'),
      agent('budget', 'budget_exceeded'),
      agent('running', 'running'),
      agent('stopped', 'stopped'),
      agent('lost', 'completed', true)
    ];
    expect(judgeableAgents(session(agents)).map((a) => a.id)).toEqual(['done', 'failed', 'budget']);
  });
});

describe('runWithConcurrency', () => {
  it('выполняет все задачи и сохраняет порядок результатов', async () => {
    const tasks = [3, 1, 2].map((n) => async () => {
      await new Promise((r) => setTimeout(r, n * 10));
      return n;
    });
    expect(await runWithConcurrency(tasks, 2)).toEqual([3, 1, 2]);
  });

  it('не превышает лимит одновременных задач', async () => {
    let running = 0;
    let peak = 0;
    const tasks = Array.from({ length: 8 }, () => async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return 0;
    });
    await runWithConcurrency(tasks, 3);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('пустой список задач отрабатывает мгновенно', async () => {
    expect(await runWithConcurrency([], 4)).toEqual([]);
  });
});

describe('parseDetectChangesOutput (GitNexus)', () => {
  it('разбирает сводку detect-changes', () => {
    const output = [
      'Changes: 11 files, 43 symbols',
      'Affected processes: 1',
      'Risk level: medium',
      '',
      'Changed symbols:',
      '  Symbol foo → src/a.ts'
    ].join('\n');
    expect(parseDetectChangesOutput(output)).toEqual({
      changedFiles: 11,
      changedSymbols: 43,
      affectedProcesses: 1,
      riskLevel: 'medium'
    });
  });

  it('«нет изменений» это нули, а не отсутствие данных', () => {
    expect(parseDetectChangesOutput('No changes detected.')).toEqual({ changedFiles: 0, changedSymbols: 0 });
  });

  it('единственное число в сводке тоже разбирается', () => {
    expect(parseDetectChangesOutput('Changes: 1 file, 1 symbol')).toMatchObject({
      changedFiles: 1,
      changedSymbols: 1
    });
  });

  it('посторонний вывод и ошибки дают null', () => {
    expect(parseDetectChangesOutput('')).toBeNull();
    expect(parseDetectChangesOutput('Error: repository not indexed')).toBeNull();
  });
});
