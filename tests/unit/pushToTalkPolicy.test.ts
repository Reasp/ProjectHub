import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOLD_TIMING,
  DEFAULT_PTT_ACCELERATOR,
  abandonKeyHold,
  checkRelease,
  createHoldState,
  createModifierKeyState,
  defaultPushToTalkKey,
  defaultPushToTalkSettings,
  holdDurationMs,
  holdTimingFromSettings,
  isValidAccelerator,
  isValidPushToTalkKey,
  nativeKeyFor,
  nativeKeysForPlatform,
  nextCheckDelayMs,
  registerFire,
  registerKeyDown,
  registerKeyUp,
  sanitizePushToTalkSettings,
  supportsHoldMode,
  type KeyHookEvent
} from '../../electron/services/pushToTalkPolicy';

describe('isValidAccelerator: горячая клавиша push-to-talk (TASK-83, AC #1)', () => {
  it('принимает модификаторы плюс одну обычную клавишу', () => {
    for (const accelerator of ['Control+Shift+Space', 'CommandOrControl+Alt+M', 'Ctrl+Shift+Alt+Super+K']) {
      expect(isValidAccelerator(accelerator), accelerator).toBe(true);
    }
  });

  it('отвергает чистые модификаторы: их globalShortcut зарегистрировать не может', () => {
    for (const accelerator of ['Control', 'Control+Shift', 'Alt+Ctrl']) {
      expect(isValidAccelerator(accelerator), accelerator).toBe(false);
    }
  });

  it('принимает одиночные клавиши, которыми не набирают текст', () => {
    for (const accelerator of ['CapsLock', 'ScrollLock', 'Pause', 'Insert', 'F13', 'F24', 'f9']) {
      expect(isValidAccelerator(accelerator), accelerator).toBe(true);
    }
  });

  it('одиночные буквы и цифры отвергаются: глобальный перехват лишил бы их во всех программах', () => {
    for (const accelerator of ['A', 'Space', 'Enter', '5', 'Escape']) {
      expect(isValidAccelerator(accelerator), accelerator).toBe(false);
    }
  });

  it('отвергает мусор, повторы модификаторов и пустые сегменты', () => {
    for (const accelerator of ['', '   ', 'Space', 'Control++A', 'Control+', '+A', 'Ctrl+Ctrl+A', 'Hyper+A']) {
      expect(isValidAccelerator(accelerator), accelerator).toBe(false);
    }
    expect(isValidAccelerator(null)).toBe(false);
    expect(isValidAccelerator(42)).toBe(false);
  });

  it('отвергает F12: она зарезервирована отладчиком и уже занята DevTools приложения', () => {
    expect(isValidAccelerator('Control+Shift+F12')).toBe(false);
    expect(isValidAccelerator('Control+Shift+F11')).toBe(true);
  });
});

describe('клавиша-модификатор push-to-talk (TASK-112)', () => {
  const rightCtrl = nativeKeyFor('RightControl', 'win32')!;
  const rightCmd = nativeKeyFor('RightCommand', 'darwin')!;
  const key = (keycode: number, mods: Partial<KeyHookEvent> = {}): KeyHookEvent => ({
    keycode,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods
  });
  const LEFT_CTRL = 0x001d;
  const LEFT_META = 0x0e5b;
  const KEY_C = 0x002e;

  it('правый Ctrl доступен везде, правый Command — только на macOS', () => {
    expect(nativeKeysForPlatform('win32')).toEqual(['RightControl']);
    expect(nativeKeysForPlatform('linux')).toEqual(['RightControl']);
    expect(nativeKeysForPlatform('darwin')).toEqual(['RightControl', 'RightCommand']);
    expect(nativeKeyFor('RightCommand', 'win32')).toBeNull();
    expect(defaultPushToTalkKey('win32')).toBe('RightControl');
    expect(defaultPushToTalkKey('darwin')).toBe('RightCommand');
  });

  it('имя клавиши принимается без учёта регистра и в короткой форме', () => {
    expect(nativeKeyFor(' rightctrl ', 'win32')?.id).toBe('RightControl');
    expect(nativeKeyFor('RightCmd', 'darwin')?.id).toBe('RightCommand');
    expect(nativeKeyFor('Control', 'win32')).toBeNull();
    expect(nativeKeyFor('LeftControl', 'win32')).toBeNull();
    expect(nativeKeyFor(42, 'win32')).toBeNull();
  });

  it('пригодность значения: клавиша-модификатор этой платформы либо accelerator', () => {
    expect(isValidPushToTalkKey('RightControl', 'win32')).toBe(true);
    expect(isValidPushToTalkKey('Control+Shift+Space', 'win32')).toBe(true);
    expect(isValidPushToTalkKey('RightCommand', 'win32')).toBe(false);
    expect(isValidPushToTalkKey('Control', 'win32')).toBe(false);
  });

  it('нажатие и отпускание правого Ctrl — старт и стоп записи', () => {
    const state = createModifierKeyState();
    expect(registerKeyDown(state, key(rightCtrl.keycode, { ctrlKey: true }), rightCtrl, 1000)).toBe('press');
    expect(state.downAt).toBe(1000);
    expect(registerKeyUp(state, key(rightCtrl.keycode), rightCtrl)).toBe('release');
    expect(state.down).toBe(false);
  });

  it('автоповтор зажатой клавиши не считается новым нажатием', () => {
    const state = createModifierKeyState();
    registerKeyDown(state, key(rightCtrl.keycode, { ctrlKey: true }), rightCtrl, 0);
    expect(registerKeyDown(state, key(rightCtrl.keycode, { ctrlKey: true }), rightCtrl, 500)).toBeNull();
    expect(registerKeyDown(state, key(rightCtrl.keycode, { ctrlKey: true }), rightCtrl, 533)).toBeNull();
    expect(state.downAt).toBe(0);
    expect(registerKeyUp(state, key(rightCtrl.keycode), rightCtrl)).toBe('release');
  });

  it('левый Ctrl и левый Command запись не запускают', () => {
    const state = createModifierKeyState();
    expect(registerKeyDown(state, key(LEFT_CTRL, { ctrlKey: true }), rightCtrl, 0)).toBeNull();
    expect(registerKeyUp(state, key(LEFT_CTRL), rightCtrl)).toBeNull();
    expect(registerKeyDown(state, key(LEFT_META, { metaKey: true }), rightCmd, 0)).toBeNull();
    expect(state.down).toBe(false);
  });

  it('правый Ctrl+C — сочетание: запись отменяется, отпускание уже ничего не отправляет', () => {
    const state = createModifierKeyState();
    expect(registerKeyDown(state, key(rightCtrl.keycode, { ctrlKey: true }), rightCtrl, 0)).toBe('press');
    expect(registerKeyDown(state, key(KEY_C, { ctrlKey: true }), rightCtrl, 80)).toBe('cancel');
    // Вторая клавиша того же сочетания отменять уже нечего.
    expect(registerKeyDown(state, key(KEY_C, { ctrlKey: true }), rightCtrl, 120)).toBeNull();
    expect(registerKeyUp(state, key(KEY_C, { ctrlKey: true }), rightCtrl)).toBeNull();
    expect(registerKeyUp(state, key(rightCtrl.keycode), rightCtrl)).toBeNull();
    // Следующее чистое нажатие работает как обычно.
    expect(registerKeyDown(state, key(rightCtrl.keycode, { ctrlKey: true }), rightCtrl, 900)).toBe('press');
  });

  it('клавиша, добавленная к уже зажатому модификатору, запись не начинает', () => {
    const state = createModifierKeyState();
    expect(registerKeyDown(state, key(rightCtrl.keycode, { ctrlKey: true, shiftKey: true }), rightCtrl, 0)).toBeNull();
    expect(registerKeyUp(state, key(rightCtrl.keycode, { shiftKey: true }), rightCtrl)).toBeNull();

    const mac = createModifierKeyState();
    expect(registerKeyDown(mac, key(rightCmd.keycode, { metaKey: true, altKey: true }), rightCmd, 0)).toBeNull();
    expect(registerKeyDown(mac, key(rightCmd.keycode, { metaKey: true }), rightCmd, 10)).toBeNull();
  });

  it('клавиша без собственного флага модификатора в событии всё равно считается чистым нажатием', () => {
    const state = createModifierKeyState();
    expect(registerKeyDown(state, key(rightCmd.keycode), rightCmd, 0)).toBe('press');
  });

  it('прочие клавиши без зажатой клавиши push-to-talk игнорируются', () => {
    const state = createModifierKeyState();
    expect(registerKeyDown(state, key(KEY_C), rightCtrl, 0)).toBeNull();
    expect(registerKeyUp(state, key(KEY_C), rightCtrl)).toBeNull();
    expect(registerKeyUp(state, key(rightCtrl.keycode), rightCtrl)).toBeNull();
  });

  it('сторожевой таймер снимает нажатие: запоздавшее отпускание ничего не переключает', () => {
    const state = createModifierKeyState();
    registerKeyDown(state, key(rightCtrl.keycode, { ctrlKey: true }), rightCtrl, 0);
    abandonKeyHold(state);
    expect(registerKeyDown(state, key(KEY_C, { ctrlKey: true }), rightCtrl, 10)).toBeNull();
    expect(registerKeyUp(state, key(rightCtrl.keycode), rightCtrl)).toBeNull();
    expect(registerKeyDown(state, key(rightCtrl.keycode, { ctrlKey: true }), rightCtrl, 20)).toBe('press');

    const idle = createModifierKeyState();
    abandonKeyHold(idle);
    expect(idle.spent).toBe(false);
  });
});

describe('sanitizePushToTalkSettings: настройки из voice-hotkey.json', () => {
  it('дефолты: клавиша-модификатор платформы в режиме удержания', () => {
    expect(defaultPushToTalkSettings('win32')).toMatchObject({
      enabled: true,
      accelerator: 'RightControl',
      mode: 'hold',
      trayIndicator: true
    });
    expect(defaultPushToTalkSettings('linux')).toMatchObject({ accelerator: 'RightControl', mode: 'hold' });
    expect(defaultPushToTalkSettings('darwin')).toMatchObject({ accelerator: 'RightCommand', mode: 'hold' });
  });

  it('удержание: у клавиши-модификатора везде, у сочетания globalShortcut — только в Windows', () => {
    expect(supportsHoldMode('win32')).toBe(true);
    expect(supportsHoldMode('darwin')).toBe(false);
    expect(supportsHoldMode('darwin', 'RightCommand')).toBe(true);
    expect(supportsHoldMode('linux', 'RightControl')).toBe(true);
    expect(supportsHoldMode('darwin', DEFAULT_PTT_ACCELERATOR)).toBe(false);
    // Правый Command вне macOS — не клавиша хука, а негодное значение.
    expect(supportsHoldMode('linux', 'RightCommand')).toBe(false);
  });

  it('пустой или битый файл даёт рабочие дефолты', () => {
    expect(sanitizePushToTalkSettings(null, 'win32')).toEqual(defaultPushToTalkSettings('win32'));
    expect(sanitizePushToTalkSettings('строка', 'win32')).toEqual(defaultPushToTalkSettings('win32'));
    expect(sanitizePushToTalkSettings({ accelerator: 'Control' }, 'win32').accelerator).toBe('RightControl');
  });

  it('клавиша-модификатор записывается каноническим именем, чужая для платформы заменяется дефолтом', () => {
    expect(sanitizePushToTalkSettings({ accelerator: 'rightctrl' }, 'win32').accelerator).toBe('RightControl');
    expect(sanitizePushToTalkSettings({ accelerator: 'RightCommand' }, 'win32').accelerator).toBe('RightControl');
    expect(sanitizePushToTalkSettings({ accelerator: 'RightControl' }, 'darwin').accelerator).toBe('RightControl');
  });

  it('сохранённое сочетание globalShortcut остаётся как было', () => {
    const saved = sanitizePushToTalkSettings({ accelerator: ' Control+Shift+Space ', mode: 'hold' }, 'win32');
    expect(saved).toMatchObject({ accelerator: DEFAULT_PTT_ACCELERATOR, mode: 'hold' });
  });

  it('режим hold у сочетания вне Windows понижается до toggle: без автоповтора запись не остановилась бы', () => {
    expect(sanitizePushToTalkSettings({ accelerator: DEFAULT_PTT_ACCELERATOR, mode: 'hold' }, 'darwin').mode).toBe(
      'toggle'
    );
    expect(sanitizePushToTalkSettings({ mode: 'hold' }, 'darwin').mode).toBe('hold');
    expect(sanitizePushToTalkSettings({ mode: 'toggle' }, 'darwin').mode).toBe('toggle');
    expect(sanitizePushToTalkSettings({ mode: 'hold' }, 'win32').mode).toBe('hold');
    expect(sanitizePushToTalkSettings({ mode: 'ерунда' }, 'win32').mode).toBe('hold');
  });

  it('выключение явное, тайминги зажимаются в допустимый диапазон', () => {
    expect(sanitizePushToTalkSettings({ enabled: false }, 'win32').enabled).toBe(false);
    expect(sanitizePushToTalkSettings({ enabled: 'да' }, 'win32').enabled).toBe(true);
    expect(sanitizePushToTalkSettings({ firstRepeatMs: 10 }, 'win32').firstRepeatMs).toBe(400);
    expect(sanitizePushToTalkSettings({ firstRepeatMs: 99999 }, 'win32').firstRepeatMs).toBe(3000);
    expect(sanitizePushToTalkSettings({ repeatGraceMs: 0 }, 'win32').repeatGraceMs).toBe(150);
    expect(sanitizePushToTalkSettings({ repeatGraceMs: 'быстро' }, 'win32').repeatGraceMs).toBe(300);
  });

  it('тайминги детектора берутся из настроек', () => {
    const settings = sanitizePushToTalkSettings({ firstRepeatMs: 900, repeatGraceMs: 250 }, 'win32');
    expect(holdTimingFromSettings(settings)).toMatchObject({
      firstRepeatMs: 900,
      repeatGraceMs: 250,
      repeatFactor: DEFAULT_HOLD_TIMING.repeatFactor
    });
  });
});

describe('детект удержания по автоповтору globalShortcut (TASK-83, AC #1)', () => {
  it('первое срабатывание — нажатие, последующие в серии — автоповтор', () => {
    const state = createHoldState();
    expect(registerFire(state, 1000)).toBe(true);
    expect(registerFire(state, 1500)).toBe(false);
    expect(registerFire(state, 1533)).toBe(false);
    expect(state.fireCount).toBe(3);
  });

  it('дедлайн подстраивается под фактический интервал автоповтора', () => {
    const state = createHoldState();
    registerFire(state, 0);
    // До первого повтора ждём по худшему случаю системной задержки автоповтора.
    expect(state.deadlineMs).toBe(DEFAULT_HOLD_TIMING.firstRepeatMs);

    registerFire(state, 500); // задержка автоповтора 500 мс → дедлайн 1250 мс
    expect(state.deadlineMs).toBe(1250);

    registerFire(state, 533); // пошёл быстрый автоповтор 33 мс → дедлайн падает до нижней границы
    expect(state.deadlineMs).toBe(DEFAULT_HOLD_TIMING.repeatGraceMs);
  });

  it('медленный автоповтор не даёт ложного отпускания', () => {
    const state = createHoldState();
    registerFire(state, 0);
    registerFire(state, 400);
    registerFire(state, 800); // интервал 400 мс → дедлайн 1000 мс
    expect(checkRelease(state, 1500)).toBe(false);
    expect(checkRelease(state, 1900)).toBe(true);
  });

  it('тишина дольше дедлайна = отпускание, повторная проверка уже ничего не даёт', () => {
    const state = createHoldState();
    registerFire(state, 0);
    registerFire(state, 500);
    registerFire(state, 533);
    expect(checkRelease(state, 700)).toBe(false);
    expect(checkRelease(state, 900)).toBe(true);
    expect(state.pressed).toBe(false);
    expect(checkRelease(state, 5000)).toBe(false);
  });

  it('нажатие после паузы — новая серия, а не продолжение старой', () => {
    const state = createHoldState();
    registerFire(state, 0);
    registerFire(state, 500);
    expect(registerFire(state, 9000)).toBe(true);
    expect(state.fireCount).toBe(1);
    expect(state.firstFireAt).toBe(9000);
  });

  it('короткий тап: одно срабатывание и отпускание по первому дедлайну', () => {
    const state = createHoldState();
    expect(registerFire(state, 100)).toBe(true);
    expect(checkRelease(state, 1000)).toBe(false);
    expect(checkRelease(state, 1400)).toBe(true);
    expect(state.fireCount).toBe(1);
  });

  it('длительность нажатия и время до следующей проверки', () => {
    const state = createHoldState();
    expect(holdDurationMs(state, 100)).toBe(0);
    registerFire(state, 1000);
    registerFire(state, 1500);
    expect(holdDurationMs(state, 1600)).toBe(600);
    expect(nextCheckDelayMs(state, 1600)).toBe(1500 + state.deadlineMs - 1600);
    checkRelease(state, 9000);
    expect(holdDurationMs(state, 9000)).toBe(500);
    expect(nextCheckDelayMs(state, 9000)).toBe(0);
  });
});
