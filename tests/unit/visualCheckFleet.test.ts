import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

const paths = vi.hoisted(() => ({ userData: '' }));
vi.mock('../../electron/services/appPaths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/services/appPaths')>();
  return { ...actual, getUserDataDir: () => paths.userData };
});

import { executeCheck, pendingCheckResult } from '../../electron/services/checkRunner';
import { normalizeCheckDefinition } from '../../electron/services/arenaChecks';
import { AgentFleetService, type AgentSlotConfig, type SwarmSession } from '../../electron/services/agentFleetService';
import { aiAgentService } from '../../electron/services/aiAgentService';
import { processManager, type RunOnceOptions } from '../../electron/services/processManager';
import { REPORT_FENCE } from '../../electron/services/doneLoop';
import { ARTIFACTS_DIR_ENV } from '../../electron/services/visualArtifacts';
import type { CheckDefinition } from '../../electron/services/arenaTypes';

// 1×1 PNG: содержимое не важно для сбора, но пусть это будет настоящая картинка.
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const SHOT_SCRIPT = `
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.${ARTIFACTS_DIR_ENV};
fs.writeFileSync(path.join(dir, 'home.png'), Buffer.from('${PNG_1PX.toString('base64')}', 'base64'));
fs.writeFileSync(path.join(dir, 'notes.md'), '# не артефакт');
fs.mkdirSync('test-results/smoke', { recursive: true });
fs.writeFileSync('test-results/smoke/trace.zip', 'zip');
fs.writeFileSync('test-results/smoke/after.png', Buffer.from('${PNG_1PX.toString('base64')}', 'base64'));
console.log('Running 1 test using 1 worker');
console.log('  1 passed (0.5s)');
`;

const uiDef = (over: Record<string, unknown> = {}): CheckDefinition =>
  normalizeCheckDefinition({ id: 'ui-smoke', kind: 'ui-smoke', name: 'UI smoke', command: 'node shot.mjs', artifacts: { from: ['test-results'] }, ...over }, 0)!;

describe('executeCheck: проверка ui-smoke с артефактами (decision-55)', () => {
  let workdir: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    paths.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-visual-ud-'));
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-visual-wd-'));
    await fs.writeFile(path.join(workdir, 'shot.mjs'), SHOT_SCRIPT, 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(paths.userData, { recursive: true, force: true });
    await fs.rm(workdir, { recursive: true, force: true });
  });

  it('команда получает каталог в окружении, артефакты собираются из него и из artifacts.from', async () => {
    const def = uiDef();
    const result = await executeCheck(pendingCheckResult(def), def, workdir, undefined, {
      artifacts: { scope: 'swarm-s1', agentId: 'a1', run: 'iter-1' }
    });

    expect(result.status).toBe('passed');
    expect(result).toMatchObject({ passedTests: 1, failedTests: 0 });
    expect(result.artifacts?.map((a) => [a.name, a.kind])).toEqual([
      ['home.png', 'screenshot'],
      ['test-results/smoke/after.png', 'screenshot'],
      ['test-results/smoke/trace.zip', 'trace']
    ]);
    const dir = path.join(paths.userData, 'visual', 'swarm-s1', 'a1', 'iter-1', 'ui-smoke');
    expect(existsSync(path.join(dir, 'home.png'))).toBe(true);
    expect(existsSync(path.join(dir, 'test-results', 'smoke', 'trace.zip'))).toBe(true);
    // Не-артефакты из каталога проверки удаляются.
    expect(existsSync(path.join(dir, 'notes.md'))).toBe(false);
    expect(result.artifacts?.[0].relPath).toBe('swarm-s1/a1/iter-1/ui-smoke/home.png');
  });

  it('плейсхолдер ${artifactsDir} подставляется в команду', async () => {
    await fs.writeFile(
      path.join(workdir, 'arg.mjs'),
      `import fs from 'node:fs'; import path from 'node:path'; fs.writeFileSync(path.join(process.argv[2], 'arg.png'), 'x');`,
      'utf-8'
    );
    const def = uiDef({ command: 'node arg.mjs "${artifactsDir}"', artifacts: {} });
    const result = await executeCheck(pendingCheckResult(def), def, workdir);
    expect(result.status).toBe('passed');
    expect(result.artifacts?.map((a) => a.name)).toEqual(['arg.png']);
    expect(result.artifacts?.[0].relPath).toMatch(/^adhoc\/main\/run-\d+\/ui-smoke\/arg\.png$/);
  });

  it('код 0 без скриншотов — провал «нет скриншотов»; обычные проверки каталога не получают', async () => {
    const def = uiDef({ command: 'node -e "process.exit(0)"', artifacts: {} });
    const result = await executeCheck(pendingCheckResult(def), def, workdir);
    expect(result.status).toBe('failed');
    expect(result.detail).toMatch(/нет скриншотов/);

    const runOnce = vi.spyOn(processManager, 'runOnce');
    const testDef: CheckDefinition = { id: 'test', kind: 'test', name: 'Tests', command: 'node -e "process.exit(0)"' };
    const plain = await executeCheck(pendingCheckResult(testDef), testDef, workdir);
    expect(plain.status).toBe('passed');
    expect(plain.artifacts).toBeUndefined();
    expect((runOnce.mock.calls[0][1] as RunOnceOptions).env).toEqual({});
  });
});

// ─────────────────────────────── Done-loop ───────────────────────────────

const TASK_FILE = [
  '---',
  'id: TASK-1',
  'title: Главная',
  'status: In Progress',
  "created_date: '2026-09-27 10:00'",
  '---',
  '',
  '## Acceptance Criteria',
  '<!-- AC:BEGIN -->',
  '- [ ] #1 [ui] Главная страница показывает заголовок',
  '<!-- AC:END -->',
  ''
].join('\n');

const report = (criteria: unknown[]) =>
  `Готово.\n\`\`\`${REPORT_FENCE}\n${JSON.stringify({ summary: 'ход', criteria })}\n\`\`\``;

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

describe('Done-loop: скриншоты ui-smoke как evidence (decision-55 п. 7)', () => {
  let projectDir: string;
  let taskFile: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    paths.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-visual-ud-'));
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-visual-loop-'));
    await fs.mkdir(path.join(projectDir, 'backlog', 'tasks'), { recursive: true });
    taskFile = path.join(projectDir, 'backlog', 'tasks', 'task-1 - Главная.md');
    await fs.writeFile(taskFile, TASK_FILE, 'utf-8');
    await fs.writeFile(
      path.join(projectDir, '.projecthub.json'),
      JSON.stringify({
        checks: [{ id: 'ui-smoke', kind: 'ui-smoke', name: 'UI smoke', command: 'npm run ui-smoke' }],
        doneLoop: { docChecks: false }
      }),
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.rm(paths.userData, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('ненайденный скриншот — повтор со списком артефактов, найденный — критерий [ui] засчитан', async () => {
    const prompts: string[] = [];
    const replies = [
      report([{ index: 1, status: 'done', evidence: 'src/Home.tsx:3 — заголовок', screenshots: ['main.png'] }]),
      report([{ index: 1, status: 'done', evidence: 'заголовок', screenshots: ['home.png'] }])
    ];
    vi.spyOn(aiAgentService, 'streamChat').mockImplementation(async (req, onChunk, onComplete) => {
      prompts.push(String(req.messages[req.messages.length - 1].content));
      const content = replies[prompts.length - 1];
      onChunk({ text: content });
      onComplete({ id: `m${prompts.length}`, role: 'assistant', content, timestamp: new Date().toISOString() });
    });
    // Проверка «снимает» home.png в каталог, который ей выдал ProjectHub.
    const runOnce = vi.spyOn(processManager, 'runOnce').mockImplementation(async (_cmd, options) => {
      await fs.writeFile(path.join(options.env![ARTIFACTS_DIR_ENV], 'home.png'), PNG_1PX);
      return { exitCode: 0, output: '  1 passed (0.4s)', truncated: false, timedOut: false, durationMs: 5, startedAt: Date.now() };
    });

    const fleet = new AgentFleetService();
    const started = await fleet.startDoneLoop({ projectPath: projectDir, taskId: 'TASK-1', prompt: '[TASK-1]', agent, useWorktrees: false });
    const session = await waitForEnd(fleet, started.id);

    expect(runOnce).toHaveBeenCalledTimes(2);
    const loop = session.doneLoop!;
    expect(loop.outcome).toBe('success');
    expect(loop.iterations[0].criteria[0]).toMatchObject({ accepted: false, ui: true });
    expect(loop.iterations[0].criteria[0].reason).toMatch(/«main\.png» не найден/);
    expect(prompts[1]).toContain('## Скриншоты проверок этой итерации');
    expect(prompts[1]).toContain('- ui-smoke/home.png');
    expect(loop.iterations[1].criteria[0]).toMatchObject({ accepted: true, screenshots: [{ ref: 'home.png', checkId: 'ui-smoke', name: 'home.png' }] });
    expect(loop.instructions).toContain('## Скриншоты как evidence');

    const saved = await fs.readFile(taskFile, 'utf-8');
    expect(saved).toContain('- [x] #1 [ui] Главная страница показывает заголовок');
    expect(saved).toContain('(скриншоты: ui-smoke/home.png)');
    expect(saved).not.toContain(paths.userData);

    // Каталоги итераций разные, и удаление сессии уносит её артефакты.
    const scopeDir = path.join(paths.userData, 'visual', `swarm-${session.id}`, agent.id);
    expect((await fs.readdir(scopeDir)).sort()).toEqual(['iter-1', 'iter-2']);
    await fleet.discardSwarm(session.id, false);
    expect(existsSync(path.join(paths.userData, 'visual', `swarm-${session.id}`))).toBe(false);
  });
});
