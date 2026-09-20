import fs from 'node:fs/promises';
import path from 'node:path';
import { getUserDataDir } from './appPaths.js';
import type { PlanState } from './planTypes.js';

/**
 * Файловое хранилище планов (TASK-80, decision-49 п. 1), по образцу `swarmSessionStore`.
 *
 * Раскладка: `<userData>/plans/<planId>.json`. Здесь только состояние исполнения плана;
 * состав подзадач, их заголовки и зависимости — в `backlog/tasks/`, они перечитываются оттуда
 * и в файле плана хранятся лишь как последний известный снимок.
 */

export const PLAN_STORE_VERSION = 1;

const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
/** Сырой ответ модели в файл пишем усечённым: он нужен человеку для разбора, а не целиком. */
const RAW_RESPONSE_LIMIT = 20_000;

export function isValidPlanId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

export interface StoredPlanState extends PlanState {
  version: number;
}

export function compactPlanForStorage(plan: PlanState): StoredPlanState {
  const raw = plan.architect.rawResponse;
  return {
    ...plan,
    version: PLAN_STORE_VERSION,
    architect: {
      ...plan.architect,
      ...(raw && raw.length > RAW_RESPONSE_LIMIT ? { rawResponse: `${raw.slice(0, RAW_RESPONSE_LIMIT)}\n…[усечено]` } : {})
    },
    // Ключ провайдера в файл не пишем (как в swarmSessionStore).
    settings: {
      ...plan.settings,
      ...(plan.settings.agent?.providerConfig?.apiKey
        ? { agent: { ...plan.settings.agent, providerConfig: { ...plan.settings.agent.providerConfig, apiKey: undefined } } }
        : {}),
      ...(plan.settings.architect?.providerConfig?.apiKey
        ? { architect: { ...plan.settings.architect, providerConfig: { ...plan.settings.architect.providerConfig, apiKey: undefined } } }
        : {})
    }
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Приведение сырого JSON к текущей версии формата; битое состояние отбрасывается. */
export function migrateStoredPlan(raw: unknown): PlanState | null {
  if (!isRecord(raw)) return null;
  if (!isValidPlanId(raw.id) || typeof raw.projectPath !== 'string' || typeof raw.taskId !== 'string') return null;
  const plan = { ...raw } as Record<string, unknown>;
  delete plan.version;

  plan.nodes = Array.isArray(raw.nodes) ? (raw.nodes as unknown[]).filter(isRecord).map((n) => ({
    ...n,
    key: typeof n.key === 'string' ? n.key : String(n.taskId ?? ''),
    taskId: String(n.taskId ?? ''),
    title: typeof n.title === 'string' ? n.title : String(n.taskId ?? ''),
    state: typeof n.state === 'string' ? n.state : 'pending',
    dependsOn: Array.isArray(n.dependsOn) ? n.dependsOn.filter((d) => typeof d === 'string') : []
  })) : [];
  plan.settings = isRecord(raw.settings) ? raw.settings : { maxParallel: 2 };
  plan.architect = isRecord(raw.architect) ? raw.architect : { attempts: 0 };
  plan.phase = typeof raw.phase === 'string' ? raw.phase : 'failed';
  plan.createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  plan.updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : plan.createdAt;

  return plan as unknown as PlanState;
}

export class PlanStore {
  private pendingSaves = new Map<string, { timer: NodeJS.Timeout; plan: PlanState }>();
  private inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly baseDir: string = path.join(getUserDataDir(), 'plans'),
    private readonly saveDelayMs: number = 500
  ) {}

  public get directory(): string {
    return this.baseDir;
  }

  public planFile(planId: string): string {
    return path.join(this.baseDir, `${planId}.json`);
  }

  /** Все планы на диске, новые первыми. Битые файлы пропускаются с предупреждением. */
  public async list(): Promise<PlanState[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.baseDir);
    } catch {
      return [];
    }
    const plans: PlanState[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      if (!isValidPlanId(id)) continue;
      try {
        const raw = await fs.readFile(path.join(this.baseDir, name), 'utf8');
        const plan = migrateStoredPlan(JSON.parse(raw));
        if (plan && plan.id === id) plans.push(plan);
      } catch (e) {
        console.warn(`[PlanStore] Пропущен повреждённый файл плана ${name}:`, e);
      }
    }
    plans.sort((a, b) => b.createdAt - a.createdAt);
    return plans;
  }

  /** Атомарная запись (tmp + rename); параллельные вызовы для одного плана сериализуются. */
  public async save(plan: PlanState): Promise<void> {
    if (!isValidPlanId(plan?.id)) throw new Error(`Недопустимый идентификатор плана: ${String(plan?.id)}`);
    const pending = this.pendingSaves.get(plan.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingSaves.delete(plan.id);
    }
    const previous = this.inFlight.get(plan.id) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.baseDir, { recursive: true });
        const target = this.planFile(plan.id);
        const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(compactPlanForStorage(plan)), 'utf8');
        try {
          await fs.rename(tmp, target);
        } catch (e) {
          await fs.rm(tmp, { force: true }).catch(() => undefined);
          throw e;
        }
      });
    this.inFlight.set(plan.id, run);
    try {
      await run;
    } finally {
      if (this.inFlight.get(plan.id) === run) this.inFlight.delete(plan.id);
    }
  }

  /** Троттлинг записи: состояние попадает на диск не позже `saveDelayMs`. */
  public scheduleSave(plan: PlanState): void {
    if (!isValidPlanId(plan?.id)) return;
    const existing = this.pendingSaves.get(plan.id);
    if (existing) {
      existing.plan = plan;
      return;
    }
    const timer = setTimeout(() => {
      const entry = this.pendingSaves.get(plan.id);
      this.pendingSaves.delete(plan.id);
      if (!entry) return;
      this.save(entry.plan).catch((e) => console.warn(`[PlanStore] Не удалось сохранить план ${plan.id}:`, e));
    }, this.saveDelayMs);
    timer.unref?.();
    this.pendingSaves.set(plan.id, { timer, plan });
  }

  public async flush(): Promise<void> {
    const pending = Array.from(this.pendingSaves.values());
    for (const entry of pending) clearTimeout(entry.timer);
    this.pendingSaves.clear();
    await Promise.allSettled(pending.map((entry) => this.save(entry.plan)));
    await Promise.allSettled(Array.from(this.inFlight.values()));
  }

  public async delete(planId: string): Promise<boolean> {
    if (!isValidPlanId(planId)) return false;
    const pending = this.pendingSaves.get(planId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingSaves.delete(planId);
    }
    try {
      await fs.rm(this.planFile(planId), { force: true });
      return true;
    } catch (e) {
      console.warn(`[PlanStore] Не удалось удалить план ${planId}:`, e);
      return false;
    }
  }
}
