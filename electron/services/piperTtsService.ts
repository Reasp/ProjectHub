/**
 * Локальный нейросетевой синтез речи на голосах Piper (TASK-69, decision-25).
 *
 * Инференс выполняется в изолированном `worker_threads` (`electron/workers/ttsWorker.mjs`) по
 * образцу `localWhisperService` и `ragWorkerClient` (decision-21): ленивая загрузка модели,
 * очередь заданий с `jobId`, таймаут, ограниченное число перезапусков.
 *
 * Отличие от decision-21 п. 5: полноценного in-process fallback здесь нет намеренно. Синтез в
 * main-процессе заблокировал бы event loop на всё время фразы, а деградация уже предусмотрена
 * архитектурой — рендерер возвращается к системному `speechSynthesis` (AC#7). Поэтому при
 * недоступности воркера сервис переходит в статус `unavailable` с причиной, которую видно
 * в настройках, и не пытается синтезировать в main.
 */
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { getWorkerScriptCandidates } from './appPaths';
import { splitTextForTts } from './ttsTextSplit';
import { getInstalledVoice, type InstalledVoice } from './ttsVoiceStore';

export type PiperTtsStatus = 'unloaded' | 'loading' | 'ready' | 'error' | 'unavailable';

/** Причина недоступности — рендерер переводит код в текст (i18n), main не хранит строки UI. */
export type PiperTtsUnavailableCode =
  | 'worker_script_missing'
  | 'native_module_missing'
  | 'worker_crashed'
  | 'voice_not_installed'
  | 'load_failed';

export interface PiperTtsState {
  status: PiperTtsStatus;
  voiceId: string | null;
  sampleRate: number | null;
  workerActive: boolean;
  queueLength: number;
  loadTimeMs?: number;
  respawnAttempts: number;
  error?: string;
  errorCode?: PiperTtsUnavailableCode;
}

export interface TtsChunk {
  jobId: string;
  samples: Float32Array;
  sampleRate: number;
  index: number;
}

export interface SpeakHandlers {
  onChunk: (chunk: TtsChunk) => void;
  onDone: (info: { jobId: string; timeMs: number; audioSec: number; chunks: number }) => void;
  onError: (info: { jobId: string; error: string }) => void;
}

export interface SpeakRequest {
  jobId: string;
  text: string;
  voiceId: string;
  /** Скорость речи: 1.0 — как записано в модели. */
  speed?: number;
  speakerId?: number;
}

/** Таймаут синтеза одного фрагмента. */
const SYNTH_TIMEOUT_MS = 45_000;
/** Таймаут загрузки модели в воркер. */
const LOAD_TIMEOUT_MS = 90_000;
/** Сколько раз пересоздавать воркер после аварийного выхода, прежде чем признать недоступным. */
const MAX_RESPAWN_ATTEMPTS = 2;

interface WorkerRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface ActiveJob {
  jobId: string;
  handlers: SpeakHandlers;
  cancelled: boolean;
  chunks: number;
  audioSec: number;
  startedAt: number;
}

class PiperTtsService {
  private worker: Worker | null = null;
  private starting: Promise<Worker | null> | null = null;
  private status: PiperTtsStatus = 'unloaded';
  private loadedVoice: InstalledVoice | null = null;
  private sampleRate: number | null = null;
  private loadTimeMs?: number;
  private errorMessage?: string;
  private errorCode?: PiperTtsUnavailableCode;
  private respawnAttempts = 0;
  private unavailable = false;
  private disposed = false;

  private requestCounter = 0;
  private pending = new Map<string, WorkerRequest>();
  private jobs = new Map<string, ActiveJob>();

  getState(): PiperTtsState {
    return {
      status: this.status,
      voiceId: this.loadedVoice?.id ?? null,
      sampleRate: this.sampleRate,
      workerActive: Boolean(this.worker),
      queueLength: this.jobs.size,
      loadTimeMs: this.loadTimeMs,
      respawnAttempts: this.respawnAttempts,
      error: this.errorMessage,
      errorCode: this.errorCode
    };
  }

  /** Нативный модуль и воркер вообще доступны в этой сборке? */
  get isAvailable(): boolean {
    return !this.unavailable;
  }

  private markUnavailable(code: PiperTtsUnavailableCode, message: string) {
    this.unavailable = true;
    this.status = 'unavailable';
    this.errorCode = code;
    this.errorMessage = message;
    console.warn(`[PiperTTS] Unavailable (${code}): ${message}`);
  }

  private resolveWorkerPath(): string | null {
    for (const candidate of getWorkerScriptCandidates('ttsWorker.mjs')) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  private async ensureWorker(): Promise<Worker | null> {
    if (this.unavailable || this.disposed) return null;
    if (this.worker) return this.worker;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const workerPath = this.resolveWorkerPath();
      if (!workerPath) {
        this.markUnavailable('worker_script_missing', 'ttsWorker.mjs not found next to the app bundle');
        return null;
      }

      try {
        const worker = new Worker(workerPath);
        worker.on('message', (msg) => this.handleMessage(worker, msg));
        worker.on('error', (err) => this.handleFailure(worker, err instanceof Error ? err : new Error(String(err))));
        worker.on('exit', (code) => {
          if (this.worker !== worker) return;
          this.handleFailure(worker, new Error(`TTS worker exited with code ${code}`));
        });
        // Воркер не должен удерживать процесс при выходе из приложения
        worker.unref();
        this.worker = worker;
        console.log('[PiperTTS] Worker thread started');
        return worker;
      } catch (err) {
        this.markUnavailable('worker_crashed', err instanceof Error ? err.message : String(err));
        return null;
      }
    })();

    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private handleMessage(worker: Worker, raw: unknown) {
    if (this.worker !== worker || !raw || typeof raw !== 'object') return;
    const msg = raw as Record<string, unknown>;
    const type = msg.type as string;
    const id = msg.id as string | undefined;

    if (type === 'ready') {
      // Воркер поднялся — разрешаем будущие перезапуски заново
      this.respawnAttempts = 0;
      return;
    }

    // Потоковые сообщения синтеза адресуются активному заданию, а не ожидающему промису
    if (type === 'chunk' && id) {
      const job = this.jobs.get(id);
      if (!job || job.cancelled) return;
      job.chunks += 1;
      const samples = msg.samples as Float32Array;
      const sampleRate = (msg.sampleRate as number) || this.sampleRate || 22050;
      job.audioSec += samples.length / sampleRate;
      job.handlers.onChunk({ jobId: id, samples, sampleRate, index: msg.index as number });
      return;
    }

    if (type === 'done' && id) {
      this.finishRequest(id, { ok: true, ...msg });
      return;
    }

    if (type === 'cancelled' && id) {
      this.finishRequest(id, { ok: true, cancelled: true });
      return;
    }

    if (type === 'loaded' || type === 'unloaded') {
      if (id) this.finishRequest(id, { ok: true, ...msg });
      return;
    }

    if (type === 'error' && id) {
      this.finishRequest(id, { ok: false, error: (msg.error as string) || 'TTS worker error' });
    }
  }

  private finishRequest(id: string, payload: Record<string, unknown>) {
    const request = this.pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(id);
    if (payload.ok === false) request.reject(new Error(String(payload.error)));
    else request.resolve(payload);
  }

  private handleFailure(worker: Worker, err: Error) {
    if (this.worker !== worker) return;
    this.worker = null;
    this.loadedVoice = null;
    this.sampleRate = null;

    for (const [id, request] of this.pending.entries()) {
      clearTimeout(request.timer);
      this.pending.delete(id);
      request.reject(err);
    }
    for (const job of this.jobs.values()) {
      job.handlers.onError({ jobId: job.jobId, error: err.message });
    }
    this.jobs.clear();

    if (this.disposed) return;

    this.respawnAttempts += 1;
    this.status = 'error';
    this.errorMessage = err.message;

    // Нативный модуль не установлен — перезапуски не помогут
    if (/Cannot find module|sherpa-onnx/i.test(err.message) && /not find|MODULE_NOT_FOUND/i.test(err.message)) {
      this.markUnavailable('native_module_missing', err.message);
      return;
    }

    if (this.respawnAttempts > MAX_RESPAWN_ATTEMPTS) {
      this.markUnavailable('worker_crashed', err.message);
    } else {
      console.warn(`[PiperTTS] Worker failed (${this.respawnAttempts}/${MAX_RESPAWN_ATTEMPTS}), will respawn on next request:`, err.message);
    }
  }

  private request<T>(payload: Record<string, unknown>, timeoutMs: number, worker: Worker): Promise<T> {
    const id = (payload.id as string) || `tts-${++this.requestCounter}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`TTS worker request timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        worker.postMessage({ ...payload, id });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Загружает голос в воркер (ленивая инициализация модели). */
  async loadVoice(voiceId: string): Promise<PiperTtsState> {
    if (this.unavailable) return this.getState();

    const installed = await getInstalledVoice(voiceId);
    if (!installed) {
      this.status = 'error';
      this.errorCode = 'voice_not_installed';
      this.errorMessage = `Voice ${voiceId} is not installed`;
      return this.getState();
    }

    if (this.loadedVoice?.id === voiceId && this.status === 'ready') return this.getState();

    const worker = await this.ensureWorker();
    if (!worker) return this.getState();

    this.status = 'loading';
    this.errorMessage = undefined;
    this.errorCode = undefined;

    try {
      const res = await this.request<{ loadTimeMs: number; sampleRate: number }>(
        {
          type: 'load',
          id: `load-${++this.requestCounter}`,
          voice: {
            model: installed.modelPath,
            tokens: installed.tokensPath,
            dataDir: installed.dataDir,
            noiseScale: installed.noiseScale,
            noiseScaleW: installed.noiseScaleW,
            lengthScale: installed.lengthScale,
            numThreads: 2
          }
        },
        LOAD_TIMEOUT_MS,
        worker
      );
      this.loadedVoice = installed;
      this.sampleRate = res.sampleRate;
      this.loadTimeMs = res.loadTimeMs;
      this.status = 'ready';
      console.log(`[PiperTTS] Voice ${voiceId} loaded in ${res.loadTimeMs}ms (${res.sampleRate} Hz)`);
    } catch (err) {
      this.status = 'error';
      this.errorCode = 'load_failed';
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
    return this.getState();
  }

  /**
   * Синтезирует текст по фрагментам. PCM уходит в обработчик по мере готовности — рендерер
   * начинает воспроизведение, не дожидаясь конца текста.
   */
  async speak(req: SpeakRequest, handlers: SpeakHandlers): Promise<void> {
    const { jobId, text, voiceId, speed = 1.0, speakerId = 0 } = req;

    if (this.unavailable) {
      handlers.onError({ jobId, error: this.errorMessage || 'Local TTS is unavailable' });
      return;
    }

    const fragments = splitTextForTts(text);
    if (fragments.length === 0) {
      handlers.onDone({ jobId, timeMs: 0, audioSec: 0, chunks: 0 });
      return;
    }

    const state = await this.loadVoice(voiceId);
    if (state.status !== 'ready') {
      handlers.onError({ jobId, error: this.errorMessage || 'Local TTS voice is not ready' });
      return;
    }

    const worker = await this.ensureWorker();
    if (!worker) {
      handlers.onError({ jobId, error: this.errorMessage || 'Local TTS worker is unavailable' });
      return;
    }

    const job: ActiveJob = { jobId, handlers, cancelled: false, chunks: 0, audioSec: 0, startedAt: Date.now() };
    this.jobs.set(jobId, job);

    try {
      for (const fragment of fragments) {
        if (job.cancelled) break;
        // Каждый фрагмент — отдельный запрос к воркеру с тем же jobId, чтобы отмена
        // останавливала и текущую генерацию, и остаток очереди
        await this.request({ type: 'synthesize', id: jobId, text: fragment, speed, sid: speakerId }, SYNTH_TIMEOUT_MS, worker);
      }
      if (!job.cancelled) {
        handlers.onDone({ jobId, timeMs: Date.now() - job.startedAt, audioSec: job.audioSec, chunks: job.chunks });
      }
    } catch (err) {
      if (!job.cancelled) {
        handlers.onError({ jobId, error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      this.jobs.delete(jobId);
    }
  }

  /** Прерывает генерацию: и текущий фрагмент внутри sherpa, и остаток очереди. */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job) job.cancelled = true;
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'cancel', id: jobId });
      } catch {
        // воркер уже умер — отмена не нужна
      }
    }
    // Ожидающий промис фрагмента разрешаем, чтобы цикл speak() вышел немедленно
    this.finishRequest(jobId, { ok: true, cancelled: true });
    return Boolean(job);
  }

  /** Отменяет все активные задания (смена движка, выход, остановка чтения). */
  cancelAll() {
    for (const jobId of [...this.jobs.keys()]) this.cancel(jobId);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.cancelAll();
    const worker = this.worker;
    this.worker = null;
    this.loadedVoice = null;
    this.status = 'unloaded';
    if (worker) await worker.terminate().catch(() => {});
    console.log('[PiperTTS] Service disposed');
  }
}

export const piperTtsService = new PiperTtsService();
