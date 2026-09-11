import { describe, expect, it, vi, beforeEach } from 'vitest';

type ExecFileCallback = (error: Error | null, stdout: string) => void;
const execFileMock = vi.fn<(cmd: string, args: string[], opts: unknown, cb: ExecFileCallback) => void>();
vi.mock('node:child_process', () => ({
  execFile: (cmd: string, args: string[], opts: unknown, cb: ExecFileCallback) => execFileMock(cmd, args, opts, cb)
}));

describe('fetchGitNexusContext — best-effort обёртка над GitNexus CLI (TASK-64)', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('собирает секции по файлам, для которых CLI вернул текст', async () => {
    execFileMock.mockImplementation((_cmd, args: string[], _opts, cb) => {
      const file = args[args.indexOf('-f') + 1];
      cb(null, `callers of ${file}: main()`);
    });
    const { fetchGitNexusContext } = await import('../../electron/services/gitNexusClient');

    const text = await fetchGitNexusContext({ projectPath: '/proj', files: ['a.ts', 'b.ts'] });
    expect(text).toContain('### a.ts');
    expect(text).toContain('callers of a.ts: main()');
    expect(text).toContain('### b.ts');
  });

  it('не бросает ошибку и пропускает файл, если репозиторий не проиндексирован', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(new Error('Repository not indexed.'), '');
    });
    const { fetchGitNexusContext } = await import('../../electron/services/gitNexusClient');

    const text = await fetchGitNexusContext({ projectPath: '/proj', files: ['a.ts'] });
    expect(text).toBe('');
  });

  it('не бросает ошибку, если бинарник gitnexus не установлен', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(Object.assign(new Error('spawn gitnexus ENOENT'), { code: 'ENOENT' }), '');
    });
    const { fetchGitNexusContext } = await import('../../electron/services/gitNexusClient');

    await expect(fetchGitNexusContext({ projectPath: '/proj', files: ['a.ts', 'b.ts'] })).resolves.toBe('');
  });

  it('без файлов возвращает пустую строку и не вызывает CLI', async () => {
    const { fetchGitNexusContext } = await import('../../electron/services/gitNexusClient');
    const text = await fetchGitNexusContext({ projectPath: '/proj', files: [] });
    expect(text).toBe('');
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
