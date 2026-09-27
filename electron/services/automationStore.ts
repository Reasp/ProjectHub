import path from 'node:path';
import fs from 'node:fs/promises';
import { rotatedFileName } from './logger.js';
import { DEFAULT_MAX_CONCURRENT_AGENT_RUNS, DEFAULT_MAX_RUNS_PER_DAY, type RuleRuntimeState } from './automationRules.js';

/**
 * Хранение Automations на диске (TASK-74, decision-52 п. 3):
 * - `automations.json` — глобальные правила, настройки и доверие к проектным правилам
 *   (человекочитаемый, пишется только по действию пользователя);
 * - `automations-state.json` — изменяемое состояние правил (счётчики дня, cooldown, пауза, cron);
 * - `automations-log.jsonl` — журнал запусков с ротацией.
 */

export const AUTOMATIONS_CONFIG_FILE = 'automations.json';
export const AUTOMATIONS_STATE_FILE = 'automations-state.json';
export const AUTOMATIONS_LOG_FILE = 'automations-log.jsonl';
export const JOURNAL_MAX_BYTES = 2 * 1024 * 1024;
export const JOURNAL_MAX_FILES = 3;
/** Дневной бюджет встроенного правила назначенных задач по умолчанию (USD). */
export const DEFAULT_BUILTIN_DAILY_BUDGET_USD = 5;

export interface AutomationsSettings {
  /** Сколько агентов, запущенных автоматизациями, может работать одновременно. */
  maxConcurrentAgentRuns: number;
  /** Лимиты встроенного правила назначенных задач (его включение — флаг Remote Control). */
  builtinAssigned: { dailyBudgetUsd: number; maxRunsPerDay: number };
}

export interface AutomationsConfig {
  version: 1;
  settings: AutomationsSettings;
  /** Глобальные правила как записаны (разбираются `parseRules` — неверные видны в UI с ошибкой). */
  rules: unknown[];
  /** Доверие к проектным правилам: ключ корня проекта → id правила → sha256 подтверждённой версии. */
  trust: Record<string, Record<string, string>>;
}

export type AutomationLogStatus = 'started' | 'success' | 'failed' | 'skipped' | 'suspended' | 'resumed';

/** Строка журнала запусков. Без секретов и содержимого файлов — только идентификаторы и итоги. */
export interface AutomationLogEntry {
  ts: string;
  ruleKey: string;
  ruleId: string;
  ruleName: string;
  scope: 'global' | 'project' | 'builtin';
  status: AutomationLogStatus;
  runId?: string;
  projectPath?: string;
  /** `cron`, `manual` или вид события (`task.statusChanged` …). */
  trigger: string;
  subject?: string;
  eventSummary?: string;
  action?: string;
  reason?: string;
  detail?: string;
  swarmId?: string;
  costUsd?: number;
  durationMs?: number;
  depth?: number;
}

function positiveNumber(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback;
}

export function defaultAutomationsSettings(): AutomationsSettings {
  return {
    maxConcurrentAgentRuns: DEFAULT_MAX_CONCURRENT_AGENT_RUNS,
    builtinAssigned: { dailyBudgetUsd: DEFAULT_BUILTIN_DAILY_BUDGET_USD, maxRunsPerDay: DEFAULT_MAX_RUNS_PER_DAY }
  };
}

export function normalizeAutomationsSettings(raw: unknown): AutomationsSettings {
  const d = defaultAutomationsSettings();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const b = (r.builtinAssigned && typeof r.builtinAssigned === 'object' ? r.builtinAssigned : {}) as Record<string, unknown>;
  return {
    maxConcurrentAgentRuns: Math.round(positiveNumber(r.maxConcurrentAgentRuns, d.maxConcurrentAgentRuns, 10)),
    builtinAssigned: {
      dailyBudgetUsd: positiveNumber(b.dailyBudgetUsd, d.builtinAssigned.dailyBudgetUsd, 10_000),
      maxRunsPerDay: Math.round(positiveNumber(b.maxRunsPerDay, d.builtinAssigned.maxRunsPerDay, 1000))
    }
  };
}

export function normalizeAutomationsConfig(raw: unknown): AutomationsConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const trust: Record<string, Record<string, string>> = {};
  if (r.trust && typeof r.trust === 'object') {
    for (const [project, rules] of Object.entries(r.trust as Record<string, unknown>)) {
      if (!rules || typeof rules !== 'object') continue;
      const clean: Record<string, string> = {};
      for (const [id, hash] of Object.entries(rules as Record<string, unknown>)) {
        if (typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)) clean[id] = hash;
      }
      if (Object.keys(clean).length) trust[project] = clean;
    }
  }
  return {
    version: 1,
    settings: normalizeAutomationsSettings(r.settings),
    rules: Array.isArray(r.rules) ? r.rules : [],
    trust
  };
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  try {
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

export class AutomationStore {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly baseDir: string) {}

  public get configPath(): string {
    return path.join(this.baseDir, AUTOMATIONS_CONFIG_FILE);
  }

  public get logPath(): string {
    return path.join(this.baseDir, AUTOMATIONS_LOG_FILE);
  }

  public async loadConfig(): Promise<AutomationsConfig> {
    return normalizeAutomationsConfig(await readJson(this.configPath));
  }

  public async loadState(): Promise<Record<string, RuleRuntimeState>> {
    const raw = await readJson(path.join(this.baseDir, AUTOMATIONS_STATE_FILE));
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, RuleRuntimeState> = {};
    for (const [key, value] of Object.entries((raw as { rules?: unknown }).rules ?? {})) {
      if (!value || typeof value !== 'object') continue;
      const v = value as Partial<RuleRuntimeState>;
      if (typeof v.day !== 'string') continue;
      out[key] = {
        day: v.day,
        runsToday: typeof v.runsToday === 'number' ? v.runsToday : 0,
        costTodayUsd: typeof v.costTodayUsd === 'number' ? v.costTodayUsd : 0,
        lastRunBySubject: v.lastRunBySubject && typeof v.lastRunBySubject === 'object' ? { ...v.lastRunBySubject } : {},
        ...(typeof v.lastRunAt === 'number' ? { lastRunAt: v.lastRunAt } : {}),
        ...(typeof v.pausedUntil === 'number' ? { pausedUntil: v.pausedUntil } : {}),
        ...(v.pauseReason === 'budget' || v.pauseReason === 'runs' ? { pauseReason: v.pauseReason } : {}),
        ...(typeof v.nextRunAt === 'number' ? { nextRunAt: v.nextRunAt } : {}),
        ...(typeof v.lastWallKey === 'string' ? { lastWallKey: v.lastWallKey } : {})
      };
    }
    return out;
  }

  /** Записи сериализуются: конфиг, состояние и журнал не пишутся параллельно сами с собой. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writes.catch(() => undefined).then(fn);
    this.writes = run;
    return run;
  }

  public saveConfig(config: AutomationsConfig): Promise<void> {
    return this.enqueue(() => writeJsonAtomic(this.configPath, config));
  }

  public saveState(state: Record<string, RuleRuntimeState>): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify({ version: 1, rules: state }));
    return this.enqueue(() => writeJsonAtomic(path.join(this.baseDir, AUTOMATIONS_STATE_FILE), snapshot));
  }

  /** Дописывает строку журнала; при превышении размера сдвигает архивы `.1` … `.N`. */
  public appendLog(entry: AutomationLogEntry, maxBytes = JOURNAL_MAX_BYTES, maxFiles = JOURNAL_MAX_FILES): Promise<void> {
    const line = `${JSON.stringify(entry)}\n`;
    return this.enqueue(async () => {
      await fs.mkdir(this.baseDir, { recursive: true });
      const size = await fs.stat(this.logPath).then((s) => s.size).catch(() => 0);
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) await this.rotate(maxFiles);
      await fs.appendFile(this.logPath, line, 'utf8');
    });
  }

  private async rotate(maxFiles: number): Promise<void> {
    const name = AUTOMATIONS_LOG_FILE;
    await fs.rm(path.join(this.baseDir, rotatedFileName(name, maxFiles)), { force: true });
    for (let n = maxFiles; n >= 1; n -= 1) {
      const from = n === 1 ? this.logPath : path.join(this.baseDir, rotatedFileName(name, n - 1));
      await fs.rename(from, path.join(this.baseDir, rotatedFileName(name, n))).catch(() => undefined);
    }
  }

  /** Последние записи журнала, новые первыми; при нехватке дочитывает первый архив. */
  public async readLog(limit = 200): Promise<AutomationLogEntry[]> {
    await this.writes.catch(() => undefined);
    const files = [this.logPath, path.join(this.baseDir, rotatedFileName(AUTOMATIONS_LOG_FILE, 1))];
    const out: AutomationLogEntry[] = [];
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      const lines = text.split('\n').filter(Boolean).reverse();
      for (const line of lines) {
        try {
          out.push(JSON.parse(line) as AutomationLogEntry);
        } catch {
          // битая строка (обрыв записи) пропускается
        }
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  /** Дождаться записей (тесты, завершение приложения). */
  public async flush(): Promise<void> {
    await this.writes.catch(() => undefined);
  }
}
