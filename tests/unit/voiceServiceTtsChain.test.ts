import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Цепочка движков озвучки в `voiceService.speak()` (TASK-104; TASK-119, decision-66): ответ агента
 * звучит выбранным голосом Qwen3-TTS; модель не в памяти — реплика ждёт её загрузки сколько нужно;
 * запасных движков у Qwen нет — не смог, реплика не звучит и пользователь видит причину. Piper
 * по-прежнему подстрахован системным голосом.
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
const warmupOpts: unknown[] = [];
/** Что рендерер сообщил main о режиме «держать модель в памяти». */
const keepLoadedCalls: boolean[] = [];
const systemUtterances: string[] = [];
/** Что вернёт прогрев модели: по умолчанию модель голоса загружается. */
const loadedModel = async (voiceId: string): Promise<Record<string, unknown>> => ({
  status: 'ready',
  modelKind: voiceId.startsWith('qwen:design:') ? 'base' : 'custom'
});
let warmupResult: (voiceId: string) => Promise<Record<string, unknown>> = loadedModel;
/** Как отвечает системный speechSynthesis: звучит, отказывает или молчит без событий. */
let systemBehavior: 'ok' | 'error' | 'silent' = 'ok';

const api = {
  getQwenTtsStatus: vi.fn(async () => qwenStatus),
  getTtsStatus: vi.fn(async () => piperStatus),
  warmupTts: vi.fn(async (voiceId: string, opts?: unknown) => {
    warmups.push(voiceId);
    warmupOpts.push(opts);
    return warmupResult(voiceId);
  }),
  setQwenTtsKeepLoaded: vi.fn(async (keep: boolean) => {
    keepLoadedCalls.push(keep);
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
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
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
        if (systemBehavior === 'silent') return;
        setTimeout(() => {
          if (systemBehavior === 'error') {
            utterance.onerror?.({ error: 'synthesis-unavailable' });
            return;
          }
          utterance.onstart?.();
          utterance.onend?.();
        }, 1);
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
type Notice = Parameters<Parameters<typeof voiceService.onTtsNotice>[0]>[0];
const notices: Notice[] = [];
voiceService.onTtsNotice((notice) => notices.push(notice));

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  vi.useRealTimers();
  outcome = () => 'audio';
  systemBehavior = 'ok';
  warmupResult = loadedModel;
  qwenStatus = { status: 'ready', modelKind: 'custom', install: installed };
  piperStatus = { status: 'ready', available: true };
  voiceService.saveConfig({
    ttsEnabled: true,
    ttsEngine: 'qwen',
    ttsVoiceId: '',
    ttsQwenVoiceId: 'qwen:custom:ryan',
    ttsQwenInstruct: 'Говори спокойно.'
  });
  // прогрев от смены движка в saveConfig идёт асинхронно — даём ему отработать до очистки
  await tick();
  spoken.length = 0;
  warmups.length = 0;
  warmupOpts.length = 0;
  keepLoadedCalls.length = 0;
  systemUtterances.length = 0;
  notices.length = 0;
  player.enqueue.mockClear();
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
    expect(notices).toEqual([null]);
  });

  it('сохранённый голос по описанию звучит моделью Base, а не той, что создаёт голоса', async () => {
    voiceService.saveConfig({ ttsQwenVoiceId: 'qwen:design:warm' });
    qwenStatus = { status: 'ready', modelKind: 'base', install: installed };
    await voiceService.speak('Готово.', 'ru');
    expect(spoken.map((r) => r.voiceId)).toEqual(['qwen:design:warm']);
    expect(warmups).toEqual([]);

    // в памяти VoiceDesign — реплика ждёт загрузки Base и звучит сохранённым голосом
    spoken.length = 0;
    qwenStatus = { status: 'ready', modelKind: 'design', install: installed };
    await voiceService.speak('Готово.', 'ru');
    expect(warmups).toEqual(['qwen:design:warm']);
    expect(spoken.map((r) => r.voiceId)).toEqual(['qwen:design:warm']);
  });

  it('модель не в памяти: реплика ждёт загрузки и звучит выбранным голосом (TASK-119)', async () => {
    qwenStatus = { status: 'unloaded', modelKind: null, install: installed };
    await voiceService.speak('Сборка прошла.', 'ru');

    expect(warmups).toEqual(['qwen:custom:ryan']);
    // автоматический прогрев не снимает недоступность движка после серии падений
    expect(warmupOpts).toEqual([{ auto: true }]);
    expect(spoken.map((r) => r.voiceId)).toEqual(['qwen:custom:ryan']);
    expect(systemUtterances).toEqual([]);
    // «Загружаю голос…» на время ожидания, снимается прозвучавшей репликой
    expect(notices).toEqual([{ kind: 'loading' }, null]);
  });

  it('долгая загрузка модели: реплика ждёт сколько нужно и звучит Qwen, запасных нет', async () => {
    vi.useFakeTimers();
    qwenStatus = { status: 'loading', modelKind: null, install: installed };
    let finishLoad: (state: Record<string, unknown>) => void = () => {};
    warmupResult = () => new Promise((resolve) => (finishLoad = resolve));

    const pending = voiceService.speak('Сборка прошла.', 'ru');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spoken).toEqual([]);
    expect(systemUtterances).toEqual([]);
    finishLoad({ status: 'ready', modelKind: 'custom' });
    await vi.advanceTimersByTimeAsync(100);
    await pending;

    expect(spoken.map((r) => r.voiceId)).toEqual(['qwen:custom:ryan']);
    expect(notices).toEqual([{ kind: 'loading' }, null]);
  });

  it('реплика во время загрузки ждёт тот же прогрев, а не запускает новый', async () => {
    qwenStatus = { status: 'loading', modelKind: null, install: installed };
    let finishLoad: (state: Record<string, unknown>) => void = () => {};
    warmupResult = () => new Promise((resolve) => (finishLoad = resolve));
    const first = voiceService.speak('Первая.', 'ru');
    await tick();
    const second = voiceService.speak('Вторая.', 'ru');
    await tick();
    finishLoad({ status: 'ready', modelKind: 'custom' });
    await Promise.all([first, second]);
    expect(warmups).toEqual(['qwen:custom:ryan']);
    // первую перебила вторая — звучит только последняя
    expect(spoken.map((r) => r.text)).toEqual(['Вторая.']);
  });

  it('загрузка упала: реплика не звучит ни одним движком, причина показана', async () => {
    qwenStatus = { status: 'unloaded', modelKind: null, install: installed };
    warmupResult = async () => ({ status: 'error', errorCode: 'qwen_out_of_memory' });
    await voiceService.speak('Сборка прошла.', 'ru');

    expect(spoken).toEqual([]);
    expect(systemUtterances).toEqual([]);
    expect(notices).toEqual([
      { kind: 'loading' },
      { kind: 'warmupFailed', reason: 'qwen_out_of_memory' },
      { kind: 'failed', failures: [{ engine: 'qwen', reason: 'qwen_out_of_memory' }] }
    ]);
  });

  it('прошлая загрузка упала: реплика повторяет её и звучит Qwen', async () => {
    qwenStatus = { status: 'error', errorCode: 'qwen_sidecar_timeout', modelKind: null, install: installed };
    await voiceService.speak('Сборка прошла.', 'ru');

    expect(warmups).toEqual(['qwen:custom:ryan']);
    expect(spoken.map((r) => r.voiceId)).toEqual(['qwen:custom:ryan']);
  });

  it('остановка озвучки снимает ожидание: реплика не звучит', async () => {
    qwenStatus = { status: 'loading', modelKind: null, install: installed };
    let finishLoad: (state: Record<string, unknown>) => void = () => {};
    warmupResult = () => new Promise((resolve) => (finishLoad = resolve));
    const pending = voiceService.speak('Сборка прошла.', 'ru');
    await tick(10);
    await voiceService.stopSpeaking();
    await pending;

    expect(spoken).toEqual([]);
    expect(systemUtterances).toEqual([]);
    expect(notices).toEqual([{ kind: 'loading' }, null]);
    // загрузка при этом не отменяется — модель пригодится следующей реплике
    finishLoad({ status: 'ready', modelKind: 'custom' });
    await tick();
  });

  it('движок не установлен: без попыток загрузки, реплика не звучит, причина видна', async () => {
    qwenStatus = { status: 'unloaded', install: { runtimeReady: false, models: {} } };
    await voiceService.speak('Сборка прошла.', 'ru');

    expect(warmups).toEqual([]);
    expect(spoken).toEqual([]);
    expect(systemUtterances).toEqual([]);
    expect(notices).toEqual([{ kind: 'failed', failures: [{ engine: 'qwen', reason: 'qwen_not_installed' }] }]);
  });

  it('движок признан недоступным: реплики его не перезапускают', async () => {
    qwenStatus = { status: 'unavailable', errorCode: 'qwen_sidecar_crashed', install: installed };
    await voiceService.speak('Сборка прошла.', 'ru');
    expect(warmups).toEqual([]);
    expect(spoken).toEqual([]);
    expect(notices).toEqual([{ kind: 'failed', failures: [{ engine: 'qwen', reason: 'qwen_sidecar_crashed' }] }]);
  });

  it('сайдкар упал на реплике: запасного движка нет, причина видна', async () => {
    outcome = () => 'error';
    await voiceService.speak('Сборка прошла.', 'ru');

    expect(spoken.map((r) => r.voiceId)).toEqual(['qwen:custom:ryan']);
    expect(systemUtterances).toEqual([]);
    expect(notices).toEqual([{ kind: 'failed', failures: [{ engine: 'qwen', reason: 'qwen_sidecar_crashed' }] }]);
  });

  it('запрос статуса упал: реплика не звучит, причина видна', async () => {
    api.getQwenTtsStatus.mockRejectedValueOnce(new Error('ipc closed'));
    await voiceService.speak('Сборка прошла.', 'ru');
    expect(spoken).toEqual([]);
    expect(notices).toEqual([{ kind: 'failed', failures: [{ engine: 'qwen', reason: 'ipc closed' }] }]);
  });

  it('Piper не сработал: говорит системный голос, пользователь видит почему', async () => {
    voiceService.saveConfig({ ttsEngine: 'piper' });
    await tick();
    notices.length = 0;
    piperStatus = { status: 'unavailable', available: false, error: 'native module missing' };
    await voiceService.speak('Сборка прошла.', 'ru');

    expect(spoken).toEqual([]);
    expect(systemUtterances).toEqual(['Сборка прошла.']);
    expect(notices).toEqual([{ kind: 'fallback', engine: 'system', reason: 'native module missing' }]);
  });

  it('не прозвучали ни Piper, ни системный голос: причина по каждому (TASK-119, AC#4)', async () => {
    voiceService.saveConfig({ ttsEngine: 'piper' });
    await tick();
    notices.length = 0;
    piperStatus = { status: 'unavailable', available: false, error: 'native module missing' };
    systemBehavior = 'error';
    await voiceService.speak('Сборка прошла.', 'ru');

    expect(systemUtterances).toEqual(['Сборка прошла.']);
    expect(notices).toEqual([
      {
        kind: 'failed',
        failures: [
          { engine: 'piper', reason: 'native module missing' },
          { engine: 'system', reason: 'system_tts_failed' }
        ]
      }
    ]);
  });

  it('системный голос молчит без единого события: отказ по пределу, а не вечное ожидание', async () => {
    voiceService.saveConfig({ ttsEngine: 'system' });
    vi.useFakeTimers();
    systemBehavior = 'silent';
    const pending = voiceService.speak('Сборка прошла.', 'ru');
    await vi.advanceTimersByTimeAsync(5_100);
    await pending;
    expect(notices.at(-1)).toEqual({ kind: 'failed', failures: [{ engine: 'system', reason: 'system_tts_failed' }] });
  });

  it('движок Piper и системный голос Qwen не запрашивают вовсе', async () => {
    voiceService.saveConfig({ ttsEngine: 'piper' });
    await tick();
    api.getQwenTtsStatus.mockClear();
    await voiceService.speak('Сборка прошла.', 'ru');
    expect(spoken.map((r) => r.voiceId)).toEqual(['ru_RU-irina-medium']);

    voiceService.saveConfig({ ttsEngine: 'system' });
    await tick();
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

describe('voiceService.prewarmTts — прогрев при старте и включении Qwen (TASK-119)', () => {
  it('выбран Qwen: модель держится в памяти и грузится заранее, без снятия недоступности', async () => {
    qwenStatus = { status: 'unloaded', modelKind: null, install: installed };
    await voiceService.prewarmTts();
    await tick();
    expect(keepLoadedCalls).toEqual([true]);
    expect(warmups).toEqual(['qwen:custom:ryan']);
    expect(warmupOpts).toEqual([{ auto: true }]);
  });

  it('выбрали другой движок или выключили озвучку — main возвращает выгрузку по простою', async () => {
    voiceService.saveConfig({ ttsEngine: 'piper' });
    await tick();
    voiceService.saveConfig({ ttsEngine: 'qwen' });
    await tick();
    voiceService.saveConfig({ ttsEnabled: false });
    await tick();
    expect(keepLoadedCalls).toEqual([false, true, false]);
  });

  it('прогрев при старте и реплика во время него — одна загрузка на двоих', async () => {
    qwenStatus = { status: 'unloaded', modelKind: null, install: installed };
    let finishLoad: (state: Record<string, unknown>) => void = () => {};
    warmupResult = () => new Promise((resolve) => (finishLoad = resolve));
    await voiceService.prewarmTts();
    qwenStatus = { status: 'loading', modelKind: null, install: installed };
    const pending = voiceService.speak('Сборка прошла.', 'ru');
    await tick();
    finishLoad({ status: 'ready', modelKind: 'custom' });
    await pending;
    expect(warmups).toEqual(['qwen:custom:ryan']);
    expect(spoken.map((r) => r.voiceId)).toEqual(['qwen:custom:ryan']);
  });

  it('неудачный прогрев при старте показывается', async () => {
    qwenStatus = { status: 'unloaded', modelKind: null, install: installed };
    warmupResult = async () => ({ status: 'error', errorCode: 'qwen_runtime_broken' });
    await voiceService.prewarmTts();
    await tick();
    expect(notices).toEqual([{ kind: 'warmupFailed', reason: 'qwen_runtime_broken' }]);
  });

  it('модель уже в памяти, другой движок или озвучка выключена — не прогревает', async () => {
    await voiceService.prewarmTts();
    qwenStatus = { status: 'unloaded', modelKind: null, install: installed };
    voiceService.saveConfig({ ttsEngine: 'piper' });
    await voiceService.prewarmTts();
    voiceService.saveConfig({ ttsEngine: 'qwen', ttsEnabled: false });
    await voiceService.prewarmTts();
    await tick();
    expect(warmups).toEqual([]);
  });

  it('включение Qwen в настройках сразу грузит модель голоса', async () => {
    voiceService.saveConfig({ ttsEngine: 'system' });
    await tick();
    qwenStatus = { status: 'unloaded', modelKind: null, install: installed };
    voiceService.saveConfig({ ttsEngine: 'qwen' });
    await tick();
    expect(warmups).toEqual(['qwen:custom:ryan']);
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
