import { spawn } from 'node:child_process';
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

class ClaudeUsageService {
  private cachedUsage: ClaudeUsageData | null = null;
  private lastFetchTime = 0;
  private readonly CACHE_TTL_MS = 45 * 1000; // 45 seconds

  public async getUsage(forceRefresh = false): Promise<ClaudeUsageData> {
    const now = Date.now();
    if (!forceRefresh && this.cachedUsage && now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return this.cachedUsage;
    }

    try {
      const cliUsageText = await this.fetchUsageFromCli();
      const statsCacheData = await this.readStatsCacheFile();

      const parsed = this.parseUsageText(cliUsageText);

      const combined: ClaudeUsageData = {
        planType: parsed.planType || 'Claude Code Subscription',
        sessionLimit: parsed.sessionLimit,
        weeklyLimit: parsed.weeklyLimit,
        fableLimit: parsed.fableLimit,
        last24h: parsed.last24h,
        last7d: parsed.last7d,
        totalSessions: statsCacheData?.totalSessions,
        totalMessages: statsCacheData?.totalMessages,
        modelUsage: statsCacheData?.modelUsage,
        dailyActivity: statsCacheData?.dailyActivity,
        rawText: cliUsageText,
        updatedAt: now,
        isFallback: false
      };

      this.cachedUsage = combined;
      this.lastFetchTime = now;
      return combined;
    } catch (err: any) {
      console.warn('Failed to fetch usage from Claude CLI, falling back to stats-cache.json:', err.message);
      const statsCacheData = await this.readStatsCacheFile();

      if (statsCacheData) {
        const fallback: ClaudeUsageData = {
          planType: 'Claude Code Subscription',
          totalSessions: statsCacheData.totalSessions,
          totalMessages: statsCacheData.totalMessages,
          modelUsage: statsCacheData.modelUsage,
          dailyActivity: statsCacheData.dailyActivity,
          rawText: 'Данные получены из локального кэша сессий Claude Code (~/.claude/stats-cache.json)',
          updatedAt: now,
          isFallback: true
        };
        this.cachedUsage = fallback;
        this.lastFetchTime = now;
        return fallback;
      }

      throw new Error(`Не удалось получить usage данные Claude Code: ${err.message}`);
    }
  }

  private fetchUsageFromCli(): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('claude', ['-p', '/usage'], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          CLAUDE_CONFIG_DIR: PROJECT_HUB_CLAUDE_DIR
        }
      });

      child.stdin.end();

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => {
        stdout += d.toString('utf-8');
      });

      child.stderr.on('data', (d) => {
        stderr += d.toString('utf-8');
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Превышено время ожидания ответа от claude /usage'));
      }, 12000);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || stdout.trim().length > 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || `claude /usage завершился с кодом ${code}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
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
