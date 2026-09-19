import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  checkpointRef,
  checkpointRefPrefix,
  checkpointsToPrune,
  createCheckpoint,
  execGit,
  filesToRemoveAfterCheckout,
  listRefs,
  rewindWorkTree,
  sanitizeRefSegment,
  snapshotTree,
  swarmIdFromCheckpointRef
} from '../../electron/services/checkpointGit';
import { CheckpointService } from '../../electron/services/checkpointService';

/**
 * Чекпоинты на настоящем git (TASK-72, decision-45 п. 1, 4, 5). Репозитории — во временном каталоге,
 * основное дерево проекта не трогается.
 */

let root: string;
let repo: string;
let wt: string;

const git = (cwd: string, ...args: string[]) => execGit(args, { cwd });
const write = (dir: string, rel: string, text: string) =>
  fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true }).then(() => fs.writeFile(path.join(dir, rel), text));
const exists = (p: string) => fs.access(p).then(() => true, () => false);

async function sha(file: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha1').update(await fs.readFile(file)).digest('hex');
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ph-cp-'));
  repo = path.join(root, 'repo');
  wt = path.join(root, 'wt');
  await fs.mkdir(repo);
  await git(repo, 'init', '-q', '-b', 'main');
  await git(repo, 'config', 'user.name', 't');
  await git(repo, 'config', 'user.email', 't@t');
  await git(repo, 'config', 'core.autocrlf', 'false');
  await write(repo, 'keep.txt', 'keep\n');
  await write(repo, 'mod.txt', 'mod v1\n');
  await write(repo, 'del.txt', 'del\n');
  await write(repo, '.gitignore', 'ignored.log\nnode_modules/\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-qm', 'base');
  await git(repo, 'worktree', 'add', '-q', '-b', 'swarm/x/a', wt, 'main');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** Агент поработал: изменён, удалён, создан, игнорируемый и staged файлы. */
async function agentWorks(): Promise<void> {
  await write(wt, 'mod.txt', 'mod v2\n');
  await fs.rm(path.join(wt, 'del.txt'));
  await write(wt, 'sub/new.txt', 'new\n');
  await write(wt, 'ignored.log', 'log\n');
  await write(wt, 'node_modules/pkg.js', 'x\n');
  await write(wt, 'staged.txt', 'staged\n');
  await git(wt, 'add', 'staged.txt');
}

describe('checkpointGit: снимок через временный индекс', () => {
  it('берёт неотслеживаемые файлы, соблюдает .gitignore, не меняет HEAD, индекс и status', async () => {
    await agentWorks();
    const indexPath = path.resolve(wt, (await git(wt, 'rev-parse', '--git-path', 'index')).trim());
    const before = {
      status: await git(wt, 'status', '--porcelain=v1', '-uall'),
      head: (await git(wt, 'rev-parse', 'HEAD')).trim(),
      index: await sha(indexPath)
    };
    const ref = checkpointRef('swarm-1', 'a', 1);
    const cp = await createCheckpoint(execGit, wt, { ref, message: 'checkpoint' });
    expect(cp).not.toBeNull();
    const files = (await git(wt, 'ls-tree', '-r', '--name-only', cp!.commit)).trim().split('\n').sort();
    expect(files).toEqual(['.gitignore', 'keep.txt', 'mod.txt', 'staged.txt', 'sub/new.txt']);
    expect(await git(wt, 'status', '--porcelain=v1', '-uall')).toBe(before.status);
    expect((await git(wt, 'rev-parse', 'HEAD')).trim()).toBe(before.head);
    expect(await sha(indexPath)).toBe(before.index);
    expect(cp!.parent).toBe(before.head);
    // ветка не содержит чекпоинт, ref виден из основного репозитория
    expect((await git(wt, 'log', '--format=%s', 'swarm/x/a')).trim()).toBe('base');
    expect(await listRefs(execGit, repo, checkpointRefPrefix('swarm-1'))).toEqual([ref]);
  });

  it('одинаковое дерево не дублируется (skipIfTree)', async () => {
    await write(wt, 'a.txt', 'a\n');
    const first = await createCheckpoint(execGit, wt, { ref: checkpointRef('s', 'a', 1), message: 'x' });
    const again = await createCheckpoint(execGit, wt, { ref: checkpointRef('s', 'a', 2), message: 'x', skipIfTree: first!.tree });
    expect(again).toBeNull();
    expect(await snapshotTree(execGit, wt)).toBe(first!.tree);
  });
});

describe('checkpointGit: откат', () => {
  it('рабочий каталог совпадает со снимком, игнорируемые файлы на месте, ветка — у родителя снимка', async () => {
    await agentWorks();
    const cp = await createCheckpoint(execGit, wt, { ref: checkpointRef('s', 'a', 1), message: 'cp1' });
    // агент продолжает, авто-коммит, грязный файл после коммита
    await write(wt, 'mod.txt', 'mod v3\n');
    await write(wt, 'later.txt', 'later\n');
    await fs.rm(path.join(wt, 'keep.txt'));
    await git(wt, 'add', '-A');
    await git(wt, 'commit', '-qm', 'agent(x): t');
    await write(wt, 'dirty.txt', 'dirty\n');
    const pre = await createCheckpoint(execGit, wt, { ref: checkpointRef('s', 'a', 2), message: 'pre' });

    const res = await rewindWorkTree(execGit, wt, cp!.commit);
    expect(res.head).toBe(cp!.parent);
    // later.txt убрал `reset --hard`; del.txt он вернул, и его удалил список (удалён в снимке)
    expect(res.removedFiles.sort()).toEqual(['del.txt', 'dirty.txt']);
    expect(await snapshotTree(execGit, wt)).toBe(cp!.tree);
    expect(await fs.readFile(path.join(wt, 'mod.txt'), 'utf8')).toBe('mod v2\n');
    expect(await exists(path.join(wt, 'keep.txt'))).toBe(true);
    expect(await exists(path.join(wt, 'del.txt'))).toBe(false);
    expect(await exists(path.join(wt, 'ignored.log'))).toBe(true);
    expect(await exists(path.join(wt, 'node_modules/pkg.js'))).toBe(true);
    expect((await git(wt, 'rev-parse', 'HEAD')).trim()).toBe(cp!.parent);
    // отменённая работа — в снимке перед откатом
    const preFiles = (await git(wt, 'ls-tree', '-r', '--name-only', pre!.commit)).trim().split('\n');
    expect(preFiles).toEqual(expect.arrayContaining(['dirty.txt', 'later.txt']));
    // «отмена отката» — тот же механизм
    await rewindWorkTree(execGit, wt, pre!.commit);
    expect(await snapshotTree(execGit, wt)).toBe(pre!.tree);
  });
});

describe('checkpointGit: чистые функции', () => {
  it('ref и префиксы', () => {
    expect(checkpointRef('swarm-1', 'agent a/b', 3)).toBe('refs/projecthub/checkpoints/swarm-1/agent-a-b/3');
    expect(swarmIdFromCheckpointRef('refs/projecthub/checkpoints/swarm-1/a/3')).toBe('swarm-1');
    expect(swarmIdFromCheckpointRef('refs/heads/main')).toBeNull();
    expect(sanitizeRefSegment('..')).toBe('x');
  });

  it('список удаления: без каталогов и путей за пределами дерева', () => {
    expect(filesToRemoveAfterCheckout(['a.txt', 'dir/'], ['b.txt', '../x', 'C:/abs', 'a.txt'])).toEqual(['a.txt', 'b.txt']);
  });

  it('лимит: удаляются самые старые', () => {
    const list = [{ n: 3 }, { n: 1 }, { n: 2 }];
    expect(checkpointsToPrune(list, 2)).toEqual([{ n: 1 }]);
    expect(checkpointsToPrune(list, 5)).toEqual([]);
  });
});

describe('CheckpointService', () => {
  it('нумерация, дедупликация, лимит, удаление ref сессии и осиротевших', async () => {
    const svc = new CheckpointService(execGit, 2);
    const agent: { id: string; checkpoints?: never[] } & Record<string, unknown> = { id: 'a' };
    await write(wt, 'f1.txt', '1');
    const r1 = await svc.capture({ swarmId: 'swarm-1', agent, cwd: wt, kind: 'start', run: 1 });
    expect(r1.status).toBe('created');
    const r2 = await svc.capture({ swarmId: 'swarm-1', agent, cwd: wt, kind: 'turn', run: 1, turn: 1 });
    expect(r2.status).toBe('same_tree');
    await write(wt, 'f2.txt', '2');
    await svc.capture({ swarmId: 'swarm-1', agent, cwd: wt, kind: 'turn', run: 1, turn: 1 });
    await write(wt, 'f3.txt', '3');
    const r4 = await svc.capture({ swarmId: 'swarm-1', agent, cwd: wt, kind: 'end', run: 1 });
    expect(r4.status === 'created' && r4.pruned.map((c) => c.n)).toEqual([1]);
    const list = (agent as { checkpoints: Array<{ n: number; filesChanged?: number }> }).checkpoints;
    expect(list.map((c) => c.n)).toEqual([2, 3]);
    expect(list[1].filesChanged).toBe(1);
    expect(await listRefs(execGit, repo, checkpointRefPrefix('swarm-1'))).toHaveLength(2);

    // чужая сессия без файла состояния — осиротевшие ref
    await createCheckpoint(execGit, wt, { ref: checkpointRef('swarm-gone', 'b', 1), message: 'x' });
    expect(await svc.pruneOrphans(repo, new Set(['swarm-1']))).toBe(1);
    expect(await svc.deleteSession(repo, 'swarm-1')).toBe(2);
    expect(await listRefs(execGit, repo, 'refs/projecthub/')).toEqual([]);
  });

  it('rewind: снимок pre_rewind, «удалено» — относительно состояния до отката', async () => {
    const svc = new CheckpointService(execGit);
    const agent: { id: string; checkpoints?: Array<{ n: number; kind: string; tree: string }> } = { id: 'a' };
    await agentWorks();
    const r1 = await svc.capture({ swarmId: 's', agent, cwd: wt, kind: 'turn', turn: 1 });
    if (r1.status !== 'created') throw new Error('no checkpoint');
    await write(wt, 'later.txt', 'later\n');
    await write(wt, 'dirty.txt', 'dirty\n');
    await fs.rm(path.join(wt, 'keep.txt'));
    const { preRewind, result } = await svc.rewind('s', agent, wt, r1.checkpoint, 1);
    expect(preRewind).toMatchObject({ n: 2, kind: 'pre_rewind' });
    expect(result.removedFiles.sort()).toEqual(['dirty.txt', 'later.txt']);
    expect(await exists(path.join(wt, 'keep.txt'))).toBe(true);
    expect(agent.checkpoints!.map((c) => c.kind)).toEqual(['turn', 'pre_rewind']);
    expect(await svc.exists(wt, r1.checkpoint)).toBe(true);
  });

  it('вне git — not_git, без исключения', async () => {
    const plain = path.join(root, 'plain');
    await fs.mkdir(plain);
    const svc = new CheckpointService(execGit);
    const r = await svc.capture({ swarmId: 's', agent: { id: 'a' }, cwd: plain, kind: 'start' });
    expect(r.status).toBe('not_git');
  });
});
