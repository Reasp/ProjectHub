import { describe, expect, it } from 'vitest';

import {
  finalizeInstall,
  IDLE_INSTALL_PROGRESS,
  parseInstallEvent,
  QWEN_INSTALL_PHASES,
  reduceInstallEvent,
  type QwenInstallProgress
} from '../../electron/services/qwenInstallProgress';
import { en } from '../../src/i18n/en';
import { ru } from '../../src/i18n/ru';

const feed = (lines: string[]): QwenInstallProgress =>
  lines.reduce((state, line) => {
    const event = parseInstallEvent(line);
    return event ? reduceInstallEvent(state, event) : state;
  }, IDLE_INSTALL_PROGRESS);

describe('ход установки Qwen3-TTS (TASK-104, AC#2)', () => {
  it('сворачивает события скрипта в состояние для настроек', () => {
    const state = feed([
      '{"type":"phase","phase":"check","detail":"C:\\\\data"}',
      '{"type":"phase","phase":"torch","detail":"https://download.pytorch.org/whl/cu128"}',
      '{"type":"log","line":"Downloading torch-2.11.0 (2753.2 MB)"}'
    ]);
    expect(state).toMatchObject({ state: 'running', phase: 'torch', lastLine: 'Downloading torch-2.11.0 (2753.2 MB)' });
  });

  it('загрузка весов даёт счётчик байт по всем файлам', () => {
    const state = feed([
      '{"type":"phase","phase":"models","detail":"Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"}',
      '{"type":"progress","phase":"models","model":"custom","file":"CustomVoice/model.safetensors","receivedBytes":1000,"totalBytes":4000,"overallReceived":1500,"overallTotal":9000}'
    ]);
    expect(state).toMatchObject({
      phase: 'models',
      file: 'CustomVoice/model.safetensors',
      receivedBytes: 1000,
      totalBytes: 4000,
      overallReceived: 1500,
      overallTotal: 9000
    });
  });

  it('смена шага очищает строку вывода предыдущего', () => {
    const state = feed(['{"type":"log","line":"pip output"}', '{"type":"phase","phase":"verify"}']);
    expect(state).toMatchObject({ phase: 'verify', lastLine: '' });
  });

  it('неизвестный шаг не подменяет известный', () => {
    expect(feed(['{"type":"phase","phase":"venv"}', '{"type":"phase","phase":"mystery"}']).phase).toBe('venv');
  });

  it('ошибка скрипта приходит кодом; неизвестный код заменяется общим', () => {
    expect(feed(['{"type":"error","code":"qwen_python_missing","error":"Python 3.10–3.13 not found"}'])).toMatchObject({
      state: 'error',
      errorCode: 'qwen_python_missing'
    });
    expect(feed(['{"type":"error","code":"EWHATEVER","error":"boom"}']).errorCode).toBe('qwen_install_failed');
  });

  it('шум в выводе и неполные события игнорируются', () => {
    expect(parseInstallEvent('Looking in indexes: https://…')).toBeNull();
    expect(parseInstallEvent('{"type":"phase"}')).toBeNull();
    expect(parseInstallEvent('{"type":"progress","file":"x"}')).toBeNull();
    expect(parseInstallEvent('{"phase":"check"}')).toBeNull();
    expect(parseInstallEvent('{not json')).toBeNull();
    expect(feed(['garbage', '{"type":"phase","phase":"check"}', '\u0000']).phase).toBe('check');
  });

  it('длинные строки обрезаются, чтобы не раздувать состояние', () => {
    expect(feed([JSON.stringify({ type: 'log', line: 'x'.repeat(5000) })]).lastLine).toHaveLength(200);
    expect(feed([JSON.stringify({ type: 'error', code: 'qwen_pip_failed', error: 'y'.repeat(5000) })]).error).toHaveLength(300);
  });
});

describe('итог установки по коду выхода', () => {
  const running: QwenInstallProgress = { ...IDLE_INSTALL_PROGRESS, state: 'running', phase: 'packages' };

  it('сообщённый скриптом итог не переписывается', () => {
    const done = feed(['{"type":"done"}']);
    expect(finalizeInstall(done, 1)).toBe(done);
    const failed = feed(['{"type":"error","code":"qwen_disk_space","error":"need 9 GB"}']);
    expect(finalizeInstall(failed, 0)).toBe(failed);
  });

  it('молчаливое завершение трактуется по коду выхода', () => {
    expect(finalizeInstall(running, 0).state).toBe('done');
    expect(finalizeInstall(running, 1)).toMatchObject({ state: 'error', errorCode: 'qwen_install_failed' });
    expect(finalizeInstall(running, null)).toMatchObject({ state: 'error', errorCode: 'qwen_install_failed' });
  });
});

describe('названия шагов установки переведены', () => {
  for (const [name, dictionary] of Object.entries({ ru: ru.voice.settingsModal.qwen.phases, en: en.voice.settingsModal.qwen.phases })) {
    it(`у каждого шага есть название в ${name}`, () => {
      const missing = QWEN_INSTALL_PHASES.filter((phase) => !dictionary[phase]?.trim());
      expect(missing).toEqual([]);
      expect(Object.keys(dictionary).filter((key) => !(QWEN_INSTALL_PHASES as readonly string[]).includes(key))).toEqual([]);
    });
  }
});
