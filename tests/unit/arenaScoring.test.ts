import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCORE_WEIGHTS,
  acceptanceScore,
  autoMergeDecision,
  blockingFailure,
  checksScore,
  collectCohortStats,
  computeCandidateScore,
  localityUnits,
  normalizeLowerIsBetter,
  normalizeWeights,
  rankCandidates,
  recommendCandidate,
  reviewScore,
  scoreCandidates,
  totalWeight,
  UNKNOWN_NORMALIZED
} from '../../electron/services/arenaScoring';
import type { CandidateScore, CheckRunResult, CheckStatus } from '../../electron/services/arenaTypes';
import type { CandidateScoreInput } from '../../electron/services/arenaScoring';

function check(status: CheckStatus, blocking = true, name = status): CheckRunResult {
  return { id: name, kind: 'test', name, command: 'npm test', status, blocking };
}

function candidate(overrides: Partial<CandidateScoreInput> & { agentId: string }): CandidateScoreInput {
  return { checks: [], ...overrides };
}

describe('normalizeLowerIsBetter', () => {
  it('лучший в когорте получает 1, худший 0', () => {
    expect(normalizeLowerIsBetter(0, 100)).toBe(1);
    expect(normalizeLowerIsBetter(100, 100)).toBe(0);
    expect(normalizeLowerIsBetter(25, 100)).toBe(0.75);
  });

  it('без разброса в когорте все получают 1', () => {
    expect(normalizeLowerIsBetter(0, 0)).toBe(1);
  });

  it('мусор на входе даёт нейтральную оценку', () => {
    expect(normalizeLowerIsBetter(Number.NaN, 10)).toBe(UNKNOWN_NORMALIZED);
    expect(normalizeLowerIsBetter(-5, 10)).toBe(UNKNOWN_NORMALIZED);
  });
});

describe('checksScore', () => {
  it('доля пройденных среди отработавших', () => {
    expect(checksScore([check('passed'), check('failed'), check('skipped')])).toEqual({
      normalized: 0.5,
      passed: 1,
      counted: 2
    });
  });

  it('пропущенные и незапущенные не тянут вниз', () => {
    expect(checksScore([check('skipped'), check('pending')])).toEqual({
      normalized: UNKNOWN_NORMALIZED,
      passed: 0,
      counted: 0
    });
  });
});

describe('blockingFailure', () => {
  it('провал блокирующей проверки находится', () => {
    expect(blockingFailure([check('passed'), check('failed', true, 'build')])?.name).toBe('build');
  });

  it('провал неблокирующей проверки не блокирует', () => {
    expect(blockingFailure([check('passed'), check('failed', false)])).toBeUndefined();
  });

  it('таймаут блокирующей проверки блокирует так же, как провал', () => {
    expect(blockingFailure([check('timeout')])).toBeDefined();
  });
});

describe('acceptanceScore', () => {
  it('частично выполненный критерий стоит половину', () => {
    const result = acceptanceScore([{ verdict: 'met' }, { verdict: 'partial' }, { verdict: 'unmet' }]);
    expect(result.normalized).toBeCloseTo(0.5, 5);
    expect(result).toMatchObject({ met: 1, total: 3, known: true });
  });

  it('без вердиктов оценка нейтральная и помечена как неизвестная', () => {
    expect(acceptanceScore(undefined)).toMatchObject({ normalized: UNKNOWN_NORMALIZED, known: false });
    expect(acceptanceScore([])).toMatchObject({ normalized: UNKNOWN_NORMALIZED, known: false });
  });
});

describe('reviewScore', () => {
  it('штрафы за замечания вычитаются из оценки ревьюера', () => {
    const result = reviewScore(
      candidate({ agentId: 'a', reviewOverall: 1, reviewFindings: [{ severity: 'major' }, { severity: 'minor' }] })
    );
    expect(result.normalized).toBeCloseTo(0.67, 2);
    expect(result.known).toBe(true);
  });

  it('критическое замечание бьёт сильнее всего', () => {
    const result = reviewScore(candidate({ agentId: 'a', reviewOverall: 1, reviewFindings: [{ severity: 'critical' }] }));
    expect(result.normalized).toBeCloseTo(0.5, 5);
  });

  it('несостоявшееся ревью даёт нейтральную оценку без штрафа', () => {
    expect(reviewScore(candidate({ agentId: 'a', reviewFailed: true, reviewFindings: [{ severity: 'critical' }] }))).toEqual({
      normalized: UNKNOWN_NORMALIZED,
      known: false,
      penalty: 0
    });
  });
});

describe('localityUnits и когорта', () => {
  it('модули весят больше файлов, зависимые символы — доли', () => {
    expect(localityUnits({ filesChanged: 3, insertions: 0, deletions: 0, modules: 2, dependents: 10 })).toBe(8);
  });

  it('максимумы когорты собираются по всем кандидатам', () => {
    const stats = collectCohortStats([
      candidate({ agentId: 'a', diff: { filesChanged: 1, insertions: 10, deletions: 5 }, costUsd: 0.2, durationMs: 1000 }),
      candidate({ agentId: 'b', diff: { filesChanged: 4, insertions: 100, deletions: 50 }, costUsd: 0.05, durationMs: 9000 })
    ]);
    expect(stats).toEqual({ maxDiffLines: 150, maxLocality: 4, maxCostUsd: 0.2, maxDurationMs: 9000 });
  });
});

describe('normalizeWeights и totalWeight', () => {
  it('частичный объект дополняется дефолтами', () => {
    expect(normalizeWeights({ checks: 10 })).toEqual({ ...DEFAULT_SCORE_WEIGHTS, checks: 10 });
  });

  it('мусор и отрицательные значения игнорируются', () => {
    expect(normalizeWeights({ checks: -1, cost: 'x', review: Number.NaN })).toEqual(DEFAULT_SCORE_WEIGHTS);
    expect(normalizeWeights(null)).toEqual(DEFAULT_SCORE_WEIGHTS);
  });

  it('сумма весов по умолчанию равна 100', () => {
    expect(totalWeight(DEFAULT_SCORE_WEIGHTS)).toBe(100);
  });
});

describe('computeCandidateScore', () => {
  const cohort = { maxDiffLines: 100, maxLocality: 10, maxCostUsd: 1, maxDurationMs: 10_000 };

  it('идеальный кандидат набирает 100 при полном наборе данных', () => {
    const score = computeCandidateScore(
      candidate({
        agentId: 'a',
        checks: [check('passed'), check('passed', true, 'lint')],
        criteria: [{ verdict: 'met' }, { verdict: 'met' }],
        reviewOverall: 1,
        diff: { filesChanged: 0, insertions: 0, deletions: 0, modules: 0, dependents: 0 },
        costUsd: 0,
        durationMs: 1
      }),
      cohort,
      DEFAULT_SCORE_WEIGHTS,
      1
    );
    expect(score.total).toBeCloseTo(100, 1);
    expect(score.blocked).toBe(false);
  });

  it('балл считается и для заблокированного кандидата, но он помечен blocked', () => {
    const score = computeCandidateScore(
      candidate({ agentId: 'a', checks: [check('passed', true, 'lint'), check('failed', true, 'build')] }),
      cohort,
      DEFAULT_SCORE_WEIGHTS,
      1
    );
    expect(score.blocked).toBe(true);
    expect(score.blockedReason).toContain('build');
    expect(score.total).toBeGreaterThan(0);
  });

  it('разложение покрывает все компоненты, а points равны weight × normalized', () => {
    const score = computeCandidateScore(candidate({ agentId: 'a', checks: [check('passed')] }), cohort, DEFAULT_SCORE_WEIGHTS, 1);
    expect(score.components.map((c) => c.key)).toEqual([
      'checks',
      'acceptance',
      'review',
      'diffSize',
      'locality',
      'cost',
      'time'
    ]);
    for (const c of score.components) {
      expect(c.points).toBeCloseTo(c.weight * c.normalized, 5);
    }
  });

  it('компоненты без данных помечены unknown и получают нейтральную оценку', () => {
    const score = computeCandidateScore(candidate({ agentId: 'a', checks: [check('passed')] }), cohort, DEFAULT_SCORE_WEIGHTS, 1);
    const diffSize = score.components.find((c) => c.key === 'diffSize')!;
    expect(diffSize.unknown).toBe(true);
    expect(diffSize.normalized).toBe(UNKNOWN_NORMALIZED);
  });

  it('вес 0 выключает компонент, а балл остаётся в шкале 0..100', () => {
    const weights = { ...DEFAULT_SCORE_WEIGHTS, cost: 0, time: 0 };
    const score = computeCandidateScore(
      candidate({ agentId: 'a', checks: [check('passed')], criteria: [{ verdict: 'met' }], reviewOverall: 1 }),
      cohort,
      weights,
      1
    );
    expect(score.components.find((c) => c.key === 'cost')!.points).toBe(0);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.total).toBeGreaterThan(0);
  });
});

describe('scoreCandidates и ранжирование', () => {
  const inputs: CandidateScoreInput[] = [
    candidate({
      agentId: 'green',
      checks: [check('passed')],
      criteria: [{ verdict: 'met' }],
      reviewOverall: 1,
      diff: { filesChanged: 2, insertions: 10, deletions: 2, modules: 1 },
      costUsd: 0.1,
      durationMs: 5000
    }),
    candidate({
      agentId: 'broken',
      checks: [check('failed')],
      criteria: [{ verdict: 'unmet' }],
      reviewOverall: 0.2,
      diff: { filesChanged: 20, insertions: 400, deletions: 100, modules: 6 },
      costUsd: 0.9,
      durationMs: 30_000
    }),
    candidate({
      agentId: 'okay',
      checks: [check('passed')],
      criteria: [{ verdict: 'partial' }],
      reviewOverall: 0.7,
      diff: { filesChanged: 5, insertions: 60, deletions: 10, modules: 2 },
      costUsd: 0.3,
      durationMs: 12_000
    })
  ];

  it('заблокированные уходят в конец независимо от балла', () => {
    const ranked = rankCandidates(scoreCandidates(inputs, DEFAULT_SCORE_WEIGHTS, 1));
    expect(ranked.map((s) => s.agentId)).toEqual(['green', 'okay', 'broken']);
    expect(ranked[2].blocked).toBe(true);
  });

  it('рекомендуется лучший незаблокированный', () => {
    const rec = recommendCandidate(scoreCandidates(inputs, DEFAULT_SCORE_WEIGHTS, 1));
    expect(rec.agentId).toBe('green');
  });

  it('если все заблокированы, рекомендации нет', () => {
    const scores = scoreCandidates(
      [candidate({ agentId: 'a', checks: [check('failed')] }), candidate({ agentId: 'b', checks: [check('timeout')] })],
      DEFAULT_SCORE_WEIGHTS,
      1
    );
    const rec = recommendCandidate(scores);
    expect(rec.agentId).toBeUndefined();
    expect(rec.reason).toContain('блокирующие');
  });

  it('при ничьей рекомендации нет — выбор за человеком', () => {
    const same = candidate({ agentId: 'a', checks: [check('passed')], reviewOverall: 1, criteria: [{ verdict: 'met' }] });
    const scores = scoreCandidates([same, { ...same, agentId: 'b' }], DEFAULT_SCORE_WEIGHTS, 1);
    const rec = recommendCandidate(scores);
    expect(rec.agentId).toBeUndefined();
    expect(rec.reason).toContain('Ничья');
  });
});

describe('autoMergeDecision', () => {
  const good: CandidateScore = {
    agentId: 'a',
    total: 90,
    blocked: false,
    components: [],
    computedAt: 1
  };

  it('выключенный авто-мердж не срабатывает никогда', () => {
    expect(autoMergeDecision([good], { a: [check('passed')] }, { enabled: false, minScore: 0 })).toMatchObject({
      allowed: false
    });
  });

  it('срабатывает при зелёных проверках и балле выше порога', () => {
    const decision = autoMergeDecision([good], { a: [check('passed')] }, { enabled: true, minScore: 85 });
    expect(decision).toMatchObject({ allowed: true, agentId: 'a' });
  });

  it('балл ниже порога запрещает слияние', () => {
    const decision = autoMergeDecision([{ ...good, total: 70 }], { a: [check('passed')] }, { enabled: true, minScore: 85 });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('ниже порога');
  });

  it('проваленная неблокирующая проверка тоже запрещает авто-мердж', () => {
    const decision = autoMergeDecision(
      [good],
      { a: [check('passed'), check('failed', false, 'lint')] },
      { enabled: true, minScore: 50 }
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('lint');
  });

  it('без единой запущенной проверки авто-мердж запрещён', () => {
    expect(autoMergeDecision([good], { a: [] }, { enabled: true, minScore: 0 })).toMatchObject({ allowed: false });
  });

  it('заблокированный кандидат не сливается даже при высоком балле', () => {
    const blocked: CandidateScore = { ...good, total: 99, blocked: true, blockedReason: 'build' };
    expect(autoMergeDecision([blocked], { a: [check('failed')] }, { enabled: true, minScore: 10 })).toMatchObject({
      allowed: false
    });
  });
});
