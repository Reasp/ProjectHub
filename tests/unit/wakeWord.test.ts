import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WAKE_WORD_PHRASES,
  applyWakeGate,
  createWakeWindow,
  matchWakeWord
} from '../../src/services/wakeWord';

describe('matchWakeWord: ключевое слово по транскрипту (TASK-83, AC #1)', () => {
  it('отделяет ключевое слово от команды и сохраняет исходный регистр команды', () => {
    expect(matchWakeWord('Хаб, открой задачи')).toMatchObject({
      matched: true,
      command: 'открой задачи',
      phrase: 'хаб'
    });
    expect(matchWakeWord('хаб открой проект WorldSim').command).toBe('открой проект WorldSim');
  });

  it('длинная фраза выигрывает у короткой', () => {
    expect(matchWakeWord('Привет, Хаб! Открой гит')).toMatchObject({
      matched: true,
      command: 'Открой гит',
      phrase: 'привет хаб'
    });
  });

  it('одно ключевое слово без команды — совпадение с пустой командой', () => {
    expect(matchWakeWord('Хаб.')).toMatchObject({ matched: true, command: '' });
    expect(matchWakeWord('  хаб  ')).toMatchObject({ matched: true, command: '' });
  });

  it('сопоставление по словам, а не по подстроке', () => {
    expect(matchWakeWord('хабар открой задачи').matched).toBe(false);
    expect(matchWakeWord('расхаб открой').matched).toBe(false);
    // Ключевое слово должно стоять в начале фразы.
    expect(matchWakeWord('открой хаб задачи').matched).toBe(false);
  });

  it('регистр, «ё» и английские варианты', () => {
    expect(matchWakeWord('ХАБ ОТКРОЙ ГИТ').matched).toBe(true);
    expect(matchWakeWord('Эй, хаб, открой доки')).toMatchObject({ matched: true, command: 'открой доки' });
    expect(matchWakeWord('Hey Hub, open tasks')).toMatchObject({ matched: true, command: 'open tasks' });
  });

  it('нераспознанное обращение возвращает исходный текст без изменений', () => {
    expect(matchWakeWord('  Открой задачи  ')).toEqual({ matched: false, command: 'Открой задачи' });
    expect(matchWakeWord('')).toEqual({ matched: false, command: '' });
  });

  it('пустой или мусорный список фраз не ломает разбор', () => {
    expect(matchWakeWord('хаб открой задачи', []).matched).toBe(false);
    expect(matchWakeWord('хаб открой задачи', ['', '   ']).matched).toBe(false);
    expect(matchWakeWord('хаб открой', DEFAULT_WAKE_WORD_PHRASES).matched).toBe(true);
  });

  it('типичные ошибки Whisper на «хаб» принимаются без настройки (замер 2026-09-17)', () => {
    expect(matchWakeWord('Хап, открой задачи.')).toMatchObject({ matched: true, command: 'открой задачи.' });
    expect(matchWakeWord('Привет, хап, прочитай задачи.')).toMatchObject({ matched: true, command: 'прочитай задачи.' });
    expect(matchWakeWord('Привет, Кап, хочу посмотреть, что сейчас в работе.')).toMatchObject({
      matched: true,
      phrase: 'привет хаб',
      command: 'хочу посмотреть, что сейчас в работе.'
    });
    expect(matchWakeWord('Привет, хабп, почитай задачи.').matched).toBe(true);
  });

  it('одиночное «кап» — не обращение: слишком похоже на обычную речь', () => {
    expect(matchWakeWord('Кап, открой задачи').matched).toBe(false);
    expect(matchWakeWord('капитан открой задачи').matched).toBe(false);
  });

  it('пользовательская фраза заменяет список по умолчанию', () => {
    expect(matchWakeWord('компьютер открой гит', ['компьютер'])).toMatchObject({
      matched: true,
      command: 'открой гит'
    });
    expect(matchWakeWord('хаб открой гит', ['компьютер']).matched).toBe(false);
  });
});

describe('applyWakeGate: окно ожидания команды после ключевого слова', () => {
  it('выключенное ключевое слово пропускает любую непустую фразу', () => {
    const state = createWakeWindow();
    expect(applyWakeGate('открой задачи', { enabled: false, now: 0 }, state)).toMatchObject({
      accepted: true,
      command: 'открой задачи'
    });
    expect(applyWakeGate('   ', { enabled: false, now: 0 }, state).accepted).toBe(false);
  });

  it('включённое ключевое слово отсекает фразы без обращения', () => {
    const state = createWakeWindow();
    expect(applyWakeGate('открой задачи', { enabled: true, now: 0 }, state)).toMatchObject({
      accepted: false,
      awaitingCommand: false
    });
  });

  it('«Хаб» → пауза → «открой задачи» выполняется как одна команда', () => {
    const state = createWakeWindow();
    expect(applyWakeGate('Хаб', { enabled: true, now: 1000 }, state)).toMatchObject({
      accepted: false,
      awaitingCommand: true
    });
    expect(applyWakeGate('открой задачи', { enabled: true, now: 3000 }, state)).toMatchObject({
      accepted: true,
      command: 'открой задачи'
    });
    // Окно одноразовое: следующая фраза снова требует обращения.
    expect(applyWakeGate('открой гит', { enabled: true, now: 3500 }, state).accepted).toBe(false);
  });

  it('окно закрывается по таймауту', () => {
    const state = createWakeWindow();
    applyWakeGate('Хаб', { enabled: true, now: 0, windowMs: 5000 }, state);
    expect(applyWakeGate('открой задачи', { enabled: true, now: 6000, windowMs: 5000 }, state).accepted).toBe(false);
  });

  it('обращение с командой в одной фразе окно не открывает', () => {
    const state = createWakeWindow();
    expect(applyWakeGate('Хаб, открой гит', { enabled: true, now: 0 }, state)).toMatchObject({
      accepted: true,
      command: 'открой гит',
      awaitingCommand: false
    });
    expect(state.openUntil).toBe(0);
  });
});
