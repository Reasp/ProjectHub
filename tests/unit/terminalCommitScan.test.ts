import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitIncludesWorktree, commitScanScope, scanPendingCommit, shellTokens } from '../../electron/services/terminalCommitScan';

/** `git commit` в терминальной сессии (TASK-73.3, decision-56 п. 4). */

describe('commitScanScope', () => {
  it.each([
    ['git commit -m "fix"', 'staged'],
    ['git commit -m "fix all the things"', 'staged'],
    ['git commit -am "fix"', 'worktree'],
    ['git commit -a -m fix', 'worktree'],
    ['git commit --all -m fix', 'worktree'],
    ['git commit -ma', 'staged'],
    ['git add -A && git commit -m "x"', 'worktree'],
    ['git add src/a.ts; git commit -m x', 'worktree'],
    ['git -C repo -c user.name=x commit -m y', 'staged'],
    ['cd app && git commit -m "a" && git push', 'staged'],
    ['"C:\\Program Files\\Git\\bin\\git.exe" commit -m x', 'staged'],
    ['C:/Git/bin/git.exe commit -m x', 'staged'],
    ['git commit --dry-run -a', null],
    ['git status', null],
    ['npm test', null],
    ['echo "git commit"', null]
  ])('%s → %s', (command, scope) => {
    expect(commitScanScope(command)).toBe(scope);
  });

  it('разбор аргументов с кавычками', () => {
    expect(shellTokens(`-m "fix \\"all\\"" -a 'x y'`)).toEqual(['-m', 'fix \\"all\\"', '-a', 'x y']);
    expect(commitIncludesWorktree('-m -a')).toBe(false);
    expect(commitIncludesWorktree('-F msg.txt -a')).toBe(true);
    expect(commitIncludesWorktree('-- -a')).toBe(false);
  });
});

describe('scanPendingCommit на настоящем репозитории', () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'ph-term-commit-'));
    const git = simpleGit(root);
    await git.init(['-b', 'main']);
    await git.addConfig('user.email', 't@example.com');
    await git.addConfig('user.name', 'Test');
    await git.addConfig('core.autocrlf', 'false');
    writeFileSync(path.join(root, 'app.ts'), 'export const a = 1;\n');
    writeFileSync(path.join(root, '.gitignore'), 'ignored.txt\n');
    await git.add('.');
    await git.commit('init');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('staged: только индекс', async () => {
    writeFileSync(path.join(root, 'app.ts'), 'export const a = 1;\nconst t = "ghp_0123456789abcdefABCDEF0123";\n');
    expect((await scanPendingCommit(root, 'staged')).findings).toEqual([]);
    await simpleGit(root).add('app.ts');
    expect((await scanPendingCommit(root, 'staged')).findings).toEqual([{ kind: 'github_token', file: 'app.ts', line: 2 }]);
  });

  it('worktree: изменения отслеживаемых и неотслеживаемые файлы, .gitignore соблюдается', async () => {
    writeFileSync(path.join(root, 'app.ts'), 'export const a = 1;\nlogin("ghp_0123456789abcdefABCDEF0123");\n');
    writeFileSync(path.join(root, 'new.env.ts'), 'export const k = "AKIAIOSFODNN7EXAMPLE";\n');
    writeFileSync(path.join(root, '.env'), 'X=1\n');
    writeFileSync(path.join(root, 'ignored.txt'), 'sk-ant-api03-AbCdEf0123456789xyzXYZ\n');
    writeFileSync(path.join(root, 'bin.dat'), Buffer.from([0, 1, 2, 0x41, 0x4b, 0x49, 0x41]));
    const res = await scanPendingCommit(root, 'worktree');
    expect(res.findings).toEqual(
      expect.arrayContaining([
        { kind: 'github_token', file: 'app.ts', line: 2 },
        { kind: 'aws_key', file: 'new.env.ts', line: 1 },
        { kind: 'env_file', file: '.env' }
      ])
    );
    expect(res.findings.some((f) => f.file === 'ignored.txt' || f.file === 'bin.dat')).toBe(false);
  });

  it('allowPaths и маркер снимают находки', async () => {
    writeFileSync(path.join(root, 'fx.ts'), 'const t = "ghp_0123456789abcdefABCDEF0123"; // projecthub:allow-secret\n');
    writeFileSync(path.join(root, 'fixtures.ts'), 'const k = "AKIAIOSFODNN7EXAMPLE";\n');
    const res = await scanPendingCommit(root, 'worktree', ['fixtures.ts']);
    expect(res.findings).toEqual([]);
    expect(res.suppressed).toBe(2);
  });
});
