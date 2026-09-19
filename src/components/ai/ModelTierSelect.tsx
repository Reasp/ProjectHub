import React from 'react';
import type { ModelTier } from '../../types/electron';
import { useTranslation } from '../../i18n/useTranslation';
import { TIERS_TOP_DOWN } from '../../lib/modelTierEditor';

interface ModelTierSelectProps {
  value: ModelTier | undefined;
  onChange: (tier: ModelTier | undefined) => void;
  className?: string;
}

/** Тир модели слота или роли (TASK-79, decision-44): «без тира» или cheap/balanced/frontier. */
export const ModelTierSelect: React.FC<ModelTierSelectProps> = ({ value, onChange, className }) => {
  const { t } = useTranslation();
  const l = t.modelTiers;
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || undefined) as ModelTier | undefined)}
      title={`${l.selectLabel}: ${l.selectHint}`}
      aria-label={l.selectLabel}
      data-testid="model-tier-select"
      className={className ?? 'px-2 py-1 rounded-sm border border-border bg-background text-foreground text-xs'}
    >
      <option value="">{l.selectNone}</option>
      {TIERS_TOP_DOWN.map((tier) => (
        <option key={tier} value={tier}>
          {l.tier[tier]} ({tier})
        </option>
      ))}
    </select>
  );
};
