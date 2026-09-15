import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false }
}));

describe('изоляция домашнего каталога в unit-тестах', () => {
  it('os.homedir() — временный каталог, а не домашний каталог пользователя', () => {
    const home = os.homedir();
    expect(path.basename(home)).toMatch(/^projecthub-test-home-/);
    expect(home.startsWith(os.tmpdir())).toBe(true);
    expect(home).not.toBe(process.env.PROJECTHUB_TEST_REAL_HOME);
  });

  it('secretStorageService пишет секреты во временный home', async () => {
    const { secretStorageService } = await import('../../electron/services/secretStorageService');
    await secretStorageService.setSecret('isolation_probe', 'value');
    const file = path.join(os.homedir(), '.projecthub', 'secrets.enc.json');
    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toHaveProperty('isolation_probe');
  });
});
