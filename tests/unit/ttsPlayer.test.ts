import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Плеер живёт в рендерере и работает через AudioContext, поэтому для unit-теста нужен минимальный
 * заменитель веб-аудио: реального устройства вывода в тестовой среде нет, а проверяется логика
 * очереди и фильтрации чанков по jobId (TASK-87, дефект 3).
 */
class FakeAudioBuffer {
  readonly duration: number;
  private readonly channel: Float32Array;

  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.channel = new Float32Array(length);
    this.duration = length / sampleRate;
  }

  getChannelData(): Float32Array {
    return this.channel;
  }
}

class FakeAudioBufferSource {
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;

  connect() {}
  disconnect() {}
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

/** Все созданные источники — чтобы проверить, что после stop() ничего нового не заводится. */
const createdSources: FakeAudioBufferSource[] = [];

class FakeAudioContext {
  readonly sampleRate: number;
  currentTime = 0;
  state: 'running' | 'suspended' | 'closed' = 'running';
  destination = {};

  constructor(options: { sampleRate: number }) {
    this.sampleRate = options.sampleRate;
  }

  createGain() {
    return { gain: { value: 1 }, connect: () => {} };
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }

  createBufferSource() {
    const source = new FakeAudioBufferSource();
    createdSources.push(source);
    return source;
  }

  async resume() {
    this.state = 'running';
  }

  async close() {
    this.state = 'closed';
  }
}

vi.stubGlobal('window', { AudioContext: FakeAudioContext });

const { ttsPlayer } = await import('../../src/services/ttsPlayer');

const samples = new Float32Array([0.1, -0.2, 0.3]);
const SAMPLE_RATE = 22050;

beforeEach(async () => {
  await ttsPlayer.close();
  createdSources.length = 0;
});

describe('ttsPlayer — приём чанков только для начатого задания (TASK-87, дефект 3)', () => {
  it('без begin() чанк отвергается и звук не создаётся', async () => {
    const accepted = await ttsPlayer.enqueue('tts-1', samples, SAMPLE_RATE);

    expect(accepted).toBe(false);
    expect(createdSources).toHaveLength(0);
    expect(ttsPlayer.isPlaying).toBe(false);
    expect(ttsPlayer.jobId).toBeNull();
  });

  it('после begin() чанк своего задания принимается', async () => {
    await ttsPlayer.begin('tts-1');
    const accepted = await ttsPlayer.enqueue('tts-1', samples, SAMPLE_RATE);

    expect(accepted).toBe(true);
    expect(ttsPlayer.isPlaying).toBe(true);
    expect(createdSources).toHaveLength(1);
    expect(createdSources[0].started).toBe(true);
  });

  it('чанк чужого задания отбрасывается', async () => {
    await ttsPlayer.begin('tts-1');
    const accepted = await ttsPlayer.enqueue('tts-2', samples, SAMPLE_RATE);

    expect(accepted).toBe(false);
    expect(createdSources).toHaveLength(0);
  });

  it('после stop() опоздавший чанк не воскрешает звук', async () => {
    await ttsPlayer.begin('tts-1');
    await ttsPlayer.enqueue('tts-1', samples, SAMPLE_RATE);
    await ttsPlayer.stop();
    createdSources.length = 0;

    // Именно этот случай и был дефектом: activeJobId === null пропускал любой чанк
    const accepted = await ttsPlayer.enqueue('tts-1', samples, SAMPLE_RATE);

    expect(accepted).toBe(false);
    expect(createdSources).toHaveLength(0);
    expect(ttsPlayer.isPlaying).toBe(false);
    expect(ttsPlayer.jobId).toBeNull();
  });

  it('новое задание после stop() снова принимает чанки', async () => {
    await ttsPlayer.begin('tts-1');
    await ttsPlayer.stop();

    await ttsPlayer.begin('tts-2');
    const accepted = await ttsPlayer.enqueue('tts-2', samples, SAMPLE_RATE);

    expect(accepted).toBe(true);
    expect(ttsPlayer.jobId).toBe('tts-2');
  });

  it('пустой чанк не создаёт источник звука', async () => {
    await ttsPlayer.begin('tts-1');
    const accepted = await ttsPlayer.enqueue('tts-1', new Float32Array(0), SAMPLE_RATE);

    expect(accepted).toBe(false);
    expect(createdSources).toHaveLength(0);
  });

  it('begin() нового задания останавливает предыдущее', async () => {
    await ttsPlayer.begin('tts-1');
    await ttsPlayer.enqueue('tts-1', samples, SAMPLE_RATE);
    const first = createdSources[0];

    await ttsPlayer.begin('tts-2');

    expect(first.stopped).toBe(true);
    expect(ttsPlayer.jobId).toBe('tts-2');
  });
});
