import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { simpleGit } from 'simple-git';
import matter from 'gray-matter';
import type { PullRequest, PRCreateOptions, PRProviderInfo } from '../../src/types/electron';

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
      throw new Error(err.stderr || err.message || 'Ошибка выполнения GitHub CLI');
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

        return parsed.map((item: any) => {
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

      // Automatically sync task status in Backlog to "Review"
      await this.syncBacklogOnPRCreated(projectPath, options.sourceBranch, options.title);

      // Fetch newly created PR details
      const raw = await this.runGh(
        ['pr', 'view', '--json', 'number,title,state,url,author,createdAt,updatedAt,headRefName,baseRefName,body,labels'],
        projectPath
      );
      const item = JSON.parse(raw);

      return {
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
    } catch (err: any) {
      console.error(`Failed to create PR in ${projectPath}:`, err);
      throw err;
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

  private async syncBacklogOnPRCreated(projectPath: string, branchName: string, prTitle: string) {
    try {
      const tasksDir = path.join(projectPath, 'backlog', 'tasks');
      if (!existsSync(tasksDir)) return;

      // Extract task ID from branch name or PR title (e.g. feat/task-8 or TASK-8)
      const match = (branchName + ' ' + prTitle).match(/task-(\d+)/i);
      if (!match) return;

      const taskId = `task-${match[1]}`.toLowerCase();
      const files = await fs.readdir(tasksDir);

      for (const file of files) {
        if (file.toLowerCase().startsWith(taskId) && file.endsWith('.md')) {
          const fullPath = path.join(tasksDir, file);
          const raw = await fs.readFile(fullPath, 'utf-8');
          const parsed = matter(raw);
          if (parsed.data.status !== 'Review' && parsed.data.status !== 'Done') {
            parsed.data.status = 'Review';
            const updated = matter.stringify(parsed.content, parsed.data);
            await fs.writeFile(fullPath, updated, 'utf-8');
          }
          break;
        }
      }
    } catch (err) {
      console.error('Failed to sync Backlog task status on PR creation:', err);
    }
  }
}

export const prService = new PRService();
