import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KILL_SWITCH_HOTKEY,
  sanitizeComputerUseSettings,
  summarizeComputerAction
} from '../../electron/services/computerPolicy';
import { buildProxyInputSchema, buildProxyToolDescription, getComputerToolSpec } from '../../electron/services/computerToolCatalog';

describe('sanitizeComputerUseSettings: безопасные значения по умолчанию (decision-27 п. 6)', () => {
  it('пустой файл — функция выключена, kill-switch и перехват мыши включены', () => {
    const s = sanitizeComputerUseSettings(undefined);
    expect(s.enabled).toBe(false);
    expect(s.killSwitchHotkey).toBe(DEFAULT_KILL_SWITCH_HOTKEY);
    expect(s.takeoverDetection).toBe(true);
    expect(s.takeoverThresholdPx).toBe(40);
    expect(s.auditScreenshots).toBe(true);
    expect(s.policy.outsideAllowlist).toBe('ask');
  });

  it('невалидные значения заменяются, границы порога соблюдаются', () => {
    const s = sanitizeComputerUseSettings({ enabled: 'yes', killSwitchHotkey: 'rm -rf', takeoverThresholdPx: 5000, takeoverDetection: false });
    expect(s.enabled).toBe(false);
    expect(s.killSwitchHotkey).toBe(DEFAULT_KILL_SWITCH_HOTKEY);
    expect(s.takeoverThresholdPx).toBe(500);
    expect(s.takeoverDetection).toBe(false);
    expect(sanitizeComputerUseSettings({ enabled: true, killSwitchHotkey: 'Control+Shift+F12' })).toMatchObject({ enabled: true, killSwitchHotkey: 'Control+Shift+F12' });
  });
});

describe('summarizeComputerAction: строка для карточки HITL', () => {
  it('инструмент, аргументы без служебных полей, цель', () => {
    const text = summarizeComputerAction('type', { text: 'Привет', focus_strategy: 'strict' }, { app: 'notepad.exe', title: 'Блокнот', source: 'app' });
    expect(text).toBe('type {"text":"Привет"} → notepad.exe «Блокнот»');
  });
  it('длинный текст усекается', () => {
    const text = summarizeComputerAction('type', { text: 'x'.repeat(1000) }, null, 100);
    expect(text.length).toBeLessThanOrEqual(101);
  });
});

describe('buildProxyInputSchema / buildProxyToolDescription', () => {
  const leftClick = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { coordinate: { type: 'array' }, approval_token: { type: 'string' } },
    required: ['coordinate', 'approval_token']
  };

  it('скрывает approval_token и $schema, добавляет coordinate_space инструментам с координатами', () => {
    const schema = buildProxyInputSchema(leftClick, getComputerToolSpec('left_click')!);
    expect(schema.$schema).toBeUndefined();
    expect(Object.keys(schema.properties)).toEqual(['coordinate', 'coordinate_space']);
    expect(schema.properties.coordinate_space.enum).toEqual(['screen', 'screenshot']);
    expect(schema.required).toEqual(['coordinate']);
  });

  it('без координат coordinate_space не добавляется; пустая схема → объект', () => {
    expect(Object.keys(buildProxyInputSchema({ type: 'object', properties: { text: { type: 'string' } } }, getComputerToolSpec('type')!).properties)).toEqual(['text']);
    expect(buildProxyInputSchema(undefined, getComputerToolSpec('list_windows')!)).toEqual({ type: 'object', properties: {} });
  });

  it('описание начинается с класса действия', () => {
    expect(buildProxyToolDescription('run_script', getComputerToolSpec('run_script')!, 'Execute a script')).toMatch(/^\[dangerous/);
    expect(buildProxyToolDescription('screenshot', getComputerToolSpec('screenshot')!, 'Capture')).toContain('1366×768');
  });
});
