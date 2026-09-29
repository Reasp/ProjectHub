import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: (name: string) => (name === 'userData' ? path.join(os.tmpdir(), `projecthub-qwen-svc-${process.pid}`) : os.homedir()),
    getAppPath: () => path.join(os.tmpdir(), 'projecthub-test-app.asar')
  }
}));

const { QwenTtsService } = await import('../../electron/services/qwenTtsService');
type Service = InstanceType<typeof QwenTtsService>;
type Deps = NonNullable<ConstructorParameters<typeof QwenTtsService>[0]>;

const FAKE_SIDECAR = path.resolve('tests/helpers/fakeQwenSidecar.mjs');

/** Сервис поверх поддельного сайдкара; stderr сайдкара собирается для проверки параметров синтеза. */
function createService(mode: string, overrides: Partial<Deps> = {}, env: Record<string, string> = {}) {
  const stderr: string[] = [];
  const spawned: ChildProcessWithoutNullStreams[] = [];
  const service = new QwenTtsService({
    spawnSidecar: async () => {
      const child = spawn(process.execPath, [FAKE_SIDECAR], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FAKE_QWEN_MODE: mode, ...env }
      });
      child.stderr.on('data', (d: Buffer) => stderr.push(d.toString()));
      spawned.push(child);
      return child;
    },
    getInstallStatus: async () => ({ runtimeReady: true, models: { custom: true, design: true, base: true } }),
    getModelDir: (kind) => `/models/${kind}`,
    getVoiceReference: async (slug) =>
      slug === 'warm' ? { refAudio: '/voices/warm.wav', refText: 'Текст эталона', seed: 77 } : null,
    idleUnloadMs: () => 60_000,
    ...overrides
  });
  services.push(service);
  return { service, stderr, spawned };
}

const services: Service[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
});

interface Outcome {
  chunks: Array<{ samples: Float32Array; sampleRate: number; index: number }>;
  done?: { audioSec: number; chunks: number };
  error?: { error: string; errorCode?: string };
}

function speak(service: Service, req: Parameters<Service['speak']>[0]): Promise<Outcome> {
  const outcome: Outcome = { chunks: [] };
  return service
    .speak(req, {
      onChunk: (chunk) => outcome.chunks.push(chunk),
      onDone: (info) => {
        outcome.done = info;
      },
      onError: (info) => {
        outcome.error = info;
      }
    })
    .then(() => outcome);
}

const waitFor = async (check: () => boolean, timeoutMs = 5000) => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition was not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('qwenTtsService — синтез через сайдкар (TASK-104, AC#2, AC#3)', () => {
  it('поднимает сайдкар по требованию, грузит модель и отдаёт звук чанками', async () => {
    const { service, spawned } = createService('ok');
    expect(service.getState()).toMatchObject({ status: 'unloaded', processActive: false });

    const result = await speak(service, { jobId: 'j1', text: 'Сборка прошла.', voiceId: 'qwen:custom:serena', language: 'ru' });

    expect(result.error).toBeUndefined();
    expect(result.chunks.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(result.chunks[0].sampleRate).toBe(24000);
    expect(result.chunks[0].samples).toBeInstanceOf(Float32Array);
    expect(result.chunks[0].samples).toHaveLength(2400);
    // int16 декодирован в диапазон -1..1
    expect(Math.max(...result.chunks[0].samples)).toBeLessThan(0.5);
    expect(result.done).toMatchObject({ chunks: 3 });
    expect(result.done!.audioSec).toBeCloseTo(0.3, 3);
    expect(service.getState()).toMatchObject({ status: 'ready', modelKind: 'custom', gpu: 'Fake GPU', vramMb: 4456 });
    expect(spawned).toHaveLength(1);
  });

  it('каждый фрагмент текста — отдельный запрос, нумерация чанков сквозная', async () => {
    const { service } = createService('ok');
    const result = await speak(service, {
      jobId: 'j1',
      text: 'Первое предложение. Второе предложение.',
      voiceId: 'qwen:custom:ryan',
      language: 'ru'
    });
    expect(result.chunks.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.done).toMatchObject({ chunks: 6 });
  });

  it('пресет-голос передаёт диктора, инструкцию подачи и язык', async () => {
    const { service, stderr } = createService('ok');
    await speak(service, {
      jobId: 'j1',
      text: 'Hello.',
      voiceId: 'qwen:custom:ryan',
      language: 'en',
      instruct: '  Говори   бодро\n'
    });
    expect(stderr.join('')).toContain('"speaker":"ryan","instruct":"Говори бодро","language":"English","text":"Hello."');
  });

  it('сохранённый голос по описанию звучит клоном эталонной записи на модели Base', async () => {
    const { service, stderr } = createService('ok');
    const result = await speak(service, { jobId: 'j1', text: 'Готово.', voiceId: 'qwen:design:warm', language: 'ru' });
    expect(result.done).toBeDefined();
    expect(stderr.join('')).toContain('"refAudio":"/voices/warm.wav","seed":77,"language":"Russian","text":"Готово."');
    // описание голоса в синтез не уходит: VoiceDesign на каждой фразе дала бы другой голос
    expect(stderr.join('')).not.toContain('instruct');
    expect(service.getState().modelKind).toBe('base');
  });

  it('проба черновика голоса берёт рецепт из запроса и отвергает некорректный', async () => {
    const { service, stderr, spawned } = createService('ok');
    const bad = await speak(service, {
      jobId: 'j0',
      text: 'Проба.',
      voiceId: 'qwen:design:@draft',
      draft: { instruct: 'коротко', seed: 5 }
    });
    expect(bad.error?.errorCode).toBe('qwen_invalid_recipe');
    // до сайдкара дело не дошло
    expect(spawned).toHaveLength(0);

    const good = await speak(service, {
      jobId: 'j1',
      text: 'Проба.',
      voiceId: 'qwen:design:@draft',
      draft: { instruct: 'Спокойный мужской голос, низкий тембр', seed: 42 }
    });
    expect(good.done).toBeDefined();
    expect(stderr.join('')).toContain('"seed":42');
    expect(service.getState().modelKind).toBe('design');
  });

  it('проба произносит текст эталона одним фрагментом, её звук становится эталоном голоса', async () => {
    const { service, stderr } = createService('ok');
    const instruct = 'Спокойный мужской голос, низкий тембр';
    expect(service.getDraftAudio(instruct, 42)).toBeNull();

    const probe = await speak(service, {
      jobId: 'j1',
      text: 'Первое предложение. Второе предложение.',
      voiceId: 'qwen:design:@draft',
      language: 'ru',
      draft: { instruct: `  ${instruct}  `, seed: 42 }
    });
    // текст запроса заменён текстом эталона и не разрезан на предложения
    expect(probe.chunks).toHaveLength(3);
    expect(stderr.join('')).toContain('"text":"Это проба голоса для озвучки ответов');
    expect(stderr.join('')).not.toContain('Первое предложение');

    const audio = service.getDraftAudio(instruct, 42);
    expect(audio).toMatchObject({ sampleRate: 24000 });
    expect(audio!.samples).toHaveLength(7200);
    expect(audio!.text.startsWith('Это проба голоса')).toBe(true);
    // звук — склейка чанков в порядке прихода
    expect(Array.from(audio!.samples.slice(2400, 2410))).toEqual(Array.from(probe.chunks[1].samples.slice(0, 10)));

    // другой рецепт этой записью не сохранить
    expect(service.getDraftAudio(instruct, 43)).toBeNull();
    expect(service.getDraftAudio(`${instruct}, быстрый темп`, 42)).toBeNull();
    expect(service.getDraftAudio(instruct, '42')).toBeNull();
  });

  it('оборванная отменой проба эталоном не становится', async () => {
    const { service } = createService('ok', {}, { FAKE_QWEN_CHUNK_DELAY_MS: '60' });
    const instruct = 'Спокойный мужской голос, низкий тембр';
    let chunks = 0;
    const finished = service.speak(
      { jobId: 'j1', text: 'Проба.', voiceId: 'qwen:design:@draft', draft: { instruct, seed: 42 } },
      { onChunk: () => (chunks += 1), onDone: () => {}, onError: () => {} }
    );
    await waitFor(() => chunks >= 1);
    service.cancel('j1');
    await finished;
    expect(service.getDraftAudio(instruct, 42)).toBeNull();
  });

  it('смена вида голоса перезагружает модель в том же процессе', async () => {
    const { service, spawned } = createService('ok');
    await speak(service, { jobId: 'j1', text: 'Раз.', voiceId: 'qwen:custom:serena' });
    expect(service.getState().modelKind).toBe('custom');
    await speak(service, { jobId: 'j2', text: 'Два.', voiceId: 'qwen:design:warm' });
    expect(service.getState().modelKind).toBe('base');
    expect(spawned).toHaveLength(1);
  });

  it('неизвестный голос и несуществующий рецепт дают код, а не исключение', async () => {
    const { service } = createService('ok');
    const unknown = await speak(service, { jobId: 'j1', text: 'Текст.', voiceId: 'qwen:custom:nobody' });
    expect(unknown.error?.errorCode).toBe('qwen_voice_not_found');
    const missing = await speak(service, { jobId: 'j2', text: 'Текст.', voiceId: 'qwen:design:absent' });
    expect(missing.error?.errorCode).toBe('qwen_voice_not_found');
  });

  it('отмена останавливает генерацию и не сообщает ни done, ни error', async () => {
    const { service } = createService('ok', {}, { FAKE_QWEN_CHUNK_DELAY_MS: '60' });
    const outcome: Outcome = { chunks: [] };
    const finished = service.speak(
      { jobId: 'j1', text: 'Первое предложение. Второе предложение.', voiceId: 'qwen:custom:serena' },
      {
        onChunk: (chunk) => outcome.chunks.push(chunk),
        onDone: (info) => {
          outcome.done = info;
        },
        onError: (info) => {
          outcome.error = info;
        }
      }
    );
    await waitFor(() => outcome.chunks.length >= 1);
    expect(service.cancel('j1')).toBe(true);
    await finished;

    expect(outcome.done).toBeUndefined();
    expect(outcome.error).toBeUndefined();
    expect(outcome.chunks.length).toBeLessThan(6);
    expect(service.cancel('j1')).toBe(false);

    // сайдкар жив и принимает следующее задание
    const next = await speak(service, { jobId: 'j2', text: 'Дальше.', voiceId: 'qwen:custom:serena' });
    expect(next.done).toMatchObject({ chunks: 3 });
  });
});

describe('qwenTtsService — неисправности не роняют приложение (TASK-104, AC#2)', () => {
  it('движок не установлен: код qwen_not_installed, сайдкар не запускается', async () => {
    const { service, spawned } = createService('ok', {
      getInstallStatus: async () => ({ runtimeReady: false, models: { custom: false, design: false, base: false } })
    });
    const result = await speak(service, { jobId: 'j1', text: 'Текст.', voiceId: 'qwen:custom:serena' });
    expect(result.error?.errorCode).toBe('qwen_not_installed');
    expect(service.getState()).toMatchObject({ status: 'unavailable', errorCode: 'qwen_not_installed' });
    expect(spawned).toHaveLength(0);
  });

  it('модель нужного вида не скачана: код qwen_model_missing', async () => {
    const { service } = createService('ok', {
      getInstallStatus: async () => ({ runtimeReady: true, models: { custom: true, design: true, base: false } })
    });
    // сохранённому голосу нужна Base, а не VoiceDesign
    const result = await speak(service, { jobId: 'j1', text: 'Текст.', voiceId: 'qwen:design:warm' });
    expect(result.error?.errorCode).toBe('qwen_model_missing');
    const preset = await speak(service, { jobId: 'j2', text: 'Текст.', voiceId: 'qwen:custom:serena' });
    expect(preset.done).toBeDefined();
  });

  it('скрипта сайдкара нет в сборке: код из исключения запуска', async () => {
    const { QwenTtsError } = await import('../../electron/services/qwenTtsService');
    const { service } = createService('ok', {
      spawnSidecar: async () => {
        throw new QwenTtsError('qwen_sidecar_missing', 'sidecar.py not found');
      }
    });
    const result = await speak(service, { jobId: 'j1', text: 'Текст.', voiceId: 'qwen:custom:serena' });
    expect(result.error?.errorCode).toBe('qwen_sidecar_missing');
  });

  it('окружение Python сломано: сайдкар сообщает причину и выходит', async () => {
    const { service } = createService('broken');
    const result = await speak(service, { jobId: 'j1', text: 'Текст.', voiceId: 'qwen:custom:serena' });
    expect(result.error?.errorCode).toBe('qwen_runtime_broken');
    expect(service.getState().processActive).toBe(false);
  });

  it('сайдкар не ответил при запуске: таймаут и остановка процесса', async () => {
    const { service, spawned } = createService('no-ready', {
      timeouts: { startMs: 150, loadMs: 1000, synthMs: 1000, stopGraceMs: 50 }
    });
    const result = await speak(service, { jobId: 'j1', text: 'Текст.', voiceId: 'qwen:custom:serena' });
    expect(result.error?.errorCode).toBe('qwen_sidecar_timeout');
    await waitFor(() => spawned[0].exitCode !== null || spawned[0].signalCode !== null);
  });

  it('модель не загрузилась: код причины из сайдкара', async () => {
    const { service } = createService('load-fails');
    const result = await speak(service, { jobId: 'j1', text: 'Текст.', voiceId: 'qwen:custom:serena' });
    expect(result.error?.errorCode).toBe('qwen_out_of_memory');
    expect(service.getState()).toMatchObject({ status: 'error', errorCode: 'qwen_out_of_memory', modelKind: null });
  });

  it('падение посреди синтеза: одна ошибка заданию, следующий запрос поднимает сайдкар заново', async () => {
    const { service, spawned } = createService('crash-on-synth');
    const errors: string[] = [];
    await service.speak(
      { jobId: 'j1', text: 'Текст.', voiceId: 'qwen:custom:serena' },
      { onChunk: () => {}, onDone: () => {}, onError: (info) => errors.push(info.errorCode ?? '') }
    );
    expect(errors).toEqual(['qwen_sidecar_crashed']);
    expect(service.getState()).toMatchObject({ status: 'error', processActive: false, respawnAttempts: 1 });

    await speak(service, { jobId: 'j2', text: 'Текст.', voiceId: 'qwen:custom:serena' });
    expect(spawned).toHaveLength(2);
  });

  it('после серии падений движок признаётся недоступным и больше не запускается', async () => {
    const { service, spawned } = createService('crash-on-synth');
    for (let i = 0; i < 4; i += 1) {
      await speak(service, { jobId: `j${i}`, text: 'Текст.', voiceId: 'qwen:custom:serena' });
    }
    expect(service.getState().status).toBe('unavailable');
    expect(spawned).toHaveLength(3);

    // выгрузка недоступность не снимает — только осознанная повторная попытка
    await service.unload();
    expect(service.getState()).toMatchObject({ status: 'unavailable', respawnAttempts: 3 });
    service.resetAvailability();
    expect(service.getState()).toMatchObject({ status: 'unloaded', respawnAttempts: 0 });
  });

  it('зависший синтез снимается по таймауту вместе с процессом', async () => {
    const { service, spawned } = createService('hang-on-synth', {
      timeouts: { startMs: 5000, loadMs: 5000, synthMs: 200, stopGraceMs: 50 }
    });
    const result = await speak(service, { jobId: 'j1', text: 'Текст.', voiceId: 'qwen:custom:serena' });
    expect(result.error?.errorCode).toBe('qwen_sidecar_timeout');
    expect(result.chunks).toHaveLength(1);
    await waitFor(() => spawned[0].exitCode !== null || spawned[0].signalCode !== null);
  });
});

describe('qwenTtsService — выгрузка модели (TASK-104, AC#2)', () => {
  it('после простоя сайдкар останавливается, следующий запрос поднимает его снова', async () => {
    const { service, spawned } = createService('ok', { idleUnloadMs: () => 120 });
    await speak(service, { jobId: 'j1', text: 'Текст.', voiceId: 'qwen:custom:serena' });
    expect(service.getState().processActive).toBe(true);

    await waitFor(() => !service.getState().processActive);
    expect(service.getState()).toMatchObject({ status: 'unloaded', modelKind: null });
    await waitFor(() => spawned[0].exitCode !== null);
    // остановка по простою — не авария
    expect(service.getState().respawnAttempts).toBe(0);

    const again = await speak(service, { jobId: 'j2', text: 'Текст.', voiceId: 'qwen:custom:serena' });
    expect(again.done).toBeDefined();
    expect(spawned).toHaveLength(2);
  });

  it('прогрев загружает модель голоса без синтеза', async () => {
    const { service } = createService('ok');
    const state = await service.warmup('qwen:design:warm');
    expect(state).toMatchObject({ status: 'ready', modelKind: 'base' });
    expect((await service.warmup('ru_RU-irina-medium')).errorCode).toBe('qwen_voice_not_found');
  });

  it('dispose завершает процесс сайдкара', async () => {
    const { service, spawned } = createService('ok');
    await service.warmup('qwen:custom:serena');
    await service.dispose();
    await waitFor(() => spawned[0].exitCode !== null || spawned[0].signalCode !== null);
  });
});
