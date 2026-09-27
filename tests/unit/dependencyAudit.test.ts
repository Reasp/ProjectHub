import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildFindingTask,
  detectAuditTargets,
  meetsSeverity,
  mergeCounts,
  newFindings,
  normalizeSeverity,
  parseNpmAudit,
  parsePipAudit,
  summarizeCounts
} from '../../electron/services/dependencyAudit';

/**
 * Разбор аудита зависимостей (TASK-73.1, decision-56 п. 2). Фикстуры — настоящие выводы 2026-09-27:
 * npm 10.9.2 (`lodash@4.17.20` + `minimist@1.2.5`; `mkdirp@0.5.1`; без lock; registry 127.0.0.1:9; `lodash@4.18.1`)
 * и pip-audit 2.10.1 (`requests==2.19.0`, `flask==0.12`; `flask>=0.12`).
 */

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', 'security', name), 'utf8');

describe('parseNpmAudit', () => {
  it('прямые уязвимости: уровни, advisories с GHSA и ссылками, fix', () => {
    const result = parseNpmAudit(fixture('npm-audit-direct.json'));
    expect(result.status).toBe('done');
    expect(result.counts).toMatchObject({ critical: 1, high: 1, moderate: 0 });
    expect(result.dependencyCount).toBe(2);
    expect(result.findings.map((f) => f.package)).toEqual(['minimist', 'lodash']);
    const lodash = result.findings.find((f) => f.package === 'lodash')!;
    expect(lodash).toMatchObject({ ecosystem: 'npm', severity: 'high', direct: true, range: '<=4.17.23' });
    expect(lodash.fix).toEqual({ available: true, name: 'lodash', version: '4.18.1', major: false });
    expect(lodash.advisories.length).toBe(5);
    expect(lodash.advisories[0]).toEqual({
      id: 'GHSA-35jh-r3h4-6jhm',
      title: 'Command Injection in lodash',
      url: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm',
      severity: 'high',
      range: '<4.17.21'
    });
  });

  it('транзитивная: via строкой — пакет-посредник без своих advisories', () => {
    const result = parseNpmAudit(fixture('npm-audit-transitive.json'));
    expect(result.counts.critical).toBe(2);
    const mkdirp = result.findings.find((f) => f.package === 'mkdirp')!;
    expect(mkdirp).toMatchObject({ direct: true, via: ['minimist'], advisories: [] });
    const minimist = result.findings.find((f) => f.package === 'minimist')!;
    expect(minimist.direct).toBe(false);
    expect(minimist.advisories.length).toBeGreaterThan(0);
    expect(minimist.fix).toMatchObject({ available: true, name: 'mkdirp', version: '0.5.6' });
  });

  it('без lock-файла — no_lockfile с подсказкой, не ошибка', () => {
    const result = parseNpmAudit(fixture('npm-audit-enolock.json'));
    expect(result.status).toBe('no_lockfile');
    expect(result.message).toContain('npm i --package-lock-only');
  });

  it('registry недоступен — error network', () => {
    const result = parseNpmAudit(fixture('npm-audit-offline.json'));
    expect(result).toMatchObject({ status: 'error', errorKind: 'network' });
    expect(result.message).toContain('ECONNREFUSED');
  });

  it('чистый проект — done без находок', () => {
    const result = parseNpmAudit(fixture('npm-audit-clean.json'));
    expect(result).toMatchObject({ status: 'done', findings: [], dependencyCount: 1 });
    expect(summarizeCounts(result.counts)).toBe('уязвимостей нет');
  });

  it('не JSON: ENOLOCK из stderr, сеть, чужой формат', () => {
    expect(parseNpmAudit('', 'npm error code ENOLOCK').status).toBe('no_lockfile');
    expect(parseNpmAudit('', 'getaddrinfo ENOTFOUND registry.npmjs.org')).toMatchObject({ status: 'error', errorKind: 'network' });
    expect(parseNpmAudit('garbage', '')).toMatchObject({ status: 'error', errorKind: 'format' });
    expect(parseNpmAudit(JSON.stringify({ advisories: {}, metadata: {} }))).toMatchObject({ status: 'error', errorKind: 'format' });
  });

  it('предупреждение npm перед JSON в stdout не ломает разбор', () => {
    const result = parseNpmAudit(`npm warn config something\n${fixture('npm-audit-clean.json')}`);
    expect(result.status).toBe('done');
  });
});

describe('parsePipAudit', () => {
  it('закреплённые требования: пакеты, версии, дубли id схлопнуты, уровень unknown', () => {
    const result = parsePipAudit(fixture('pip-audit-no-deps.json'));
    expect(result.status).toBe('done');
    expect(result.dependencyCount).toBe(2);
    expect(result.findings.map((f) => `${f.package}@${f.version}`)).toEqual(['flask@0.12', 'requests@2.19.0']);
    const requests = result.findings.find((f) => f.package === 'requests')!;
    const ids = requests.advisories.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('PYSEC-2018-28');
    const pysec = requests.advisories.find((a) => a.id === 'PYSEC-2018-28')!;
    expect(pysec.url).toBe('https://github.com/advisories/GHSA-x84v-xcm2-53pg');
    expect(pysec.fixVersions).toEqual(['2.20.0']);
    expect(requests.severity).toBe('unknown');
    expect(requests.fix?.available).toBe(true);
    expect(result.counts.unknown).toBe(2);
  });

  it('незакреплённые требования — unsupported с именем пакета', () => {
    const result = parsePipAudit('', fixture('pip-audit-unpinned.stderr.txt'));
    expect(result.status).toBe('unsupported');
    expect(result.message).toContain('flask');
  });

  it('сеть и мусор', () => {
    expect(parsePipAudit('', 'requests.exceptions.ConnectionError: Max retries exceeded with url')).toMatchObject({ status: 'error', errorKind: 'network' });
    expect(parsePipAudit('', 'ERROR:pip_audit._cli:boom')).toMatchObject({ status: 'error', errorKind: 'format' });
  });
});

describe('detectAuditTargets', () => {
  it('npm по lock, без lock — no_lockfile; yarn/pnpm/cargo — unsupported; requirements — pip', () => {
    expect(detectAuditTargets(['package.json', 'package-lock.json'])).toEqual([{ ecosystem: 'npm', manifest: 'package-lock.json', run: true }]);
    expect(detectAuditTargets(['package.json'])[0]).toMatchObject({ ecosystem: 'npm', run: false, status: 'no_lockfile' });
    expect(detectAuditTargets(['package.json', 'yarn.lock'])[0]).toMatchObject({ ecosystem: 'yarn', status: 'unsupported' });
    expect(detectAuditTargets(['package.json', 'pnpm-lock.yaml'])[0]).toMatchObject({ ecosystem: 'pnpm', status: 'unsupported' });
    expect(detectAuditTargets(['requirements.txt', 'requirements-dev.txt', 'Cargo.lock']).map((t) => `${t.ecosystem}:${t.manifest}:${t.run}`)).toEqual([
      'pip:requirements-dev.txt:true',
      'pip:requirements.txt:true',
      'cargo:Cargo.lock:false'
    ]);
    expect(detectAuditTargets(['README.md'])).toEqual([]);
  });
});

describe('пороги, новые находки, сводки, задача', () => {
  it('meetsSeverity: unknown считается как high, но не проходит порог critical', () => {
    expect(meetsSeverity('critical', 'high')).toBe(true);
    expect(meetsSeverity('moderate', 'high')).toBe(false);
    expect(meetsSeverity('unknown', 'high')).toBe(true);
    expect(meetsSeverity('unknown', 'critical')).toBe(false);
    expect(normalizeSeverity('MEDIUM')).toBe('moderate');
    expect(normalizeSeverity('weird')).toBe('unknown');
  });

  it('newFindings: новая — та, у которой есть advisory, которого не было', () => {
    const before = parseNpmAudit(fixture('npm-audit-transitive.json')).findings;
    const after = parseNpmAudit(fixture('npm-audit-direct.json')).findings;
    expect(newFindings(undefined, after).length).toBe(2);
    expect(newFindings(after, after)).toEqual([]);
    const fresh = newFindings(before, after).map((f) => f.package);
    expect(fresh).toContain('lodash');
  });

  it('summarizeCounts и mergeCounts', () => {
    const a = parseNpmAudit(fixture('npm-audit-direct.json')).counts;
    const b = parsePipAudit(fixture('pip-audit-no-deps.json')).counts;
    expect(summarizeCounts(mergeCounts([a, b]))).toBe('critical 1, high 1, unknown 2');
  });

  it('buildFindingTask: заголовок в пределах лимита, advisories ссылками, label security', () => {
    const lodash = parseNpmAudit(fixture('npm-audit-direct.json')).findings.find((f) => f.package === 'lodash')!;
    const task = buildFindingTask(lodash, 'demo');
    expect(task.title).toBe('Уязвимость lodash: Command Injection in lodash');
    expect(task.labels).toEqual(['security']);
    expect(task.description).toContain('[GHSA-35jh-r3h4-6jhm](https://github.com/advisories/GHSA-35jh-r3h4-6jhm)');
    expect(task.description).toContain('Исправление: 4.18.1');
    const long = buildFindingTask({ ...lodash, advisories: [{ ...lodash.advisories[0], title: 'x'.repeat(300) }] });
    expect(long.title.length).toBeLessThanOrEqual(100);
  });
});
