/**
 * Тиры моделей и fallback-цепочка слота (TASK-79, decision-44).
 *
 * Роль и слот ссылаются на тир (`cheap | balanced | frontier`), а не на id модели. Тир разрешается в
 * цепочку моделей по таблице `<userData>/model-tiers.json`, которую заполняет пользователь (или первичное
 * заполнение из того, что у него настроено, — без вендорских дефолтов, [[decision-26]] п. 0). При ошибке
 * провайдера слот переключается на следующее звено цепочки по правилам [[decision-43]] §8.
 *
 * Чистый модуль без Electron — импортируется unit-тестами напрямую.
 */
import type { ProviderErrorInfo, ProviderErrorKind, ProviderErrorReason } from './providerErrors.js';

export type ModelTier = 'cheap' | 'balanced' | 'frontier';

/** От младшего к старшему. */
export const MODEL_TIERS: readonly ModelTier[] = ['cheap', 'balanced', 'frontier'];

export type TierEngine = 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'api';

export const TIER_ENGINES: readonly TierEngine[] = ['claude-cli', 'codex-cli', 'gemini-cli', 'api'];

/** Больше двух переключений за ход не делается (decision-44 п. 6). */
export const MAX_MODEL_SWITCHES = 2;
export const DEFAULT_MAX_WAIT_MS = 30_000;
export const MAX_WAIT_LIMIT_MS = 120_000;

/**
 * Алиасы Claude CLI (`claude --help`: «an alias for the latest model»): CLI сам разрешает их в текущее
 * поколение, поэтому это не id модели. Используются для первичного заполнения и подсказок.
 */
export const CLAUDE_CLI_TIER_ALIASES: Readonly<Record<ModelTier, string>> = {
  cheap: 'haiku',
  balanced: 'sonnet',
  frontier: 'opus'
};
export const CLAUDE_CLI_MODEL_ALIASES: readonly string[] = ['haiku', 'sonnet', 'opus', 'fable'];

/** Звено тира: движок, модель и для `api` — цель (профиль по имени или id, либо прежний провайдер). */
export interface TierModelEntry {
  engine: TierEngine;
  model: string;
  /** Профиль OpenAI-совместимого провайдера: имя или id, как в роли ([[decision-40]] п. 2). */
  profile?: string;
  /** Прежний провайдер (`anthropic`, `ollama`…). Без `profile` и `provider` — провайдер AI Studio. */
  provider?: string;
  /** `auto` — добавлено первичным заполнением, `manual` — пользователем. */
  source?: 'auto' | 'manual';
}

export interface ModelTierSettings {
  version: 1;
  updatedAt?: string;
  /** Когда звенья тира кончились — спускаться в младший тир. */
  fallbackToLowerTier: boolean;
  /** Лимит переключений за ход агента: 0…2, 0 — fallback выключен. */
  maxSwitches: number;
  /** Сколько ждать `retryAfterMs` перед переключением, не больше. */
  maxWaitMs: number;
  tiers: Record<ModelTier, TierModelEntry[]>;
}

export function isModelTier(value: unknown): value is ModelTier {
  return typeof value === 'string' && (MODEL_TIERS as readonly string[]).includes(value);
}

export function isTierEngine(value: unknown): value is TierEngine {
  return typeof value === 'string' && (TIER_ENGINES as readonly string[]).includes(value);
}

export function emptyModelTierSettings(): ModelTierSettings {
  return {
    version: 1,
    fallbackToLowerTier: true,
    maxSwitches: MAX_MODEL_SWITCHES,
    maxWaitMs: DEFAULT_MAX_WAIT_MS,
    tiers: { cheap: [], balanced: [], frontier: [] }
  };
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v ? v : undefined;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Нормализует одну запись; `string` — причина, по которой запись отброшена. */
export function normalizeTierEntry(raw: unknown): TierModelEntry | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'запись не объект';
  const r = raw as Record<string, unknown>;
  if (!isTierEngine(r.engine)) return `неизвестный движок «${String(r.engine)}»`;
  const model = clean(r.model);
  if (!model) return 'не указана модель';
  const entry: TierModelEntry = { engine: r.engine, model };
  // Цель имеет смысл только у API-движка: CLI сам знает, куда ходить.
  if (r.engine === 'api') {
    const profile = clean(r.profile);
    const provider = clean(r.provider);
    if (profile) entry.profile = profile;
    else if (provider) entry.provider = provider;
  }
  if (r.source === 'auto' || r.source === 'manual') entry.source = r.source;
  return entry;
}

/**
 * Таблица из файла: битые записи пропускаются, повторы в пределах всей таблицы убираются (запись
 * остаётся в первом тире, где встретилась). `problems` — что отброшено, для UI.
 */
export function normalizeModelTierSettings(raw: unknown): { settings: ModelTierSettings; problems: string[] } {
  const settings = emptyModelTierSettings();
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) problems.push('файл тиров не содержит объект');
    return { settings, problems };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.fallbackToLowerTier === 'boolean') settings.fallbackToLowerTier = r.fallbackToLowerTier;
  settings.maxSwitches = clampInt(r.maxSwitches, 0, MAX_MODEL_SWITCHES, MAX_MODEL_SWITCHES);
  settings.maxWaitMs = clampInt(r.maxWaitMs, 0, MAX_WAIT_LIMIT_MS, DEFAULT_MAX_WAIT_MS);
  const updatedAt = clean(r.updatedAt);
  if (updatedAt) settings.updatedAt = updatedAt;

  const tiers = r.tiers && typeof r.tiers === 'object' && !Array.isArray(r.tiers) ? (r.tiers as Record<string, unknown>) : {};
  const seen = new Set<string>();
  for (const tier of MODEL_TIERS) {
    const list = tiers[tier];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      problems.push(`тир ${tier}: ожидается список`);
      continue;
    }
    list.forEach((item, index) => {
      const entry = normalizeTierEntry(item);
      if (typeof entry === 'string') {
        problems.push(`тир ${tier}, запись ${index + 1}: ${entry}`);
        return;
      }
      const key = entryKey(entry);
      if (seen.has(key)) {
        problems.push(`тир ${tier}, запись ${index + 1}: повтор «${entry.model}»`);
        return;
      }
      seen.add(key);
      settings.tiers[tier].push(entry);
    });
  }
  return { settings, problems };
}

/** Цель звена: движок и профиль или провайдер (без регистра). Одна цель — один сервер и один счёт. */
export function targetKey(entry: Pick<TierModelEntry, 'engine' | 'profile' | 'provider'>): string {
  const target = entry.engine === 'api' ? (entry.profile ? `profile:${entry.profile}` : entry.provider ? `provider:${entry.provider}` : 'ai-studio') : '';
  return `${entry.engine}|${target.toLocaleLowerCase()}`;
}

/** Ключ звена: цель и модель. Регистр id модели значим у некоторых серверов, поэтому модель как есть. */
export function entryKey(entry: Pick<TierModelEntry, 'engine' | 'profile' | 'provider' | 'model'>): string {
  return `${targetKey(entry)}|${entry.model}`;
}

/** Есть ли в тире звенья для движка. */
export function tierHasEngine(settings: ModelTierSettings, tier: ModelTier, engine: TierEngine): boolean {
  return settings.tiers[tier].some((e) => e.engine === engine);
}

// ─────────────────────────────── Цепочка ───────────────────────────────

/** Звено цепочки слота. `origin: 'explicit'` — модель, заданная слотом или ролью явно. */
export interface ChainLink {
  engine: TierEngine;
  model: string;
  profile?: string;
  provider?: string;
  /** Тир, из которого взято звено; у явной модели — отсутствует. */
  tier?: ModelTier;
  origin: 'explicit' | 'tier';
}

export interface ModelChainInput {
  engine: TierEngine;
  tier?: ModelTier;
  /** Явная модель слота или роли и её цель. Пустая модель или `default` — модели нет. */
  explicit?: { model?: string; profile?: string; provider?: string };
}

/** Тиры цепочки: запрошенный, затем младшие по убыванию (если разрешено). */
export function tiersForChain(tier: ModelTier, fallbackToLowerTier: boolean): ModelTier[] {
  const index = MODEL_TIERS.indexOf(tier);
  if (!fallbackToLowerTier) return [tier];
  return MODEL_TIERS.slice(0, index + 1).reverse();
}

/**
 * Цепочка моделей слота (decision-44 п. 5): явная модель, затем звенья тира для движка слота, затем младшие
 * тиры. Повторы убираются. Пустая цепочка — тир для движка не настроен, слот работает как без тира.
 */
export function buildModelChain(settings: ModelTierSettings, input: ModelChainInput): ChainLink[] {
  const chain: ChainLink[] = [];
  const seen = new Set<string>();
  const push = (link: ChainLink) => {
    const key = entryKey(link);
    if (seen.has(key)) return;
    seen.add(key);
    chain.push(link);
  };

  const explicitModel = clean(input.explicit?.model);
  if (explicitModel && explicitModel !== 'default') {
    const link: ChainLink = { engine: input.engine, model: explicitModel, origin: 'explicit' };
    if (input.engine === 'api') {
      const profile = clean(input.explicit?.profile);
      const provider = clean(input.explicit?.provider);
      if (profile) link.profile = profile;
      else if (provider) link.provider = provider;
    }
    push(link);
  }

  if (input.tier) {
    for (const tier of tiersForChain(input.tier, settings.fallbackToLowerTier)) {
      for (const entry of settings.tiers[tier]) {
        if (entry.engine !== input.engine) continue;
        push({
          engine: entry.engine,
          model: entry.model,
          ...(entry.profile ? { profile: entry.profile } : {}),
          ...(entry.provider ? { provider: entry.provider } : {}),
          tier,
          origin: 'tier'
        });
      }
    }
  }
  return chain;
}

/** Подпись звена для логов и экспорта: «qwen2.5:7b-instruct · профиль Ollama» или «opus · claude-cli». */
export function describeChainLink(link: Pick<ChainLink, 'engine' | 'model' | 'profile' | 'provider'>): string {
  if (link.engine !== 'api') return `${link.model} · ${link.engine}`;
  if (link.profile) return `${link.model} · профиль «${link.profile}»`;
  if (link.provider) return `${link.model} · ${link.provider}`;
  return `${link.model} · AI Studio`;
}

// ─────────────────────────────── Решение о переключении ───────────────────────────────

/**
 * Правило по виду ошибки (decision-43 §8, decision-44 п. 6):
 * - `next` — следующее звено сразу;
 * - `wait_next` — подождать `retryAfterMs`, затем следующее звено;
 * - `other_target` — отказ сервера или счёта, а не модели: только звено с другой целью;
 * - `none` — не переключать: другая модель той же настройки не поможет.
 */
export type FallbackRule = 'next' | 'wait_next' | 'other_target' | 'none';

export function fallbackRuleFor(info: Pick<ProviderErrorInfo, 'kind' | 'reason'>): FallbackRule {
  switch (info.kind) {
    case 'model_not_found':
      return 'next';
    case 'rate_limit':
      return 'wait_next';
    case 'unavailable':
      return info.reason === 'refused' || info.reason === 'dns' || info.reason === 'tls' || info.reason === 'network' ? 'other_target' : 'wait_next';
    case 'quota':
      return 'other_target';
    case 'bad_request':
      return info.reason === 'context' ? 'next' : 'none';
    default:
      // auth, config, unknown
      return 'none';
  }
}

export type FallbackStopReason =
  /** Вид ошибки не допускает переключения. */
  | 'not_switchable'
  /** Звенья цепочки кончились (или остались только с той же целью). */
  | 'exhausted'
  /** Лимит переключений за ход исчерпан. */
  | 'limit'
  /** Fallback выключен (`maxSwitches: 0`). */
  | 'disabled'
  /** Агент уже вызывал инструменты — повтор хода повторил бы побочные эффекты. */
  | 'side_effects';

export type FallbackDecision =
  | { action: 'switch'; nextIndex: number; waitMs: number; rule: FallbackRule }
  | { action: 'stop'; reason: FallbackStopReason; rule: FallbackRule };

export interface FallbackInput {
  chain: readonly ChainLink[];
  currentIndex: number;
  error: Pick<ProviderErrorInfo, 'kind' | 'reason' | 'retryAfterMs'>;
  /** Сколько переключений уже сделано в этом ходе. */
  switchesDone: number;
  maxSwitches: number;
  maxWaitMs: number;
  /** В ходе уже был вызов инструмента. */
  sideEffects?: boolean;
}

export function decideFallback(input: FallbackInput): FallbackDecision {
  const rule = fallbackRuleFor(input.error);
  if (rule === 'none') return { action: 'stop', reason: 'not_switchable', rule };
  if (input.sideEffects) return { action: 'stop', reason: 'side_effects', rule };
  const maxSwitches = Math.min(MAX_MODEL_SWITCHES, Math.max(0, input.maxSwitches));
  if (maxSwitches === 0) return { action: 'stop', reason: 'disabled', rule };
  if (input.switchesDone >= maxSwitches) return { action: 'stop', reason: 'limit', rule };

  const current = input.chain[input.currentIndex];
  const currentTarget = current ? targetKey(current) : undefined;
  for (let i = input.currentIndex + 1; i < input.chain.length; i++) {
    if (rule === 'other_target' && targetKey(input.chain[i]) === currentTarget) continue;
    const waitMs = rule === 'wait_next' ? Math.min(Math.max(0, input.error.retryAfterMs ?? 0), Math.max(0, input.maxWaitMs)) : 0;
    return { action: 'switch', nextIndex: i, waitMs, rule };
  }
  return { action: 'stop', reason: 'exhausted', rule };
}

/** Текст причины остановки цепочки (ru) — для лога, ошибки слота и экспорта. */
export function describeFallbackStop(reason: FallbackStopReason, maxSwitches: number): string {
  switch (reason) {
    case 'not_switchable':
      return 'переключение модели не поможет при такой ошибке';
    case 'exhausted':
      return 'в цепочке тира не осталось подходящих моделей';
    case 'limit':
      return `исчерпан лимит переключений модели (${maxSwitches})`;
    case 'disabled':
      return 'переключение модели выключено в настройках тиров';
    case 'side_effects':
      return 'агент уже вызывал инструменты, повтор хода другой моделью повторил бы их действия';
  }
}

// ─────────────────────────────── Отчёт ───────────────────────────────

/** Звено в отчёте: без служебного `origin`. */
export type ChainLinkRef = Pick<ChainLink, 'engine' | 'model' | 'profile' | 'provider' | 'tier'>;

export function chainLinkRef(link: ChainLink): ChainLinkRef {
  return {
    engine: link.engine,
    model: link.model,
    ...(link.profile ? { profile: link.profile } : {}),
    ...(link.provider ? { provider: link.provider } : {}),
    ...(link.tier ? { tier: link.tier } : {})
  };
}

/** Одно переключение модели: с какого звена, на какое и почему. */
export interface ModelSwitchRecord {
  at: number;
  from: ChainLinkRef;
  to: ChainLinkRef;
  kind: ProviderErrorKind;
  reason?: ProviderErrorReason;
  status?: number;
  code?: string;
  /** Сколько ждали перед переключением (`retryAfterMs`, не дольше `maxWaitMs`). */
  waitedMs?: number;
  /** Краткая причина для лога и экспорта (ru). */
  message: string;
}

/**
 * Снимок маршрутизации модели агента (decision-44 п. 8): запрошенный тир, откуда первая модель, чем агент
 * работал последним, переключения и почему цепочка остановилась.
 */
export interface ModelRoutingInfo {
  requestedTier?: ModelTier;
  /** `explicit` — явная модель слота или роли, `tier` — из таблицы тиров, `default` — модель по умолчанию движка. */
  source: 'explicit' | 'tier' | 'default';
  engine: TierEngine;
  /** Звено, которым агент работал последним. */
  current?: ChainLinkRef;
  chainLength: number;
  /** Лимит переключений за ход из таблицы тиров. */
  maxSwitches?: number;
  switches: ModelSwitchRecord[];
  /** Почему цепочка остановилась на ошибке. */
  stopped?: FallbackStopReason;
  /** Пояснение: например, тир для движка не настроен. */
  note?: string;
}

// ─────────────────────────────── Первичное заполнение ───────────────────────────────

const EMBEDDING_RE = /embed|bge|minilm|rerank|(^|[^a-z])e5-/i;
/** Размер модели в id: `qwen2.5:7b-instruct` → 7, `ornith:35b` → 35, `phi3:3.8b` → 3.8. MoE (`8x7b`) — нет. */
const SIZE_RE = /(?:^|[^a-z0-9.x])(\d+(?:\.\d+)?)b(?![a-z0-9])/i;

export function parameterSizeB(modelId: string): number | undefined {
  const m = SIZE_RE.exec(modelId);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Тир по размеру: до 10B — cheap, 10–30B — balanced, больше 30B — frontier. */
export function tierForModelSize(sizeB: number): ModelTier {
  if (sizeB < 10) return 'cheap';
  if (sizeB <= 30) return 'balanced';
  return 'frontier';
}

export interface TierSeedInput {
  /** Настройки AI Studio: модель, которой пользователь уже пользуется. */
  aiStudio?: { provider: string; profileId?: string; model?: string };
  profiles: readonly { id: string; name: string; local?: boolean }[];
  /** Кэш каталогов профилей: id профиля → модели. */
  catalogs: Readonly<Record<string, readonly string[]>>;
  /** Claude CLI отвечает на `claude --version`. */
  claudeCli: boolean;
}

/**
 * Первичное заполнение (decision-44 п. 3): только из того, что настроено у пользователя. Ручные записи не
 * трогаются, уже существующие звенья не дублируются. `added` — сколько звеньев добавлено.
 */
export function seedModelTiers(input: TierSeedInput, base: ModelTierSettings = emptyModelTierSettings()): { settings: ModelTierSettings; added: number } {
  const settings: ModelTierSettings = {
    ...base,
    tiers: { cheap: [...base.tiers.cheap], balanced: [...base.tiers.balanced], frontier: [...base.tiers.frontier] }
  };
  const seen = new Set(MODEL_TIERS.flatMap((t) => settings.tiers[t].map(entryKey)));
  let added = 0;
  const add = (tier: ModelTier, entry: TierModelEntry) => {
    const key = entryKey(entry);
    if (seen.has(key)) return;
    seen.add(key);
    settings.tiers[tier].push({ ...entry, source: 'auto' });
    added += 1;
  };
  // Роли хранят профиль по имени (переносимо между машинами), здесь так же — если имя однозначно.
  const profileRef = (id: string): string => {
    const profile = input.profiles.find((p) => p.id === id);
    if (!profile) return id;
    const sameName = input.profiles.filter((p) => p.name.trim().toLocaleLowerCase() === profile.name.trim().toLocaleLowerCase());
    return sameName.length === 1 ? profile.name : id;
  };

  const studio = input.aiStudio;
  const studioModel = clean(studio?.model);
  if (studio && studioModel && studioModel !== 'default') {
    if (studio.provider === 'openai-compatible') {
      if (studio.profileId) add('balanced', { engine: 'api', model: studioModel, profile: profileRef(studio.profileId) });
    } else {
      add('balanced', { engine: 'api', model: studioModel, provider: studio.provider });
    }
  }

  if (input.claudeCli) {
    for (const tier of MODEL_TIERS) add(tier, { engine: 'claude-cli', model: CLAUDE_CLI_TIER_ALIASES[tier] });
  }

  for (const profile of input.profiles) {
    const models = input.catalogs[profile.id] ?? [];
    const sized = models
      .filter((m) => !EMBEDDING_RE.test(m))
      .map((m) => ({ model: m, size: parameterSizeB(m) }))
      .filter((m): m is { model: string; size: number } => m.size !== undefined)
      // Внутри тира крупная модель раньше: она ближе к верхней границе тира.
      .sort((a, b) => b.size - a.size);
    for (const { model, size } of sized) {
      add(tierForModelSize(size), { engine: 'api', model, profile: profileRef(profile.id) });
    }
  }

  return { settings, added };
}
