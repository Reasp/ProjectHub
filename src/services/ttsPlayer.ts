/**
 * Воспроизведение PCM-чанков локального TTS в рендерере (TASK-69, decision-25).
 *
 * Синтез идёт в main-процессе, но звук воспроизводится здесь: только у `AudioContext` есть
 * `setSinkId`, то есть выбор устройства вывода (наушники/гарнитура), чего системный
 * `speechSynthesis` не умеет вовсе.
 *
 * Чанки приходят по мере готовности и ставятся в очередь встык по времени контекста, поэтому
 * между фразами нет пауз и щелчков, а первый звук слышен, пока остальной текст ещё считается.
 */

export type TtsPlayerState = 'idle' | 'playing';

class TtsPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  /** Время в шкале AudioContext, с которого должен начаться следующий чанк. */
  private nextStartTime = 0;
  private contextSampleRate = 0;
  private currentSinkId = '';
  private endedCallbacks = new Set<() => void>();
  private playing = false;
  /** Активное задание: чанки с чужим jobId (от отменённого чтения) игнорируются. */
  private activeJobId: string | null = null;

  get isPlaying(): boolean {
    return this.playing;
  }

  get jobId(): string | null {
    return this.activeJobId;
  }

  /** Подписка на завершение воспроизведения (последний чанк доиграл или всё остановлено). */
  onEnded(callback: () => void): () => void {
    this.endedCallbacks.add(callback);
    return () => this.endedCallbacks.delete(callback);
  }

  private notifyEnded() {
    for (const cb of this.endedCallbacks) {
      try {
        cb();
      } catch (err) {
        console.error('[TtsPlayer] onEnded callback failed:', err);
      }
    }
  }

  /**
   * Готовит контекст под частоту модели. Пересоздаётся при смене частоты или устройства вывода:
   * у AudioContext частота задаётся только при создании.
   */
  private async ensureContext(sampleRate: number, sinkId: string, volume: number): Promise<AudioContext | null> {
    if (typeof window === 'undefined') return null;

    if (this.ctx && (this.contextSampleRate !== sampleRate || this.currentSinkId !== sinkId)) {
      await this.close();
    }

    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      // Частота контекста = частоте модели: без ресемплинга и артефактов
      const ctx = new AudioCtx({ sampleRate });
      this.contextSampleRate = sampleRate;
      this.currentSinkId = sinkId;

      if (sinkId && 'setSinkId' in ctx) {
        try {
          await (ctx as AudioContext & { setSinkId: (id: string) => Promise<void> }).setSinkId(sinkId);
        } catch (err) {
          console.warn('[TtsPlayer] setSinkId failed, using default output:', err);
        }
      }

      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);

      this.ctx = ctx;
      this.gain = gain;
      this.nextStartTime = 0;
    }

    if (this.gain) this.gain.gain.value = volume;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  /** Начинает новое задание: сбрасывает очередь предыдущего. */
  async begin(jobId: string): Promise<void> {
    if (this.activeJobId && this.activeJobId !== jobId) await this.stop();
    this.activeJobId = jobId;
  }

  /**
   * Ставит очередной чанк в очередь воспроизведения.
   * @returns false, если чанк относится к отменённому заданию и был отброшен
   */
  async enqueue(
    jobId: string,
    samples: Float32Array,
    sampleRate: number,
    options: { sinkId?: string; volume?: number } = {}
  ): Promise<boolean> {
    if (this.activeJobId !== null && jobId !== this.activeJobId) return false;
    if (!samples || samples.length === 0) return false;

    this.activeJobId = jobId;
    const ctx = await this.ensureContext(sampleRate, options.sinkId ?? '', options.volume ?? 1);
    if (!ctx) return false;
    // Пока готовился контекст, задание могли отменить
    if (this.activeJobId !== jobId) return false;

    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    // set() вместо copyToChannel: не зависит от параметра ArrayBufferLike в типе Float32Array
    buffer.getChannelData(0).set(samples);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain!);

    // Небольшой запас, чтобы первый чанк не начался «в прошлом» из-за задержки планирования
    const startAt = Math.max(ctx.currentTime + 0.02, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.playing = true;

    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) {
        this.playing = false;
        this.notifyEnded();
      }
    };
    return true;
  }

  /** Останавливает воспроизведение и очищает очередь. */
  async stop(): Promise<void> {
    this.activeJobId = null;
    const wasPlaying = this.playing;
    for (const source of this.sources) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // источник мог уже завершиться
      }
    }
    this.sources.clear();
    this.playing = false;
    this.nextStartTime = this.ctx ? this.ctx.currentTime : 0;
    if (wasPlaying) this.notifyEnded();
  }

  /** Полностью закрывает аудиоконтекст (смена устройства вывода или частоты модели). */
  async close(): Promise<void> {
    await this.stop();
    const ctx = this.ctx;
    this.ctx = null;
    this.gain = null;
    this.contextSampleRate = 0;
    this.currentSinkId = '';
    if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => {});
  }
}

export const ttsPlayer = new TtsPlayer();
