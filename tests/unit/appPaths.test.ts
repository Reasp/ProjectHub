import path from 'node:path';
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';

// Частичный мок electron: как в упакованном приложении, но с предсказуемыми путями
const USER_DATA = path.join(os.tmpdir(), 'projecthub-test-userdata');
const APP_PATH = path.join(os.tmpdir(), 'projecthub-test-app.asar');

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (name: string) => (name === 'userData' ? USER_DATA : os.homedir()),
    getAppPath: () => APP_PATH
  }
}));

const appPaths = await import('../../electron/services/appPaths');

describe('appPaths (TASK-43)', () => {
  it('кэш моделей лежит в userData/models', () => {
    expect(appPaths.getModelsCacheDir()).toBe(path.join(USER_DATA, 'models'));
  });

  it('в упакованном приложении dev-репозиторий не определяется', () => {
    expect(appPaths.isPackagedApp()).toBe(true);
    expect(appPaths.getDevRepoRoot()).toBeNull();
  });

  it('кандидаты воркера — абсолютные пути от каталога бандла и app.getAppPath()', () => {
    const candidates = appPaths.getWorkerScriptCandidates('whisperWorker.mjs');
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates).toContain(path.normalize(path.join(APP_PATH, 'dist-electron', 'workers', 'whisperWorker.mjs')));
    expect(candidates).toContain(path.normalize(path.join(APP_PATH, 'electron', 'workers', 'whisperWorker.mjs')));
    for (const c of candidates) {
      expect(path.isAbsolute(c)).toBe(true);
      expect(c.endsWith(path.join('workers', 'whisperWorker.mjs'))).toBe(true);
    }
    // без дублей
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('распознаёт корень диска/файловой системы', () => {
    const root = path.parse(process.cwd()).root;
    expect(appPaths.isFilesystemRoot(root)).toBe(true);
    expect(appPaths.isFilesystemRoot(path.join(root, 'Projects'))).toBe(false);
    expect(appPaths.isFilesystemRoot(os.homedir())).toBe(false);
  });
});
