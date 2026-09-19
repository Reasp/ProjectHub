import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentFleetService } from '../../electron/services/agentFleetService';
import { SwarmSessionStore } from '../../electron/services/swarmSessionStore';
import { aiAgentService, type StreamChatOptions } from '../../electron/services/aiAgentService';
import { CheckpointService } from '../../electron/services/checkpointService';
import { execGit, listRefs } from '../../electron/services/checkpointGit';

/**
 * Чекпоинты, откат, продолжение и трасса в сервисе флота (TASK-72, decision-45). Проект — временный
 * git-репозиторий: ref и worktree не попадают в основное дерево ProjectHub.
 */

let root: string;
let repo: string;
let store: SwarmSessionStore;

const git = (cwd: string, ...args: string[]) => execGit(args, { cwd });
const exists = (p: string) => fs.access(p).then(() => true, () => false);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error('timeout');
    await wait(25);
  }
}

beforeEach(async () => {
  vi.restoreAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-cpfleet-'));
  repo = path.join(root, 'project');
  await fs.mkdir(repo);
  await git(repo, 'init', '-q', '-b', 'main');
  await git(repo, 'config', 'user.name', 't');
  await git(repo, 'config', 'user.email', 't@t');
  await git(repo, 'config', 'core.autocrlf', 'false');
  await fs.writeFile(path.join(repo, 'readme.md'), 'base\n');
  await fs.writeFile(path.join(repo, '.gitignore'), '.worktrees/\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-qm', 'base');
  store = new SwarmSessionStore(path.join(root, 'swarms'), 10);
  vi.spyOn(AgentFleetService.prototype, 'runJudge').mockResolvedValue(null);
});

afterEach(async () => {
  await store.flush();
  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe('AgentFleetService: чекпоинты по ходам и откат (TASK-72)', () => {
  it('ход с инструментами → чекпоинт; откат к ходу 1; продолжение в новой сессии; трасса; чистка ref', async () => {
    const checkpoints = new CheckpointService();
    const fleet = new AgentFleetService(store, { checkpoints });
    let swarmId = '';
    const prompts: string[] = [];
    let call = 0;
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (req, onChunk, onComplete, _onError, options?: StreamChatOptions) => {
      call++;
      prompts.push(req.messages[req.messages.length - 1].content);
      const wt = req.projectPath;
      const tool = async (id: string, file: string) => {
        await fs.writeFile(path.join(wt, file), file);
        onChunk({ toolCall: { id, name: 'write_file', args: { path: file } } });
        options?.onToolBoundary?.({ kind: 'tool_result', id, name: 'write_file', ok: true, outputChars: 2, durationMs: 7 });
        // снимок хода идёт в очереди агента — ждём его, как если бы модель думала над следующим шагом
        await checkpoints.whenIdle(swarmId, 'agent-1');
      };
      if (call === 1) {
        options?.onToolBoundary?.({ kind: 'step', step: 0, model: 'm' });
        await tool('c1', 'one.txt');
        options?.onToolBoundary?.({ kind: 'step', step: 1, model: 'm' });
        await tool('c2', 'two.txt');
      } else {
        options?.onToolBoundary?.({ kind: 'step', step: 0, model: 'm' });
      }
      onChunk({ text: `ответ ${call}` });
      onComplete({ id: `m${call}`, role: 'assistant', content: `ответ ${call}`, timestamp: new Date().toISOString() });
    });

    const session = await fleet.startFanOut({
      projectPath: repo,
      prompt: 'Сделай файлы',
      useWorktrees: true,
      agents: [{ id: 'agent-1', name: 'A', engine: 'api', role: 'impl' }]
    });
    swarmId = session.id;
    await waitFor(() => session.status === 'completed');
    const agent = session.agents[0];
    const wt = agent.worktreePath!;
    expect(wt).toBeTruthy();

    // start (чистое дерево), ход 1, ход 2; end совпал с ходом 2 и не дублируется
    expect(agent.checkpoints!.map((c) => [c.n, c.kind, c.turn])).toEqual([
      [1, 'start', undefined],
      [2, 'turn', 1],
      [3, 'turn', 2]
    ]);
    expect(agent.trace).toMatchObject({ runs: 1, turns: 2, checkpoints: 3 });
    expect(agent.commitStatus).toBe('committed');
    // история ветки — только авто-коммит, чекпоинтов в ней нет
    expect((await git(wt, 'log', '--format=%s')).trim().split('\n')).toEqual(['agent(impl): ' + session.id, 'base']);

    // откат запрещён, пока сессия выполняется — здесь уже завершена, разрешён
    const view1 = await fleet.getTimeline(session.id, agent.id);
    expect(view1!.rewind.allowed).toBe(true);
    expect(view1!.timeline.totals).toMatchObject({ runs: 1, turns: 2, tools: 2 });
    expect(view1!.timeline.tools.map((t) => [t.name, t.status, t.durationMs])).toEqual([
      ['write_file', 'ok', 7],
      ['write_file', 'ok', 7]
    ]);

    const rw = await fleet.rewindAgent(session.id, agent.id, 2);
    expect(rw).toMatchObject({ success: true, removedFiles: 1, preRewindCheckpoint: 4 });
    expect(await exists(path.join(wt, 'one.txt'))).toBe(true);
    expect(await exists(path.join(wt, 'two.txt'))).toBe(false);
    // ветка вернулась к родителю снимка, откатанное состояние зафиксировано коммитом rewind(...)
    expect((await git(wt, 'log', '--format=%s')).trim().split('\n')).toEqual(['rewind(impl): чекпоинт #2 (после хода 1)', 'base']);
    expect(agent.rewinds).toHaveLength(1);
    expect(agent.rewinds![0]).toMatchObject({ toCheckpoint: 2, toTurn: 1, preRewindCheckpoint: 4, removedFiles: 1 });
    expect(agent.pendingRewindNote).toContain('откатён к чекпоинту #2');
    expect(agent.diffSummary?.filesChanged).toBe(1);

    // несуществующий чекпоинт
    expect((await fleet.rewindAgent(session.id, agent.id, 99)).success).toBe(false);

    const usageRun1 = agent.metrics.usage!;
    const cont = await fleet.continueAgent(session.id, agent.id, 'добавь три');
    expect(cont.success).toBe(true);
    await waitFor(() => session.status === 'completed' && call === 2);
    expect(prompts[1]).toContain('Уточнение пользователя: добавь три');
    expect(prompts[1]).toContain('откатён к чекпоинту #2 (после хода 1');
    expect(agent.pendingRewindNote).toBeUndefined();
    // usage второго запуска добавился к первому, а не заменил его (живой прогон выявил затирание)
    expect(agent.metrics.usage!.outputTokens).toBeGreaterThan(usageRun1.outputTokens);
    expect(agent.metrics.usage!.inputTokens).toBeGreaterThan(usageRun1.inputTokens);

    const view2 = await fleet.getTimeline(session.id, agent.id);
    const tl = view2!.timeline;
    expect(tl.runs.map((r) => [r.run, r.afterRewind ?? false, r.status])).toEqual([
      [1, false, 'completed'],
      [2, true, 'completed']
    ]);
    expect(tl.turns.map((t) => t.turn)).toEqual([1, 2, 3]);
    expect(tl.rewinds).toHaveLength(1);
    expect(tl.checkpoints.map((c) => c.kind)).toContain('pre_rewind');

    // экспорт трассы: заголовок и события, каждая строка — JSON
    const jsonl = await fleet.exportTrace(session.id);
    const lines = jsonl!.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: 'header', format: 'projecthub-agent-trace', v: 1, sessionFormat: 'projecthub-swarm-session', swarmId: session.id });
    expect(lines[0].agents[0]).toMatchObject({ id: 'agent-1', engine: 'api' });
    expect(lines.slice(1).every((l) => l.agentId === 'agent-1' && l.v === 1)).toBe(true);
    expect(lines.some((l) => l.type === 'rewind')).toBe(true);

    // закрытие сессии удаляет ref чекпоинтов
    expect((await listRefs(execGit, repo, 'refs/projecthub/')).length).toBeGreaterThan(0);
    await fleet.discardSwarm(session.id);
    expect(await listRefs(execGit, repo, 'refs/projecthub/')).toEqual([]);
  }, 60_000);

  it('без worktree чекпоинты создаются, а откат запрещён с понятной причиной', async () => {
    const fleet = new AgentFleetService(store, { checkpoints: new CheckpointService() });
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (req, onChunk, onComplete) => {
      await fs.writeFile(path.join(req.projectPath, 'x.txt'), 'x');
      onChunk({ text: 'ok' });
      onComplete({ id: 'm', role: 'assistant', content: 'ok', timestamp: new Date().toISOString() });
    });
    const session = await fleet.startFanOut({
      projectPath: repo,
      prompt: 'p',
      useWorktrees: false,
      autoCommitAgentResults: false,
      agents: [{ id: 'agent-1', name: 'A', engine: 'api' }]
    });
    await waitFor(() => session.status === 'completed');
    const agent = session.agents[0];
    expect(agent.checkpoints!.map((c) => c.kind)).toEqual(['start', 'end']);
    const view = await fleet.getTimeline(session.id, agent.id);
    expect(view!.rewind).toMatchObject({ allowed: false });
    expect(view!.rewind.reason).toContain('только в изолированном worktree');
    const rw = await fleet.rewindAgent(session.id, agent.id, 1);
    expect(rw.success).toBe(false);
    expect(await exists(path.join(repo, 'x.txt'))).toBe(true);
    await fleet.discardSwarm(session.id, false);
    expect(await listRefs(execGit, repo, 'refs/projecthub/')).toEqual([]);
  }, 60_000);

  it.runIf(process.platform === 'win32')(
    'Claude CLI: события фикстуры 2.1.275 → ходы, длительности, usage один раз на сообщение, чекпоинт хода с Write',
    async () => {
      const fakeDir = path.join(root, 'fake-claude');
      await fs.mkdir(fakeDir);
      // Воспроизводит настоящий stream-json; перед результатом Write создаёт файл, как сделал бы CLI.
      const fake = `
const fs = require('node:fs'); const path = require('node:path');
const lines = fs.readFileSync(process.env.PH_FAKE_FIXTURE, 'utf8').split('\\n').filter(Boolean);
process.stdin.resume();
process.stdin.on('end', () => {
  for (const line of lines) {
    const e = JSON.parse(line);
    // Время модели перед следующим сообщением: в живом прогоне 1.7 с, здесь 400 мс.
    if (e.type === 'assistant') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
    if (e.type === 'user' && JSON.stringify(e).includes('File created')) fs.writeFileSync(path.join(process.cwd(), 'b.txt'), 'HELLO CHECKPOINT\\n');
    process.stdout.write(line + '\\n');
  }
  process.exit(0);
});`;
      await fs.writeFile(path.join(fakeDir, 'claude.cjs'), fake);
      await fs.writeFile(path.join(fakeDir, 'claude.cmd'), `@"${process.execPath}" "${path.join(fakeDir, 'claude.cjs')}" %*\r\n`);
      const originalPath = process.env.PATH;
      process.env.PATH = `${fakeDir}${path.delimiter}${originalPath}`;
      process.env.PH_FAKE_FIXTURE = path.join(__dirname, 'fixtures', 'claude-cli-stream-2.1.275-tools.jsonl');
      vi.spyOn(AgentFleetService.prototype as never, 'prepareAgentHitl').mockResolvedValue({ args: [], env: {}, cleanup: () => undefined } as never);
      const recordUsage = vi.spyOn(AgentFleetService.prototype as never, 'recordUsage');
      try {
        const fleet = new AgentFleetService(store, { checkpoints: new CheckpointService() });
        const session = await fleet.startFanOut({
          projectPath: repo,
          prompt: 'Прочитай a.txt и создай b.txt',
          useWorktrees: true,
          agents: [{ id: 'cli-1', name: 'C', engine: 'claude-cli' }]
        });
        await waitFor(() => session.status !== 'running' && session.status !== 'preparing', 30_000);
        const agent = session.agents[0];
        expect(agent.status, agent.error).toBe('completed');
        // 3 сообщения модели = 3 «add», хотя событий assistant 6; плюс итог result — «replace»
        const modes = recordUsage.mock.calls.map((c) => (c as unknown[])[3]);
        expect(modes.filter((m) => m === 'add')).toHaveLength(3);
        expect(modes.filter((m) => m === 'replace')).toHaveLength(1);
        expect(agent.metrics.usage?.outputTokens).toBe(439);

        const tl = (await fleet.getTimeline(session.id, agent.id))!.timeline;
        expect(tl.turns.map((t) => t.turn)).toEqual([1, 2, 3]);
        expect(tl.tools.map((t) => [t.name, t.durationMs, t.status])).toEqual([
          ['Read', 85, 'ok'],
          ['Write', 60, 'ok']
        ]);
        expect(tl.turns[0].usage?.partial).toBe(true);
        expect(tl.runs[0].usage?.costUsd).toBeCloseTo(0.0333058, 6);
        // Read не меняет дерево — чекпоинт хода 1 не создаётся; Write создаёт b.txt — есть чекпоинт хода 2
        expect(agent.checkpoints!.map((c) => [c.kind, c.turn])).toEqual([
          ['start', undefined],
          ['turn', 2]
        ]);
        expect(tl.turns[1].checkpoint).toBe(2);
        await fleet.discardSwarm(session.id);
      } finally {
        process.env.PATH = originalPath;
        delete process.env.PH_FAKE_FIXTURE;
      }
    },
    60_000
  );

  it('без сервиса чекпоинтов (по умолчанию) ref не создаются', async () => {
    const fleet = new AgentFleetService(store);
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (_req, onChunk, onComplete) => {
      onChunk({ text: 'ok' });
      onComplete({ id: 'm', role: 'assistant', content: 'ok', timestamp: new Date().toISOString() });
    });
    const session = await fleet.startFanOut({ projectPath: repo, prompt: 'p', useWorktrees: false, agents: [{ id: 'a', name: 'A', engine: 'api' }] });
    await waitFor(() => session.status === 'completed');
    expect(session.agents[0].checkpoints).toBeUndefined();
    expect(await listRefs(execGit, repo, 'refs/projecthub/')).toEqual([]);
    // трасса пишется и без чекпоинтов
    const view = await fleet.getTimeline(session.id, 'a');
    expect(view!.timeline.runs).toHaveLength(1);
    expect(view!.continueAgent.allowed).toBe(true);
  }, 60_000);
});
