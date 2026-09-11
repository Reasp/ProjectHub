import { describe, expect, it } from 'vitest';
import { isNewerVersion } from '../../electron/services/versionCompare';

describe('isNewerVersion', () => {
  it('признаёт больший патч/минор/мажор новее', () => {
    expect(isNewerVersion('0.1.1', '0.1.0')).toBe(true);
    expect(isNewerVersion('0.2.0', '0.1.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
  });

  it('не считает равную или более старую версию новее', () => {
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false);
  });

  it('игнорирует префикс "v" в тегах GitHub Releases', () => {
    expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('v0.1.0', 'v0.1.0')).toBe(false);
  });

  it('обрабатывает версии с разным числом сегментов', () => {
    expect(isNewerVersion('0.1', '0.0.9')).toBe(true);
    expect(isNewerVersion('0.1.0.1', '0.1.0')).toBe(true);
  });
});
