import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPUTER_POLICY,
  evaluateComputerAction,
  extractTargetHints,
  isTargetAllowlisted,
  normalizeAppName,
  resolveComputerTarget,
  sanitizeComputerPolicy,
  taskAllowsComputerUse,
  type ComputerActionContext,
  type ComputerPolicySettings,
  type ComputerTarget,
  type RuntimeWindowInfo
} from '../../electron/services/computerPolicy';
import { getComputerToolSpec } from '../../electron/services/computerToolCatalog';

const notepad: ComputerTarget = { app: 'Notepad.exe', title: 'Безымянный — Блокнот', windowId: 1, source: 'window' };
const chrome: ComputerTarget = { app: 'chrome.exe', title: 'Gmail - Google Chrome', windowId: 2, source: 'window' };
const saveAs: ComputerTarget = { app: 'Notepad.exe', title: 'Сохранить как', windowId: 3, source: 'focused' };

const settings = (patch: Partial<ComputerPolicySettings> = {}): ComputerPolicySettings => ({
  ...DEFAULT_COMPUTER_POLICY,
  allowlist: [{ app: 'notepad' }],
  ...patch
});
const ctx = (patch: Partial<ComputerActionContext> = {}): ComputerActionContext => ({ enabled: true, killSwitchEngaged: false, origin: 'studio', ...patch });

const evaluate = (tool: string, target: ComputerTarget | null, s = settings(), c = ctx(), focused: ComputerTarget | null = target) =>
  evaluateComputerAction({ tool, spec: getComputerToolSpec(tool), target, focused, settings: s, context: c });

describe('evaluateComputerAction: HITL по классам действий (decision-27 п. 3, AC #2, #3)', () => {
  it('observe — автоматически, даже вне allowlist', () => {
    expect(evaluate('screenshot', chrome)).toMatchObject({ verdict: 'allow', rule: 'computer-observe' });
    expect(evaluate('get_ui_tree', null)).toMatchObject({ verdict: 'allow' });
  });

  it('act в allowlist — автоматически; вне allowlist — запрос или отказ по настройке', () => {
    expect(evaluate('type', notepad)).toMatchObject({ verdict: 'allow', rule: 'computer-allowlist', actionClass: 'act' });
    expect(evaluate('left_click', chrome)).toMatchObject({ verdict: 'ask', rule: 'computer-outside-allowlist' });
    expect(evaluate('left_click', chrome, settings({ outsideAllowlist: 'deny' }))).toMatchObject({ verdict: 'deny', rule: 'computer-outside-allowlist' });
  });

  it('роль без auto-approve: act в allowlist всё равно спрашивается', () => {
    expect(evaluate('type', notepad, settings(), ctx({ autoApprove: false }))).toMatchObject({ verdict: 'ask', rule: 'computer-manual' });
  });

  it('dangerous — всегда запрос, даже в allowlist', () => {
    expect(evaluate('run_script', notepad)).toMatchObject({ verdict: 'ask', rule: 'computer-dangerous', actionClass: 'dangerous' });
    expect(evaluate('hold_key', notepad)).toMatchObject({ verdict: 'ask', rule: 'computer-dangerous' });
  });

  it('файловый диалог повышает act до dangerous', () => {
    expect(evaluate('press_button', saveAs)).toMatchObject({ verdict: 'ask', rule: 'computer-file-dialog', actionClass: 'dangerous' });
  });

  it('act без цели (уведомление, неопределённое окно) — запрос', () => {
    expect(evaluate('notification', null)).toMatchObject({ verdict: 'ask', rule: 'computer-no-target' });
    expect(evaluate('left_click', null)).toMatchObject({ verdict: 'ask', rule: 'computer-no-target' });
  });

  it('режим «только разрешённые окна»: отказ, если цель или активное окно вне списка', () => {
    const only = settings({ onlyAllowlistedWindows: true });
    expect(evaluate('type', notepad, only)).toMatchObject({ verdict: 'allow' });
    expect(evaluate('type', chrome, only)).toMatchObject({ verdict: 'deny', rule: 'computer-only-window' });
    expect(evaluate('type', notepad, only, ctx(), chrome)).toMatchObject({ verdict: 'deny', rule: 'computer-only-window' });
    expect(evaluate('run_script', null, only)).toMatchObject({ verdict: 'ask', rule: 'computer-dangerous' });
  });

  it('жёсткие запреты: выключено, kill-switch, неизвестный инструмент, автономные запуски', () => {
    expect(evaluate('screenshot', notepad, settings(), ctx({ enabled: false }))).toMatchObject({ verdict: 'deny', rule: 'computer-disabled' });
    expect(evaluate('screenshot', notepad, settings(), ctx({ killSwitchEngaged: true }))).toMatchObject({ verdict: 'deny', rule: 'kill-switch' });
    expect(evaluate('openai_computer', notepad)).toMatchObject({ verdict: 'deny', rule: 'computer-tool-unknown' });
    expect(evaluate('teleport', notepad)).toMatchObject({ verdict: 'deny', rule: 'computer-tool-unknown' });
    expect(evaluate('type', notepad, settings(), ctx({ origin: 'automation' }))).toMatchObject({ verdict: 'deny', rule: 'computer-autonomous-forbidden' });
    expect(evaluate('screenshot', notepad, settings(), ctx({ origin: 'assigned' }))).toMatchObject({ verdict: 'deny', rule: 'computer-autonomous-forbidden' });
  });

  it('Done-loop — только если задача явно разрешила', () => {
    expect(evaluate('type', notepad, settings(), ctx({ origin: 'swarm', doneLoop: true }))).toMatchObject({ verdict: 'deny', rule: 'computer-task-not-allowed' });
    expect(evaluate('type', notepad, settings(), ctx({ origin: 'swarm', doneLoop: true, taskAllowsComputerUse: true }))).toMatchObject({ verdict: 'allow' });
  });
});

describe('allowlist и нормализация', () => {
  it('имя процесса без регистра и .exe; шаблоны *; заголовок — подстрока', () => {
    expect(normalizeAppName('Notepad.EXE')).toBe('notepad');
    expect(isTargetAllowlisted(notepad, [{ app: 'NOTEPAD.exe' }])).toBe(true);
    expect(isTargetAllowlisted(chrome, [{ app: 'chr*' }])).toBe(true);
    expect(isTargetAllowlisted(chrome, [{ title: 'gmail' }])).toBe(true);
    expect(isTargetAllowlisted(chrome, [{ app: 'chrome', title: 'Docs' }])).toBe(false);
    expect(isTargetAllowlisted(chrome, [{}])).toBe(false);
    expect(isTargetAllowlisted(null, [{ app: 'chrome' }])).toBe(false);
  });

  it('sanitizeComputerPolicy отбрасывает мусор и ставит безопасные значения по умолчанию', () => {
    const s = sanitizeComputerPolicy({ allowlist: [{ app: ' notepad.exe ' }, { foo: 1 }, null], outsideAllowlist: 'yes', onlyAllowlistedWindows: 'true' });
    expect(s.allowlist).toEqual([{ app: 'notepad.exe' }]);
    expect(s.outsideAllowlist).toBe('ask');
    expect(s.onlyAllowlistedWindows).toBe(false);
    expect(s.fileDialogTitles.length).toBeGreaterThan(0);
    expect(sanitizeComputerPolicy(null)).toEqual({ ...DEFAULT_COMPUTER_POLICY, allowlist: [] });
  });

  it('label computer-use разрешает управление компьютером в задаче', () => {
    expect(taskAllowsComputerUse(['feature', 'Computer-Use'])).toBe(true);
    expect(taskAllowsComputerUse(['computer'])).toBe(false);
    expect(taskAllowsComputerUse(undefined)).toBe(false);
  });
});

describe('resolveComputerTarget: цель по list_windows', () => {
  const windows: RuntimeWindowInfo[] = [
    { windowId: 10, bundleId: 'Code.exe', title: 'ProjectHub - VS Code', bounds: { x: -8, y: -8, width: 1936, height: 1056 }, isOnScreen: true, isFocused: true },
    { windowId: 20, bundleId: 'Notepad.exe', title: 'Безымянный — Блокнот', bounds: { x: 100, y: 100, width: 800, height: 600 }, isOnScreen: true },
    { windowId: 30, bundleId: 'Discord.exe', title: 'Discord', bounds: { x: -32000, y: -32000, width: 160, height: 28 }, isOnScreen: false }
  ];

  it('окно из аргументов, приложение, заголовок', () => {
    expect(resolveComputerTarget(windows, extractTargetHints({ window_id: 20 }, null)).target).toMatchObject({ app: 'Notepad.exe', windowId: 20, source: 'window' });
    expect(resolveComputerTarget(windows, extractTargetHints({ target_app: 'notepad.exe' }, null)).target).toMatchObject({ windowId: 20, source: 'app' });
    expect(resolveComputerTarget(windows, extractTargetHints({ bundle_id: 'mspaint.exe' }, null)).target).toEqual({ app: 'mspaint.exe', source: 'app' });
    expect(resolveComputerTarget(windows, extractTargetHints({ window_name: 'блокнот' }, null)).target?.windowId).toBe(20);
    expect(resolveComputerTarget(windows, extractTargetHints({ window_id: 999 }, null)).target).toEqual({ windowId: 999, source: 'window' });
  });

  it('точка — верхнее видимое окно под ней; иначе активное окно', () => {
    // Первое по z-порядку окно под точкой — развёрнутый VS Code, он перекрывает Блокнот.
    expect(resolveComputerTarget(windows, extractTargetHints({}, [150, 150])).target?.windowId).toBe(10);
    expect(resolveComputerTarget(windows.slice(1), extractTargetHints({}, [150, 150])).target?.windowId).toBe(20);
    const r = resolveComputerTarget(windows, extractTargetHints({ text: 'hi' }, null));
    expect(r.target).toMatchObject({ windowId: 10, source: 'focused' });
    expect(r.focused?.windowId).toBe(10);
  });
});
