import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ARTIFACT_LIMITS,
  artifactKindOf,
  checkArtifactsRelDir,
  enforceMinScreenshots,
  iterationScreenshots,
  mimeOfArtifact,
  planStorePrune,
  resolveArtifactReadPath,
  resolveArtifactSources,
  resolveScreenshotRef,
  safeSegment,
  selectArtifacts,
  substituteArtifactsDir
} from '../../electron/services/visualArtifacts';
import {
  defaultChecksFromProject,
  normalizeCheckDefinition,
  parseCheckOutput,
  parseTestCounters,
  summarizeCheckResult
} from '../../electron/services/arenaChecks';
import type { CheckArtifact, CheckRunResult } from '../../electron/services/arenaTypes';

const MB = 1024 * 1024;

const result = (over: Partial<CheckRunResult> = {}): CheckRunResult => ({
  id: 'ui-smoke',
  kind: 'ui-smoke',
  name: 'UI smoke',
  command: 'npm run ui-smoke',
  status: 'passed',
  blocking: true,
  ...over
});

const shot = (name: string, relPath = `s/a/iter-1/ui-smoke/${name}`): CheckArtifact => ({ name, relPath, kind: 'screenshot', bytes: 100 });

describe('формат проверки ui-smoke', () => {
  it('normalizeCheckDefinition сохраняет вид и секцию artifacts', () => {
    const def = normalizeCheckDefinition(
      { id: 'ui', kind: 'ui-smoke', command: 'npx playwright test', artifacts: { from: ['test-results', '', 5], minScreenshots: 2.7 } },
      0
    );
    expect(def?.kind).toBe('ui-smoke');
    expect(def?.artifacts).toEqual({ from: ['test-results'], minScreenshots: 2 });
  });

  it('artifacts.from строкой и отрицательный минимум', () => {
    const def = normalizeCheckDefinition({ kind: 'ui-smoke', command: 'x', artifacts: { from: 'out', minScreenshots: -3 } }, 0);
    expect(def?.artifacts).toEqual({ from: ['out'], minScreenshots: 0 });
    expect(def?.id).toBe('ui-smoke-1');
  });

  it('у других видов секции artifacts нет', () => {
    expect(normalizeCheckDefinition({ kind: 'test', command: 'x', artifacts: { from: ['a'] } }, 0)?.artifacts).toBeUndefined();
  });

  it('скрипт ui-smoke в package.json становится проверкой по умолчанию', () => {
    const checks = defaultChecksFromProject({ scripts: { test: 'vitest run', 'ui-smoke': 'playwright test --project smoke' } });
    expect(checks.map((c) => [c.id, c.kind])).toEqual([
      ['test', 'test'],
      ['ui-smoke', 'ui-smoke']
    ]);
    expect(checks[1].command).toBe('npm run ui-smoke');
  });

  it('плейсхолдер каталога артефактов', () => {
    expect(substituteArtifactsDir('pw test --output "${artifactsDir}" && cp x ${artifactsDir}/x', 'C:/v/a')).toBe(
      'pw test --output "C:/v/a" && cp x C:/v/a/x'
    );
    expect(substituteArtifactsDir('npm run ui-smoke', 'C:/v/a')).toBe('npm run ui-smoke');
  });
});

describe('счётчики Playwright Test', () => {
  it('passed с временем, failed и flaky', () => {
    const out = 'Running 4 tests using 2 workers\n\n  1 failed\n    [chromium] › smoke.spec.ts:3:1 › home\n  1 flaky\n  2 passed (3.4s)\n';
    expect(parseTestCounters(out)).toEqual({ failedTests: 1, passedTests: 3, totalTests: 4 });
  });

  it('все упали — строки passed нет', () => {
    expect(parseTestCounters('Running 2 tests using 1 worker\n\n  2 failed\n')).toEqual({ failedTests: 2, passedTests: 0, totalTests: 2 });
  });

  it('время в минутах и разбор для вида ui-smoke', () => {
    expect(parseCheckOutput('ui-smoke', '  5 passed (1.2m)\n')).toEqual({ failedTests: 0, passedTests: 5, totalTests: 5 });
  });

  it('vitest по-прежнему разбирается первым', () => {
    expect(parseTestCounters(' Tests  2 failed | 10 passed (12)\n')).toEqual({ failedTests: 2, passedTests: 10, totalTests: 12 });
  });
});

describe('отбор артефактов', () => {
  it('виды по расширению', () => {
    expect(artifactKindOf('a/Home.PNG')).toBe('screenshot');
    expect(artifactKindOf('x.webp')).toBe('screenshot');
    expect(artifactKindOf('trace.zip')).toBe('trace');
    expect(artifactKindOf('error-context.md')).toBeNull();
    expect(artifactKindOf('video.webm')).toBeNull();
  });

  it('лимиты файла, числа и объёма; скриншоты раньше trace', () => {
    const cands = [
      { sourcePath: '/w/t.zip', name: 'trace.zip', bytes: 5 * MB },
      { sourcePath: '/w/b.png', name: 'b.png', bytes: 1 * MB },
      { sourcePath: '/w/a.png', name: 'a.png', bytes: 1 * MB },
      { sourcePath: '/w/huge.png', name: 'huge.png', bytes: 20 * MB },
      { sourcePath: '/w/log.txt', name: 'log.txt', bytes: 1 }
    ];
    const sel = selectArtifacts(cands, DEFAULT_ARTIFACT_LIMITS);
    expect(sel.selected.map((s) => s.name)).toEqual(['a.png', 'b.png', 'trace.zip']);
    expect(sel.truncated).toBe(true);

    const few = selectArtifacts(cands.slice(1, 3), { maxFileBytes: 10 * MB, maxFilesPerCheck: 1, maxBytesPerCheck: 10 * MB });
    expect(few.selected.map((s) => s.name)).toEqual(['a.png']);
    expect(few.truncated).toBe(true);

    const bytes = selectArtifacts(cands.slice(0, 3), { maxFileBytes: 10 * MB, maxFilesPerCheck: 10, maxBytesPerCheck: 2 * MB });
    expect(bytes.selected.map((s) => s.name)).toEqual(['a.png', 'b.png']);
  });

  it('обратные слэши в имени и дубли', () => {
    const sel = selectArtifacts([
      { sourcePath: '/a', name: 'dir\\a.png', bytes: 1 },
      { sourcePath: '/b', name: 'dir/a.png', bytes: 1 }
    ]);
    expect(sel.selected.map((s) => s.name)).toEqual(['dir/a.png']);
  });

  it('источники только внутри рабочего каталога', () => {
    const wd = path.resolve('/w/proj');
    expect(resolveArtifactSources(wd, ['test-results', '../other', path.resolve('/etc'), '', 'test-results'])).toEqual([
      path.join(wd, 'test-results')
    ]);
  });

  it('минимум скриншотов: пустой прогон — провал', () => {
    const r = result();
    enforceMinScreenshots(r, 1);
    expect(r.status).toBe('failed');
    expect(r.detail).toMatch(/нет скриншотов/);

    const ok = result({ artifacts: [shot('a.png')] });
    enforceMinScreenshots(ok, 1);
    expect(ok.status).toBe('passed');

    const failed = result({ status: 'failed' });
    enforceMinScreenshots(failed, 1);
    expect(failed.detail).toBeUndefined();

    const zero = result();
    enforceMinScreenshots(zero, 0);
    expect(zero.status).toBe('passed');
  });

  it('сводка проверки называет число скриншотов', () => {
    const r = result({
      durationMs: 1500,
      artifacts: [shot('a.png'), { name: 't.zip', relPath: 'x', kind: 'trace', bytes: 1 }],
      artifactsTruncated: true
    });
    expect(summarizeCheckResult(r)).toBe('passed, 1.5 с, скриншотов: 1, trace: 1 (часть не сохранена по лимиту)');
  });
});

describe('хранилище', () => {
  it('безопасные сегменты и каталог проверки', () => {
    expect(safeSegment('../..')).toBe('x');
    expect(safeSegment('a/b\\c:d')).toBe('a-b-c-d');
    expect(checkArtifactsRelDir({ scope: 'swarm-1', agentId: 'agent:1', run: 'iter-2', checkId: 'ui smoke' })).toBe(
      'swarm-1/agent-1/iter-2/ui-smoke'
    );
    expect(checkArtifactsRelDir({ scope: 'adhoc', run: 'r', checkId: 'c' })).toBe('adhoc/main/r/c');
  });

  it('план ротации: возраст, затем объём, текущий каталог не трогается', () => {
    const now = 100 * 86_400_000;
    const day = 86_400_000;
    const entries = [
      { key: 'old', bytes: 10, mtimeMs: now - 40 * day },
      { key: 'a', bytes: 500, mtimeMs: now - 3 * day },
      { key: 'b', bytes: 500, mtimeMs: now - 2 * day },
      { key: 'cur', bytes: 500, mtimeMs: now - 50 * day }
    ];
    expect(planStorePrune(entries, { maxBytes: 1000, maxAgeMs: 30 * day, now, keep: new Set(['cur']) })).toEqual(['old', 'a']);
    expect(planStorePrune(entries, { maxBytes: 10_000, maxAgeMs: 60 * day, now })).toEqual([]);
  });

  it('путь чтения не выходит за хранилище', () => {
    const root = path.resolve('/ud/visual');
    expect(resolveArtifactReadPath(root, 'swarm-1/a/iter-1/ui/home.png')).toBe(path.join(root, 'swarm-1', 'a', 'iter-1', 'ui', 'home.png'));
    expect(resolveArtifactReadPath(root, '../secrets.enc.json')).toBeNull();
    expect(resolveArtifactReadPath(root, path.resolve('/etc/passwd'))).toBeNull();
    expect(resolveArtifactReadPath(root, 'C:/Windows/win.ini')).toBeNull();
    expect(resolveArtifactReadPath(root, '')).toBeNull();
    expect(resolveArtifactReadPath(root, '.')).toBeNull();
    expect(mimeOfArtifact('a.JPG')).toBe('image/jpeg');
  });
});

describe('ссылки на скриншоты', () => {
  const checks = [
    result({ id: 'ui-smoke', artifacts: [shot('home.png'), shot('smoke/settings.png'), { name: 't.zip', relPath: 't', kind: 'trace', bytes: 1 }] }),
    result({ id: 'ui-2', artifacts: [shot('home.png', 'other/home.png')] })
  ];
  const shots = iterationScreenshots(checks);

  it('trace не считается скриншотом', () => {
    expect(shots).toHaveLength(3);
  });

  it('путь, checkId/путь и однозначное имя', () => {
    const r1 = resolveScreenshotRef('ui-2/home.png', shots);
    expect(r1.ok && r1.match.checkId).toBe('ui-2');
    const r2 = resolveScreenshotRef('settings.PNG', shots);
    expect(r2.ok && r2.match.artifact.name).toBe('smoke/settings.png');
    const r3 = resolveScreenshotRef('./smoke\\settings.png', shots);
    expect(r3.ok).toBe(true);
  });

  it('неоднозначное и отсутствующее имя', () => {
    const amb = resolveScreenshotRef('home.png', shots);
    expect(amb).toEqual({ ok: false, error: 'ambiguous', candidates: ['ui-smoke/home.png', 'ui-2/home.png'] });
    expect(resolveScreenshotRef('nope.png', shots)).toEqual({ ok: false, error: 'not_found' });
    expect(resolveScreenshotRef('  ', shots)).toEqual({ ok: false, error: 'not_found' });
  });
});
