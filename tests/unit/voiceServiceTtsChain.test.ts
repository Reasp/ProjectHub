import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Цепочка движков озвучки в `voiceService.speak()` (TASK-104, AC#1–AC#3): ответ агента звучит
 * выбранным голосом Qwen3-TTS, а если модель не в памяти или движок неисправен — следующим
 * движком, без ожидания и без краха.
 *
 * Рендерер в тесте — заглушки `window.api` и плеера: проверяется, что и в каком порядке
 * запрашивается у main, а не звук.
 */
const player = vi.hoisted(() => ({
  isPlaying: false,
  begin: vi.fn(async () => {}),
  enqueue: vi.fn(async () => true),
  stop: vi.fn(async () => {}),
  onEnded: vi.fn(() => () => {})
}));
vi.mock('../../src/services/ttsPlayer', () => ({ ttsPlayer: player }));

type Listener<T> = (payload: T) => void;
interface SpeakRequest {
  jobId: string;
  voiceId: string;
  text: string;
  language?: string;
  instruct?: string;
  speed?: number;
}

const events = {
  chunk: [] as Listener<{ jobId: string; samples: Float32Array; sampleRate: number; index: number }>[],
  done: [] as Listener<{ jobId: string; timeMs: number; audioSec: number; chunks: number }>[],
  error: [] as Listener<{ jobId: string; error: string; errorCode?: string }>[]
};

const installed = { runtimeReady: true, models: { custom: true, design: true, base: true } };
let qwenStatus: Record<string, unknown> = {};
let piperStatus: Record<string, unknown> = {};
/** Как main отвечает на задание: звуком или ошибкой движка. */
let outcome: (req: SpeakRequest) => 'audio' | 'error' = () => 'audio';
const spoken: SpeakRequest[] = [];
const warmups: string[] = [];
const systemUtterances: string[] = [];

const api = {
  getQwenTtsStatus: vi.fn(async () => qwenStatus),
  getTtsStatus: vi.fn(async () => piperStatus),
  warmupTts: vi.fn(async (voiceId: string) => {
    warmups.push(voiceId);
    return {};
  }),
  cancelTts: vi.fn(async () => true),
  speakTts: vi.fn(async (req: SpeakRequest) => {
    spoken.push(req);
    const result = outcome(req);
    // события приходят после ответа на вызов, как в приложении
    setTimeout(() => {
      if (result === 'audio') {
        for (const cb of events.chunk) cb({ jobId: req.jobId, samples: new Float32Array(2400), sampleRate: 24000, index: 0 });
        setTimeout(() => {
          for (const cb of events.done) cb({ jobId: req.jobId, timeMs: 10, audioSec: 0.1, chunks: 1 });
        }, 5);
      } else {
        for (const cb of events.error) cb({ jobId: req.jobId, error: 'sidecar exited', errorCode: 'qwen_sidecar_crashed' });
      }
    }, 5);
    return { ok: true };
  }),
  onTtsChunk: (cb: (typeof events.chunk)[number]) => (events.chunk.push(cb), () => {}),
  onTtsDone: (cb: (typeof events.done)[number]) => (events.done.push(cb), () => {}),
  onTtsError: (cb: (typeof events.error)[number]) => (events.error.push(cb), () => {})
};

class FakeUtterance {
  lang = '';
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

const storage = new Map<string, string>();
Object.assign(globalThis, {
  window: {
    api,
    speechSynthesis: {
      cancel: () => {},
      speak: (utterance: FakeUtterance) => {
        systemUtterances.push(utterance.text);
        setTimeout(() => utterance.onend?.(), 1);
      }
    }
  },
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value)
  },
  SpeechSynthesisUtterance: FakeUtterance
});

const { voiceService } = await import('../../src/services/voiceService');

beforeEach(() => {
  spoken.length = 0;
  warmups.length = 0;
  systemUtterances.length = 0;
  outcome = () => 'audio';
  qwenStatus = { status: 'ready', modelKind: 'custom', install: installed };
  piperStatus = { status: 'ready', available: true };
  player.enqueue.mockClear();
  voiceService.saveConfig({
    ttsEnabled: true,
    ttsEngine: 'qwen',
    ttsVoiceId: '',
    ttsQwenVoiceId: 'qwen:custom:ryan',
    ttsQwenInstruct: 'Говори спокойно.'
  });
});

describe('voiceService.speak — цепочка движков (TASK-104)', () => {
  it('модель в памяти: реплика звучит выбранным голосом Qwen с инструкцией подачи', async () => {
    await voiceService.speak('Сборка прошла.', 'ru');

    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toMatchObject({
      voiceId: 'qwen:custom:ryan',
      text: 'Сборка прошла.',
      language: 'ru',
      instruct: 'Говори спокойно.'
    });
    expect(player.enqueue).toHaveBeenCalledTimes(1);
    // пауза пополнения буфера включена только для Qwen
    expect(player.enqueue.mock.calls[0][3]).toMatchObject({ rebufferSec: 0.25 });
    expect(systemUtterances).toEqual([]);
    expect(voiceService.getLastTtsError()).toBeNull();
  });

  it('сохранённый голос по описанию ждёт модель Base, а не ту, что создаёт голоса', async () => {
    voiceService.saveConfig({ ttsQwenVoiceId: 'qwen:design:warm' });
    qwenStatus = { status: 'ready', modelKind: 'base', install: installed };
    await voiceService.speak('Готово.', 'ru');
    expect(spoken.map((r) => r.voiceId)).toEqual(['qwen:design:warm']);

    spoken.length = 0;
    qwenStatus = { status: 'ready', modelKind: 'design', install: installed };
    await voiceService.speak('Готово.', 'ru');
    expect(warmups).toEqual(['qwen:design:warm']);
    expect(spoken.map((r) => r.voiceId)).toEqual(['ru_RU-irina-medium']);
  });

  it('модель не в памяти: загрузка идёт в фоне, фразу без ожидания озвучивает Piper', async () => {
    qwenStatus = { status: 'unloaded', modelKind: null, install: installed };
    await voiceService.speak('Сборка прошла.', 'ru');

    expect(warmups).toEqual(['qwen:custom:ryan']);
    expect(spoken.map((r) => r.voiceId)).toEqual(['ru_RU-irina-medium']);
    expect(player.enqueue.mock.calls[0][3].rebufferSec).toBe(0);
    expect(systemUtterances).toEqual([]);
  });

  it('движок не установлен: без попыток загрузки, говорит Piper; причина видна в настройках', async () => {
    qwenStatus = { status: 'unloaded', install: { runtimeReady: false, models: {} } };
    await voiceService.speak('Сборка прошла.', 'ru');

    expect(warmups).toEqual([]);
    expect(spoken.map((r) => r.voiceId)).toEqual(['ru_RU-irina-medium']);
  });

  it('движок признан недоступным: реплики его не трогают', async () => {
    qwenStatus = { status: 'unavailable', errorCode: 'qwen_sidecar_crashed', install: installed };
    await voiceService.speak('Сборка прошла.', 'ru');
    expect(warmups).toEqual([]);
    expect(spoken.map((r) => r.voiceId)).toEqual(['ru_RU-irina-medium']);
  });

  it('сайдкар упал на реплике: она озвучивается следующим движком', async () => {
    outcome = (req) => (req.voiceId.startsWith('qwen:') ? 'error' : 'audio');
    await voiceService.speak('Сборка прошла.', 'ru');

    expect(spoken.map((r) => r.voiceId)).toEqual(['qwen:custom:ryan', 'ru_RU-irina-medium']);
    expect(systemUtterances).toEqual([]);
  });

  it('не сработали ни Qwen, ни Piper: остаётся системный голос', async () => {
    qwenStatus = { status: 'unloaded', modelKind: null, install: installed };
    piperStatus = { status: 'unavailable', available: false, error: 'native module missing' };
    await voiceService.speak('Сборка прошла.', 'ru');

    expect(spoken).toEqual([]);
    expect(systemUtterances).toEqual(['Сборка прошла.']);
  });

  it('запрос статуса упал: реплика всё равно звучит', async () => {
    api.getQwenTtsStatus.mockRejectedValueOnce(new Error('ipc closed'));
    await voiceService.speak('Сборка прошла.', 'ru');
    expect(spoken.map((r) => r.voiceId)).toEqual(['ru_RU-irina-medium']);
  });

  it('движок Piper и системный голос Qwen не запрашивают вовсе', async () => {
    api.getQwenTtsStatus.mockClear();
    voiceService.saveConfig({ ttsEngine: 'piper' });
    await voiceService.speak('Сборка прошла.', 'ru');
    expect(spoken.map((r) => r.voiceId)).toEqual(['ru_RU-irina-medium']);

    voiceService.saveConfig({ ttsEngine: 'system' });
    await voiceService.speak('Сборка прошла.', 'ru');
    expect(systemUtterances).toEqual(['Сборка прошла.']);
    expect(api.getQwenTtsStatus).not.toHaveBeenCalled();
  });

  it('озвучка выключена — ни один движок не вызывается', async () => {
    voiceService.saveConfig({ ttsEnabled: false });
    await voiceService.speak('Сборка прошла.', 'ru');
    expect(spoken).toEqual([]);
    expect(systemUtterances).toEqual([]);
  });
});

describe('voiceService.previewQwenVoice — прослушивание в настройках', () => {
  it('ждёт загрузки модели и не уходит в запасной движок', async () => {
    qwenStatus = { status: 'unloaded', modelKind: null, install: installed };
    const played = await voiceService.previewQwenVoice('Проба.', 'ru', { voiceId: 'qwen:custom:serena', instruct: 'Бодро.' });

    expect(played).toBe(true);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toMatchObject({ voiceId: 'qwen:custom:serena', instruct: 'Бодро.' });
    expect(warmups).toEqual([]);
  });

  it('проба черновика передаёт рецепт; неудача возвращает код причины', async () => {
    const draft = { instruct: 'A calm female voice, warm timbre', seed: 42 };
    expect(await voiceService.previewQwenVoice('Проба.', 'ru', { draft })).toBe(true);
    expect(spoken[0]).toMatchObject({ voiceId: 'qwen:design:@draft', draft });

    outcome = () => 'error';
    expect(await voiceService.previewQwenVoice('Проба.', 'ru', { draft })).toBe(false);
    expect(voiceService.getLastTtsError()).toBe('qwen_sidecar_crashed');
    expect(systemUtterances).toEqual([]);
  });
});
