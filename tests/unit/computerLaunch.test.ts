import { describe, expect, it } from 'vitest';
import { isLaunchableAppName, parseOpenApplicationActivated } from '../../electron/services/computerPolicy';

describe('запуск приложений прокси на Windows (ограничение рантайма 7.4)', () => {
  it('разрешено только голое имя исполняемого файла', () => {
    expect(isLaunchableAppName('notepad.exe')).toBe(true);
    expect(isLaunchableAppName('MSPaint.EXE')).toBe(true);
    expect(isLaunchableAppName('code-insiders.exe')).toBe(true);
  });

  it('пути, аргументы, метасимволы оболочки и не-exe отклоняются', () => {
    for (const name of [
      'C:\\Windows\\notepad.exe',
      '..\\evil.exe',
      'notepad.exe & calc.exe',
      'notepad.exe /p file.txt',
      '"notepad.exe"',
      'notepad',
      'script.bat',
      'a|b.exe',
      '%COMSPEC%.exe',
      '',
      '.exe',
      42
    ]) {
      expect(isLaunchableAppName(name), String(name)).toBe(false);
    }
  });

  it('флаг activated из ответа open_application', () => {
    expect(parseOpenApplicationActivated('Opened notepad.exe (activated: false)')).toBe(false);
    expect(parseOpenApplicationActivated('Opened com.apple.Safari (activated: true)')).toBe(true);
    expect(parseOpenApplicationActivated('something else')).toBeNull();
  });
});
