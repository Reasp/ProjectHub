import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { PROJECT_HUB_CLAUDE_DIR } from './aiAgentService.js';

export interface ClaudeUsageLimitWindow {
  percent: number;
  resetsAt?: string;
}

export interface ClaudeUsageBreakdownItem {
  name: string;
  percent: number;
}

export interface ClaudeUsageBreakdown {
  requests?: number;
  sessions?: number;
  contextAbove150kPercent?: number;
  subagentHeavyPercent?: number;
  sessionsOver8hPercent?: number;
  topSkills?: ClaudeUsageBreakdownItem[];
  topSubagents?: ClaudeUsageBreakdownItem[];
  topMcpServers?: ClaudeUsageBreakdownItem[];
}

export interface ClaudeModelTokenStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD?: number;
}

export interface ClaudeUsageData {
  planType: string;
  sessionLimit?: ClaudeUsageLimitWindow;
  weeklyLimit?: ClaudeUsageLimitWindow;
  fableLimit?: ClaudeUsageLimitWindow;
  last24h?: ClaudeUsageBreakdown;
  last7d?: ClaudeUsageBreakdown;
  totalSessions?: number;
  totalMessages?: number;
  modelUsage?: Record<string, ClaudeModelTokenStats>;
  dailyActivity?: {
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }[];
  rawText?: string;
  updatedAt: number;
  isFallback?: boolean;
}

/**
 * Сырое событие `rate_limit_event` из stream-json Claude CLI (поля по факту наблюдений,
 * все опциональны). `utilization` — доля 0..1, `resetsAt` — unix-секунды или ISO-строка.
 */
export interface ClaudeRateLimitEventInfo {
  status?: string;
  rateLimitType?: string;
  rate_limit_type?: string;
  windowType?: string;
  utilization?: number;
  resetsAt?: number | string;
  reset_at?: number | string;
  unifiedWindows?: ClaudeRateLimitEventInfo[];
}

/** Окна лимитов, накопленные из rate-limit событий CLI (без запросов к API). */
export interface ClaudeRateLimitSnapshot {
  sessionLimit?: ClaudeUsageLimitWindow;
  weeklyLimit?: ClaudeUsageLimitWindow;
  fableLimit?: ClaudeUsageLimitWindow;
  updatedAt: number;
}

function formatResetsAt(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : undefined;
  return date.toISOString();
}

class ClaudeUsageService {
  private cachedUsage: ClaudeUsageData | null = null;
  private lastFetchTime = 0;
  private readonly CACHE_TTL_MS = 45 * 1000; // 45 seconds
  private rateLimits: ClaudeRateLimitSnapshot | null = null;

  /**
   * Usage без обращения к модели (аудит 3.9, TASK-44). Проверено: `claude -p /usage` в
   * print-режиме не выполняет встроенную команду, а отправляет строку «/usage» модели как
   * промпт — каждый вызов тратил квоту. Теперь источники только локальные:
   * `~/.claude/stats-cache.json` (сессии, сообщения, токены по моделям) и rate-limit события
   * из stream-json уже идущих сессий Claude CLI (`noteRateLimitEvent`).
   */
  public async getUsage(forceRefresh = false): Promise<ClaudeUsageData> {
    const now = Date.now();
    if (!forceRefresh && this.cachedUsage && now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return this.cachedUsage;
    }

    const statsCacheData = await this.readStatsCacheFile();
    if (!statsCacheData && !this.rateLimits) {
      throw new Error(
        'Не удалось получить usage данные Claude Code: нет ~/.claude/stats-cache.json и ещё не было rate-limit событий CLI'
      );
    }

    const usage: ClaudeUsageData = {
      planType: 'Claude Code Subscription',
      sessionLimit: this.rateLimits?.sessionLimit,
      weeklyLimit: this.rateLimits?.weeklyLimit,
      fableLimit: this.rateLimits?.fableLimit,
      totalSessions: statsCacheData?.totalSessions,
      totalMessages: statsCacheData?.totalMessages,
      modelUsage: statsCacheData?.modelUsage,
      dailyActivity: statsCacheData?.dailyActivity,
      rawText: this.describeSources(statsCacheData !== null),
      updatedAt: now,
      isFallback: !this.rateLimits
    };

    this.cachedUsage = usage;
    this.lastFetchTime = now;
    return usage;
  }

  private describeSources(hasStatsCache: boolean): string {
    const lines = [
      hasStatsCache
        ? 'Сессии, сообщения и токены: локальный кэш Claude Code (~/.claude/stats-cache.json).'
        : 'Локальный кэш Claude Code (~/.claude/stats-cache.json) не найден.',
      this.rateLimits
        ? `Лимиты: rate-limit события Claude CLI, последнее ${new Date(this.rateLimits.updatedAt).toLocaleString()}.`
        : 'Лимиты (сессия/неделя) появятся после первого rate-limit события в сессии Claude CLI из AI Studio.',
      'Запрос `claude -p /usage` не используется: в print-режиме он отправляется модели как промпт и расходует квоту.'
    ];
    return lines.join('\n');
  }

  /** Текущие окна лимитов, накопленные из событий CLI (для тестов и диагностики). */
  public getRateLimitSnapshot(): ClaudeRateLimitSnapshot | null {
    return this.rateLimits;
  }

  /**
   * Учесть `rate_limit_event` из stream-json Claude CLI. Окно определяется по типу лимита:
   * `five_hour` → сессия, `seven_day` → неделя, `seven_day_<model>` → отдельная модельная
   * квота (в UI — «Fable»). Событие без числовой `utilization` игнорируется.
   */
  public noteRateLimitEvent(info: ClaudeRateLimitEventInfo | null | undefined): void {
    if (!info || typeof info !== 'object') return;
    const windows = Array.isArray(info.unifiedWindows) && info.unifiedWindows.length > 0 ? info.unifiedWindows : [info];

    let changed = false;
    const next: ClaudeRateLimitSnapshot = { ...(this.rateLimits ?? { updatedAt: 0 }) };

    for (const win of windows) {
      if (!win || typeof win.utilization !== 'number' || !Number.isFinite(win.utilization)) continue;
      const type = String(win.rateLimitType ?? win.rate_limit_type ?? win.windowType ?? info.rateLimitType ?? '').toLowerCase();
      const window: ClaudeUsageLimitWindow = {
        percent: Math.max(0, Math.min(100, Math.round(win.utilization * 100))),
        resetsAt: formatResetsAt(win.resetsAt ?? win.reset_at)
      };

      if (type.includes('five_hour') || type.includes('session')) {
        next.sessionLimit = window;
      } else if (type.includes('seven_day') && /seven_day_[a-z]/.test(type)) {
        next.fableLimit = window;
      } else if (type.includes('seven_day') || type.includes('week')) {
        next.weeklyLimit = window;
      } else if (!next.sessionLimit) {
        // Тип неизвестен: считаем окном сессии, но только если оно ещё не заполнено.
        next.sessionLimit = window;
      } else {
        continue;
      }
      changed = true;
    }

    if (!changed) return;
    next.updatedAt = Date.now();
    this.rateLimits = next;
    // Сбросить кэш, чтобы следующий getUsage отдал свежие лимиты.
    this.lastFetchTime = 0;
  }

  private async readStatsCacheFile(): Promise<any | null> {
    const candidates = [
      path.join(os.homedir(), '.claude', 'stats-cache.json'),
      path.join(PROJECT_HUB_CLAUDE_DIR, 'stats-cache.json')
    ];

    for (const filePath of candidates) {
      if (existsSync(filePath)) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          return JSON.parse(content);
        } catch (e) {
          console.warn(`Error reading ${filePath}:`, e);
        }
      }
    }
    return null;
  }

  public parseUsageText(text: string): {
    planType: string;
    sessionLimit?: ClaudeUsageLimitWindow;
    weeklyLimit?: ClaudeUsageLimitWindow;
    fableLimit?: ClaudeUsageLimitWindow;
    last24h?: ClaudeUsageBreakdown;
    last7d?: ClaudeUsageBreakdown;
  } {
    let planType = 'Claude Code Subscription';
    if (text.includes('subscription')) {
      planType = 'Claude Subscription (Max Speed)';
    } else if (text.includes('usage credits') || text.includes('credits')) {
      planType = 'Usage Credits (Pay-as-you-go)';
    }

    let sessionLimit: ClaudeUsageLimitWindow | undefined;
    const sessionMatch = text.match(/Current session:\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^\r\n]+))?/i);
    if (sessionMatch) {
      sessionLimit = {
        percent: parseInt(sessionMatch[1], 10),
        resetsAt: sessionMatch[2]?.trim()
      };
    }

    let weeklyLimit: ClaudeUsageLimitWindow | undefined;
    // Сначала ищем общее "Current week (all models):" или явное "Current week:"
    const allModelsMatch = text.match(/Current week\s*\((?:all models|all)\):\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^\r\n]+))?/i);
    const plainWeeklyMatch = text.match(/Current week:\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^\r\n]+))?/i);
    const matchedWeekly = allModelsMatch || plainWeeklyMatch;
    if (matchedWeekly) {
      weeklyLimit = {
        percent: parseInt(matchedWeekly[1], 10),
        resetsAt: matchedWeekly[2]?.trim()
      };
    } else {
      // Запасной вариант: если есть "Current week (...)" и это не Fable
      const genericWeeklyMatch = text.match(/Current week(?:\s*\((?!fable)[^\)]+\))?:\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^\r\n]+))?/i);
      if (genericWeeklyMatch) {
        weeklyLimit = {
          percent: parseInt(genericWeeklyMatch[1], 10),
          resetsAt: genericWeeklyMatch[2]?.trim()
        };
      }
    }

    let fableLimit: ClaudeUsageLimitWindow | undefined;
    // Отдельный лимит для модели Fable (Claude 3.7 Sonnet / hybrid reasoning): "Current week (Fable): XX% used"
    const fableMatch = text.match(/Current week\s*\((?:fable)\):\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^\r\n]+))?/i);
    if (fableMatch) {
      fableLimit = {
        percent: parseInt(fableMatch[1], 10),
        resetsAt: fableMatch[2]?.trim()
      };
    }

    const parseSection = (sectionText: string): ClaudeUsageBreakdown => {
      const breakdown: ClaudeUsageBreakdown = {};

      const reqMatch = sectionText.match(/(\d+)\s+requests/i);
      if (reqMatch) breakdown.requests = parseInt(reqMatch[1], 10);

      const sessMatch = sectionText.match(/(\d+)\s+sessions/i);
      if (sessMatch) breakdown.sessions = parseInt(sessMatch[1], 10);

      const ctxMatch = sectionText.match(/(\d+)%\s+of your usage was at >150k context/i);
      if (ctxMatch) breakdown.contextAbove150kPercent = parseInt(ctxMatch[1], 10);

      const subagentMatch = sectionText.match(/(\d+)%\s+of your usage came from subagent-heavy/i);
      if (subagentMatch) breakdown.subagentHeavyPercent = parseInt(subagentMatch[1], 10);

      const durMatch = sectionText.match(/(\d+)%\s+of your usage came from sessions active for 8\+\s*hours/i);
      if (durMatch) breakdown.sessionsOver8hPercent = parseInt(durMatch[1], 10);

      const parseItems = (regex: RegExp): ClaudeUsageBreakdownItem[] => {
        const match = sectionText.match(regex);
        if (!match) return [];
        const rawItems = match[1].split(',');
        return rawItems
          .map((item) => {
            const m = item.trim().match(/^(.+?)\s+(\d+)%$/);
            if (m) {
              return { name: m[1].trim(), percent: parseInt(m[2], 10) };
            }
            return null;
          })
          .filter(Boolean) as ClaudeUsageBreakdownItem[];
      };

      breakdown.topSkills = parseItems(/Top skills:\s*([^\n\r]+)/i);
      breakdown.topSubagents = parseItems(/Top subagents:\s*([^\n\r]+)/i);
      breakdown.topMcpServers = parseItems(/Top MCP servers:\s*([^\n\r]+)/i);

      return breakdown;
    };

    let last24h: ClaudeUsageBreakdown | undefined;
    let last7d: ClaudeUsageBreakdown | undefined;

    const idx24h = text.indexOf('Last 24h');
    const idx7d = text.indexOf('Last 7d');

    if (idx24h !== -1) {
      const sub24h = idx7d !== -1 ? text.slice(idx24h, idx7d) : text.slice(idx24h);
      last24h = parseSection(sub24h);
    }

    if (idx7d !== -1) {
      const sub7d = text.slice(idx7d);
      last7d = parseSection(sub7d);
    }

    return {
      planType,
      sessionLimit,
      weeklyLimit,
      fableLimit,
      last24h,
      last7d
    };
  }
}

export const claudeUsageService = new ClaudeUsageService();
