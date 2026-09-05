import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const sent: Array<{ channel: string; payload: any }> = [];
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string, payload: any) => sent.push({ channel, payload }) }
      }
    ]
  }
}));

const { GIT_CHANGED_DEBOUNCE_MS, gitService, isIgnoredWorkingTreePath } = await import(
  '../../electron/services/gitService'
);

const isWin = process.platform === 'win32';
const ROOT = isWin ? 'C:\\Projects\\App' : '/home/user/Projects/App';
const inside = (...parts: string[]) => path.join(ROOT, ...parts);

let tmpRoot: string;
const repos: string[] = [];

/** Минимальная структура .git, достаточная для watchProjectGit (без реального git init). */
function makeFakeRepo(dir: string) {
  fs.mkdirSync(path.join(dir, '.git', 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/master\n');
  fs.writeFileSync(path.join(dir, '.git', 'index'), '');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export {};\n');
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projecthub-gitwatch-'));
  for (let i = 0; i < 10; i++) {
    const dir = path.join(tmpRoot, `repo-${i}`);
    makeFakeRepo(dir);
    repos.push(dir);
  }
});

afterAll(() => {
  gitService.cleanupAll();
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}
});

describe('isIgnoredWorkingTreePath (аудит 2.2: ignored вотчера)', () => {
  it('не игнорирует корень проекта и обычные исходники', () => {
    expect(isIgnoredWorkingTreePath(ROOT, ROOT)).toBe(false);
    expect(isIgnoredWorkingTreePath(ROOT, inside('src', 'components', 'git', 'GitInspector.tsx'))).toBe(false);
    expect(isIgnoredWorkingTreePath(ROOT, inside('package.json'))).toBe(false);
  });

  it('игнорирует каталоги сборки, зависимостей и окружений', () => {
    for (const dir of [
      'node_modules',
      'dist',
      'dist-electron',
      'release',
      'build',
      'coverage',
      'target',
      '.next',
      'venv',
      '.venv',
      '__pycache__',
      '.rag-index',
      '.env-state',
      '.cache'
    ]) {
      expect(isIgnoredWorkingTreePath(ROOT, inside(dir)), dir).toBe(true);
      expect(isIgnoredWorkingTreePath(ROOT, inside(dir, 'deep', 'file.js')), `${dir}/deep`).toBe(true);
      expect(isIgnoredWorkingTreePath(ROOT, inside('packages', 'app', dir, 'x')), `nested ${dir}`).toBe(true);
    }
  });

  it('сравнивает по сегментам пути, а не по подстроке', () => {
    expect(isIgnoredWorkingTreePath(ROOT, inside('src', 'build-tools', 'x.ts'))).toBe(false);
    expect(isIgnoredWorkingTreePath(ROOT, inside('src', 'distribution.ts'))).toBe(false);
  });

  it('игнорирует служебные файлы: логи, временные, swap', () => {
    expect(isIgnoredWorkingTreePath(ROOT, inside('server.log'))).toBe(true);
    expect(isIgnoredWorkingTreePath(ROOT, inside('src', 'a.ts.swp'))).toBe(true);
    expect(isIgnoredWorkingTreePath(ROOT, inside('src', 'a.ts~'))).toBe(true);
  });
});

describe('жизненный цикл вотчеров (аудит 2.2, AC #6)', () => {
  it('дебаунс git:changed не меньше 1,5 с', () => {
    expect(GIT_CHANGED_DEBOUNCE_MS).toBeGreaterThanOrEqual(1500);
  });

  it('число вотчеров равно числу открытых проектов после открытия и закрытия 10 проектов', () => {
    for (const dir of repos) gitService.watchProjectGit(dir);
    expect(gitService.getWatcherCount()).toBe(10);

    // Повторный watch того же проекта (в т.ч. в другом регистре на Windows) не плодит дубли.
    gitService.watchProjectGit(repos[0]);
    gitService.watchProjectGit(isWin ? repos[1].toUpperCase() : repos[1]);
    expect(gitService.getWatcherCount()).toBe(10);

    // Закрываем 4 вкладки — остаётся 6 вотчеров ровно для открытых проектов.
    for (const dir of repos.slice(0, 4)) gitService.unwatchProjectGit(dir);
    expect(gitService.getWatcherCount()).toBe(6);
    const watched = gitService.getWatchedProjects().map((p) => path.normalize(p));
    expect(watched.sort()).toEqual(repos.slice(4).map((p) => path.normalize(p)).sort());

    // Закрываем остальные — вотчеров не остаётся.
    for (const dir of repos.slice(4)) gitService.unwatchProjectGit(dir);
    expect(gitService.getWatcherCount()).toBe(0);
    expect(gitService.getWatchedProjects()).toEqual([]);

    // Повторное открытие снова поднимает вотчер, unwatch несуществующего — безопасен.
    gitService.watchProjectGit(repos[0]);
    expect(gitService.getWatcherCount()).toBe(1);
    gitService.unwatchProjectGit(path.join(tmpRoot, 'never-watched'));
    expect(gitService.getWatcherCount()).toBe(1);
    gitService.cleanupAll();
    expect(gitService.getWatcherCount()).toBe(0);
  });

  it('каталог без .git не получает вотчер', () => {
    const plain = path.join(tmpRoot, 'plain-dir');
    fs.mkdirSync(plain, { recursive: true });
    gitService.watchProjectGit(plain);
    expect(gitService.getWatcherCount()).toBe(0);
  });
});
