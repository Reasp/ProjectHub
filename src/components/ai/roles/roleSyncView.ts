/**
 * Чистые функции панели синхронизации ролей (TASK-77): без React и Electron, покрыты unit-тестами.
 */
import type { RoleExportTarget, RoleSyncFile, RoleSyncOptionsInput, RoleSyncPlan } from '../../../types/electron';

const MARKER = 'projecthub:generated';
/** Скрипт хуков в командах настроек движков: у `.agents/hooks.json` маркера нет, наш — ключ с этим скриптом. */
const HOOK_SCRIPT = 'projecthub-hook.mjs';

function generated(file: RoleSyncFile): boolean {
  if (file.current === null) return false;
  return file.kind === 'hookSettings' ? file.current.includes(HOOK_SCRIPT) : file.current.includes(MARKER);
}

/**
 * Опции синхронизации по файлам проекта (предпросмотр со всеми движками и хуками): какие движки и хуки уже
 * синхронизированы. Проект без сгенерированных файлов — Claude Code с хуками (Codex не проверен вживую, Antigravity
 * включается явно: его хуки при сбое отклоняют вызовы).
 */
export function inferSyncOptions(probe: Pick<RoleSyncPlan, 'files'>): RoleSyncOptionsInput {
  const synced = (target: RoleExportTarget) => probe.files.some((f) => f.kind === 'agent' && f.target === target && generated(f));
  const claude = synced('claude');
  const codex = synced('codex');
  const antigravity = synced('antigravity') || probe.files.some((f) => f.kind === 'hookSettings' && f.target === 'antigravity' && generated(f));
  const hooks = probe.files.some((f) => f.kind === 'hookScript' && generated(f));
  if (!claude && !codex && !antigravity && !hooks) return { targets: ['claude'], hooks: true };
  const targets: RoleSyncOptionsInput['targets'] = [];
  if (claude || (!codex && !antigravity)) targets.push('claude');
  if (codex) targets.push('codex');
  if (antigravity) targets.push('antigravity');
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
