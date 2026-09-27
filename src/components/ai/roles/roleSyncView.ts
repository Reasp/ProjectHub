/**
 * Чистые функции панели синхронизации ролей (TASK-77): без React и Electron, покрыты unit-тестами.
 */
import type { RoleSyncFile, RoleSyncOptionsInput, RoleSyncPlan } from '../../../types/electron';

const MARKER = 'projecthub:generated';

function generated(file: RoleSyncFile): boolean {
  return file.current !== null && file.current.includes(MARKER);
}

/**
 * Опции синхронизации по файлам проекта (предпросмотр со всеми движками и хуками): какие движки и хуки уже
 * синхронизированы. Проект без сгенерированных файлов — Claude Code с хуками (Codex не проверен вживую).
 */
export function inferSyncOptions(probe: Pick<RoleSyncPlan, 'files'>): RoleSyncOptionsInput {
  const claude = probe.files.some((f) => f.kind === 'agent' && f.target === 'claude' && generated(f));
  const codex = probe.files.some((f) => f.kind === 'agent' && f.target === 'codex' && generated(f));
  const hooks = probe.files.some((f) => f.kind === 'hookScript' && generated(f));
  if (!claude && !codex && !hooks) return { targets: ['claude'], hooks: true };
  const targets: RoleSyncOptionsInput['targets'] = [];
  if (claude || !codex) targets.push('claude');
  if (codex) targets.push('codex');
  return { targets, hooks };
}

export const DEFAULT_HOOK_URL = 'http://127.0.0.1:42042';

/** Команды установки переменных окружения хуков для внешнего терминала. Токен — только в окружении. */
export function hookEnvSnippets(connection: { url: string | null; token: string; failMode: 'open' | 'closed' }): { powershell: string; bash: string } {
  const url = connection.url || DEFAULT_HOOK_URL;
  const vars: Array<[string, string]> = [
    ['PROJECTHUB_HOOK_URL', url],
    ['PROJECTHUB_HOOK_TOKEN', connection.token],
    ['PROJECTHUB_HOOK_FAIL_MODE', connection.failMode]
  ];
  return {
    powershell: vars.map(([k, v]) => `$env:${k} = "${v}"`).join('; '),
    bash: `export ${vars.map(([k, v]) => `${k}="${v}"`).join(' ')}`
  };
}
