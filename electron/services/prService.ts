import path from 'node:path';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { simpleGit } from 'simple-git';
import matter from 'gray-matter';
import type { PullRequest, PRCreateOptions, PRProviderInfo } from '../../src/types/electron';
import { findTaskFile } from './taskFileLookup.js';
import { normalizeFrontmatter, withUpdatedDate } from './backlogTaskFormat.js';
import { appEventBus } from './eventBus.js';
import os from 'node:os';
import { parseGhPrList, type PrInfo } from './prSnapshot.js';
import { ghCommentArgs } from './prReviewFormat.js';

/** PR для ревью (TASK-81): голова, ветки и описание. */
export interface PrReviewTarget {
  number: number;
  title: string;
  body: string;
  url: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  draft: boolean;
  state: string;
}

const execFileAsync = promisify(execFile);

class PRService {
  private async runGh(args: string[], cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('gh', args, {
        cwd,
        env: { ...process.env, GH_PAGER: 'cat' }
      });
      return stdout.trim();
    } catch (err: any) {
      throw new Error(err.stderr || err.message || 'Ошибка выполнения GitHub CLI', { cause: err });
    }
  }

  private async isGhAvailable(): Promise<boolean> {
    try {
      await execFileAsync('gh', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async getProviderInfo(projectPath: string): Promise<PRProviderInfo> {
    try {
      const gitDir = path.join(projectPath, '.git');
      if (!existsSync(gitDir)) {
        return { provider: 'none', hasCli: false, authenticated: false };
      }

      const git = simpleGit(projectPath);
      const remotes = await git.getRemotes(true);
      const origin = remotes.find((r) => r.name === 'origin') || remotes[0];

      if (!origin || !origin.refs.fetch) {
        return { provider: 'none', hasCli: false, authenticated: false };
      }

      const url = origin.refs.fetch;
      const isGitHub = url.includes('github.com');
      const isGitLab = url.includes('gitlab.com');

      let repo = '';
      if (isGitHub) {
        const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
        if (match) repo = match[1];
      } else if (isGitLab) {
        const match = url.match(/gitlab\.com[:/](.+?)(?:\.git)?$/);
        if (match) repo = match[1];
      }

      const hasCli = await this.isGhAvailable();
      let authenticated = false;

      if (hasCli && isGitHub) {
        try {
          await this.runGh(['auth', 'status'], projectPath);
          authenticated = true;
        } catch {
          authenticated = false;
        }
      }

      return {
        provider: isGitHub ? 'github' : isGitLab ? 'gitlab' : 'none',
        repo: repo || undefined,
        remoteUrl: url,
        hasCli,
        authenticated
      };
    } catch (e) {
      console.error(`Failed to get PR provider info for ${projectPath}:`, e);
      return { provider: 'none', hasCli: false, authenticated: false };
    }
  }

  async listPullRequests(
    projectPath: string,
    state: 'all' | 'open' | 'closed' | 'merged' = 'open'
  ): Promise<PullRequest[]> {
    try {
      const provider = await this.getProviderInfo(projectPath);

      if (provider.provider === 'github' && provider.hasCli) {
        let ghState = 'open';
        if (state === 'all') ghState = 'all';
        else if (state === 'closed') ghState = 'closed';
        else if (state === 'merged') ghState = 'merged';

        const jsonFields = [
          'number',
          'title',
          'state',
          'url',
          'author',
          'createdAt',
          'updatedAt',
          'headRefName',
          'baseRefName',
          'body',
          'labels',
          'statusCheckRollup',
          'comments'
        ].join(',');

        const raw = await this.runGh(
          ['pr', 'list', '--state', ghState, '--json', jsonFields, '--limit', '30'],
          projectPath
        );

        if (!raw) return [];
        const parsed = JSON.parse(raw);

        const prs: PullRequest[] = parsed.map((item: any) => {
          let checksStatus: PullRequest['checksStatus'] = 'NONE';
          if (item.statusCheckRollup && item.statusCheckRollup.length > 0) {
            const hasFailures = item.statusCheckRollup.some(
              (c: any) => c.state === 'FAILURE' || c.conclusion === 'FAILURE'
            );
            const hasPending = item.statusCheckRollup.some(
              (c: any) => c.state === 'PENDING' || c.status === 'IN_PROGRESS'
            );
            if (hasFailures) checksStatus = 'FAILURE';
            else if (hasPending) checksStatus = 'PENDING';
            else checksStatus = 'SUCCESS';
          }

          let prState: PullRequest['state'] = 'OPEN';
          if (item.state === 'MERGED') prState = 'MERGED';
          else if (item.state === 'CLOSED') prState = 'CLOSED';

          return {
            id: item.number,
            number: item.number,
            title: item.title,
            state: prState,
            url: item.url,
            author: item.author?.login || 'unknown',
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            sourceBranch: item.headRefName || '',
            targetBranch: item.baseRefName || 'main',
            body: item.body || '',
            labels: (item.labels || []).map((l: any) => l.name),
            checksStatus,
            provider: 'github' as const,
            commentsCount: item.comments?.length || 0
          };
        });

        // Упавшие проверки уходят в шину (TASK-63, decision-13 п.1). Список PR опрашивается
        // периодически, поэтому дубликаты снимает дедупликация `notificationRules` по
        // ключу `pr:checks:<project>:<number>`, а не какое-либо состояние здесь.
        for (const pr of prs) {
          if (pr.state === 'OPEN' && pr.checksStatus === 'FAILURE') {
            appEventBus.publish({
              type: 'pr:checksFailed',
              projectPath,
              number: pr.number,
              title: pr.title,
              url: pr.url,
              at: Date.now()
            });
          }
        }

        return prs;
      }

      return [];
    } catch (err) {
      console.error(`Failed to list PRs for ${projectPath}:`, err);
      return [];
    }
  }

  async createPullRequest(projectPath: string, options: PRCreateOptions): Promise<PullRequest | null> {
    try {
      const provider = await this.getProviderInfo(projectPath);
      if (provider.provider !== 'github' || !provider.hasCli) {
        throw new Error('Для создания Pull Request требуется GitHub репозиторий и установленный GitHub CLI (gh).');
      }

      const args = [
        'pr',
        'create',
        '--title',
        options.title,
        '--body',
        options.body,
        '--head',
        options.sourceBranch
      ];

      if (options.targetBranch) {
        args.push('--base', options.targetBranch);
      }
      if (options.draft) {
        args.push('--draft');
      }

      const stdout = await this.runGh(args, projectPath);
      const prUrl = stdout.trim();

      // Automatically sync task status in Backlog to "Review" + record branch/pr (TASK-64)
      await this.syncBacklogOnPRCreated(projectPath, options.sourceBranch, options.title, prUrl);

      // Fetch newly created PR details
      const raw = await this.runGh(
        ['pr', 'view', '--json', 'number,title,state,url,author,createdAt,updatedAt,headRefName,baseRefName,body,labels'],
        projectPath
      );
      const item = JSON.parse(raw);

      const created: PullRequest = {
        id: item.number,
        number: item.number,
        title: item.title,
        state: 'OPEN',
        url: item.url || prUrl,
        author: item.author?.login || 'you',
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || new Date().toISOString(),
        sourceBranch: item.headRefName || options.sourceBranch,
        targetBranch: item.baseRefName || options.targetBranch || 'main',
        body: item.body || options.body,
        labels: (item.labels || []).map((l: any) => l.name),
        checksStatus: 'NONE',
        provider: 'github'
      };

      appEventBus.publish({
        type: 'pr:created',
        projectPath,
        number: created.number,
        title: created.title,
        url: created.url,
        at: Date.now()
      });

      return created;
    } catch (err: any) {
      console.error(`Failed to create PR in ${projectPath}:`, err);
      throw err;
    }
  }

  // ─────────────── Ревью PR (TASK-81, decision-53): эти методы бросают ошибку, а не глотают её ───────────────

  /** Открытые PR с головой для опроса `prWatcher`. Нет `gh`, авторизации или сети — исключение. */
  async listOpenPrsForWatch(projectPath: string): Promise<PrInfo[]> {
    const raw = await this.runGh(
      ['pr', 'list', '--state', 'open', '--json', 'number,title,url,headRefOid,headRefName,baseRefName,isDraft,author', '--limit', '50'],
      projectPath
    );
    return parseGhPrList(raw);
  }

  async getPrForReview(projectPath: string, prNumber: number): Promise<PrReviewTarget> {
    const raw = await this.runGh(
      ['pr', 'view', String(prNumber), '--json', 'number,title,body,url,headRefOid,headRefName,baseRefName,isDraft,state'],
      projectPath
    );
    const r = JSON.parse(raw) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    if (!str(r.headRefOid)) throw new Error(`gh не вернул голову PR #${prNumber}`);
    return {
      number: prNumber,
      title: str(r.title) || `#${prNumber}`,
      body: str(r.body),
      url: str(r.url),
      headSha: str(r.headRefOid),
      headRef: str(r.headRefName),
      baseRef: str(r.baseRefName),
      draft: r.isDraft === true,
      state: str(r.state)
    };
  }

  async getPrDiffStrict(projectPath: string, prNumber: number): Promise<string> {
    return this.runGh(['pr', 'diff', String(prNumber)], projectPath);
  }

  /**
   * Голова PR в локальную ссылку `refs/projecthub/pr/<N>` — от неё строятся worktree ревьюеров.
   * Возвращает ссылку и её SHA.
   */
  async fetchPrHead(projectPath: string, prNumber: number): Promise<{ ref: string; sha: string }> {
    const ref = `refs/projecthub/pr/${prNumber}`;
    const git = simpleGit(projectPath);
    await git.fetch('origin', `+refs/pull/${prNumber}/head:${ref}`);
    const sha = (await git.revparse([ref])).trim();
    return { ref, sha };
  }

  /**
   * Сводный комментарий ревью. Единственный путь записи в PR из ревью — `gh pr comment`
   * (`ghCommentArgs`): approve и request changes невозможны (decision-53 п. 8).
   */
  async commentOnPr(projectPath: string, prNumber: number, body: string): Promise<string> {
    const file = path.join(os.tmpdir(), `projecthub-pr-${prNumber}-${Date.now()}.md`);
    await fs.writeFile(file, body, 'utf-8');
    try {
      return await this.runGh(ghCommentArgs(prNumber, file), projectPath);
    } finally {
      await fs.rm(file, { force: true }).catch(() => undefined);
    }
  }

  async getPRDiff(projectPath: string, prNumber: number): Promise<string> {
    try {
      return await this.runGh(['pr', 'diff', String(prNumber)], projectPath);
    } catch (err) {
      console.error(`Failed to get diff for PR #${prNumber}:`, err);
      return '';
    }
  }

  private async syncBacklogOnPRCreated(projectPath: string, branchName: string, prTitle: string, prUrl: string) {
    try {
      // Extract task ID from branch name or PR title (e.g. feat/task-8 or TASK-8)
      const match = (branchName + ' ' + prTitle).match(/task-(\d+)/i);
      if (!match) return;

      const task = await findTaskFile(projectPath, `task-${match[1]}`);
      if (!task) return;

      const data = { ...task.data };
      if (data.status !== 'Review' && data.status !== 'Done') data.status = 'Review';
      data.branch = branchName;
      if (prUrl) data.pr = prUrl;

      const updated = matter.stringify(task.content, normalizeFrontmatter(withUpdatedDate(data)));
      await fs.writeFile(task.filePath, updated, 'utf-8');
    } catch (err) {
      console.error('Failed to sync Backlog task status on PR creation:', err);
    }
  }
}

export const prService = new PRService();
