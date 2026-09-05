import { afterEach, describe, expect, it, vi } from 'vitest';

// claudeBridgeService тянет electron через secretStorageService/processManager — подменяем модуль.
vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  },
  BrowserWindow: { getAllWindows: () => [] }
}));

const {
  ApprovalCancelledError,
  claudeBridgeService,
  SUBPROCESS_DEFAULT_TIMEOUT_MS
} = await import('../../electron/services/claudeBridgeService');
type ApprovalRequest = import('../../electron/services/claudeBridgeService').ApprovalRequest;
type SubagentInfo = import('../../electron/services/claudeBridgeService').SubagentInfo;

const PROJECT = process.cwd();

function makeApproval(sessionId: string, id = `appr-${Math.random().toString(36).slice(2)}`): ApprovalRequest {
  return {
    id,
    sessionId,
    projectPath: PROJECT,
    type: 'command',
    title: 'test',
    createdAt: Date.now()
  };
}

afterEach(() => {
  claudeBridgeService.killAll();
  claudeBridgeService.removeAllListeners();
});

describe('requestApproval / rejectPendingApprovals (аудит 1.3)', () => {
  it('sendApprovalResponse резолвит ожидающее одобрение', async () => {
    const req = makeApproval('s1');
    const p = claudeBridgeService.requestApproval(req);
    expect(claudeBridgeService.getPendingApprovalIds('s1')).toEqual([req.id]);
    expect(claudeBridgeService.getProjectStatus(PROJECT).status).toBe('waiting_approval');

    expect(claudeBridgeService.sendApprovalResponse(req.id, { approved: true, text: 'ok' })).toBe(true);
    await expect(p).resolves.toEqual({ approved: true, text: 'ok' });
    expect(claudeBridgeService.getPendingApprovalIds()).toEqual([]);
    expect(claudeBridgeService.sendApprovalResponse(req.id, { approved: true })).toBe(false);
  });

  it('abortSession отклоняет одобрения только своей сессии и переводит статус проекта в idle', async () => {
    const own = claudeBridgeService.requestApproval(makeApproval('s1'));
    const other = claudeBridgeService.requestApproval(makeApproval('s2'));
    const statuses: string[] = [];
    claudeBridgeService.on('statusChanged', (s) => statuses.push(s.status));

    claudeBridgeService.abortSession('s1');

    await expect(own).rejects.toBeInstanceOf(ApprovalCancelledError);
    expect(claudeBridgeService.getPendingApprovalIds('s1')).toEqual([]);
    expect(claudeBridgeService.getPendingApprovalIds('s2')).toHaveLength(1);
    expect(statuses).toContain('idle');
    expect(claudeBridgeService.getProjectStatus(PROJECT).status).toBe('idle');
    // idle не хранится в реестре статусов
    expect(claudeBridgeService.getAllProjectStatuses()).toEqual([]);

    claudeBridgeService.sendApprovalResponse(claudeBridgeService.getPendingApprovalIds('s2')[0], { approved: false });
    await expect(other).resolves.toEqual({ approved: false });
  });

  it('killAll отклоняет одобрения всех сессий', async () => {
    const a = claudeBridgeService.requestApproval(makeApproval('s1'));
    const b = claudeBridgeService.requestApproval(makeApproval('s2'));
    claudeBridgeService.killAll();
    await expect(a).rejects.toBeInstanceOf(ApprovalCancelledError);
    await expect(b).rejects.toBeInstanceOf(ApprovalCancelledError);
    expect(claudeBridgeService.getPendingApprovalIds()).toEqual([]);
    expect(claudeBridgeService.getActiveProcessCount()).toBe(0);
  });
});

describe('executeSubprocess (аудит 1.4)', () => {
  // executeSubprocess запускает PowerShell на Windows: путь в кавычках там нужно вызывать через `&`.
  const node = (process.platform === 'win32' ? '& ' : '') + JSON.stringify(process.execPath);

  it('по умолчанию таймаут 5 минут', () => {
    expect(SUBPROCESS_DEFAULT_TIMEOUT_MS).toBe(5 * 60_000);
  });

  it('возвращает вывод и код завершения', async () => {
    const res = await claudeBridgeService.executeSubprocess(`${node} -e "process.stdout.write('hello'); process.exit(3)"`, PROJECT);
    expect(res.output).toContain('hello');
    // PowerShell -Command сводит ненулевой код нативной команды к 1, поэтому проверяем только «не 0».
    expect(res.exitCode).not.toBe(0);
    expect(res.timedOut).toBe(false);
    expect(res.truncated).toBe(false);
  });

  it('убивает зависший процесс по таймауту и снимает его с учёта сессии', async () => {
    const started = Date.now();
    const res = await claudeBridgeService.executeSubprocess(
      `${node} -e "process.stdout.write('started'); setInterval(() => {}, 1000)"`,
      PROJECT,
      undefined,
      { timeoutMs: 700, sessionId: 'sub-timeout' }
    );
    expect(res.timedOut).toBe(true);
    expect(res.output).toContain('started');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(claudeBridgeService.getActiveProcessCount()).toBe(0);
  }, 15_000);

  it('усекает вывод до лимита, оставляя хвост, и отдаёт ограниченный снимок в onProgress', async () => {
    let maxSeen = 0;
    const res = await claudeBridgeService.executeSubprocess(
      `${node} -e "process.stdout.write('a'.repeat(50000) + 'TAIL')"`,
      PROJECT,
      (snapshot) => { maxSeen = Math.max(maxSeen, snapshot.length); },
      { maxOutputBytes: 2000 }
    );
    expect(res.truncated).toBe(true);
    expect(res.output.length).toBeLessThanOrEqual(2000);
    expect(res.output.endsWith('TAIL')).toBe(true);
    expect(maxSeen).toBeLessThanOrEqual(2000);
  });

  it('abortSession убивает команды агента этой сессии', async () => {
    const p = claudeBridgeService.executeSubprocess(
      `${node} -e "setInterval(() => {}, 1000)"`,
      PROJECT,
      undefined,
      { timeoutMs: 60_000, sessionId: 'sub-abort' }
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(claudeBridgeService.getActiveProcessCount()).toBe(1);
    claudeBridgeService.abortSession('sub-abort');
    const res = await p;
    expect(res.exitCode).not.toBe(0);
    expect(claudeBridgeService.getActiveProcessCount()).toBe(0);
  }, 15_000);
});

describe('подагенты и CLI-сессии (аудит 2.3)', () => {
  const sub = (id: string, parentSessionId: string, status: SubagentInfo['status'] = 'running'): SubagentInfo => ({
    id,
    parentSessionId,
    projectPath: PROJECT,
    name: id,
    task: 'task',
    status,
    startedAt: Date.now()
  });

  it('finishSessionSubagents завершает только подагентов своей сессии и удаляет их из реестра', () => {
    claudeBridgeService.registerSubagent(sub('a', 's1'));
    claudeBridgeService.registerSubagent(sub('b', 's1', 'completed'));
    claudeBridgeService.registerSubagent(sub('c', 's2'));
    const updates: SubagentInfo[] = [];
    claudeBridgeService.on('subagentUpdated', (s) => updates.push(s));

    const finished = claudeBridgeService.finishSessionSubagents('s1', 'failed');

    expect(finished.map((s) => [s.id, s.status])).toEqual([['a', 'failed'], ['b', 'completed']]);
    expect(finished[0].completedAt).toBeTypeOf('number');
    expect(updates.map((s) => s.id)).toEqual(['a', 'b']);
    expect(claudeBridgeService.getSubagents(PROJECT).map((s) => s.id)).toEqual(['c']);

    claudeBridgeService.finishSessionSubagents('s2', 'completed');
    expect(claudeBridgeService.getSubagents(PROJECT)).toEqual([]);
  });

  it('clearSession забывает resume-id Claude CLI и подагентов сессии', () => {
    (claudeBridgeService as any).sessionClaudeCliIds.set('s1', 'cli-123');
    claudeBridgeService.registerSubagent(sub('a', 's1'));
    expect(claudeBridgeService.getClaudeCliSessionId('s1')).toBe('cli-123');

    claudeBridgeService.clearSession('s1');

    expect(claudeBridgeService.getClaudeCliSessionId('s1')).toBeUndefined();
    expect(claudeBridgeService.getSubagents(PROJECT)).toEqual([]);
  });
});
