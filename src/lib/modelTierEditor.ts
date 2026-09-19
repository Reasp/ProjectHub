/**
 * Редактор таблицы тиров моделей (TASK-79, decision-44): правка звеньев, порядок, проверка черновика и
 * подсветка модели, которой нет в каталоге её профиля. Чистые функции без React — покрыты unit-тестами.
 * Схему и нормализацию окончательно применяет main-процесс (`electron/services/modelTiers.ts`).
 */
import type { ModelTier, ModelTierSettings, TierEngine, TierModelEntry } from '../types/electron';
import { findProfileByRef, type ProfileLike, type ProviderChoice } from './providerSelect';

/** Порядок показа: старший тир сверху. */
export const TIERS_TOP_DOWN: readonly ModelTier[] = ['frontier', 'balanced', 'cheap'];
export const TIER_ENGINE_OPTIONS: readonly TierEngine[] = ['api', 'claude-cli', 'codex-cli', 'gemini-cli'];

/** Алиасы Claude CLI — зеркало `CLAUDE_CLI_MODEL_ALIASES` в main (`claude --help`). */
export const CLAUDE_CLI_ALIASES: readonly string[] = ['haiku', 'sonnet', 'opus', 'fable'];

function cloneTiers(settings: ModelTierSettings): ModelTierSettings {
  return {
    ...settings,
    tiers: { cheap: [...settings.tiers.cheap], balanced: [...settings.tiers.balanced], frontier: [...settings.tiers.frontier] }
  };
}

export function addTierEntry(settings: ModelTierSettings, tier: ModelTier, entry: TierModelEntry): ModelTierSettings {
  const next = cloneTiers(settings);
  next.tiers[tier].push({ ...entry, source: 'manual' });
  return next;
}

/** Правка звена пользователем делает его ручным: повторное заполнение его не трогает. */
export function updateTierEntry(settings: ModelTierSettings, tier: ModelTier, index: number, patch: Partial<TierModelEntry>): ModelTierSettings {
  const next = cloneTiers(settings);
  const current = next.tiers[tier][index];
  if (!current) return settings;
  const merged: TierModelEntry = { ...current, ...patch, source: 'manual' };
  // Цель есть только у API-движка.
  if (merged.engine !== 'api') {
    delete merged.profile;
    delete merged.provider;
  }
  next.tiers[tier][index] = merged;
  return next;
}

export function removeTierEntry(settings: ModelTierSettings, tier: ModelTier, index: number): ModelTierSettings {
  const next = cloneTiers(settings);
  next.tiers[tier].splice(index, 1);
  return next;
}

/** Сдвиг звена в пределах тира (`delta` −1 — выше, +1 — ниже). */
export function moveTierEntry(settings: ModelTierSettings, tier: ModelTier, index: number, delta: -1 | 1): ModelTierSettings {
  const list = settings.tiers[tier];
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return settings;
  const next = cloneTiers(settings);
  const [item] = next.tiers[tier].splice(index, 1);
  next.tiers[tier].splice(target, 0, item);
  return next;
}

/** Цель звена для `ProviderProfileSelect`. */
export function entryTargetChoice(entry: TierModelEntry): ProviderChoice {
  if (entry.profile) return { provider: 'openai-compatible', profile: entry.profile };
  return entry.provider ? { provider: entry.provider } : {};
}

export function entryTargetPatch(choice: ProviderChoice): Pick<TierModelEntry, 'profile' | 'provider'> {
  if (choice.profile) return { profile: choice.profile, provider: undefined };
  if (choice.provider && choice.provider !== 'openai-compatible') return { provider: choice.provider, profile: undefined };
  return { profile: undefined, provider: undefined };
}

/** Каталог профиля в UI: модели, время и ошибка последнего обновления. */
export interface TierCatalogState {
  models: string[];
  fetchedAt: number | null;
  error?: string;
}

export type EntryAvailability =
  /** Модель есть в каталоге или это алиас Claude CLI. */
  | 'ok'
  /** Каталог профиля известен, модели в нём нет — подсветить. */
  | 'missing'
  /** Профиль не найден на этой машине. */
  | 'no_profile'
  /** Проверить нечем: каталога нет (прежний провайдер, Codex/Gemini, пустой кэш). */
  | 'unknown';

export function entryAvailability(
  entry: TierModelEntry,
  profiles: readonly ProfileLike[],
  catalogs: Readonly<Record<string, TierCatalogState | undefined>>
): EntryAvailability {
  if (entry.engine === 'claude-cli') {
    const model = entry.model.trim().toLowerCase();
    return CLAUDE_CLI_ALIASES.includes(model) || model.startsWith('claude-') ? 'ok' : 'unknown';
  }
  if (entry.engine !== 'api' || !entry.profile) return 'unknown';
  const profile = findProfileByRef(entry.profile, profiles);
  if (!profile) return 'no_profile';
  const catalog = catalogs[profile.id];
  if (!catalog || catalog.models.length === 0) return 'unknown';
  return catalog.models.includes(entry.model.trim()) ? 'ok' : 'missing';
}

/** Id профилей, на которые ссылаются звенья API — для загрузки каталогов. */
export function referencedProfileIds(settings: ModelTierSettings, profiles: readonly ProfileLike[]): string[] {
  const ids = new Set<string>();
  for (const tier of TIERS_TOP_DOWN) {
    for (const entry of settings.tiers[tier]) {
      if (entry.engine !== 'api' || !entry.profile) continue;
      const profile = findProfileByRef(entry.profile, profiles);
      if (profile) ids.add(profile.id);
    }
  }
  return [...ids];
}

/** Подсказки поля модели: каталог профиля, алиасы Claude CLI, иначе ничего (ручной ввод). */
export function modelSuggestions(
  entry: TierModelEntry,
  profiles: readonly ProfileLike[],
  catalogs: Readonly<Record<string, TierCatalogState | undefined>>
): string[] {
  if (entry.engine === 'claude-cli') return [...CLAUDE_CLI_ALIASES];
  if (entry.engine !== 'api' || !entry.profile) return [];
  const profile = findProfileByRef(entry.profile, profiles);
  return profile ? catalogs[profile.id]?.models ?? [] : [];
}

export type TierDraftProblem = { tier: ModelTier; index: number; kind: 'empty_model' | 'duplicate' };

/** Проблемы черновика до сохранения: пустая модель и повтор звена (main всё равно отбросит их). */
export function tierDraftProblems(settings: ModelTierSettings): TierDraftProblem[] {
  const problems: TierDraftProblem[] = [];
  const seen = new Set<string>();
  for (const tier of TIERS_TOP_DOWN) {
    settings.tiers[tier].forEach((entry, index) => {
      const model = entry.model.trim();
      if (!model) {
        problems.push({ tier, index, kind: 'empty_model' });
        return;
      }
      const target = entry.engine === 'api' ? (entry.profile ? `p:${entry.profile}` : entry.provider ? `v:${entry.provider}` : 'studio') : '';
      const key = `${entry.engine}|${target.toLocaleLowerCase()}|${model}`;
      if (seen.has(key)) problems.push({ tier, index, kind: 'duplicate' });
      seen.add(key);
    });
  }
  return problems;
}

/** Подпись звена в карточке агента: «qwen2.5:7b · Ollama», «opus · claude-cli», «m · AI Studio». */
export function chainLinkLabel(link: Pick<TierModelEntry, 'engine' | 'model' | 'profile' | 'provider'>): string {
  if (link.engine !== 'api') return `${link.model} · ${link.engine}`;
  return `${link.model} · ${link.profile ?? link.provider ?? 'AI Studio'}`;
}

export function tierEntryCount(settings: ModelTierSettings): number {
  return settings.tiers.cheap.length + settings.tiers.balanced.length + settings.tiers.frontier.length;
}
