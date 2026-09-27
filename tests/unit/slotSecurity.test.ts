import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseNpmViewOutput } from '../../electron/services/dependencyDiff';
import {
  computeSlotSecurity,
  enrichSlotSecurityFromRegistry,
  filesInPatch,
  mergeApprovalText,
  mergeNeedsApproval,
  securityForFiles,
  securityNotifyKey,
  securityScoreInput,
  securitySummaryText,
  type SlotSecurityDeps
} from '../../electron/services/slotSecurity';

/**
 * Безопасность слота Swarm (TASK-73.4, decision-56 п. 5–7). Репозиторий настоящий: база `main` с `package.json` и
 * lock-файлом из npm 10.9, ветка агента добавляет пакеты (реальный lock после `npm install --package-lock-only`) и ключ.
 */

const fixtures = path.join(__dirname, 'fixtures', 'security');
const NOW = Date.parse('2026-09-27T12:00:00Z');

describe('computeSlotSecurity', () => {
  let repo: string;
  let patch: string;
  let deps: SlotSecurityDeps;
  let lookups: string[][];

  beforeAll(async () => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'ph-slot-sec-'));
    const git = simpleGit(repo);
    await git.init(['-b', 'main']);
    await git.addConfig('user.email', 't@example.com');
    await git.addConfig('user.name', 'Test');
    await git.addConfig('core.autocrlf', 'false');
    copyFileSync(path.join(fixtures, 'pkg-base.json'), path.join(repo, 'package.json'));
    copyFileSync(path.join(fixtures, 'lock-base.json'), path.join(repo, 'package-lock.json'));
    mkdirSync(path.join(repo, 'src'));
    writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const a = 1;\n');
    await git.add('.');
    await git.commit('base');
    await git.checkoutLocalBranch('swarm/agent-1');
    copyFileSync(path.join(fixtures, 'pkg-head.json'), path.join(repo, 'package.json'));
    copyFileSync(path.join(fixtures, 'lock-head.json'), path.join(repo, 'package-lock.json'));
    writeFileSync(path.join(repo, 'src', 'app.ts'), 'export const a = 1;\n// projecthub:allow-secret ghp_0123456789abcdefABCDEF0123\nexport const k = "AKIAIOSFODNN7EXAMPLE";\n');
    writeFileSync(path.join(repo, 'requirements.txt'), 'requests==2.31.0\n');
    await git.add('.');
    await git.commit('agent(implementer): result');
    patch = await git.diff(['main', '--no-color']);
    lookups = [];
    deps = {
      showBaseFile: async (root, base, rel) => {
        try {
          return await simpleGit(root).show([`${base}:${rel}`]);
        } catch {
          return null;
        }
      },
      readWorktreeFile: async (wt, rel) => fs.readFile(path.join(wt, rel), 'utf8').catch(() => null),
      headSha: async (wt) => (await simpleGit(wt).revparse(['HEAD'])).trim(),
      allowPaths: async () => [],
      registryLookupsEnabled: async () => true,
      lookupRegistry: async (_cwd, specs) => {
        lookups.push(specs);
        const map = new Map();
        for (const spec of specs) {
          if (spec === 'left-pad@1.3.0') map.set(spec, parseNpmViewOutput(readFileSync(path.join(fixtures, 'npm-view-left-pad.json'), 'utf8'), '1.3.0'));
          else if (spec === 'mkdirp@0.5.6') map.set(spec, { createdAt: '2011-01-01T00:00:00Z', publishedAt: '2022-03-25T00:00:00Z' });
          else map.set(spec, { error: 'offline' });
        }
        return map;
      },
      now: () => NOW
    };
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('секреты без учёта маркера агента, зависимости по файлам, lock и requirements', async () => {
    const report = await computeSlotSecurity({ projectPath: repo, baseBranch: 'main', worktreePath: repo, patch }, deps);
    expect(report.secrets).toEqual(
      expect.arrayContaining([
        { kind: 'github_token', file: 'src/app.ts', line: 2 },
        { kind: 'aws_key', file: 'src/app.ts', line: 3 }
      ])
    );
    expect(report.secretsSuppressed).toBe(0);
    const deps1 = Object.fromEntries(report.dependencies.map((d) => [d.name, d]));
    expect(deps1['left-pad']).toMatchObject({ kind: 'added', to: '1.3.0', resolved: '1.3.0' });
    expect(deps1['mkdirp']).toMatchObject({ kind: 'added', to: '^0.5.1', resolved: '0.5.6' });
    expect(deps1['lodash']).toMatchObject({ kind: 'changed', from: '^4.17.20', to: '^4.18.1' });
    expect(deps1['requests']).toMatchObject({ ecosystem: 'pip', kind: 'added', to: '==2.31.0' });
    expect(report.lockChanges).toEqual([{ manifest: 'package-lock.json', added: 3, sample: ['left-pad', 'minimist', 'mkdirp'] }]);
    expect(report.registry).toBe('pending');
    expect(report.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(report.scannedAt).toBe(NOW);
  });

  it('registry: флаги риска, сбой запроса — partial без флага', async () => {
    const base = await computeSlotSecurity({ projectPath: repo, baseBranch: 'main', worktreePath: repo, patch }, deps);
    const report = await enrichSlotSecurityFromRegistry(base, repo, deps);
    expect(lookups.at(-1)!.sort()).toEqual(['left-pad@1.3.0', 'lodash@4.18.1', 'mkdirp@0.5.6']);
    const byName = Object.fromEntries(report.dependencies.map((d) => [d.name, d]));
    expect(byName['left-pad'].flags).toEqual(['deprecated']);
    expect(byName['left-pad'].registry?.publishedAt).toBe('2018-04-09T01:10:45.796Z');
    expect(byName['mkdirp'].flags).toBeUndefined();
    expect(byName['lodash'].registry).toEqual({ error: 'offline' });
    expect(report.registry).toBe('partial');

    expect(securityScoreInput(report)).toEqual({ secrets: 2, riskyDependencies: 1, dependencyChanges: 4 });
    expect(mergeNeedsApproval(report)).toBe(true);
    const text = mergeApprovalText(report, 'implementer', 'main');
    expect(text.title).toBe('Слить кандидата «implementer» в main: секретов 2, пакетов 4');
    expect(text.details).toContain('+left-pad 1.3.0 [deprecated]');
    expect(text.details).toContain('package-lock.json: +3 пакетов');
    expect(text.details).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(securitySummaryText(report)).toContain('секреты: ');
    // Ключ при секретах не зависит от флагов registry — фоновое обогащение не даёт второго уведомления.
    expect(securityNotifyKey('a1', report)).toBe(securityNotifyKey('a1', base));
    expect(securityNotifyKey('a1', report)).toBe('a1|secrets|aws_key@src/app.ts:3,github_token@src/app.ts:2');
    expect(securityNotifyKey('a1', { ...report, secrets: [] })).toBe('a1|deps|left-pad:deprecated');
  });

  it('выключенные запросы registry и allowPaths основного дерева', async () => {
    const report = await computeSlotSecurity(
      { projectPath: repo, baseBranch: 'main', worktreePath: repo, patch },
      { ...deps, registryLookupsEnabled: async () => false, allowPaths: async () => ['src/**'] }
    );
    expect(report.registry).toBe('disabled');
    expect(report.secrets).toEqual([]);
    expect(report.secretsSuppressed).toBe(2);
    expect(await enrichSlotSecurityFromRegistry(report, repo, deps)).toBe(report);
    expect(mergeApprovalText(report, 'x', 'main').details).toContain('выключена');
  });

  it('сборка из файлов учитывает только выбранные файлы', async () => {
    const report = await computeSlotSecurity({ projectPath: repo, baseBranch: 'main', worktreePath: repo, patch }, deps);
    const onlyApp = securityForFiles(report, ['src/app.ts'])!;
    expect(onlyApp.secrets.length).toBe(2);
    expect(onlyApp.dependencies).toEqual([]);
    expect(mergeNeedsApproval(securityForFiles(report, ['README.md']))).toBe(false);
    expect(mergeNeedsApproval(undefined)).toBe(false);
    expect(securityScoreInput(undefined)).toBeUndefined();
  });

  it('чистый результат — без уведомления и без HITL', async () => {
    const clean = { scannedAt: NOW, secrets: [], secretsSuppressed: 0, dependencies: [], lockChanges: [], registry: 'none' as const };
    expect(securityNotifyKey('a', clean)).toBeNull();
    expect(mergeNeedsApproval(clean)).toBe(false);
    expect(securityScoreInput(clean)).toEqual({ secrets: 0, riskyDependencies: 0, dependencyChanges: 0 });
  });

  it('filesInPatch разбирает кавычки git', () => {
    expect(filesInPatch('diff --git a/x y.txt b/x y.txt\n')).toEqual(['x y.txt']);
    expect(filesInPatch('diff --git "a/\\320\\260.txt" "b/\\320\\260.txt"\n')).toEqual(['а.txt']);
  });
});
