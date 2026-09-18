/**
 * Выбор провайдера в слоте Swarm, роли и ревьюере Arena и группировка моделей по профилям в AI Studio
 * (TASK-70.5, decision-40). Чистые функции без React — покрыты unit-тестами.
 *
 * Поиск профиля по ссылке повторяет `electron/services/slotProvider.ts::resolveProfileRef` (рендерер не
 * импортирует main-процесс): сначала id, затем имя без учёта регистра, только если оно однозначно.
 * Окончательно ссылку разрешает main-процесс при запуске агента.
 */

export interface ProfileLike {
  id: string;
  name: string;
  local?: boolean;
}

export interface ProviderChoice {
  provider?: string;
  /** Профиль: id (слот) или имя (роль, ревьюер — переносимо между машинами). */
  profile?: string;
}

export const LEGACY_PROVIDER_IDS = ['openrouter', 'deepseek', 'ollama', 'custom'] as const;

export function findProfileByRef(ref: string | undefined, profiles: readonly ProfileLike[]): ProfileLike | undefined {
  const needle = ref?.trim();
  if (!needle) return undefined;
  const byId = profiles.find((p) => p.id === needle);
  if (byId) return byId;
  const lower = needle.toLocaleLowerCase();
  const byName = profiles.filter((p) => p.name.trim().toLocaleLowerCase() === lower);
  return byName.length === 1 ? byName[0] : undefined;
}

/**
 * Значение `<select>`: `''` — как в AI Studio, `provider:<id>`, `profile:<id>`, `missing:<ref>` —
 * ссылка на профиль, которого нет на этой машине (показывается, чтобы не потерять её молча).
 */
export function encodeProviderChoice(choice: ProviderChoice, profiles: readonly ProfileLike[]): string {
  const ref = choice.profile?.trim();
  if (ref) {
    const profile = findProfileByRef(ref, profiles);
    return profile ? `profile:${profile.id}` : `missing:${ref}`;
  }
  if (choice.provider === 'openai-compatible') return 'missing:';
  return choice.provider ? `provider:${choice.provider}` : '';
}

/** Обратное преобразование; `storeProfileAs` — что записать в ссылку: id или имя профиля. */
export function decodeProviderChoice(
  value: string,
  profiles: readonly ProfileLike[],
  storeProfileAs: 'id' | 'name'
): ProviderChoice {
  if (value.startsWith('profile:')) {
    const id = value.slice('profile:'.length);
    const profile = profiles.find((p) => p.id === id);
    const ref = profile ? (storeProfileAs === 'name' ? profile.name : profile.id) : id;
    return { provider: 'openai-compatible', profile: ref };
  }
  if (value.startsWith('missing:')) {
    const ref = value.slice('missing:'.length);
    return ref ? { provider: 'openai-compatible', profile: ref } : { provider: 'openai-compatible' };
  }
  if (value.startsWith('provider:')) return { provider: value.slice('provider:'.length) };
  return {};
}

export interface SlotProvider {
  provider?: 'anthropic' | 'openrouter' | 'deepseek' | 'ollama' | 'custom' | 'openai-compatible';
  profileId?: string;
  model?: string;
}

const PROVIDER_IDS = ['anthropic', ...LEGACY_PROVIDER_IDS, 'openai-compatible'] as const;

/**
 * Провайдер слота из роли: профиль важнее провайдера, ссылка на профиль сохраняется как id, если
 * профиль найден на этой машине (иначе как есть — main-процесс вернёт понятную ошибку). Роль без
 * провайдера и модели — `undefined` (настройки AI Studio); только с моделью — модель без провайдера.
 */
export function slotProviderFromRole(
  role: { provider?: string; profile?: string; model?: string },
  profiles: readonly ProfileLike[]
): SlotProvider | undefined {
  const model = role.model?.trim() || undefined;
  const ref = role.profile?.trim();
  if (ref) {
    return { provider: 'openai-compatible', profileId: findProfileByRef(ref, profiles)?.id ?? ref, ...(model ? { model } : {}) };
  }
  const provider = role.provider?.trim();
  if (provider && (PROVIDER_IDS as readonly string[]).includes(provider)) {
    return { provider: provider as SlotProvider['provider'], ...(model ? { model } : {}) };
  }
  return model ? { model } : undefined;
}

/** Выбор в селекторе → провайдер слота; модель сохраняется, только если провайдер не менялся. */
export function slotProviderFromChoice(choice: ProviderChoice, current: SlotProvider | undefined): SlotProvider | undefined {
  const sameTarget =
    (choice.provider ?? undefined) === (current?.provider ?? undefined) && (choice.profile ?? undefined) === (current?.profileId ?? undefined);
  const model = sameTarget ? current?.model : undefined;
  if (!choice.provider && !choice.profile) return model ? { model } : undefined;
  return {
    provider: (choice.profile ? 'openai-compatible' : choice.provider) as SlotProvider['provider'],
    ...(choice.profile ? { profileId: choice.profile } : {}),
    ...(model ? { model } : {})
  };
}

export interface ModelOption {
  id: string;
  name?: string;
  description?: string;
  badge?: string;
  family?: string;
}

export interface ModelGroup {
  /** `claude-cli` или id профиля. */
  key: string;
  label: string;
  local?: boolean;
  models: ModelOption[];
  /** Состояние каталога профиля: загрузка или текст ошибки. */
  loading?: boolean;
  error?: string;
}

/** Фильтр групп по строке поиска: id, имя, описание модели или имя профиля. Пустые группы остаются только без запроса. */
export function filterModelGroups(groups: readonly ModelGroup[], query: string): ModelGroup[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return groups.map((g) => ({ ...g }));
  const out: ModelGroup[] = [];
  for (const g of groups) {
    const groupMatches = g.label.toLocaleLowerCase().includes(q);
    const models = groupMatches
      ? g.models
      : g.models.filter((m) =>
          [m.id, m.name, m.description].some((v) => typeof v === 'string' && v.toLocaleLowerCase().includes(q))
        );
    if (models.length > 0) out.push({ ...g, models });
  }
  return out;
}

/** Группы моделей по профилям: локальные профили первыми, затем по имени. */
export function sortProfilesForMenu<T extends ProfileLike>(profiles: readonly T[]): T[] {
  return [...profiles].sort((a, b) => {
    if (Boolean(a.local) !== Boolean(b.local)) return a.local ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
