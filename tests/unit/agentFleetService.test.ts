import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseDiffSummary,
  AgentFleetService,
  type AgentSlotConfig,
  type SwarmSession
} from '../../electron/services/agentFleetService';
import { worktreeService } from '../../electron/services/worktreeService';
import { aiAgentService } from '../../electron/services/aiAgentService';

describe('agentFleetService unit tests (TASK-54)', () => {
  describe('parseDiffSummary', () => {
    it('корректно обрабатывает пустой или пустой от пробелов дифф', () => {
      const summary = parseDiffSummary('');
      expect(summary.filesChanged).toBe(0);
      expect(summary.insertions).toBe(0);
      expect(summary.deletions).toBe(0);
      expect(summary.patch).toBe('');

      const whitespaceSummary = parseDiffSummary('   \n  \n');
      expect(whitespaceSummary.filesChanged).toBe(0);
    });

    it('корректно подсчитывает измененные файлы, добавления и удаления в Git diff', () => {
      const patch = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,5 @@
 const a = 1;
+const b = 2;
+const c = 3;
-const d = 4;
diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -10,2 +10,1 @@
-console.log('old');
+console.log('new');
`;

      const summary = parseDiffSummary(patch);
      expect(summary.filesChanged).toBe(2);
      expect(summary.insertions).toBe(3); // 2 in index.ts + 1 in utils.ts
      expect(summary.deletions).toBe(2); // 1 in index.ts + 1 in utils.ts
      expect(summary.patch).toBe(patch);
    });
  });

  describe('AgentFleetService Orchestrator', () => {
    let fleetService: AgentFleetService;

    beforeEach(() => {
      fleetService = new AgentFleetService();
      vi.restoreAllMocks();
    });

    it('startFanOut: создает сессию роя и связывает каждого агента с Git Worktree (AC #1, #2, #3)', async () => {
      const mockWorktreeInfo = (branch: string) => ({
        path: `F:/ProjectHub/.worktrees/${branch.replace(/\//g, '_')}`,
        branch,
        commit: '1234567',
        isMain: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false
      });

      const addWorktreeSpy = vi
        .spyOn(worktreeService, 'addWorktree')
        .mockImplementation(async (_p, opts) => mockWorktreeInfo(opts.branch));

      vi.spyOn(worktreeService, 'getWorktreeDiff').mockResolvedValue(
        `diff --git a/app.ts b/app.ts\n+++ b/app.ts\n+console.log(1);\n`
      );

      vi.spyOn(aiAgentService, 'streamChat').mockImplementation(
        async (_req, onChunk, onComplete) => {
          onChunk({ text: 'Hello from agent' });
          onComplete({
            id: 'm1',
            role: 'assistant',
            content: 'Hello from agent',
            timestamp: new Date().toISOString()
          });
        }
      );

      const agents: AgentSlotConfig[] = [
        {
          id: 'agent-1',
          name: 'Claude Contender',
          engine: 'api',
          role: 'Contender A'
        },
        {
          id: 'agent-2',
          name: 'DeepSeek Contender',
          engine: 'api',
          role: 'Contender B'
        }
      ];

      const session = await fleetService.startFanOut({
        projectPath: 'F:/ProjectHub',
        prompt: 'Создать модуль аналитики',
        useWorktrees: true,
        agents
      });

      expect(session).toBeDefined();
      expect(session.mode).toBe('fan_out');
      expect(session.agents).toHaveLength(2);
      expect(session.useWorktrees).toBe(true);

      // Ждем завершения фонового выполнения агентов
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(addWorktreeSpy).toHaveBeenCalledTimes(2);
      expect(session.agents[0].worktreePath).toContain('.worktrees');
      expect(session.agents[1].worktreePath).toContain('.worktrees');
    });

    it('pickWinner: в 1 клик сливает ветку победителя и безопасно очищает проигравших (AC #5)', async () => {
      const mergeSpy = vi
        .spyOn(worktreeService, 'mergeWorktree')
        .mockResolvedValue({ success: true });

      const removeSpy = vi
        .spyOn(worktreeService, 'removeWorktree')
        .mockResolvedValue(true);

      const pruneSpy = vi
        .spyOn(worktreeService, 'pruneWorktrees')
        .mockResolvedValue(true);

      // Создаем ручную сессию
      const mockSession: SwarmSession = {
        id: 'swarm-test-winner',
        projectPath: 'F:/ProjectHub',
        mode: 'fan_out',
        prompt: 'Тестовая задача',
        baseBranch: 'main',
        useWorktrees: true,
        status: 'running',
        createdAt: Date.now(),
        agents: [
          {
            id: 'winner-1',
            config: { id: 'winner-1', name: 'Winner Agent', engine: 'api' },
            status: 'completed',
            worktreePath: 'F:/ProjectHub/.worktrees/winner',
            worktreeBranch: 'swarm/test/winner',
            logs: [],
            liveOutput: 'solution A',
            metrics: { startTime: 100 }
          },
          {
            id: 'loser-2',
            config: { id: 'loser-2', name: 'Loser Agent', engine: 'api' },
            status: 'running',
            worktreePath: 'F:/ProjectHub/.worktrees/loser',
            worktreeBranch: 'swarm/test/loser',
            logs: [],
            liveOutput: 'solution B',
            metrics: { startTime: 100 }
          }
        ]
      };

      (fleetService as any).sessions.set(mockSession.id, mockSession);

      const result = await fleetService.pickWinner(mockSession.id, 'winner-1', true);

      expect(result.success).toBe(true);
      expect(mergeSpy).toHaveBeenCalledWith('F:/ProjectHub', 'swarm/test/winner', 'main');
      expect(removeSpy).toHaveBeenCalledWith('F:/ProjectHub', 'F:/ProjectHub/.worktrees/loser', true);
      expect(pruneSpy).toHaveBeenCalled();

      expect(mockSession.winnerAgentId).toBe('winner-1');
      expect(mockSession.agents[0].winner).toBe(true);
      expect(mockSession.agents[1].status).toBe('stopped');
      expect(mockSession.status).toBe('completed');
    });

    it('startHandoff: запускает сквозной конвейер ролей с передачей контекста (AC #6)', async () => {
      vi.spyOn(worktreeService, 'addWorktree').mockResolvedValue({
        path: 'F:/ProjectHub/.worktrees/handoff_shared',
        branch: 'handoff/shared',
        commit: 'abc',
        isMain: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false
      });
      vi.spyOn(worktreeService, 'getWorktreeDiff').mockResolvedValue('');

      const promptsReceived: string[] = [];
      vi.spyOn(aiAgentService, 'streamChat').mockImplementation(
        async (req, onChunk, onComplete) => {
          promptsReceived.push(req.messages[0].content);
          const responseText = `Результат этапа для: ${req.messages[0].content.slice(0, 30)}...`;
          onChunk({ text: responseText });
          onComplete({
            id: 'm-handoff',
            role: 'assistant',
            content: responseText,
            timestamp: new Date().toISOString()
          });
        }
      );

      const session = await fleetService.startHandoff({
        projectPath: 'F:/ProjectHub',
        prompt: 'Спроектировать и реализовать авторизацию',
        stages: [
          {
            role: 'Архитектор',
            agent: { id: 'h-1', name: 'Architect', engine: 'api' },
            instructions: 'Создай спецификацию'
          },
          {
            role: 'Кодер',
            agent: { id: 'h-2', name: 'Coder', engine: 'api' },
            instructions: 'Напиши код по спецификации'
          }
        ]
      });

      expect(session).toBeDefined();
      expect(session.mode).toBe('handoff');
      expect(session.handoffStages).toHaveLength(2);

      // Ждем завершения последовательного выполнения
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(promptsReceived).toHaveLength(2);
      // Второй этап должен содержать артефакты первого этапа
      expect(promptsReceived[1]).toContain('Артефакты и результат предыдущего этапа');
    });

    it('stopSwarm: прерывает выполнение всех активных процессов и потоков роя', () => {
      const mockSession: SwarmSession = {
        id: 'swarm-stop-test',
        projectPath: 'F:/ProjectHub',
        mode: 'fan_out',
        prompt: 'Тест останова',
        baseBranch: 'main',
        useWorktrees: false,
        status: 'running',
        createdAt: Date.now(),
        agents: [
          {
            id: 'ag-1',
            config: { id: 'ag-1', name: 'Agent 1', engine: 'api' },
            status: 'running',
            logs: [],
            liveOutput: '',
            metrics: { startTime: Date.now() }
          }
        ]
      };

      (fleetService as any).sessions.set(mockSession.id, mockSession);

      const stopped = fleetService.stopSwarm(mockSession.id);
      expect(stopped).toBe(true);
      expect(mockSession.status).toBe('stopped');
      expect(mockSession.agents[0].status).toBe('stopped');
    });
  });
});
