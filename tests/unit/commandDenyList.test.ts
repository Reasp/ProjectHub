import { describe, expect, it, vi } from 'vitest';

// claudeBridgeService тянет electron через secretStorageService/processManager — подменяем модуль.
vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  },
  BrowserWindow: { getAllWindows: () => [] }
}));

const { claudeBridgeService } = await import('../../electron/services/claudeBridgeService');

describe('claudeBridgeService.isCommandDenied (deny-list команд для авто-одобрения)', () => {
  it('подстрока без учёта регистра и лишних пробелов', () => {
    expect(claudeBridgeService.isCommandDenied('rm -rf ./dist', ['rm -rf'])).toBe(true);
    expect(claudeBridgeService.isCommandDenied('GIT PUSH origin main', ['git push'])).toBe(true);
    expect(claudeBridgeService.isCommandDenied('  git push  ', ['  Git Push  '])).toBe(true);
    expect(claudeBridgeService.isCommandDenied('npm test', ['git push', 'rm -rf'])).toBe(false);
  });

  it('пустая команда, пустой список и пустые шаблоны ничего не запрещают', () => {
    expect(claudeBridgeService.isCommandDenied('', ['rm'])).toBe(false);
    expect(claudeBridgeService.isCommandDenied('rm -rf /', [])).toBe(false);
    expect(claudeBridgeService.isCommandDenied('rm -rf /')).toBe(false);
    expect(claudeBridgeService.isCommandDenied('anything', ['', '   '])).toBe(false);
  });
});
