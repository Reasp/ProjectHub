import { describe, expect, it } from 'vitest';
import {
  decideAfterQwenWarmup,
  decideQwenReply,
  isSystemSpeechFailure,
  qwenSkipReason,
  RENDERER_TTS_ERROR_CODES,
  replyOutcomeNotice,
  shouldPrewarmQwen,
  speaksWithQwen,
  SYSTEM_TTS_FAILED,
  ttsNoticeView,
  type TtsNoticeLabels
} from '../../src/services/ttsReplyPolicy';

/**
 * Реплика при незагруженной модели Qwen3-TTS (TASK-119, decision-66): ждать прогрева сколько нужно,
 * запасных движков у Qwen нет, не смог — показать причину.
 */
const installed = { runtimeReady: true, models: { custom: true, design: true, base: true } };
const PRESET = 'qwen:custom:serena';
const SAVED = 'qwen:design:warm';

describe('decideQwenReply — решение до ожидания', () => {
  it('модель голоса в памяти — озвучиваем сразу', () => {
    expect(decideQwenReply({ status: 'ready', modelKind: 'custom', install: installed }, PRESET)).toEqual({ action: 'speak' });
  });

  it('модель не загружена, грузится или в памяти другая — ждём прогрева', () => {
    for (const status of ['unloaded', 'starting', 'loading']) {
      expect(decideQwenReply({ status, modelKind: null, install: installed }, PRESET)).toEqual({ action: 'wait' });
    }
    // сохранённый голос звучит моделью Base, а загружена VoiceDesign
    expect(decideQwenReply({ status: 'ready', modelKind: 'design', install: installed }, SAVED)).toEqual({ action: 'wait' });
  });

  it('прошлая загрузка упала — всё равно ждём повтора: пользователь выбрал Qwen', () => {
    expect(
      decideQwenReply({ status: 'error', errorCode: 'qwen_out_of_memory', modelKind: null, install: installed }, PRESET)
    ).toEqual({ action: 'wait' });
  });

  it('движок не установлен, модели нет или он признан недоступным — реплика не звучит, причина видна', () => {
    expect(decideQwenReply({ status: 'unloaded', install: { runtimeReady: false, models: {} } }, PRESET)).toEqual({
      action: 'fail',
      reason: 'qwen_not_installed'
    });
    expect(
      decideQwenReply({ status: 'unloaded', install: { runtimeReady: true, models: { custom: false } } }, PRESET)
    ).toEqual({ action: 'fail', reason: 'qwen_model_missing' });
    expect(
      decideQwenReply({ status: 'unavailable', errorCode: 'qwen_sidecar_crashed', install: installed }, PRESET)
    ).toEqual({ action: 'fail', reason: 'qwen_sidecar_crashed' });
    expect(decideQwenReply(null, PRESET)).toMatchObject({ action: 'fail' });
  });

  it('голос не Qwen — движок не может озвучить', () => {
    expect(decideQwenReply({ status: 'ready', modelKind: 'custom', install: installed }, 'ru_RU-irina-medium')).toMatchObject({
      action: 'fail'
    });
  });
});

describe('decideAfterQwenWarmup — решение после прогрева', () => {
  it('модель голоса загружена — озвучиваем выбранным голосом', () => {
    expect(decideAfterQwenWarmup({ status: 'ready', modelKind: 'custom' }, PRESET)).toEqual({ action: 'speak' });
    expect(decideAfterQwenWarmup({ status: 'ready', modelKind: 'base' }, SAVED)).toEqual({ action: 'speak' });
  });

  it('прогрев упал — причина из кода ошибки или текста', () => {
    expect(decideAfterQwenWarmup({ status: 'error', errorCode: 'qwen_sidecar_timeout' }, PRESET)).toEqual({
      action: 'fail',
      reason: 'qwen_sidecar_timeout'
    });
    expect(decideAfterQwenWarmup({ status: 'error', error: 'ipc closed' }, PRESET)).toEqual({ action: 'fail', reason: 'ipc closed' });
    expect(decideAfterQwenWarmup({ status: 'error' }, PRESET)).toEqual({ action: 'fail', reason: 'qwen_load_failed' });
    // загрузилась не та модель — например, настройки успели сменить голос
    expect(decideAfterQwenWarmup({ status: 'ready', modelKind: 'design' }, SAVED)).toMatchObject({ action: 'fail' });
  });
});

describe('speaksWithQwen — модель держится в памяти', () => {
  it('только при включённой озвучке и выбранном Qwen', () => {
    expect(speaksWithQwen({ ttsEnabled: true, ttsEngine: 'qwen' })).toBe(true);
    expect(speaksWithQwen({ ttsEnabled: false, ttsEngine: 'qwen' })).toBe(false);
    expect(speaksWithQwen({ ttsEnabled: true, ttsEngine: 'piper' })).toBe(false);
  });
});

describe('shouldPrewarmQwen — прогрев заранее', () => {
  const unloaded = { status: 'unloaded', modelKind: null, install: installed };

  it('озвучка включена, выбран Qwen, модели нет в памяти — прогреваем', () => {
    expect(shouldPrewarmQwen({ ttsEnabled: true, ttsEngine: 'qwen' }, unloaded, PRESET)).toBe(true);
  });

  it('выключена озвучка или выбран другой движок — видеопамять не занимаем', () => {
    expect(shouldPrewarmQwen({ ttsEnabled: false, ttsEngine: 'qwen' }, unloaded, PRESET)).toBe(false);
    expect(shouldPrewarmQwen({ ttsEnabled: true, ttsEngine: 'piper' }, unloaded, PRESET)).toBe(false);
    expect(shouldPrewarmQwen({ ttsEnabled: true, ttsEngine: 'system' }, unloaded, PRESET)).toBe(false);
  });

  it('уже загружен, не установлен, недоступен или прошлый прогрев упал — не прогреваем', () => {
    const cfg = { ttsEnabled: true, ttsEngine: 'qwen' as const };
    expect(shouldPrewarmQwen(cfg, { status: 'ready', modelKind: 'custom', install: installed }, PRESET)).toBe(false);
    expect(shouldPrewarmQwen(cfg, { status: 'unloaded', install: { runtimeReady: false } }, PRESET)).toBe(false);
    expect(shouldPrewarmQwen(cfg, { status: 'unavailable', install: installed }, PRESET)).toBe(false);
    expect(shouldPrewarmQwen(cfg, { status: 'error', install: installed }, PRESET)).toBe(false);
  });
});

describe('qwenSkipReason', () => {
  it('недоступность — код сбоя, иначе — чего не хватает', () => {
    expect(qwenSkipReason({ status: 'unavailable', errorCode: 'qwen_runtime_broken', install: installed })).toBe('qwen_runtime_broken');
    expect(qwenSkipReason({ status: 'unloaded', install: { runtimeReady: false } })).toBe('qwen_not_installed');
    expect(qwenSkipReason({ status: 'unloaded', install: installed })).toBe('qwen_model_missing');
    expect(qwenSkipReason(undefined)).toBe('qwen_not_installed');
  });
});

describe('isSystemSpeechFailure', () => {
  it('отмена новой репликой — не отказ, всё остальное — отказ', () => {
    expect(isSystemSpeechFailure('interrupted')).toBe(false);
    expect(isSystemSpeechFailure('canceled')).toBe(false);
    expect(isSystemSpeechFailure('synthesis-unavailable')).toBe(true);
    expect(isSystemSpeechFailure('audio-hardware')).toBe(true);
    expect(isSystemSpeechFailure(undefined)).toBe(true);
  });

  it('код отказа системного голоса переводится словарём рендерера', () => {
    expect(RENDERER_TTS_ERROR_CODES).toEqual([SYSTEM_TTS_FAILED]);
  });
});

describe('replyOutcomeNotice — что сказать пользователю о реплике', () => {
  it('прозвучал выбранный движок — уведомления нет', () => {
    expect(replyOutcomeNotice(['qwen'], [], 'qwen')).toBeNull();
    expect(replyOutcomeNotice(['piper', 'system'], [], 'piper')).toBeNull();
  });

  it('Qwen не смог — реплика не прозвучала, причина видна', () => {
    const failures = [{ engine: 'qwen' as const, reason: 'qwen_out_of_memory' }];
    expect(replyOutcomeNotice(['qwen'], failures, null)).toEqual({ kind: 'failed', failures });
  });

  it('Piper подстрахован системным голосом — почему ответил не он', () => {
    expect(replyOutcomeNotice(['piper', 'system'], [{ engine: 'piper', reason: 'voice_not_installed' }], 'system')).toEqual({
      kind: 'fallback',
      engine: 'system',
      reason: 'voice_not_installed'
    });
  });
});

describe('ttsNoticeView', () => {
  const labels: TtsNoticeLabels = {
    loading: 'Загружаю голос…',
    fallback: 'Ответил запасной голос ({engine}): {reason}',
    warmupFailed: 'Голос не загрузился: {reason}',
    failed: 'Реплика не озвучена. {reasons}',
    engines: { qwen: 'Qwen3-TTS', piper: 'Piper', system: 'системный голос' }
  };
  const translate = (code: string) =>
    ({ qwen_out_of_memory: 'не хватило видеопамяти', system_tts_failed: 'нет голосов' })[code] ?? code;

  it('ожидание и отказ висят до замены, остальное гаснет само', () => {
    expect(ttsNoticeView({ kind: 'loading' }, labels, translate)).toEqual({ text: 'Загружаю голос…', tone: 'info', autoHideMs: null });
    expect(ttsNoticeView({ kind: 'fallback', engine: 'system', reason: 'Voice x is not installed' }, labels, translate)).toEqual({
      text: 'Ответил запасной голос (системный голос): Voice x is not installed',
      tone: 'warn',
      autoHideMs: 6000
    });
    expect(ttsNoticeView({ kind: 'warmupFailed', reason: 'qwen_out_of_memory' }, labels, translate)).toMatchObject({
      text: 'Голос не загрузился: не хватило видеопамяти',
      tone: 'error'
    });
    expect(
      ttsNoticeView({ kind: 'failed', failures: [{ engine: 'qwen', reason: 'qwen_out_of_memory' }] }, labels, translate)
    ).toEqual({ text: 'Реплика не озвучена. Qwen3-TTS — не хватило видеопамяти', tone: 'error', autoHideMs: null });
    expect(
      ttsNoticeView(
        {
          kind: 'failed',
          failures: [
            { engine: 'piper', reason: 'Voice x is not installed' },
            { engine: 'system', reason: 'system_tts_failed' }
          ]
        },
        labels,
        translate
      ).text
    ).toBe('Реплика не озвучена. Piper — Voice x is not installed; системный голос — нет голосов');
  });
});
