import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeTempDir } from '../helpers/removeTempDir';

// TASK-108: каталог, который был cwd процесса, удаляется после выхода процесса, а не падает EBUSY.

function mkdir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'projecthub-rmtmp-'));
  fs.writeFileSync(path.join(dir, 'f.txt'), 'x');
  return dir;
}

/** Процесс с cwd = dir; сигнал о старте — строка в stdout. */
function holdCwd(dir: string, ms: number): Promise<ReturnType<typeof spawn>> {
  const child = spawn(process.execPath, ['-e', `process.stdout.write('up'); setTimeout(() => {}, ${ms})`], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return new Promise((resolve) => child.stdout!.once('data', () => resolve(child)));
}

describe('removeTempDir', () => {
  it('удаляет каталог с содержимым', async () => {
    const dir = mkdir();
    await removeTempDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('несуществующий каталог — не ошибка', async () => {
    await expect(removeTempDir(path.join(os.tmpdir(), 'projecthub-rmtmp-missing-x'))).resolves.toBeUndefined();
  });

  it.runIf(process.platform === 'win32')('ждёт, пока процесс с этим cwd завершится', async () => {
    const dir = mkdir();
    await holdCwd(dir, 700);
    await removeTempDir(dir, 20_000);
    expect(fs.existsSync(dir)).toBe(false);
  }, 30_000);

  it.runIf(process.platform === 'win32')('каталог держит живой процесс дольше дедлайна — ошибка', async () => {
    const dir = mkdir();
    const child = await holdCwd(dir, 60_000);
    try {
      await expect(removeTempDir(dir, 300)).rejects.toMatchObject({ code: 'EBUSY' });
    } finally {
      child.kill();
      await removeTempDir(dir);
    }
  }, 30_000);
});
