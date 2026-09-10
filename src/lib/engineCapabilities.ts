import type { RoleDefinition, RoleEngine } from '../types/electron';

/**
 * Зеркало `electron/services/roleEngineAdapter.ts::ENGINE_CAPABILITIES` для UI-предупреждений
 * (decision-9 п.2, TASK-60) — рендерер не импортирует main-процесс, поэтому таблица продублирована
 * здесь в минимальном виде. При изменении адаптера держать в синхроне.
 */
export const ENGINE_CAPABILITIES: Record<RoleEngine, { tools: boolean; maxTurns: boolean }> = {
  'claude-cli': { tools: true, maxTurns: true },
  'codex-cli': { tools: false, maxTurns: false },
  'gemini-cli': { tools: false, maxTurns: false },
  api: { tools: true, maxTurns: false }
};

/** Список читаемых предупреждений: что роль просит, но выбранный движок не умеет нативно. */
export function unsupportedRoleFeatures(engine: RoleEngine, role: RoleDefinition | undefined): string[] {
  if (!role) return [];
  const caps = ENGINE_CAPABILITIES[engine];
  const warnings: string[] = [];
  if (role.tools && role.tools.length > 0 && !caps.tools) warnings.push('ограничение набора инструментов');
  if (role.maxTurns && role.maxTurns > 0 && !caps.maxTurns) warnings.push('лимит ходов');
  return warnings;
}
