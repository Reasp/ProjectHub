import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QWEN_VOICE_ID,
  QWEN_DRAFT_VOICE_ID,
  QWEN_VOICE_PREFIX,
  qwenReadiness,
  qwenVoiceKind,
  qwenVoiceModel,
  ttsEngineChain
} from '../../src/services/ttsEngineChain';
import * as registry from '../../electron/services/qwenTtsRegistry';

describe('цепочка движков озвучки (TASK-104, AC#1, AC#2)', () => {
  it('каждый следующий движок — деградация предыдущего, системный голос всегда последний', () => {
    expect(ttsEngineChain('qwen')).toEqual(['qwen', 'piper', 'system']);
    expect(ttsEngineChain('piper')).toEqual(['piper', 'system']);
    expect(ttsEngineChain('system')).toEqual(['system']);
  });

  it('неизвестное значение из старого конфига не ломает озвучку', () => {
    expect(ttsEngineChain('whatever' as never)).toEqual(['system']);
  });
});

describe('константы рендерера повторяют реестр main-процесса', () => {
  it('префикс, голос по умолчанию и черновик совпадают', () => {
    expect(QWEN_VOICE_PREFIX).toBe(registry.QWEN_VOICE_PREFIX);
    expect(DEFAULT_QWEN_VOICE_ID).toBe(registry.DEFAULT_QWEN_VOICE_ID);
    expect(QWEN_DRAFT_VOICE_ID).toBe(registry.QWEN_DRAFT_VOICE_ID);
  });

  it('вид голоса и его модель определяются так же, как в main', () => {
    for (const id of [DEFAULT_QWEN_VOICE_ID, QWEN_DRAFT_VOICE_ID, 'qwen:design:warm', 'qwen:custom:ryan']) {
      const parsed = registry.parseQwenVoiceId(id)!;
      expect(qwenVoiceKind(id)).toBe(parsed.kind);
      expect(qwenVoiceModel(id)).toBe(registry.modelForVoice(parsed));
    }
    expect(qwenVoiceModel('qwen:design:warm')).toBe('base');
    expect(qwenVoiceModel('ru_RU-irina-medium')).toBeNull();
    expect(qwenVoiceKind('ru_RU-irina-medium')).toBeNull();
    expect(qwenVoiceKind('qwen:clone:x')).toBeNull();
  });
});

describe('готовность Qwen3-TTS к реплике', () => {
  const install = { runtimeReady: true, models: { custom: true, design: true, base: true } };

  it('модель голоса в памяти — озвучиваем', () => {
    expect(qwenReadiness({ status: 'ready', modelKind: 'custom', install }, 'qwen:custom:serena')).toBe('speak');
    // сохранённый голос по описанию звучит моделью Base, а не VoiceDesign
    expect(qwenReadiness({ status: 'ready', modelKind: 'base', install }, 'qwen:design:warm')).toBe('speak');
    expect(qwenReadiness({ status: 'ready', modelKind: 'design', install }, 'qwen:design:warm')).toBe('warmup');
  });

  it('модель не загружена или загружена другая — грузим в фоне, фразу отдаём дальше', () => {
    expect(qwenReadiness({ status: 'unloaded', modelKind: null, install }, DEFAULT_QWEN_VOICE_ID)).toBe('warmup');
    expect(qwenReadiness({ status: 'starting', modelKind: null, install }, DEFAULT_QWEN_VOICE_ID)).toBe('warmup');
    expect(qwenReadiness({ status: 'loading', modelKind: null, install }, DEFAULT_QWEN_VOICE_ID)).toBe('warmup');
    expect(qwenReadiness({ status: 'ready', modelKind: 'design', install }, 'qwen:custom:serena')).toBe('warmup');
    // после единичного сбоя следующая реплика пробует поднять сайдкар снова
    expect(qwenReadiness({ status: 'error', modelKind: null, install }, DEFAULT_QWEN_VOICE_ID)).toBe('warmup');
  });

  it('движок не установлен, нет модели или он признан недоступным — пропускаем', () => {
    expect(qwenReadiness(null, DEFAULT_QWEN_VOICE_ID)).toBe('skip');
    expect(qwenReadiness({ status: 'unloaded' }, DEFAULT_QWEN_VOICE_ID)).toBe('skip');
    expect(
      qwenReadiness({ status: 'unloaded', install: { runtimeReady: false, models: { custom: true } } }, DEFAULT_QWEN_VOICE_ID)
    ).toBe('skip');
    expect(
      qwenReadiness(
        { status: 'ready', modelKind: 'custom', install: { runtimeReady: true, models: { custom: true, design: true } } },
        'qwen:design:warm'
      )
    ).toBe('skip');
    expect(qwenReadiness({ status: 'unavailable', modelKind: null, install }, DEFAULT_QWEN_VOICE_ID)).toBe('skip');
  });

  it('голос другого движка в настройке Qwen — пропускаем', () => {
    expect(qwenReadiness({ status: 'ready', modelKind: 'custom', install }, 'ru_RU-irina-medium')).toBe('skip');
    expect(qwenReadiness({ status: 'ready', modelKind: 'custom', install }, '')).toBe('skip');
  });
});
