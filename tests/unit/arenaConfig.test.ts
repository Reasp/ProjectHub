import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AUTO_MERGE_MIN_SCORE,
  DEFAULT_REVIEWER_ROLE_SLUG,
  resolveArenaConfig
} from '../../electron/services/arenaConfig';
import { DEFAULT_SCORE_WEIGHTS } from '../../electron/services/arenaScoring';
import { DEFAULT_MAX_CONCURRENT_CHECKS } from '../../electron/services/arenaChecks';

const project = { scripts: { lint: 'eslint .', test: 'vitest run', build: 'vite build' } };

describe('resolveArenaConfig', () => {
  it('без секций в .projecthub.json выводит проверки из package.json и берёт дефолты', () => {
    const config = resolveArenaConfig({ project });
    expect(config.checks.map((c) => c.kind)).toEqual(['lint', 'test', 'build']);
    expect(config.weights).toEqual(DEFAULT_SCORE_WEIGHTS);
    expect(config.autoMerge).toEqual({ enabled: false, minScore: DEFAULT_AUTO_MERGE_MIN_SCORE });
    expect(config.reviewer).toEqual({ enabled: true, roleSlug: DEFAULT_REVIEWER_ROLE_SLUG });
    expect(config.maxConcurrentChecks).toBe(DEFAULT_MAX_CONCURRENT_CHECKS);
  });

  it('пустой массив checks означает «проверок нет», а не «подставь дефолты»', () => {
    expect(resolveArenaConfig({ checks: [], project }).checks).toEqual([]);
  });

  it('проверки из конфига вытесняют дефолтные и нормализуются', () => {
    const config = resolveArenaConfig({
      checks: [{ command: 'make check', name: 'Make', blocking: false }, { name: 'без команды' }],
      project
    });
    expect(config.checks).toHaveLength(1);
    expect(config.checks[0]).toMatchObject({ command: 'make check', name: 'Make', blocking: false, kind: 'custom' });
  });

  it('авто-мердж включается только явным true', () => {
    expect(resolveArenaConfig({ arena: { autoMerge: {} }, project }).autoMerge.enabled).toBe(false);
    expect(resolveArenaConfig({ arena: { autoMerge: { enabled: true } }, project }).autoMerge.enabled).toBe(true);
  });

  it('порог авто-мерджа зажимается в 0..100', () => {
    expect(resolveArenaConfig({ arena: { autoMerge: { minScore: 500 } }, project }).autoMerge.minScore).toBe(100);
    expect(resolveArenaConfig({ arena: { autoMerge: { minScore: -10 } }, project }).autoMerge.minScore).toBe(0);
  });

  it('ревьюер выключается только явным false, slug и модель переопределяются', () => {
    const config = resolveArenaConfig({
      arena: { reviewer: { enabled: false, roleSlug: '  senior-reviewer ', model: 'claude-opus-5' } },
      project
    });
    expect(config.reviewer).toEqual({ enabled: false, roleSlug: 'senior-reviewer', model: 'claude-opus-5' });
  });

  it('частичные веса дополняются дефолтными', () => {
    const config = resolveArenaConfig({ arena: { weights: { checks: 60, time: 0 } }, project });
    expect(config.weights).toEqual({ ...DEFAULT_SCORE_WEIGHTS, checks: 60, time: 0 });
  });

  it('конкурентность проверок зажимается в 1..8', () => {
    expect(resolveArenaConfig({ arena: { maxConcurrentChecks: 100 }, project }).maxConcurrentChecks).toBe(8);
    expect(resolveArenaConfig({ arena: { maxConcurrentChecks: 0 }, project }).maxConcurrentChecks).toBe(
      DEFAULT_MAX_CONCURRENT_CHECKS
    );
    expect(resolveArenaConfig({ arena: { maxConcurrentChecks: 3 }, project }).maxConcurrentChecks).toBe(3);
  });
});
