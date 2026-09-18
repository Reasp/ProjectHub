import React from 'react';
import { useTranslation } from '../../i18n/useTranslation';
import { REASONING_EFFORT_OPTIONS, parseReasoningEffort, type EffortTargetKind, type ReasoningEffort } from '../../lib/reasoningEffort';

const HINT_KEYS: Record<EffortTargetKind, 'hintClaudeCli' | 'hintAnthropicApi' | 'hintOpenAICompatible' | 'hintNotSent' | 'hintCliIgnored' | 'hintStudio'> = {
  'claude-cli': 'hintClaudeCli',
  'anthropic-api': 'hintAnthropicApi',
  'openai-compatible': 'hintOpenAICompatible',
  'not-sent': 'hintNotSent',
  'cli-ignored': 'hintCliIgnored',
  studio: 'hintStudio'
};

/**
 * Выбор усилия рассуждений (TASK-70.3, decision-41): «по умолчанию модели» и шкала `none…max`.
 * Подсказка объясняет, куда уйдёт значение у выбранного провайдера или движка.
 */
export const ReasoningEffortSelect: React.FC<{
  value: ReasoningEffort | undefined;
  onChange: (effort: ReasoningEffort | undefined) => void;
  target: EffortTargetKind;
  className?: string;
  /** Компактный вид (слот Swarm): подсказка — во всплывающем title. */
  compact?: boolean;
}> = ({ value, onChange, target, className, compact }) => {
  const { t } = useTranslation();
  const l = t.reasoningEffort;
  const hint = l[HINT_KEYS[target]];
  const select = (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(parseReasoningEffort(e.target.value))}
      className={className}
      title={compact ? `${l.slotTitle}. ${hint}` : undefined}
      aria-label={l.label}
      data-testid="reasoning-effort-select"
    >
      <option value="">{compact ? `${l.shortLabel}: ${l.modelDefaultShort}` : l.modelDefault}</option>
      {REASONING_EFFORT_OPTIONS.map((effort) => (
        <option key={effort} value={effort} disabled={effort === 'none' && target === 'claude-cli'}>
          {compact ? `${l.shortLabel}: ${l[effort].toLocaleLowerCase()}` : l[effort]}
        </option>
      ))}
    </select>
  );
  if (compact) return select;
  return (
    <div>
      {select}
      <p className="mt-1 text-[10px] text-slate-400 leading-relaxed">{hint}</p>
    </div>
  );
};
