import React, { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n';
import {
  LEGACY_PROVIDER_IDS,
  decodeProviderChoice,
  encodeProviderChoice,
  findProfileByRef,
  sortProfilesForMenu,
  type ProviderChoice
} from '../../lib/providerSelect';
import type { LlmProfileView } from '../../types/electron';

/** Профили OpenAI-совместимых провайдеров (без ключей) — для селекторов слота, роли и ревьюера. */
export function useLlmProfiles(enabled = true): LlmProfileView[] {
  const [profiles, setProfiles] = useState<LlmProfileView[]>([]);
  useEffect(() => {
    if (!enabled || !window.api?.listLlmProfiles) return;
    let cancelled = false;
    window.api
      .listLlmProfiles()
      .then((list) => {
        if (!cancelled) setProfiles(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return profiles;
}

/** Каталог моделей профиля (кэш main-процесса) — подсказки для поля модели. */
export function useProfileModels(profileRef: string | undefined, profiles: readonly LlmProfileView[]): string[] {
  const profileId = findProfileByRef(profileRef, profiles)?.id;
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    if (!profileId || !window.api?.listLlmProfileModels) {
      setModels([]);
      return;
    }
    let cancelled = false;
    window.api
      .listLlmProfileModels(profileId)
      .then((res) => {
        if (!cancelled) setModels(res.models);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);
  return models;
}

interface ProviderProfileSelectProps {
  value: ProviderChoice;
  onChange: (next: ProviderChoice) => void;
  profiles: readonly LlmProfileView[];
  /** Слот хранит id профиля, роль и ревьюер — имя (id профиля свой на каждой машине, decision-40). */
  storeProfileAs: 'id' | 'name';
  className?: string;
}

/**
 * Провайдер слота Swarm, роли или ревьюера Arena: «как в AI Studio», Anthropic, профили
 * OpenAI-совместимых провайдеров и — для совместимости — прежние провайдеры.
 */
export const ProviderProfileSelect: React.FC<ProviderProfileSelectProps> = ({
  value,
  onChange,
  profiles,
  storeProfileAs,
  className
}) => {
  const { t } = useTranslation();
  const p = t.providerSelect;
  const encoded = encodeProviderChoice(value, profiles);
  const sorted = sortProfilesForMenu(profiles);

  return (
    <select
      value={encoded}
      onChange={(e) => onChange(decodeProviderChoice(e.target.value, profiles, storeProfileAs))}
      title={p.hint}
      aria-label={p.label}
      className={className ?? 'px-2 py-1 rounded-sm border border-border bg-background text-foreground text-xs'}
    >
      <option value="">{p.aiStudioDefault}</option>
      <option value="provider:anthropic">{p.anthropic}</option>
      {encoded.startsWith('missing:') && (
        <option value={encoded}>{p.missingProfile.replace('{name}', encoded.slice('missing:'.length) || '?')}</option>
      )}
      {sorted.length > 0 && (
        <optgroup label={p.profilesGroup}>
          {sorted.map((profile) => (
            <option key={profile.id} value={`profile:${profile.id}`}>
              {profile.name}
              {profile.local ? ` · ${p.local}` : ''}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={p.legacyGroup}>
        {LEGACY_PROVIDER_IDS.map((id) => (
          <option key={id} value={`provider:${id}`}>
            {id}
          </option>
        ))}
      </optgroup>
    </select>
  );
};
