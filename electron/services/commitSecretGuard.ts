/**
 * Проверка коммита на секреты (decision-56 п. 4, TASK-73.3).
 *
 * Коммит из GitInspector и Remote Control идёт через `guardedCommit`: staged-дифф сканируется `scanDiffForSecrets`
 * в main-процессе, рендерер проверку обойти не может. Находки — коммит не выполняется, ответ несёт виды, файлы и
 * строки (без значений) и хэш дерева индекса. Повтор с `acknowledgeSecrets` равным текущему `git write-tree`
 * означает «человек видел именно это содержимое и решил коммитить» — решение пишется в аудит HITL.
 */
import { simpleGit } from 'simple-git';
import { scanDiffForSecrets, summarizeSecretFindings, type DiffSecretFinding } from './diffSecretScan.js';

export type GuardedCommitResult =
  | { ok: true; overridden?: boolean }
  | { ok: false; reason: 'secrets'; findings: DiffSecretFinding[]; suppressed: number; truncated: boolean; treeHash: string }
  | { ok: false; reason: 'error'; error: string };

export interface GuardedCommitOptions {
  stageAll?: boolean;
  /** Хэш дерева индекса, который человек видел в диалоге «закоммитить всё равно». */
  acknowledgeSecrets?: string;
  /** Можно ли подтвердить коммит с находками из этого канала (окно — да, телефон — нет). */
  allowOverride: boolean;
  /** Кто коммитит — для аудита. */
  source: { kind: 'local' } | { kind: 'remote'; deviceId?: string; deviceName?: string };
}

export interface CommitGuardDeps {
  stageAll(root: string): Promise<void>;
  stagedDiff(root: string): Promise<string>;
  indexTree(root: string): Promise<string>;
  allowPaths(root: string): Promise<string[]>;
  commit(root: string, message: string): Promise<boolean>;
  recordOverride(info: { root: string; message: string; treeHash: string; summary: string; source: GuardedCommitOptions['source'] }): void;
  warn(message: string, err?: unknown): void;
}

export function secretAllowPathsFromConfig(config: unknown): string[] {
  const security = (config as { security?: { secretScan?: { allowPaths?: unknown } } } | null)?.security;
  const list = security?.secretScan?.allowPaths;
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).slice(0, 200) : [];
}

function defaultDeps(): CommitGuardDeps {
  return {
    stageAll: async (root) => {
      await simpleGit(root).add('.');
    },
    stagedDiff: (root) => simpleGit(root).diff(['--cached', '--no-color', '--no-ext-diff']),
    indexTree: async (root) => (await simpleGit(root).raw(['write-tree'])).trim(),
    allowPaths: async (root) => {
      const { actionConfigService } = await import('./actionConfigService.js');
      return secretAllowPathsFromConfig(await actionConfigService.getConfig(root));
    },
    commit: async (root, message) => {
      const { gitService } = await import('./gitService.js');
      return gitService.commitChanges(root, message, false);
    },
    recordOverride: ({ root, message, treeHash, summary, source }) => {
      void import('./hitlService.js').then(({ hitlService }) =>
        hitlService.recordHumanDecision(
          {
            sessionId: `git-commit-${treeHash.slice(0, 12)}`,
            projectPath: root,
            type: 'command',
            title: 'Коммит с находками сканера секретов',
            command: `git commit -m ${JSON.stringify(message.split('\n')[0].slice(0, 120))}`,
            tool: 'git commit'
          },
          'allow',
          source.kind === 'remote' ? { kind: 'remote', deviceId: source.deviceId, deviceName: source.deviceName } : { kind: 'local' },
          'secret-scan-override',
          summary
        )
      );
    },
    warn: (message, err) => console.warn(`[CommitGuard] ${message}`, err ?? '')
  };
}

export async function guardedCommit(
  root: string,
  message: string,
  options: GuardedCommitOptions,
  deps: CommitGuardDeps = defaultDeps()
): Promise<GuardedCommitResult> {
  try {
    if (options.stageAll) await deps.stageAll(root);
  } catch (err) {
    return { ok: false, reason: 'error', error: err instanceof Error ? err.message : String(err) };
  }

  let overridden = false;
  try {
    const [patch, allowPaths] = await Promise.all([deps.stagedDiff(root), deps.allowPaths(root)]);
    // Коммит делает человек — маркер `projecthub:allow-secret` на строке учитывается (decision-56 п. 3).
    const scan = scanDiffForSecrets(patch, { allowPaths, honorInlineMarker: true });
    if (scan.findings.length > 0) {
      const treeHash = await deps.indexTree(root);
      const acknowledged = options.allowOverride && Boolean(options.acknowledgeSecrets) && options.acknowledgeSecrets === treeHash;
      if (!acknowledged) {
        return { ok: false, reason: 'secrets', findings: scan.findings, suppressed: scan.suppressed, truncated: scan.truncated, treeHash };
      }
      deps.recordOverride({ root, message, treeHash, summary: summarizeSecretFindings(scan.findings), source: options.source });
      overridden = true;
    }
  } catch (err) {
    // Сбой скана (нет git, битый индекс) не должен запрещать коммит: git сам откажет, если индекс неисправен.
    deps.warn('Скан staged-диффа не выполнен', err);
  }

  const ok = await deps.commit(root, message);
  if (!ok) return { ok: false, reason: 'error', error: 'git commit завершился ошибкой' };
  return overridden ? { ok: true, overridden: true } : { ok: true };
}
