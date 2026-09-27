/**
 * Секреты в `git commit` терминальной сессии (decision-56 п. 4, TASK-73.3).
 *
 * Хук PreToolUse видит команду до выполнения. `git commit` без добавления файлов коммитит индекс — сканируется
 * staged-дифф. `git commit -a` или цепочка `git add … && git commit` закоммитит ещё не добавленное — тогда
 * сканируются изменения отслеживаемых файлов относительно HEAD и неотслеживаемые файлы (не из `.gitignore`).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { scanDiffForSecrets, type DiffSecretScanResult } from './diffSecretScan.js';

export type CommitScanScope = 'staged' | 'worktree';

const MAX_UNTRACKED_FILES = 200;
const MAX_UNTRACKED_BYTES = 1024 * 1024;

/** Разбивает цепочку оболочки на команды (`&&`, `||`, `;`, `|`, перевод строки) — кавычки не разбираются. */
function segments(command: string): string[] {
  return command.split(/&&|\|\||;|\||\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** `git [-C x] [-c k=v] commit …` — с глобальными опциями git перед подкомандой. */
const GIT_SUB_RE = /^(?:"[^"]*[\\/]git(?:\.exe)?"|(?:\S*[\\/])?git(?:\.exe)?)((?:\s+(?:-C\s+\S+|-c\s+\S+|--[\w-]+(?:=\S+)?))*)\s+(\w[\w-]*)(.*)$/i;

function gitSubcommand(segment: string): { sub: string; args: string } | null {
  const m = segment.match(GIT_SUB_RE);
  return m ? { sub: m[2].toLowerCase(), args: m[3] } : null;
}

/** Что сканировать перед командой; `null` — в команде нет `git commit`. */
export function commitScanScope(command: string): CommitScanScope | null {
  let sawAdd = false;
  for (const seg of segments(command ?? '')) {
    const git = gitSubcommand(seg);
    if (!git) continue;
    if (git.sub === 'add' || git.sub === 'rm' || git.sub === 'mv' || git.sub === 'stage') sawAdd = true;
    if (git.sub === 'commit') {
      if (shellTokens(git.args).includes('--dry-run')) continue;
      return sawAdd || commitIncludesWorktree(git.args) ? 'worktree' : 'staged';
    }
  }
  return null;
}

/** Аргументы с учётом кавычек: `-m "fix all"` — два токена, а не три. */
export function shellTokens(args: string): string[] {
  const tokens: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(args)) !== null) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

/** Опции `git commit`, за которыми идёт значение отдельным токеном. */
const COMMIT_VALUE_OPTS = new Set(['-m', '-F', '-C', '-c', '-t', '--message', '--file', '--reuse-message', '--reedit-message', '--template', '--author', '--date', '--fixup', '--squash', '--cleanup', '--trailer']);

/** Коммитит ли `git commit` неиндексированные изменения: `-a`, `--all`, `-am`. */
export function commitIncludesWorktree(args: string): boolean {
  const tokens = shellTokens(args);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === '--') break;
    if (tok === '--all') return true;
    if (COMMIT_VALUE_OPTS.has(tok)) {
      i++;
      continue;
    }
    if (/^-[A-Za-z]+$/.test(tok)) {
      // Склеенные короткие флаги: всё после буквы со значением (-m, -F, -C, -c, -t) — уже значение.
      for (const ch of tok.slice(1)) {
        if (ch === 'a') return true;
        if ('mFCct'.includes(ch)) break;
      }
    }
  }
  return false;
}

/** Неотслеживаемые текстовые файлы как «новые» в формате патча — для общего сканера. */
async function untrackedAsPatch(cwd: string): Promise<string> {
  const git = simpleGit(cwd);
  const list = (await git.raw(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).slice(0, MAX_UNTRACKED_FILES);
  const parts: string[] = [];
  for (const rel of list) {
    let buf: Buffer;
    try {
      const stat = await fs.stat(path.join(cwd, rel));
      if (!stat.isFile() || stat.size > MAX_UNTRACKED_BYTES) continue;
      buf = await fs.readFile(path.join(cwd, rel));
    } catch {
      continue;
    }
    if (buf.includes(0)) continue;
    const lines = buf.toString('utf8').split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const file = rel.replace(/\\/g, '/');
    parts.push(
      `diff --git a/${file} b/${file}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${file}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((l) => `+${l}`)
    );
  }
  return parts.join('\n');
}

export async function scanPendingCommit(cwd: string, scope: CommitScanScope, allowPaths: string[] = []): Promise<DiffSecretScanResult> {
  const git = simpleGit(cwd);
  let patch: string;
  if (scope === 'staged') {
    patch = await git.diff(['--cached', '--no-color', '--no-ext-diff']);
  } else {
    // Репозиторий без коммитов: HEAD нет — всё содержимое индекса плюс неотслеживаемые.
    const hasHead = await git.raw(['rev-parse', '--verify', '--quiet', 'HEAD']).then((out) => Boolean(out.trim())).catch(() => false);
    const tracked = hasHead ? await git.diff(['HEAD', '--no-color', '--no-ext-diff']) : await git.diff(['--cached', '--no-color', '--no-ext-diff']);
    patch = `${tracked}\n${await untrackedAsPatch(cwd)}`;
  }
  return scanDiffForSecrets(patch, { allowPaths, honorInlineMarker: true });
}
