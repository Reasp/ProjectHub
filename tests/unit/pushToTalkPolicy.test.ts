import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOLD_TIMING,
  DEFAULT_PTT_ACCELERATOR,
  checkRelease,
  createHoldState,
  defaultPushToTalkSettings,
  holdDurationMs,
  holdTimingFromSettings,
  isValidAccelerator,
  nextCheckDelayMs,
  registerFire,
  sanitizePushToTalkSettings,
  supportsHoldMode
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

describe('sanitizePushToTalkSettings: настройки из voice-hotkey.json', () => {
  it('дефолты: на Windows удержание, на остальных платформах toggle', () => {
    expect(supportsHoldMode('win32')).toBe(true);
    expect(supportsHoldMode('darwin')).toBe(false);
    expect(defaultPushToTalkSettings('win32')).toMatchObject({
      enabled: true,
      accelerator: DEFAULT_PTT_ACCELERATOR,
      mode: 'hold',
      trayIndicator: true
    });
    expect(defaultPushToTalkSettings('linux').mode).toBe('toggle');
  });

  it('пустой или битый файл даёт рабочие дефолты', () => {
    expect(sanitizePushToTalkSettings(null, 'win32')).toEqual(defaultPushToTalkSettings('win32'));
    expect(sanitizePushToTalkSettings('строка', 'win32')).toEqual(defaultPushToTalkSettings('win32'));
    expect(sanitizePushToTalkSettings({ accelerator: 'Control' }, 'win32').accelerator).toBe(DEFAULT_PTT_ACCELERATOR);
  });

  it('режим hold вне Windows понижается до toggle: без автоповтора запись не остановилась бы', () => {
    expect(sanitizePushToTalkSettings({ mode: 'hold' }, 'darwin').mode).toBe('toggle');
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
