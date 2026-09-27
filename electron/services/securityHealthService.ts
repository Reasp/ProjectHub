/**
 * Security Health проекта (decision-56 п. 2, 9, TASK-73.2).
 *
 * Аудит зависимостей по кнопке и из Automations, кэш отчёта и настроек в `<userData>/security`, задача Backlog из
 * находки и запросы метаданных пакетов в registry (для слотов Swarm) с кэшем. Разбор выводов — в чистом
 * `dependencyAudit`/`dependencyDiff`; здесь только процессы, файлы и одновременность.
 *
 * Внешние команды получают только аргументы из белого набора: имена файлов корня, отобранные шаблоном, и
 * спецификации пакетов, прошедшие `isSafeNpmName`. Всё, что приходит из диффа агента, до оболочки не доходит иначе.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import treeKill from 'tree-kill';
import { getUserDataDir } from './appPaths.js';
import type { AppBusEvent } from './hitlTypes.js';
import {
  buildFindingTask,
  detectAuditTargets,
  emptyCounts,
  meetsSeverity,
  mergeCounts,
  newFindings,
  parseNpmAudit,
  parsePipAudit,
  severityRank,
  summarizeCounts,
  type AuditEcosystem,
  type AuditErrorKind,
  type AuditFinding,
  type AuditRunStatus,
  type AuditSeverity,
  type EcosystemAuditParse,
  type SeverityCounts
} from './dependencyAudit.js';
import { MAX_REGISTRY_LOOKUPS, parseNpmViewOutput, type RegistryMeta } from './dependencyDiff.js';

export const SECURITY_REPORT_VERSION = 1;
export const AUDIT_TIMEOUT_MS = 120_000;
export const AUDIT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
/** Автоматический повтор аудита проекта не чаще — иначе правило cron гоняло бы registry впустую. */
export const AUDIT_MIN_INTERVAL_MS = 10 * 60_000;
export const REGISTRY_TIMEOUT_MS = 15_000;
export const REGISTRY_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
export const REGISTRY_CONCURRENCY = 4;
const REGISTRY_CACHE_MAX_ENTRIES = 2000;
const TOOL_PROBE_TTL_MS = 10 * 60_000;

/** Аргумент внешней команды: имя файла, спецификация пакета, флаг. Пробелы и метасимволы оболочки запрещены. */
const SAFE_ARG_RE = /^[A-Za-z0-9@._/:=+~-]+$/;

export interface EcosystemReport extends EcosystemAuditParse {
  ecosystem: AuditEcosystem;
  manifest?: string;
  ranAt: number;
  durationMs?: number;
  /** Прошлый успешный результат, сохранённый при сбое нового запуска (офлайн). */
  stale?: boolean;
  staleSince?: number;
}

export interface SecurityReport {
  version: number;
  projectPath: string;
  ranAt?: number;
  durationMs?: number;
  ecosystems: EcosystemReport[];
  counts: SeverityCounts;
  /** Созданные задачи: `<экосистема>:<пакет>` → id задачи. */
  tasks: Record<string, string>;
}

export interface SecuritySettings {
  version: number;
  /** Запросы `npm view` для пакетов, добавленных агентами (decision-56 п. 9). */
  registryLookups: boolean;
}

export interface RunAuditOptions {
  reason: 'manual' | 'automation';
  /** Для автоматического запуска: минимальный уровень новых находок, о которых публикуется событие. */
  minSeverity?: AuditSeverity;
}

export interface RunAuditResult {
  report: SecurityReport;
  /** Аудит не запускался: прошло меньше `AUDIT_MIN_INTERVAL_MS` (только для автоматизаций). */
  fromCache: boolean;
  newFindings: AuditFinding[];
}

export interface ToolRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

export interface SecurityHealthDeps {
  stateDir(): string;
  now(): number;
  runTool(command: string, args: string[], options: { cwd: string; timeoutMs: number }): Promise<ToolRunResult>;
  listRootFiles(root: string): Promise<string[]>;
  createTask(root: string, task: { title: string; description: string; labels: string[]; priority: string }): Promise<{ id: string } | null>;
  publish(event: AppBusEvent): void;
  /** Отчёт проекта изменился — окно перечитает вкладку. */
  notifyRenderer(projectPath: string): void;
}

export function projectKey(root: string): string {
  const normalized = path.resolve(root).replace(/\\/g, '/');
  return createHash('sha1')
    .update(process.platform === 'win32' ? normalized.toLowerCase() : normalized)
    .digest('hex')
    .slice(0, 12);
}

function isSafeArg(arg: string): boolean {
  return SAFE_ARG_RE.test(arg);
}

/** Запуск CLI с полным stdout (у `processManager.runOnce` — только хвост). На Windows `npm` — это `npm.cmd`, нужна оболочка. */
export function defaultRunTool(command: string, args: string[], options: { cwd: string; timeoutMs: number }): Promise<ToolRunResult> {
  const bad = [command, ...args].find((a) => !isSafeArg(a));
  if (bad !== undefined) return Promise.resolve({ code: null, stdout: '', stderr: '', timedOut: false, error: `Недопустимый аргумент команды: ${bad.slice(0, 80)}` });
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', npm_config_fund: 'false', npm_config_update_notifier: 'false', PYTHONIOENCODING: 'utf-8' };
    delete env.ELECTRON_RUN_AS_NODE;
    let child;
    try {
      child = spawn(command, args, { cwd: options.cwd, env, shell: process.platform === 'win32', windowsHide: true });
    } catch (err) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const out: Buffer[] = [];
    const errOut: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) treeKill(child.pid);
    }, options.timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk: Buffer) => {
      if (outBytes + chunk.length <= AUDIT_MAX_OUTPUT_BYTES) out.push(chunk);
      outBytes += chunk.length;
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (errBytes < 256 * 1024) errOut.push(chunk);
      errBytes += chunk.length;
    });
    const finish = (code: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(errOut).toString('utf8'),
        timedOut,
        ...(error ? { error } : outBytes > AUDIT_MAX_OUTPUT_BYTES ? { error: 'Вывод длиннее 32 МБ' } : {})
      });
    };
    child.on('error', (err) => finish(null, err.message));
    child.on('close', (code) => finish(code));
  });
}

function defaultDeps(): SecurityHealthDeps {
  return {
    stateDir: () => path.join(getUserDataDir(), 'security'),
    now: () => Date.now(),
    runTool: defaultRunTool,
    listRootFiles: async (root) => {
      try {
        return (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
      } catch {
        return [];
      }
    },
    createTask: async (root, task) => {
      const { createBacklogTaskFile } = await import('./backlogTaskCreate.js');
      const created = await createBacklogTaskFile(root, { ...task, type: 'bug' });
      return created ? { id: created.id } : null;
    },
    publish: (event) => {
      void import('./eventBus.js').then(({ appEventBus }) => appEventBus.publish(event)).catch(() => undefined);
    },
    notifyRenderer: (projectPath) => {
      void import('electron')
        .then(({ BrowserWindow }) => {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send('security:reportUpdated', projectPath);
          }
        })
        .catch(() => undefined);
    }
  };
}

function priorityFor(severity: AuditSeverity): string {
  return severity === 'critical' || severity === 'high' || severity === 'unknown' ? 'high' : severity === 'moderate' ? 'medium' : 'low';
}

function errorStatus(message: string, errorKind: AuditErrorKind): EcosystemAuditParse {
  return { status: 'error', errorKind, message, findings: [], counts: emptyCounts() };
}

interface RegistryCacheFile {
  version: number;
  entries: Record<string, { meta: RegistryMeta; at: number }>;
}

export class SecurityHealthService {
  private running = new Map<string, Promise<RunAuditResult>>();
  private writeChain: Promise<unknown> = Promise.resolve();
  private toolProbe = new Map<string, { at: number; command: string[] | null }>();
  private registryCache: RegistryCacheFile | null = null;

  constructor(private readonly deps: SecurityHealthDeps = defaultDeps()) {}

  // ─────────────────────────── Файлы состояния ───────────────────────────

  private reportFile(root: string): string {
    return path.join(this.deps.stateDir(), `${projectKey(root)}.json`);
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  /** Запись через временный файл и последовательно — отчёт не бьётся при параллельных сохранениях. */
  private writeJson(file: string, value: unknown): Promise<void> {
    const job = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
      await fs.rename(tmp, file);
    });
    this.writeChain = job.catch(() => undefined);
    return job;
  }

  public async getReport(root: string): Promise<SecurityReport | null> {
    const report = await this.readJson<SecurityReport>(this.reportFile(root));
    if (!report || report.version !== SECURITY_REPORT_VERSION || !Array.isArray(report.ecosystems)) return null;
    return { ...report, tasks: report.tasks ?? {} };
  }

  public async getSettings(): Promise<SecuritySettings> {
    const raw = await this.readJson<Partial<SecuritySettings>>(path.join(this.deps.stateDir(), 'settings.json'));
    return { version: 1, registryLookups: raw?.registryLookups !== false };
  }

  public async saveSettings(patch: Partial<SecuritySettings>): Promise<SecuritySettings> {
    const next: SecuritySettings = { ...(await this.getSettings()), ...(typeof patch.registryLookups === 'boolean' ? { registryLookups: patch.registryLookups } : {}), version: 1 };
    await this.writeJson(path.join(this.deps.stateDir(), 'settings.json'), next);
    return next;
  }

  // ─────────────────────────────── Аудит ───────────────────────────────

  public isRunning(root: string): boolean {
    return this.running.has(projectKey(root));
  }

  /** Один аудит проекта одновременно; повторный вызов получает тот же промис. */
  public runAudit(root: string, options: RunAuditOptions): Promise<RunAuditResult> {
    const key = projectKey(root);
    const existing = this.running.get(key);
    if (existing) return existing;
    const job = this.doRunAudit(root, options).finally(() => this.running.delete(key));
    this.running.set(key, job);
    this.deps.notifyRenderer(root);
    return job;
  }

  private async doRunAudit(root: string, options: RunAuditOptions): Promise<RunAuditResult> {
    const previous = await this.getReport(root);
    const now = this.deps.now();
    if (options.reason === 'automation' && previous?.ranAt && now - previous.ranAt < AUDIT_MIN_INTERVAL_MS) {
      return { report: previous, fromCache: true, newFindings: [] };
    }

    const targets = detectAuditTargets(await this.deps.listRootFiles(root));
    const ecosystems: EcosystemReport[] = [];
    for (const target of targets) {
      const startedAt = this.deps.now();
      let parsed: EcosystemAuditParse;
      if (!target.run) {
        parsed = { status: target.status as AuditRunStatus, findings: [], counts: emptyCounts(), ...(target.message ? { message: target.message } : {}) };
      } else if (target.ecosystem === 'npm') {
        parsed = await this.runNpmAudit(root);
      } else {
        parsed = await this.runPipAudit(root, target.manifest as string);
      }
      const entry: EcosystemReport = {
        ...parsed,
        ecosystem: target.ecosystem,
        ...(target.manifest ? { manifest: target.manifest } : {}),
        ranAt: startedAt,
        durationMs: this.deps.now() - startedAt
      };
      // Сбой сети или инструмента не стирает прошлый результат — он остаётся с пометкой «устарело».
      const prior = previous?.ecosystems.find((e) => e.ecosystem === entry.ecosystem && e.manifest === entry.manifest);
      if (entry.status === 'error' && prior && (prior.status === 'done' || prior.stale)) {
        ecosystems.push({
          ...prior,
          stale: true,
          staleSince: prior.staleSince ?? prior.ranAt,
          ...(entry.errorKind ? { errorKind: entry.errorKind } : {}),
          message: entry.message
        });
      } else {
        ecosystems.push(entry);
      }
    }

    const report: SecurityReport = {
      version: SECURITY_REPORT_VERSION,
      projectPath: root,
      ranAt: now,
      durationMs: this.deps.now() - now,
      ecosystems,
      counts: mergeCounts(ecosystems.map((e) => e.counts)),
      tasks: previous?.tasks ?? {}
    };
    await this.writeJson(this.reportFile(root), report);
    this.deps.notifyRenderer(root);

    const before = previous?.ecosystems.flatMap((e) => e.findings) ?? [];
    const fresh = newFindings(before, ecosystems.filter((e) => !e.stale).flatMap((e) => e.findings));
    if (options.reason === 'automation') this.publishAuditFindings(root, fresh, options.minSeverity ?? 'high', now);
    return { report, fromCache: false, newFindings: fresh };
  }

  private publishAuditFindings(root: string, fresh: AuditFinding[], minSeverity: AuditSeverity, at: number): void {
    const relevant = fresh.filter((f) => meetsSeverity(f.severity, minSeverity));
    if (relevant.length === 0) return;
    const counts = emptyCounts();
    for (const f of relevant) counts[f.severity] += 1;
    const top = [...relevant].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
    const names = relevant.slice(0, 5).map((f) => f.package).join(', ') + (relevant.length > 5 ? ` +${relevant.length - 5}` : '');
    this.deps.publish({
      type: 'security:finding',
      projectPath: root,
      source: 'audit',
      severity: top.severity,
      title: `Новые уязвимости зависимостей: ${relevant.length}`,
      summary: `${summarizeCounts(counts)} · ${names}`,
      count: relevant.length,
      key: relevant.flatMap((f) => f.advisories.map((a) => `${f.package}:${a.id}`)).sort().join(',').slice(0, 500) || names,
      at
    });
  }

  private async runNpmAudit(root: string): Promise<EcosystemAuditParse> {
    const res = await this.deps.runTool('npm', ['audit', '--json'], { cwd: root, timeoutMs: AUDIT_TIMEOUT_MS });
    if (res.timedOut) return errorStatus(`npm audit не ответил за ${AUDIT_TIMEOUT_MS / 1000} с`, 'timeout');
    if (res.error && !res.stdout) {
      if (/ENOENT|not recognized|не является/i.test(`${res.error} ${res.stderr}`)) {
        return { status: 'not_installed', findings: [], counts: emptyCounts(), message: 'npm не найден в PATH' };
      }
      return errorStatus(res.error, 'tool');
    }
    return parseNpmAudit(res.stdout, res.stderr);
  }

  /** `pip-audit` из PATH или модулем Python; `null` — не установлен. Результат пробы кэшируется на 10 минут. */
  private async pipAuditCommand(root: string): Promise<string[] | null> {
    const cached = this.toolProbe.get('pip-audit');
    const now = this.deps.now();
    if (cached && now - cached.at < TOOL_PROBE_TTL_MS) return cached.command;
    const candidates: string[][] = [['pip-audit'], ['python', '-m', 'pip_audit'], ...(process.platform === 'win32' ? [['py', '-3', '-m', 'pip_audit']] : [['python3', '-m', 'pip_audit']])];
    let found: string[] | null = null;
    for (const cmd of candidates) {
      const res = await this.deps.runTool(cmd[0], [...cmd.slice(1), '--version'], { cwd: root, timeoutMs: 20_000 });
      if (res.code === 0 && /pip-audit/i.test(res.stdout + res.stderr)) {
        found = cmd;
        break;
      }
    }
    this.toolProbe.set('pip-audit', { at: now, command: found });
    return found;
  }

  private async runPipAudit(root: string, manifest: string): Promise<EcosystemAuditParse> {
    const cmd = await this.pipAuditCommand(root);
    if (!cmd) return { status: 'not_installed', findings: [], counts: emptyCounts(), message: 'pip-audit не установлен (pip install pip-audit)' };
    // --no-deps --disable-pip: без установки пакетов во временное окружение (сборка sdist исполняла бы чужой код).
    const res = await this.deps.runTool(cmd[0], [...cmd.slice(1), '-r', manifest, '--no-deps', '--disable-pip', '-f', 'json', '--progress-spinner', 'off'], {
      cwd: root,
      timeoutMs: AUDIT_TIMEOUT_MS
    });
    if (res.timedOut) return errorStatus(`pip-audit не ответил за ${AUDIT_TIMEOUT_MS / 1000} с`, 'timeout');
    if (res.error && !res.stdout && !res.stderr) return errorStatus(res.error, 'tool');
    return parsePipAudit(res.stdout, res.stderr);
  }

  // ───────────────────────────── Задача из находки ─────────────────────────────

  public async createTaskFromFinding(
    root: string,
    ecosystem: AuditEcosystem,
    pkg: string
  ): Promise<{ ok: true; taskId: string; existed: boolean } | { ok: false; error: string }> {
    const report = await this.getReport(root);
    if (!report) return { ok: false, error: 'Аудит проекта ещё не запускался' };
    const key = `${ecosystem}:${pkg}`;
    const existing = report.tasks[key];
    if (existing) return { ok: true, taskId: existing, existed: true };
    const finding = report.ecosystems.flatMap((e) => e.findings).find((f) => f.ecosystem === ecosystem && f.package === pkg);
    if (!finding) return { ok: false, error: `Находка ${pkg} не найдена в последнем отчёте` };
    const task = buildFindingTask(finding, path.basename(root));
    const created = await this.deps.createTask(root, { ...task, priority: priorityFor(finding.severity) });
    if (!created) return { ok: false, error: 'Не удалось создать задачу Backlog' };
    const fresh = (await this.getReport(root)) ?? report;
    fresh.tasks = { ...fresh.tasks, [key]: created.id };
    await this.writeJson(this.reportFile(root), fresh);
    this.deps.notifyRenderer(root);
    return { ok: true, taskId: created.id, existed: false };
  }

  // ─────────────────────────────── Registry ───────────────────────────────

  private async loadRegistryCache(): Promise<RegistryCacheFile> {
    if (this.registryCache) return this.registryCache;
    const raw = await this.readJson<RegistryCacheFile>(path.join(this.deps.stateDir(), 'registry-cache.json'));
    this.registryCache = raw?.version === 1 && raw.entries && typeof raw.entries === 'object' ? raw : { version: 1, entries: {} };
    return this.registryCache;
  }

  /**
   * Метаданные пакетов из registry через npm пользователя (`.npmrc`, прокси, авторизация). Спецификации — уже
   * проверенные `registryLookupSpec`; сбой запроса не кэшируется. Возвращает карту спецификация → метаданные.
   */
  public async lookupRegistry(cwd: string, specs: string[]): Promise<Map<string, RegistryMeta>> {
    const result = new Map<string, RegistryMeta>();
    const unique = [...new Set(specs)].filter((s) => isSafeArg(s)).slice(0, MAX_REGISTRY_LOOKUPS);
    if (unique.length === 0) return result;
    const cache = await this.loadRegistryCache();
    const now = this.deps.now();
    const pending: string[] = [];
    for (const spec of unique) {
      const hit = cache.entries[spec];
      if (hit && now - hit.at < REGISTRY_CACHE_TTL_MS) result.set(spec, hit.meta);
      else pending.push(spec);
    }
    let next = 0;
    const worker = async () => {
      for (;;) {
        const spec = pending[next++];
        if (spec === undefined) return;
        const version = spec.lastIndexOf('@') > 0 ? spec.slice(spec.lastIndexOf('@') + 1) : undefined;
        const res = await this.deps.runTool('npm', ['view', spec, 'time', 'deprecated', '--json'], { cwd, timeoutMs: REGISTRY_TIMEOUT_MS });
        const meta: RegistryMeta = res.timedOut ? { error: 'тайм-аут registry' } : parseNpmViewOutput(res.stdout, version, res.stderr || res.error || '');
        result.set(spec, meta);
        if (!meta.error) cache.entries[spec] = { meta, at: this.deps.now() };
      }
    };
    await Promise.all(Array.from({ length: Math.min(REGISTRY_CONCURRENCY, pending.length) }, worker));
    if (pending.length) {
      const entries = Object.entries(cache.entries).sort((a, b) => b[1].at - a[1].at).slice(0, REGISTRY_CACHE_MAX_ENTRIES);
      cache.entries = Object.fromEntries(entries);
      await this.writeJson(path.join(this.deps.stateDir(), 'registry-cache.json'), cache).catch(() => undefined);
    }
    return result;
  }
}

export const securityHealthService = new SecurityHealthService();
