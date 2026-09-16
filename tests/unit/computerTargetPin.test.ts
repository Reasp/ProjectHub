import { describe, expect, it } from 'vitest';
import { shouldPinTargetWindow, type ComputerTarget } from '../../electron/services/computerPolicy';

const dialog: ComputerTarget = { app: 'notepad.exe', title: 'Save As', windowId: 42, source: 'app' };

describe('shouldPinTargetWindow: действие идёт в проверенное политикой окно', () => {
  it('только target_app и найденное окно — закрепляем window_id', () => {
    expect(shouldPinTargetWindow({ text: 'привет', target_app: 'notepad.exe' }, dialog)).toBe(true);
  });

  it('окно указано явно — аргументы не трогаем', () => {
    expect(shouldPinTargetWindow({ target_app: 'notepad.exe', target_window_id: 7 }, dialog)).toBe(false);
    expect(shouldPinTargetWindow({ target_app: 'notepad.exe', window_id: 7 }, dialog)).toBe(false);
  });

  it('без target_app или без цели с окном — не закрепляем', () => {
    expect(shouldPinTargetWindow({ text: 'привет' }, dialog)).toBe(false);
    expect(shouldPinTargetWindow({ target_app: '  ' }, dialog)).toBe(false);
    expect(shouldPinTargetWindow({ target_app: 'notepad.exe' }, null)).toBe(false);
    expect(shouldPinTargetWindow({ target_app: 'mspaint.exe' }, { app: 'mspaint.exe', source: 'app' })).toBe(false);
  });
});
