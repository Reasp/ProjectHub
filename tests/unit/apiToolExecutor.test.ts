import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { ApiToolExecutor, type ApiToolContext, type ApiToolExecutorDeps } from '../../electron/services/apiToolExecutor';
import type { ApprovalResponse, HitlRequest } from '../../electron/services/hitlTypes';
import type { AIProviderConfig, AutoApproveRules } from '../../electron/services/aiAgentService';

const WT = path.resolve('/tmp/wt-slot');
const RULES: AutoApproveRules = { enabled: true, allowCommands: true, allowFileWrite: true, allowFileRead: true, allowSubagents: true, writeExcludePatterns: [], readExcludePatterns: [], commandDenyList: [] };

type Fake = ApiToolExecutorDeps & {
  files: Map<string, string>;
  autos: Array<{ info: Omit<HitlRequest, 'id' | 'createdAt'>; decision: string; rule: string }>;
  outcomes: Array<{ id: string; outcome: string }>;
  asked: HitlRequest[];
  commands: Array<{ command: string; cwd: string; sessionId: string; timeoutMs?: number }>;
};

function fakeDeps(answer: (req: HitlRequest) => ApprovalResponse | Promise<ApprovalResponse> = () => ({ approved: true })): Fake {
  let n = 0;
  const files = new Map<string, string>();
  const deps: Fake = {
    files,
    autos: [],
    outcomes: [],
    asked: [],
    commands: [],
    newRequestId: () => `req-${++n}`,
    requestApproval: vi.fn(async (req: HitlRequest) => {
      deps.asked.push(req);
      return answer(req);
    }),
    recordAutoDecision: (info, decision, rule) => {
      deps.autos.push({ info, decision, rule });
      return `auto-${++n}`;
    },
    recordOutcome: (id, outcome) => {
      deps.outcomes.push({ id, outcome });
    },
    readFile: async (abs) => {
      const v = files.get(abs);
      if (v === undefined) throw new Error(`ENOENT ${abs}`);
      return v;
    },
    fileExists: (abs) => files.has(abs),
    listDir: async () => [{ name: 'src', isDirectory: true }, { name: 'a.txt', isDirectory: false }],
    writeFile: async (workDir, filePath, content) => {
      files.set(path.resolve(workDir, filePath), content);
    },
    generateDiff: (o, nw, f) => `--- ${f}\n-${o}\n+${nw}`,
    runCommand: async (command, cwd, options) => {
      deps.commands.push({ command, cwd, ...options });
      return command.includes('fail') ? { output: 'boom', exitCode: 1, timedOut: false } : { output: 'ok', exitCode: 0, timedOut: false };
    },
    searchDocs: async (_p, q) => `- ${q}`,
    parseQuestion: (args) => ({ title: String(args.title || 'Вопрос'), subtitle: String(args.question || ''), options: [] })
  };
  return deps;
}

function ctx(config: AIProviderConfig, over: Partial<ApiToolContext> = {}): ApiToolContext {
  return {
    sessionId: 'swarm-agent-1',
    workDir: WT,
    projectPath: path.resolve('/tmp/project'),
    config,
    origin: 'swarm',
    engine: 'api',
    agentId: 'agent-1',
    agentName: 'Кодер',
    role: 'implementer',
    isActive: () => true,
    ...over
  };
}

const auto: AIProviderConfig = { provider: 'ollama', model: 'm', autoApprove: true };
const manual: AIProviderConfig = { provider: 'ollama', model: 'm', autoApprove: false };

describe('ApiToolExecutor — исполнение в worktree с HITL и аудитом (decision-46 п. 2)', () => {
  it('чтение и запись при auto-approve: авто-решения с агентом и ролью, outcome executed', async () => {
    const deps = fakeDeps();
    deps.files.set(path.join(WT, 'in.txt'), 'hello');
    const ex = new ApiToolExecutor(deps);
    const executed: string[] = [];
    const c = ctx(auto, { onExecute: (call) => executed.push(call.name) });

    const read = await ex.execute({ id: 't1', name: 'read_file', args: { filePath: 'in.txt' } }, c);
    expect(read).toEqual({ content: 'hello' });
    const write = await ex.execute({ id: 't2', name: 'write_file', args: { filePath: 'out/b.txt', content: 'HELLO' } }, c);
    expect(write.isError).toBeUndefined();
    expect(deps.files.get(path.join(WT, 'out', 'b.txt'))).toBe('HELLO');

    expect(deps.autos.map((a) => [a.decision, a.rule])).toEqual([['allow', 'auto-read'], ['allow', 'auto-write']]);
    expect(deps.autos[1].info).toMatchObject({
      sessionId: 'swarm-agent-1',
      projectPath: WT,
      origin: 'swarm',
      engine: 'api',
      agentId: 'agent-1',
      agentName: 'Кодер',
      role: 'implementer',
      tool: 'write_file',
      type: 'file_write',
      filePath: 'out/b.txt'
    });
    expect(deps.outcomes.map((o) => o.outcome)).toEqual(['executed', 'executed']);
    expect(executed).toEqual(['read_file', 'write_file']);
    expect(deps.asked).toHaveLength(0);
  });

  it('ручной режим: запись идёт карточкой с диффом, одобрение — запись, отказ — без записи и без onExecute', async () => {
    let approve = true;
    const deps = fakeDeps(() => ({ approved: approve, text: approve ? undefined : 'не надо' }));
    deps.files.set(path.join(WT, 'b.txt'), 'old');
    const ex = new ApiToolExecutor(deps);
    const executed: string[] = [];
    const requests: HitlRequest[] = [];
    const c = ctx(manual, { onExecute: (call) => executed.push(call.id), onApprovalRequest: (r) => requests.push(r) });

    const ok = await ex.execute({ id: 'w1', name: 'write_file', args: { filePath: 'b.txt', content: 'new' } }, c);
    expect(ok.isError).toBeUndefined();
    expect(deps.asked[0]).toMatchObject({
      type: 'file_write',
      origin: 'swarm',
      agentId: 'agent-1',
      role: 'implementer',
      filePath: 'b.txt',
      diff: { oldContent: 'old', newContent: 'new' }
    });
    expect(deps.asked[0].title).toContain('Кодер');
    expect(requests).toHaveLength(1);
    expect(deps.outcomes).toEqual([{ id: deps.asked[0].id, outcome: 'executed' }]);

    approve = false;
    const no = await ex.execute({ id: 'w2', name: 'write_file', args: { filePath: 'b.txt', content: 'newer' } }, c);
    expect(no).toEqual({ content: 'Отклонено пользователем: не надо', isError: true });
    expect(deps.files.get(path.join(WT, 'b.txt'))).toBe('new');
    expect(executed).toEqual(['w1']);
    expect(deps.autos).toHaveLength(0);
  });

  it('запись вне worktree и фоновые команды отклоняются без карточки с записью в аудит', async () => {
    const deps = fakeDeps();
    const ex = new ApiToolExecutor(deps);
    const outside = await ex.execute({ id: 'x', name: 'write_file', args: { filePath: '../../etc/x', content: 'x' } }, ctx(auto));
    expect(outside.isError).toBe(true);
    expect(outside.content).toContain('вне корня проекта');
    const bg = await ex.execute({ id: 'y', name: 'run_command', args: { command: 'npm run dev', background: true } }, ctx(auto));
    expect(bg.isError).toBe(true);
    expect(deps.autos.map((a) => [a.decision, a.rule])).toEqual([['deny', 'outside-project'], ['deny', 'background-not-allowed']]);
    expect(deps.asked).toHaveLength(0);
    expect(deps.commands).toHaveLength(0);
  });

  it('команда исполняется в worktree с sessionId и таймаутом роли; ненулевой код — ошибка с outcome failed', async () => {
    const deps = fakeDeps();
    const ex = new ApiToolExecutor(deps);
    const cfg: AIProviderConfig = { ...auto, autoApproveRules: { ...RULES, commandTimeoutSec: 30 } };
    const ok = await ex.execute({ id: 'c1', name: 'run_command', args: { command: 'npm test' } }, ctx(cfg));
    expect(ok).toEqual({ content: 'ok' });
    expect(deps.commands[0]).toEqual({ command: 'npm test', cwd: WT, sessionId: 'swarm-agent-1', timeoutMs: 30_000 });
    const bad = await ex.execute({ id: 'c2', name: 'run_command', args: { command: 'npm run fail' } }, ctx(cfg));
    expect(bad.isError).toBe(true);
    expect(bad.content).toContain('кодом 1');
    expect(deps.outcomes.map((o) => o.outcome)).toEqual(['executed', 'failed']);
  });

  it('вопрос: ответ человека возвращается модели', async () => {
    const deps = fakeDeps(() => ({ approved: true, text: 'Вариант Б' }));
    const ex = new ApiToolExecutor(deps);
    const res = await ex.execute({ id: 'q', name: 'ask_question', args: { title: 'Что делаем?', question: 'A или Б' } }, ctx(auto));
    expect(res).toEqual({ content: 'Вариант Б' });
    expect(deps.asked[0]).toMatchObject({ type: 'question', questionData: { title: 'Что делаем?' } });
  });

  it('чтение вне worktree: карточка, «запретить» — отказ', async () => {
    const deps = fakeDeps(() => ({ approved: true, text: 'deny' }));
    const ex = new ApiToolExecutor(deps);
    const res = await ex.execute({ id: 'r', name: 'read_file', args: { filePath: '../secret.txt' } }, ctx(auto));
    expect(res.isError).toBe(true);
    expect(deps.asked[0].details).toContain('вне рабочего каталога');
  });

  it('остановленный агент: инструмент не исполняется; отмена карточки — ошибка модели', async () => {
    const deps = fakeDeps(() => {
      const err = new Error('Сессия прервана: ожидание одобрения отменено');
      err.name = 'ApprovalCancelledError';
      throw err;
    });
    const ex = new ApiToolExecutor(deps);
    const stopped = await ex.execute({ id: 's', name: 'read_file', args: { filePath: 'a' } }, ctx(auto, { isActive: () => false }));
    expect(stopped.isError).toBe(true);
    expect(deps.autos).toHaveLength(0);
    const cancelled = await ex.execute({ id: 'k', name: 'write_file', args: { filePath: 'a', content: '' } }, ctx(manual));
    expect(cancelled).toEqual({ content: 'Сессия прервана: ожидание одобрения отменено', isError: true });
  });

  it('computer_* уходит в прокси с контекстом слота; без прокси — ошибка', async () => {
    const deps = fakeDeps();
    const calls: Array<Record<string, unknown>> = [];
    deps.callComputerTool = async (name, args, c) => {
      calls.push({ name, args, origin: c.origin, doneLoop: c.doneLoop, allow: c.taskAllowsComputerUse });
      return { content: 'done' };
    };
    const ex = new ApiToolExecutor(deps);
    const res = await ex.execute({ id: 'p', name: 'computer_list_windows', args: {} }, ctx(auto, { doneLoop: true, taskAllowsComputerUse: true }));
    expect(res).toEqual({ content: 'done' });
    expect(calls).toEqual([{ name: 'computer_list_windows', args: {}, origin: 'swarm', doneLoop: true, allow: true }]);
    const none = await new ApiToolExecutor(fakeDeps()).execute({ id: 'p2', name: 'computer_click', args: {} }, ctx(auto));
    expect(none.isError).toBe(true);
  });
});
