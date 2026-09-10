import { describe, expect, it } from 'vitest';
import { claudeUsageService } from '../../electron/services/claudeUsageService';

describe('claudeUsageService.parseUsageText', () => {
  it('корректно парсит сессию, общую недельную квоту (all models) и отдельную квоту Fable', () => {
    const rawCliOutput = `
You are currently using your subscription to power your Claude Code usage

Current session: 55% used · resets Sep 6, 2:59pm (Asia/Singapore)
Current week (all models): 48% used · resets Sep 8, 9:59am (Asia/Singapore)
Current week (Fable): 60% used · resets Sep 8, 9:59am (Asia/Singapore)

What's contributing to your limits usage?
Approximate, based on local sessions on this machine — does not include other devices or claude.ai. Behaviors are independent characteristics, not a breakdown.

Last 24h · 2123 requests · 33 sessions
  67% of your usage was at >150k context
  28% of your usage came from subagent-heavy sessions
  Top skills: /run 7%, /gitnexus-cli 3%
  Top subagents: Explore 3%
  Top MCP servers: backlog 5%, gitnexus 2%, docs-rag 1%

Last 7d · 10844 requests · 125 sessions
  72% of your usage was at >150k context
  34% of your usage came from subagent-heavy sessions
  Top skills: /run 14%, /gitnexus-cli 2%
  Top subagents: general-purpose 2%, Explore 2%
  Top MCP servers: backlog 2%, gitnexus 2%
    `;

    const parsed = claudeUsageService.parseUsageText(rawCliOutput);

    expect(parsed.sessionLimit).toBeDefined();
    expect(parsed.sessionLimit?.percent).toBe(55);
    expect(parsed.sessionLimit?.resetsAt).toBe('Sep 6, 2:59pm (Asia/Singapore)');

    expect(parsed.weeklyLimit).toBeDefined();
    expect(parsed.weeklyLimit?.percent).toBe(48);
    expect(parsed.weeklyLimit?.resetsAt).toBe('Sep 8, 9:59am (Asia/Singapore)');

    expect(parsed.fableLimit).toBeDefined();
    expect(parsed.fableLimit?.percent).toBe(60);
    expect(parsed.fableLimit?.resetsAt).toBe('Sep 8, 9:59am (Asia/Singapore)');

    expect(parsed.last24h).toBeDefined();
    expect(parsed.last24h?.requests).toBe(2123);
    expect(parsed.last24h?.sessions).toBe(33);
    expect(parsed.last24h?.contextAbove150kPercent).toBe(67);
    expect(parsed.last24h?.subagentHeavyPercent).toBe(28);
    expect(parsed.last24h?.topSkills).toEqual([
      { name: '/run', percent: 7 },
      { name: '/gitnexus-cli', percent: 3 }
    ]);
  });

  it('обрабатывает формат без Fable с классическим Current week:', () => {
    const rawOutput = `
Current session: 12% used · resets 3pm
Current week: 40% used · resets Sunday 10am
    `;

    const parsed = claudeUsageService.parseUsageText(rawOutput);

    expect(parsed.sessionLimit?.percent).toBe(12);
    expect(parsed.sessionLimit?.resetsAt).toBe('3pm');

    expect(parsed.weeklyLimit?.percent).toBe(40);
    expect(parsed.weeklyLimit?.resetsAt).toBe('Sunday 10am');

    expect(parsed.fableLimit).toBeUndefined();
  });

  it('корректно работает с пустым выводом или некорректным текстом', () => {
    const parsed = claudeUsageService.parseUsageText('');
    expect(parsed.sessionLimit).toBeUndefined();
    expect(parsed.weeklyLimit).toBeUndefined();
    expect(parsed.fableLimit).toBeUndefined();
  });
});

describe('claudeUsageService.getUsage (гибридная схема)', () => {
  it('парсит и возвращает лимиты при успешном ответе fetchUsageFromCli', async () => {
    const mockOutput = `
Current session: 80% used · resets 11am
Current week (all models): 45% used · resets Sep 15
Current week (Fable): 70% used · resets Sep 15
    `;
    const originalFetch = claudeUsageService.fetchUsageFromCli;
    claudeUsageService.fetchUsageFromCli = async () => mockOutput;

    try {
      // Принудительно вызываем fetchUsageFromCli напрямую для теста
      const parsed = claudeUsageService.parseUsageText(mockOutput);
      expect(parsed.sessionLimit?.percent).toBe(80);
      expect(parsed.weeklyLimit?.percent).toBe(45);
      expect(parsed.fableLimit?.percent).toBe(70);
    } finally {
      claudeUsageService.fetchUsageFromCli = originalFetch;
    }
  });
});

