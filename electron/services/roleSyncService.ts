/**
 * Синхронизация ролей ProjectHub и хуков терминала в проект (TASK-77, decision-54 п. 2, 3, 10).
 *
 * `planRoleSync` — предпросмотр: какие файлы будут созданы, обновлены, какие правили руками (конфликт), какие
 * чужие (без маркера) и какие остались от удалённых ролей (orphan). `applyRoleSync` пишет по свежему плану:
 * конфликты перезаписываются и orphan удаляются только по явному выбору, чужие файлы не трогаются никогда.
 * Содержимое строит чистый `roleExport.ts`; здесь только файловая система.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ANTIGRAVITY_AGENTS_DIR,
  ANTIGRAVITY_HOOKS_REL_PATH,
  buildRoleExport,
  CLAUDE_AGENTS_DIR,
  CLAUDE_SETTINGS_REL_PATH,
  CODEX_AGENTS_DIR,
  CODEX_HOOKS_REL_PATH,
  hasOurHooks,
  HOOK_SCRIPT_REL_PATH,
  mergeHookSettings,
  planFileWrite,
  planMergedFile,
  readMarker,
  type ExportTarget,
  type FileAction,
  type SkippedRoleExport
} from './roleExport.js';
import { hookScriptFile } from './terminalHookScript.js';
import type { ModelTierSettings } from './modelTiers.js';
import type { RoleDefinition } from './roleTypes.js';

export type RoleSyncFileKind = 'agent' | 'hookScript' | 'hookSettings';

export interface RoleSyncFile {
  relPath: string;
  kind: RoleSyncFileKind;
  target?: ExportTarget;
  roleSlug?: string;
  action: FileAction;
  /** Сгенерированный файл правили руками. */
  modified?: boolean;
  /** Нужное содержимое; null — файл должен исчезнуть (orphan). */
  desired: string | null;
  current: string | null;
  notes: string[];
  /** Почему файл нельзя обновить (невалидный JSON настроек). */
  error?: string;
}

export interface RoleSyncOptions {
  targets: ExportTarget[];
  /** Установить хуки терминала (`false` — снять наши записи и скрипт). */
  hooks: boolean;
  hookTimeoutSec: number;
}

export interface RoleSyncSummary {
  create: number;
  update: number;
  conflict: number;
  orphan: number;
  foreign: number;
  unchanged: number;
  /** В проекте уже есть файлы, сгенерированные ProjectHub. */
  synced: boolean;
  /** Расхождения, которые стоит показать индикатором: только если проект уже синхронизировали. */
  drift: number;
}

export interface RoleSyncPlan {
  projectPath: string;
  options: RoleSyncOptions;
  files: RoleSyncFile[];
  skipped: SkippedRoleExport[];
  summary: RoleSyncSummary;
}

export interface RoleSyncChoices {
  /** Конфликтные файлы, которые разрешено перезаписать. */
  overwrite?: string[];
  /** Orphan-файлы, которые разрешено удалить. */
  deleteOrphans?: string[];
}

export interface RoleSyncResult {
  written: string[];
  deleted: string[];
  skipped: Array<{ relPath: string; reason: string }>;
  plan: RoleSyncPlan;
}

export interface RoleSyncDeps {
  loadRoles(projectPath: string): Promise<{ roles: RoleDefinition[] }>;
  getTiers(): Promise<ModelTierSettings | undefined>;
}

const AGENT_DIRS: Record<ExportTarget, { dir: string; ext: string }> = {
  claude: { dir: CLAUDE_AGENTS_DIR, ext: '.md' },
  codex: { dir: CODEX_AGENTS_DIR, ext: '.toml' },
  antigravity: { dir: ANTIGRAVITY_AGENTS_DIR, ext: '.md' }
};
const HOOK_SETTINGS_PATH: Record<ExportTarget, string> = {
  claude: CLAUDE_SETTINGS_REL_PATH,
  codex: CODEX_HOOKS_REL_PATH,
  antigravity: ANTIGRAVITY_HOOKS_REL_PATH
};

/** Что человеку нужно знать о хуках движка до установки (предпросмотр). */
const HOOK_INSTALL_NOTES: Record<ExportTarget, string[]> = {
  claude: [],
  codex: ['Codex загружает хуки только для доверенного .codex/ и после подтверждения в /hooks'],
  antigravity: [
    'Antigravity считает отказом сбой хука: без Node.js на машине все вызовы инструментов в проекте будут отклонены',
    'хуки работают только в доверенном рабочем каталоге Antigravity',
    'одобрение в ProjectHub не выдаёт разрешение движка в режиме agy -p'
  ]
};

function abs(projectPath: string, relPath: string): string {
  return path.join(projectPath, ...relPath.split('/'));
}

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf-8');
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, file);
}

function summarize(files: RoleSyncFile[]): RoleSyncSummary {
  const count = (a: FileAction) => files.filter((f) => f.action === a).length;
  const synced = files.some((f) => f.current !== null && (f.kind === 'hookSettings' ? hasOurHooks(f.current) : readMarker(f.current) !== null));
  const summary = {
    create: count('create'),
    update: count('update'),
    conflict: count('conflict'),
    orphan: count('orphan'),
    foreign: count('foreign'),
    unchanged: count('unchanged')
  };
  const drift = synced ? summary.create + summary.update + summary.conflict + summary.orphan : 0;
  return { ...summary, synced, drift };
}

async function defaultDeps(): Promise<RoleSyncDeps> {
  return {
    loadRoles: async (projectPath) => (await import('./roleService.js')).loadRoles(projectPath),
    getTiers: async () => {
      try {
        return await (await import('./modelTierService.js')).modelTierService.getSettings();
      } catch {
        return undefined;
      }
    }
  };
}

export async function planRoleSync(projectPath: string, options: RoleSyncOptions, deps?: RoleSyncDeps): Promise<RoleSyncPlan> {
  const d = deps ?? (await defaultDeps());
  const { roles } = await d.loadRoles(projectPath);
  const tiers = await d.getTiers();
  const { files: exported, skipped } = buildRoleExport(roles, options.targets, { tiers });
  const files: RoleSyncFile[] = [];

  const wanted = new Set<string>();
  for (const f of exported) {
    wanted.add(f.relPath);
    const current = await readOrNull(abs(projectPath, f.relPath));
    files.push({ relPath: f.relPath, kind: 'agent', target: f.target, roleSlug: f.roleSlug, desired: f.content, current, notes: f.notes, ...planFileWrite(current, f.content) });
  }

  // Сгенерированные файлы всех движков, которых больше нет в экспорте (роль удалена, движок снят).
  for (const target of Object.keys(AGENT_DIRS) as ExportTarget[]) {
    const { dir, ext } = AGENT_DIRS[target];
    let names: string[];
    try {
      names = await fs.readdir(abs(projectPath, dir));
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (!name.endsWith(ext)) continue;
      const relPath = `${dir}/${name}`;
      if (wanted.has(relPath)) continue;
      const current = await readOrNull(abs(projectPath, relPath));
      if (current === null || !readMarker(current)) continue;
      const marker = readMarker(current);
      files.push({ relPath, kind: 'agent', target, ...(marker?.role ? { roleSlug: marker.role } : {}), desired: null, current, notes: [], ...planFileWrite(current, null) });
    }
  }

  const scriptCurrent = await readOrNull(abs(projectPath, HOOK_SCRIPT_REL_PATH));
  const scriptDesired = options.hooks ? hookScriptFile() : null;
  if (scriptDesired !== null || scriptCurrent !== null) {
    files.push({ relPath: HOOK_SCRIPT_REL_PATH, kind: 'hookScript', desired: scriptDesired, current: scriptCurrent, notes: [], ...planFileWrite(scriptCurrent, scriptDesired) });
  }

  for (const target of Object.keys(HOOK_SETTINGS_PATH) as ExportTarget[]) {
    const relPath = HOOK_SETTINGS_PATH[target];
    const install = options.hooks && options.targets.includes(target);
    const current = await readOrNull(abs(projectPath, relPath));
    if (!install && !hasOurHooks(current)) continue;
    const merged = mergeHookSettings(current, target, { timeoutSec: options.hookTimeoutSec, install });
    const notes = install ? HOOK_INSTALL_NOTES[target] : [];
    if (!merged.ok) {
      files.push({ relPath, kind: 'hookSettings', target, desired: null, current, notes, action: 'conflict', error: merged.error });
      continue;
    }
    files.push({ relPath, kind: 'hookSettings', target, desired: merged.content, current, notes, ...planMergedFile(current, merged.content) });
  }

  return { projectPath, options, files, skipped, summary: summarize(files) };
}

export async function applyRoleSync(projectPath: string, options: RoleSyncOptions, choices: RoleSyncChoices = {}, deps?: RoleSyncDeps): Promise<RoleSyncResult> {
  const plan = await planRoleSync(projectPath, options, deps);
  const overwrite = new Set(choices.overwrite ?? []);
  const deleteOrphans = new Set(choices.deleteOrphans ?? []);
  const written: string[] = [];
  const deleted: string[] = [];
  const skipped: Array<{ relPath: string; reason: string }> = [];

  for (const file of plan.files) {
    const target = abs(projectPath, file.relPath);
    switch (file.action) {
      case 'create':
      case 'update':
        if (file.desired !== null) {
          await writeAtomic(target, file.desired);
          written.push(file.relPath);
        }
        break;
      case 'conflict':
        if (file.error) skipped.push({ relPath: file.relPath, reason: file.error });
        else if (file.desired !== null && overwrite.has(file.relPath)) {
          await writeAtomic(target, file.desired);
          written.push(file.relPath);
        } else skipped.push({ relPath: file.relPath, reason: 'изменён вручную' });
        break;
      case 'orphan':
        if (deleteOrphans.has(file.relPath)) {
          await fs.unlink(target);
          deleted.push(file.relPath);
        } else skipped.push({ relPath: file.relPath, reason: 'роли больше нет' });
        break;
      case 'foreign':
        skipped.push({ relPath: file.relPath, reason: 'файл создан не ProjectHub' });
        break;
      case 'unchanged':
        break;
    }
  }
  if (written.length || deleted.length) {
    console.log(`[RoleSync] ${projectPath}: записано ${written.length}, удалено ${deleted.length}, пропущено ${skipped.length}`);
  }
  return { written, deleted, skipped, plan: await planRoleSync(projectPath, options, deps) };
}
