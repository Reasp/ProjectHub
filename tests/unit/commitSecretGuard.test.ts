import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guardedCommit, secretAllowPathsFromConfig, type CommitGuardDeps } from '../../electron/services/commitSecretGuard';

/** Коммит со сканером секретов (TASK-73.3, decision-56 п. 4) на настоящем git-репозитории. */

describe('guardedCommit', () => {
  let root: string;
  let overrides: Array<{ treeHash: string; summary: string; source: unknown }>;
  let allowPaths: string[];
  let deps: CommitGuardDeps;

  beforeEach(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'ph-commit-guard-'));
    const git = simpleGit(root);
    await git.init(['-b', 'main']);
    await git.addConfig('user.email', 't@example.com');
    await git.addConfig('user.name', 'Test');
    await git.addConfig('core.autocrlf', 'false');
    writeFileSync(path.join(root, 'README.md'), 'x\n');
    await git.add('.');
    await git.commit('init');
    overrides = [];
    allowPaths = [];
    deps = {
      stageAll: async (r) => {
        await simpleGit(r).add('.');
      },
      stagedDiff: (r) => simpleGit(r).diff(['--cached', '--no-color', '--no-ext-diff']),
      indexTree: async (r) => (await simpleGit(r).raw(['write-tree'])).trim(),
      allowPaths: async () => allowPaths,
      commit: async (r, message) => {
        await simpleGit(r).commit(message);
        return true;
      },
      recordOverride: (info) => overrides.push({ treeHash: info.treeHash, summary: info.summary, source: info.source }),
      warn: () => undefined
    };
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const log = async () => (await simpleGit(root).log()).all.map((c) => c.message);

  it('чистый staged-дифф коммитится сразу', async () => {
    writeFileSync(path.join(root, 'a.ts'), 'export const a = 1;\n');
    const res = await guardedCommit(root, 'feat: a', { stageAll: true, allowOverride: true, source: { kind: 'local' } }, deps);
    expect(res).toEqual({ ok: true });
    expect(await log()).toContain('feat: a');
  });

  it('секрет — отказ с видами и файлами, значение наружу не уходит, коммита нет', async () => {
    writeFileSync(path.join(root, 'config.ts'), 'export const key = "sk-ant-api03-AbCdEf0123456789xyzXYZ";\n');
    writeFileSync(path.join(root, '.env'), 'PORT=3000\n');
    const res = await guardedCommit(root, 'feat: config', { stageAll: true, allowOverride: true, source: { kind: 'local' } }, deps);
    expect(res.ok).toBe(false);
    if (res.ok || res.reason !== 'secrets') throw new Error('ожидался отказ по секретам');
    expect(res.findings).toEqual(
      expect.arrayContaining([
        { kind: 'provider_key', file: 'config.ts', line: 1 },
        { kind: 'env_file', file: '.env' }
      ])
    );
    expect(res.treeHash).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.stringify(res)).not.toContain('AbCdEf0123456789');
    expect(await log()).toEqual(['init']);
  });

  it('подтверждение по хэшу индекса коммитит и пишет решение в аудит', async () => {
    writeFileSync(path.join(root, 'config.ts'), 'export const key = "sk-ant-api03-AbCdEf0123456789xyzXYZ";\n');
    const first = await guardedCommit(root, 'feat: key', { stageAll: true, allowOverride: true, source: { kind: 'local' } }, deps);
    if (first.ok || first.reason !== 'secrets') throw new Error('ожидался отказ');
    const second = await guardedCommit(root, 'feat: key', { allowOverride: true, acknowledgeSecrets: first.treeHash, source: { kind: 'local' } }, deps);
    expect(second).toEqual({ ok: true, overridden: true });
    expect(overrides).toEqual([{ treeHash: first.treeHash, summary: 'assigned_secret (config.ts:1); provider_key (config.ts:1)', source: { kind: 'local' } }]);
    expect(await log()).toContain('feat: key');
  });

  it('индекс изменился после отказа — старое подтверждение не действует', async () => {
    writeFileSync(path.join(root, 'config.ts'), 'export const key = "sk-ant-api03-AbCdEf0123456789xyzXYZ";\n');
    const first = await guardedCommit(root, 'x', { stageAll: true, allowOverride: true, source: { kind: 'local' } }, deps);
    if (first.ok || first.reason !== 'secrets') throw new Error('ожидался отказ');
    writeFileSync(path.join(root, 'other.ts'), 'const token = "ghp_0123456789abcdefABCDEF0123";\n');
    const second = await guardedCommit(root, 'x', { stageAll: true, allowOverride: true, acknowledgeSecrets: first.treeHash, source: { kind: 'local' } }, deps);
    expect(second).toMatchObject({ ok: false, reason: 'secrets' });
    expect(overrides).toEqual([]);
    expect(await log()).toEqual(['init']);
  });

  it('с телефона подтверждение невозможно даже с верным хэшем', async () => {
    writeFileSync(path.join(root, 'config.ts'), 'export const key = "sk-ant-api03-AbCdEf0123456789xyzXYZ";\n');
    const first = await guardedCommit(root, 'x', { stageAll: true, allowOverride: false, source: { kind: 'remote', deviceId: 'd1' } }, deps);
    if (first.ok || first.reason !== 'secrets') throw new Error('ожидался отказ');
    const second = await guardedCommit(root, 'x', { allowOverride: false, acknowledgeSecrets: first.treeHash, source: { kind: 'remote', deviceId: 'd1' } }, deps);
    expect(second).toMatchObject({ ok: false, reason: 'secrets' });
  });

  it('allowPaths и маркер человека снимают находки', async () => {
    allowPaths = ['tests/**'];
    writeFileSync(path.join(root, 'fixture.ts'), 'const t = "ghp_0123456789abcdefABCDEF0123"; // projecthub:allow-secret\n');
    await simpleGit(root).raw(['add', 'fixture.ts']);
    const res = await guardedCommit(root, 'test: fixture', { allowOverride: true, source: { kind: 'local' } }, deps);
    expect(res).toEqual({ ok: true });
  });

  it('сбой скана не запрещает коммит', async () => {
    writeFileSync(path.join(root, 'b.ts'), 'export const b = 2;\n');
    const broken = { ...deps, stagedDiff: async () => Promise.reject(new Error('git broken')) };
    const res = await guardedCommit(root, 'feat: b', { stageAll: true, allowOverride: true, source: { kind: 'local' } }, broken);
    expect(res).toEqual({ ok: true });
  });

  it('secretAllowPathsFromConfig берёт только строки', () => {
    expect(secretAllowPathsFromConfig({ security: { secretScan: { allowPaths: ['tests/**', 3, ''] } } })).toEqual(['tests/**']);
    expect(secretAllowPathsFromConfig({})).toEqual([]);
    expect(secretAllowPathsFromConfig(null)).toEqual([]);
  });
});
