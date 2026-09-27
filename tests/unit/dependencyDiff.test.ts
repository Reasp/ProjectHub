import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dependencyFilesInDiff,
  dependencySource,
  diffLockPackages,
  diffManifestDependencies,
  diffRequirements,
  isSafeNpmName,
  packageNameFromLockKey,
  parseNpmViewOutput,
  registryLookupSpec,
  resolvedLockVersion,
  riskFlags,
  summarizeDependencyChanges,
  type DependencyChange
} from '../../electron/services/dependencyDiff';

/**
 * Зависимости в диффе агента (TASK-73.1, decision-56 п. 5). `package.json`/`package-lock.json` (v3) до и после — из
 * настоящего `npm install --package-lock-only` npm 10.9.2; ответы `npm view … time deprecated --json` — живые.
 */

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', 'security', name), 'utf8');
const NOW = Date.parse('2026-09-27T12:00:00Z');

describe('diffManifestDependencies', () => {
  it('добавленные, изменённые; переезд из devDependencies в dependencies с той же версией — не новый', () => {
    const changes = diffManifestDependencies('package.json', fixture('pkg-base.json'), fixture('pkg-head.json'));
    const byName = Object.fromEntries(changes.map((c) => [c.name, c]));
    expect(byName['left-pad']).toMatchObject({ kind: 'added', to: '1.3.0', section: 'dependencies', source: 'registry' });
    expect(byName['mkdirp']).toMatchObject({ kind: 'added', to: '^0.5.1' });
    expect(byName['lodash']).toMatchObject({ kind: 'changed', from: '^4.17.20', to: '^4.18.1' });
    expect(byName['typescript']).toBeUndefined();
    expect(changes).toHaveLength(3);
  });

  it('удалённый пакет и новый манифест без базы', () => {
    const removed = diffManifestDependencies('package.json', fixture('pkg-head.json'), fixture('pkg-base.json'));
    expect(removed.filter((c) => c.kind === 'removed').map((c) => c.name).sort()).toEqual(['left-pad', 'mkdirp']);
    const fresh = diffManifestDependencies('apps/web/package.json', null, '{"dependencies":{"react":"19.0.0"}}');
    expect(fresh).toEqual([
      { ecosystem: 'npm', manifest: 'apps/web/package.json', name: 'react', section: 'dependencies', kind: 'added', to: '19.0.0', source: 'registry' }
    ]);
    expect(diffManifestDependencies('package.json', '{', 'not json')).toEqual([]);
  });

  it('источник пакета по спецификации', () => {
    expect(dependencySource('^1.2.3')).toBe('registry');
    expect(dependencySource('github:user/repo')).toBe('git');
    expect(dependencySource('user/repo#main')).toBe('git');
    expect(dependencySource('git+https://x/y.git')).toBe('git');
    expect(dependencySource('file:../lib')).toBe('file');
    expect(dependencySource('workspace:*')).toBe('workspace');
    expect(dependencySource('npm:other@1')).toBe('alias');
    expect(dependencySource('https://x/y.tgz')).toBe('url');
  });
});

describe('lock-файл', () => {
  it('новые записи packages — с транзитивными (minimist через mkdirp)', () => {
    const lock = diffLockPackages('package-lock.json', fixture('lock-base.json'), fixture('lock-head.json'));
    expect(lock).toEqual({ manifest: 'package-lock.json', added: 3, sample: ['left-pad', 'minimist', 'mkdirp'] });
    expect(diffLockPackages('package-lock.json', fixture('lock-head.json'), fixture('lock-head.json'))).toBeNull();
  });

  it('версия из lock и имя из ключа', () => {
    expect(resolvedLockVersion(fixture('lock-head.json'), 'mkdirp')).toBe('0.5.6');
    expect(resolvedLockVersion(fixture('lock-head.json'), 'nope')).toBeUndefined();
    expect(packageNameFromLockKey('node_modules/a/node_modules/@s/b')).toBe('@s/b');
  });

  it('файлы зависимостей в диффе — вне node_modules', () => {
    expect(dependencyFilesInDiff(['package.json', 'apps/web/package.json', 'package-lock.json', 'node_modules/x/package.json', 'requirements-dev.txt', 'src/a.ts'])).toEqual({
      manifests: ['package.json', 'apps/web/package.json'],
      locks: ['package-lock.json'],
      requirements: ['requirements-dev.txt']
    });
  });
});

describe('requirements', () => {
  it('добавлено, изменено, удалено; имена по PEP 503, комментарии и опции пропускаются', () => {
    const base = 'requests==2.19.0\nFlask==0.12  # web\n-r other.txt\nold_pkg>=1\n';
    const head = 'requests==2.31.0\nflask==0.12\nnew-pkg[extra]==1.0 ; python_version>"3.8"\n';
    const changes = diffRequirements('requirements.txt', base, head);
    expect(changes.map((c) => `${c.kind}:${c.name}:${c.from ?? ''}:${c.to ?? ''}`).sort()).toEqual([
      'added:new-pkg::==1.0',
      'changed:requests:==2.19.0:==2.31.0',
      'removed:old_pkg:>=1:'
    ]);
  });
});

describe('registry', () => {
  it('npm view с deprecated — обёртка { time, deprecated }', () => {
    const meta = parseNpmViewOutput(fixture('npm-view-left-pad.json'), '1.3.0');
    expect(meta).toEqual({ createdAt: '2014-03-14T09:09:20.762Z', publishedAt: '2018-04-09T01:10:45.796Z', deprecated: 'use String.prototype.padStart()' });
  });

  it('npm view без deprecated — голая карта time', () => {
    const meta = parseNpmViewOutput(fixture('npm-view-bare-time.json'), '1.2.8');
    expect(meta.createdAt).toBe('2013-06-25T08:17:16.343Z');
    expect(meta.publishedAt).toBe('2023-02-09T20:59:49.233Z');
    expect(meta.deprecated).toBeUndefined();
  });

  it('E404 — notFound; мусор — error', () => {
    expect(parseNpmViewOutput(fixture('npm-view-e404.json'), '1.0.0')).toEqual({ notFound: true });
    expect(parseNpmViewOutput('', undefined, 'npm error code E404')).toEqual({ notFound: true });
    expect(parseNpmViewOutput('', undefined, 'npm error network timeout').error).toContain('network');
  });

  it('флаги риска', () => {
    expect(riskFlags({ notFound: true }, NOW)).toEqual(['not_found']);
    expect(riskFlags({ error: 'x' }, NOW)).toEqual([]);
    expect(riskFlags({ createdAt: '2026-09-20T00:00:00Z', publishedAt: '2026-09-25T00:00:00Z' }, NOW)).toEqual(['recent', 'young']);
    expect(riskFlags(parseNpmViewOutput(fixture('npm-view-left-pad.json'), '1.3.0'), NOW)).toEqual(['deprecated']);
    expect(riskFlags(parseNpmViewOutput(fixture('npm-view-bare-time.json'), '1.2.8'), NOW)).toEqual([]);
  });

  it('спецификация запроса: точная версия из lock или манифеста, иначе имя; опасные имена отсекаются', () => {
    const base: DependencyChange = { ecosystem: 'npm', manifest: 'package.json', name: 'mkdirp', kind: 'added', to: '^0.5.1', source: 'registry' };
    expect(registryLookupSpec(base)).toBe('mkdirp');
    expect(registryLookupSpec({ ...base, resolved: '0.5.6' })).toBe('mkdirp@0.5.6');
    expect(registryLookupSpec({ ...base, to: '=1.3.0' })).toBe('mkdirp@1.3.0');
    expect(registryLookupSpec({ ...base, name: 'x & calc.exe' })).toBeNull();
    expect(registryLookupSpec({ ...base, source: 'git' })).toBeNull();
    expect(registryLookupSpec({ ...base, kind: 'removed' })).toBeNull();
    expect(isSafeNpmName('@scope/pkg.name')).toBe(true);
    expect(isSafeNpmName('Upper')).toBe(false);
    expect(isSafeNpmName('a;b')).toBe(false);
  });

  it('сводка изменений для HITL', () => {
    const text = summarizeDependencyChanges([
      { ecosystem: 'npm', manifest: 'package.json', name: 'left-pad', kind: 'added', to: '1.3.0', source: 'registry', flags: ['deprecated'] },
      { ecosystem: 'npm', manifest: 'package.json', name: 'lodash', kind: 'changed', from: '^4.17.20', to: '^4.18.1', source: 'registry' },
      { ecosystem: 'npm', manifest: 'package.json', name: 'gone', kind: 'removed', from: '1', source: 'registry' }
    ]);
    expect(text).toBe('+left-pad 1.3.0 [deprecated], lodash ^4.17.20→^4.18.1');
  });
});
