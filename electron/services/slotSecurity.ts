/**
 * Безопасность результата слота Swarm (decision-56 п. 5–7, TASK-73.4).
 *
 * По патчу слота: секреты в добавленных строках (маркер `projecthub:allow-secret` в диффе агента не действует —
 * агент не может сам себе разрешить), изменения зависимостей между базовой веткой и worktree, новые пакеты
 * lock-файла и метаданные registry. Из отчёта выводятся вход компонента `security` и текст запроса HITL.
 */
import path from 'node:path';
import { scanDiffForSecrets, summarizeSecretFindings, unquoteGitPath, type DiffSecretFinding } from './diffSecretScan.js';
import {
  dependencyFilesInDiff,
  diffLockPackages,
  diffManifestDependencies,
  diffRequirements,
  registryLookupSpec,
  resolvedLockVersion,
  reviewableChanges,
  riskFlags,
  riskyChanges,
  summarizeDependencyChanges,
  type DependencyChange,
  type LockChange,
  type RegistryMeta
} from './dependencyDiff.js';
import type { CandidateSecurityInput } from './arenaScoring.js';

export interface AgentSlotSecurity {
  scannedAt: number;
  /** HEAD worktree на момент скана: ветка сдвинулась — перед слиянием отчёт пересчитывается. */
  headSha?: string;
  secrets: DiffSecretFinding[];
  secretsSuppressed: number;
  secretsTruncated?: boolean;
  dependencies: DependencyChange[];
  lockChanges: LockChange[];
  /** `done` — запросы выполнены, `partial` — часть не удалась, `disabled` — выключены, `none` — проверять нечего. */
  registry: 'done' | 'partial' | 'disabled' | 'none' | 'pending';
  /** Ключ последнего опубликованного `security:finding` — одно уведомление на состояние. */
  notifiedKey?: string;
}

export interface SlotSecurityDeps {
  /** Содержимое файла в базовой ветке основного репозитория; `null` — файла нет. */
  showBaseFile(projectPath: string, baseBranch: string, relPath: string): Promise<string | null>;
  /** Файл в worktree кандидата; `null` — файла нет (удалён). */
  readWorktreeFile(worktreePath: string, relPath: string): Promise<string | null>;
  headSha(worktreePath: string): Promise<string | undefined>;
  /** `security.secretScan.allowPaths` из `.projecthub.json` основного дерева. */
  allowPaths(projectPath: string): Promise<string[]>;
  registryLookupsEnabled(): Promise<boolean>;
  lookupRegistry(cwd: string, specs: string[]): Promise<Map<string, RegistryMeta>>;
  now(): number;
}

/** Пути новых версий файлов из заголовков `diff --git` (с разбором кавычек git). */
export function filesInPatch(patch: string): string[] {
  const files: string[] = [];
  for (const line of (patch ?? '').split('\n')) {
    if (!line.startsWith('diff --git ')) continue;
    const rest = line.slice('diff --git '.length).replace(/\r$/, '');
    const quoted = rest.match(/"b\/(?:[^"\\]|\\.)*"$/);
    const file = quoted ? unquoteGitPath(quoted[0]).replace(/^b\//, '') : rest.slice(rest.lastIndexOf(' b/') + 3);
    if (file && !files.includes(file)) files.push(file);
  }
  return files;
}

function posixDir(rel: string): string {
  const dir = path.posix.dirname(rel.replace(/\\/g, '/'));
  return dir === '.' ? '' : dir;
}

/** Без worktree отчёт не строится: изменения зависимостей сравниваются по файлам, а не по кускам патча. */
export async function computeSlotSecurity(
  input: { projectPath: string; baseBranch: string; worktreePath: string; patch: string },
  deps: SlotSecurityDeps
): Promise<AgentSlotSecurity> {
  const { projectPath, baseBranch, worktreePath, patch } = input;
  const scan = scanDiffForSecrets(patch, { allowPaths: await deps.allowPaths(projectPath).catch(() => []), honorInlineMarker: false });
  const files = dependencyFilesInDiff(filesInPatch(patch));

  const lockText = new Map<string, string | null>();
  const readLock = async (rel: string) => {
    if (!lockText.has(rel)) lockText.set(rel, await deps.readWorktreeFile(worktreePath, rel).catch(() => null));
    return lockText.get(rel) ?? null;
  };

  const dependencies: DependencyChange[] = [];
  for (const manifest of files.manifests) {
    const [base, head] = await Promise.all([
      deps.showBaseFile(projectPath, baseBranch, manifest).catch(() => null),
      deps.readWorktreeFile(worktreePath, manifest).catch(() => null)
    ]);
    const changes = diffManifestDependencies(manifest, base, head);
    const dir = posixDir(manifest);
    // Версия из lock рядом с манифестом или из корневого lock рабочих областей npm.
    const localLock = await readLock(path.posix.join(dir, 'package-lock.json'));
    const rootLock = dir ? await readLock('package-lock.json') : null;
    for (const change of changes) {
      if (change.kind === 'removed') continue;
      const resolved = resolvedLockVersion(localLock, change.name) ?? resolvedLockVersion(rootLock, change.name, dir);
      if (resolved) change.resolved = resolved;
    }
    dependencies.push(...changes);
  }
  for (const req of files.requirements) {
    const [base, head] = await Promise.all([
      deps.showBaseFile(projectPath, baseBranch, req).catch(() => null),
      deps.readWorktreeFile(worktreePath, req).catch(() => null)
    ]);
    dependencies.push(...diffRequirements(req, base, head));
  }
  const lockChanges: LockChange[] = [];
  for (const lock of files.locks) {
    const base = await deps.showBaseFile(projectPath, baseBranch, lock).catch(() => null);
    const change = diffLockPackages(lock, base, await readLock(lock));
    if (change) lockChanges.push(change);
  }

  const specs = new Map<DependencyChange, string>();
  for (const change of dependencies) {
    const spec = registryLookupSpec(change);
    if (spec) specs.set(change, spec);
  }
  let registry: AgentSlotSecurity['registry'] = specs.size === 0 ? 'none' : 'pending';
  if (specs.size > 0 && !(await deps.registryLookupsEnabled().catch(() => false))) registry = 'disabled';

  return {
    scannedAt: deps.now(),
    headSha: await deps.headSha(worktreePath).catch(() => undefined),
    secrets: scan.findings,
    secretsSuppressed: scan.suppressed,
    ...(scan.truncated ? { secretsTruncated: true } : {}),
    dependencies,
    lockChanges,
    registry
  };
}

/** Метаданные registry для отчёта (второй шаг: сеть, может идти после показа результата). */
export async function enrichSlotSecurityFromRegistry(
  report: AgentSlotSecurity,
  worktreePath: string,
  deps: Pick<SlotSecurityDeps, 'lookupRegistry' | 'now'>
): Promise<AgentSlotSecurity> {
  if (report.registry !== 'pending') return report;
  const specs = new Map<DependencyChange, string>();
  for (const change of report.dependencies) {
    const spec = registryLookupSpec(change);
    if (spec) specs.set(change, spec);
  }
  let metas: Map<string, RegistryMeta>;
  try {
    metas = await deps.lookupRegistry(worktreePath, [...new Set(specs.values())]);
  } catch {
    return { ...report, registry: 'partial' };
  }
  const now = deps.now();
  let failed = 0;
  const dependencies = report.dependencies.map((change) => {
    const spec = specs.get(change);
    if (!spec) return change;
    const meta = metas.get(spec);
    if (!meta || meta.error) {
      failed++;
      return meta ? { ...change, registry: meta } : change;
    }
    const flags = riskFlags(meta, now);
    return { ...change, registry: meta, ...(flags.length ? { flags } : {}) };
  });
  return { ...report, dependencies, registry: failed > 0 ? 'partial' : 'done' };
}

/** Вход компонента `security` балла (decision-56 п. 6). */
export function securityScoreInput(report: AgentSlotSecurity | undefined): CandidateSecurityInput | undefined {
  if (!report) return undefined;
  return {
    secrets: report.secrets.length,
    riskyDependencies: riskyChanges(report.dependencies).length,
    dependencyChanges: reviewableChanges(report.dependencies).length
  };
}

/** Нужно ли решение человека при слиянии: секреты или новые/изменённые зависимости. */
export function mergeNeedsApproval(report: AgentSlotSecurity | undefined): boolean {
  if (!report) return false;
  return report.secrets.length > 0 || reviewableChanges(report.dependencies).length > 0;
}

/** Часть отчёта, относящаяся к выбранным файлам (сборка результата из файлов кандидатов). */
export function securityForFiles(report: AgentSlotSecurity | undefined, files: string[]): AgentSlotSecurity | undefined {
  if (!report) return undefined;
  const set = new Set(files.map((f) => f.replace(/\\/g, '/')));
  return {
    ...report,
    secrets: report.secrets.filter((s) => set.has(s.file)),
    dependencies: report.dependencies.filter((d) => set.has(d.manifest)),
    lockChanges: report.lockChanges.filter((l) => set.has(l.manifest))
  };
}

/** Заголовок и подробности запроса HITL при слиянии — без значений секретов. */
export function mergeApprovalText(report: AgentSlotSecurity, candidate: string, target: string): { title: string; details: string } {
  const deps = reviewableChanges(report.dependencies);
  const title = `Слить кандидата «${candidate}» в ${target}: секретов ${report.secrets.length}, пакетов ${deps.length}`;
  const lines: string[] = [];
  if (report.secrets.length) lines.push(`Секреты (значения скрыты): ${summarizeSecretFindings(report.secrets, 6)}`);
  if (deps.length) lines.push(`Зависимости: ${summarizeDependencyChanges(deps, 12)}`);
  for (const lock of report.lockChanges) lines.push(`${lock.manifest}: +${lock.added} пакетов (${lock.sample.slice(0, 6).join(', ')})`);
  if (report.registry === 'disabled') lines.push('Проверка пакетов в registry выключена в настройках Security Health.');
  if (report.registry === 'partial') lines.push('Метаданные registry получены не для всех пакетов.');
  // Карточка HITL в окне сворачивает переводы строк — точка в конце строки сохраняет границы пунктов.
  return { title, details: lines.map((l) => (l.endsWith('.') ? l : `${l}.`)).join('\n') };
}

/** Короткая сводка для ревьюера и лога. */
export function securitySummaryText(report: AgentSlotSecurity | undefined): string {
  if (!report) return 'дифф на секреты и зависимости не проверялся';
  const parts: string[] = [];
  parts.push(report.secrets.length ? `секреты: ${summarizeSecretFindings(report.secrets, 4)}` : 'секретов нет');
  const deps = reviewableChanges(report.dependencies);
  parts.push(deps.length ? `зависимости: ${summarizeDependencyChanges(deps, 8)}` : 'новых зависимостей нет');
  for (const lock of report.lockChanges) parts.push(`${lock.manifest}: +${lock.added} пакетов`);
  return parts.join('; ');
}

/**
 * Ключ состояния для уведомления: одно событие на агента и набор находок. При секретах ключ зависит только от них —
 * флаги registry, пришедшие позже фоном, не порождают второе уведомление о том же диффе (живая проверка TASK-73.6).
 */
export function securityNotifyKey(agentId: string, report: AgentSlotSecurity): string | null {
  if (report.secrets.length > 0) {
    return `${agentId}|secrets|${report.secrets.map((s) => `${s.kind}@${s.file}:${s.line ?? ''}`).sort().join(',')}`.slice(0, 500);
  }
  const risky = riskyChanges(report.dependencies);
  if (risky.length === 0) return null;
  return `${agentId}|deps|${risky.map((d) => `${d.name}:${(d.flags ?? []).join('+')}`).sort().join(',')}`.slice(0, 500);
}
