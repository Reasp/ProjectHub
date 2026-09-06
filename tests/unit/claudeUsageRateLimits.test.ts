import { describe, expect, it, vi } from 'vitest';

// aiAgentService (PROJECT_HUB_CLAUDE_DIR) тянет electron через secretStorageService — мок-заглушка.
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false }
}));

const { claudeUsageService } = await import('../../electron/services/claudeUsageService');

describe('claudeUsageService: лимиты из rate_limit_event без спауна CLI (TASK-44)', () => {
  it('раскладывает окна five_hour / seven_day / seven_day_<model> по сессии, неделе и Fable', () => {
    claudeUsageService.noteRateLimitEvent({
      unifiedWindows: [
        { rateLimitType: 'five_hour', utilization: 0.55, resetsAt: 1_800_000_000 },
        { rateLimitType: 'seven_day', utilization: 0.481 },
        { rateLimitType: 'seven_day_opus', utilization: 0.6 }
      ]
    });

    const snap = claudeUsageService.getRateLimitSnapshot();
    expect(snap?.sessionLimit?.percent).toBe(55);
    expect(snap?.sessionLimit?.resetsAt).toBe(new Date(1_800_000_000 * 1000).toISOString());
    expect(snap?.weeklyLimit?.percent).toBe(48);
    expect(snap?.fableLimit?.percent).toBe(60);
  });

  it('плоское событие с utilization обновляет окно, событие без utilization игнорируется', () => {
    claudeUsageService.noteRateLimitEvent({ rateLimitType: 'five_hour', utilization: 0.9 });
    expect(claudeUsageService.getRateLimitSnapshot()?.sessionLimit?.percent).toBe(90);

    const before = claudeUsageService.getRateLimitSnapshot();
    claudeUsageService.noteRateLimitEvent({ status: 'allowed' });
    expect(claudeUsageService.getRateLimitSnapshot()).toBe(before);
  });

  it('getUsage не спаунит процессы и отдаёт лимиты из снимка', async () => {
    const usage = await claudeUsageService.getUsage(true);
    expect(usage.sessionLimit?.percent).toBe(90);
    expect(usage.weeklyLimit?.percent).toBe(48);
    expect(usage.isFallback).toBe(false);
    expect(usage.rawText).toContain('claude -p /usage');
  });
});
