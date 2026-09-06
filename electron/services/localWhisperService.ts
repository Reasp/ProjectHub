import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { ensureModelsCacheDir, getModelsCacheDir, getWorkerScriptCandidates } from './appPaths';

export type LocalWhisperStatus = 'unloaded' | 'loading' | 'ready' | 'error';

export interface LocalWhisperState {
  status: LocalWhisperStatus;
  model: string;
  cacheDir: string;
  workerActive: boolean;
  queueLength: number;
  error?: string;
  loadTimeMs?: number;
  respawnAttempts?: number;
}

interface PendingJob {
  id: string;
  language: 'ru' | 'en';
  resolve: (res: { text: string; timeMs: number }) => void;
  reject: (err: any) => void;
  startTime: number;
  timer: NodeJS.Timeout;
}

/** Таймаут одной транскрипции. */
const TRANSCRIBE_TIMEOUT_MS = 30_000;
/** Сколько ждать готовности модели при первом вызове transcribe (ленивая загрузка). */
const READY_WAIT_TIMEOUT_MS = 90_000;
/** Ограниченное число попыток перезапуска воркера после аварийного выхода. */
const MAX_RESPAWN_ATTEMPTS = 3;
const RESPAWN_BASE_DELAY_MS = 1_000;

class LocalWhisperService {
  private status: LocalWhisperStatus = 'unloaded';
  private modelName = 'Xenova/whisper-base';
  private cacheDir: string;
  private worker: Worker | null = null;
  private errorMessage?: string;
  private loadStartTime = 0;
  private loadTimeMs?: number;
  private requestIdCounter = 0;
  private pendingJobs = new Map<string, PendingJob>();
  private fallbackPipeline: any = null;
  private respawnAttempts = 0;
  private respawnTimer: NodeJS.Timeout | null = null;
  private disposing = false;
  /** Ожидающие готовности модели (ленивый transcribe во время loading). */
  private readyWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  constructor() {
    // Единый кэш моделей приложения (userData/models) — общий с RAG-эмбеддингами (TASK-43)
    this.cacheDir = getModelsCacheDir();
  }

  getState(): LocalWhisperState {
    return {
      status: this.status,
      model: this.modelName,
      cacheDir: this.cacheDir,
      workerActive: Boolean(this.worker),
      queueLength: this.pendingJobs.size,
      error: this.errorMessage,
      loadTimeMs: this.loadTimeMs,
      respawnAttempts: this.respawnAttempts
    };
  }

  /**
   * Неблокирующая фоновая инициализация: поднимает изолированный Worker thread,
   * в котором целиком выполняется инференс. Вызывается лениво — при первом
   * включении hands-free или явном прогреве из настроек, а не на старте приложения.
   */
  initBackground() {
    if (this.status === 'loading' || this.status === 'ready') return;

    this.disposing = false;
    this.respawnAttempts = 0;
    this.errorMessage = undefined;
    this.status = 'loading';
    this.loadStartTime = Date.now();
    console.log(`[LocalWhisper] Initializing isolated Worker thread for ${this.modelName}...`);

    this.spawnWorker();
  }

  private resolveWorkerPath(): string | null {
    // Кандидаты вычисляются от каталога бандла и app.getAppPath(), не от process.cwd() (TASK-43)
    const candidates = getWorkerScriptCandidates('whisperWorker.mjs');
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    console.warn('[LocalWhisper] Worker script not found, checked:', candidates);
    return null;
  }

  private spawnWorker() {
    const workerPath = this.resolveWorkerPath();
    if (!workerPath) {
      console.warn('[LocalWhisper] Worker script not found, using in-process fallback');
      this.initInProcessFallback();
      return;
    }

    ensureModelsCacheDir()
      .then((cacheDir) => {
        this.cacheDir = cacheDir;
        if (this.disposing) return;
        this.startWorker(workerPath);
      })
      .catch((err) => {
        console.error('[LocalWhisper] Failed to prepare models cache dir:', err);
        this.status = 'error';
        this.errorMessage = err instanceof Error ? err.message : String(err);
        this.rejectReadyWaiters(err instanceof Error ? err : new Error(String(err)));
      });
  }

  private startWorker(workerPath: string) {
    try {
      console.log(`[LocalWhisper] Spawning Worker thread at ${workerPath}`);
      const worker = new Worker(workerPath, {
        workerData: { cacheDir: this.cacheDir, modelName: this.modelName }
      });
      this.worker = worker;

      worker.on('message', (msg) => {
        if (!msg || this.worker !== worker) return;

        if (msg.type === 'ready') {
          this.status = 'ready';
          this.errorMessage = undefined;
          this.loadTimeMs = msg.loadTimeMs || (Date.now() - this.loadStartTime);
          console.log(`[LocalWhisper] Isolated Worker thread is READY (${this.loadTimeMs}ms)`);
          this.resolveReadyWaiters();
        } else if (msg.type === 'init_error') {
          this.status = 'error';
          this.errorMessage = msg.error;
          console.warn('[LocalWhisper] Worker initialization error:', msg.error);
          this.rejectReadyWaiters(new Error(msg.error));
        } else if (msg.type === 'result') {
          // Воркер доказал работоспособность — только теперь сбрасываем счётчик перезапусков,
          // иначе воркер, падающий на каждой задаче, перезапускался бы бесконечно
          this.respawnAttempts = 0;
          const job = this.takePendingJob(msg.id);
          if (job) job.resolve({ text: msg.text, timeMs: msg.timeMs });
        } else if (msg.type === 'error') {
          const job = this.takePendingJob(msg.id);
          if (job) job.reject(new Error(msg.error));
        }
      });

      worker.on('error', (err: any) => {
        if (this.worker !== worker) return;
        console.error('[LocalWhisper] Worker thread runtime error:', err);
        this.status = 'error';
        this.errorMessage = err?.message || String(err);
        this.flushPendingWithError(err);
        this.rejectReadyWaiters(err instanceof Error ? err : new Error(String(err)));
      });

      worker.on('exit', (code) => {
        if (this.worker !== worker) return;
        this.worker = null;
        this.handleWorkerExit(code);
      });

      // Send initial trigger
      worker.postMessage({ type: 'init' });
    } catch (err: any) {
      console.error('[LocalWhisper] Failed to spawn worker thread:', err);
      this.initInProcessFallback();
    }
  }

  /**
   * Аварийный выход воркера: статус → error, все ожидающие задачи отклоняются,
   * затем ограниченное число попыток respawn с экспоненциальной задержкой.
   */
  private handleWorkerExit(code: number) {
    if (this.disposing) {
      console.log(`[LocalWhisper] Worker thread exited (code ${code}) during dispose`);
      return;
    }

    const reason = `Whisper worker exited unexpectedly with code ${code}`;
    console.warn(`[LocalWhisper] ${reason}`);
    this.status = 'error';
    this.errorMessage = reason;
    const exitError = new Error(reason);
    this.flushPendingWithError(exitError);

    if (this.respawnAttempts >= MAX_RESPAWN_ATTEMPTS) {
      this.errorMessage = `${reason}; respawn limit (${MAX_RESPAWN_ATTEMPTS}) reached`;
      console.error(`[LocalWhisper] ${this.errorMessage}`);
      this.rejectReadyWaiters(new Error(this.errorMessage));
      return;
    }

    const delay = RESPAWN_BASE_DELAY_MS * 2 ** this.respawnAttempts;
    this.respawnAttempts += 1;
    console.warn(
      `[LocalWhisper] Respawning worker in ${delay}ms (attempt ${this.respawnAttempts}/${MAX_RESPAWN_ATTEMPTS})`
    );

    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.respawnTimer = setTimeout(() => {
      this.respawnTimer = null;
      if (this.disposing) return;
      this.status = 'loading';
      this.loadStartTime = Date.now();
      this.spawnWorker();
    }, delay);
  }

  private takePendingJob(id: string): PendingJob | undefined {
    const job = this.pendingJobs.get(id);
    if (!job) return undefined;
    clearTimeout(job.timer);
    this.pendingJobs.delete(id);
    return job;
  }

  private flushPendingWithError(err: any) {
    for (const [id, job] of this.pendingJobs.entries()) {
      clearTimeout(job.timer);
      this.pendingJobs.delete(id);
      job.reject(err);
    }
  }

  private resolveReadyWaiters() {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w.resolve();
  }

  private rejectReadyWaiters(err: Error) {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w.reject(err);
  }

  /** Ждёт перехода из loading в ready (или error/таймаут). */
  private waitForReady(timeoutMs = READY_WAIT_TIMEOUT_MS): Promise<void> {
    if (this.status === 'ready') return Promise.resolve();
    if (this.status === 'error') {
      return Promise.reject(new Error(this.errorMessage || 'Local Whisper is in error state'));
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((w) => w !== waiter);
        reject(new Error(`Local Whisper model did not become ready within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      const waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        }
      };
      this.readyWaiters.push(waiter);
    });
  }

  private async initInProcessFallback() {
    try {
      console.log('[LocalWhisper] Initializing in-process Transformers fallback...');
      this.cacheDir = await ensureModelsCacheDir();
      const transformers = await import('@huggingface/transformers');
      if (transformers.env) {
        transformers.env.cacheDir = this.cacheDir;
        transformers.env.allowLocalModels = true;
      }
      this.fallbackPipeline = await transformers.pipeline('automatic-speech-recognition', this.modelName, {
        dtype: 'fp32'
      });
      this.status = 'ready';
      this.loadTimeMs = Date.now() - this.loadStartTime;
      console.log(`[LocalWhisper] In-process fallback pipeline is READY (${this.loadTimeMs}ms)`);
      this.resolveReadyWaiters();
    } catch (e: any) {
      this.status = 'error';
      this.errorMessage = e.message;
      this.rejectReadyWaiters(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Приводит вход к самостоятельному Float32Array, буфер которого можно
   * безопасно передать в воркер через transferList.
   */
  private toTransferableFloat32(audioData: Float32Array | ArrayBuffer | ArrayLike<number>): Float32Array {
    if (audioData instanceof Float32Array) {
      // view на чужой/общий буфер — копируем, иначе transfer оторвёт буфер у владельца
      if (audioData.byteOffset !== 0 || audioData.byteLength !== audioData.buffer.byteLength) {
        return audioData.slice();
      }
      return audioData;
    }
    if (audioData instanceof ArrayBuffer) {
      return new Float32Array(audioData);
    }
    if (ArrayBuffer.isView(audioData)) {
      // Uint8Array/Buffer с сырыми float32-байтами (например, после сериализации)
      const view = audioData as ArrayBufferView;
      const copy = new ArrayBuffer(view.byteLength);
      new Uint8Array(copy).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      return new Float32Array(copy);
    }
    return Float32Array.from(audioData);
  }

  /**
   * Transcribe 16kHz Mono PCM float audio data.
   * Delegates execution to the isolated Worker thread.
   */
  async transcribe(
    audioData: Float32Array | ArrayBuffer | number[],
    language: 'ru' | 'en' = 'ru'
  ): Promise<{ text: string; timeMs: number }> {
    const startTime = Date.now();

    const floatArray = this.toTransferableFloat32(audioData);

    if (floatArray.length < 1600) {
      return { text: '', timeMs: 0 };
    }

    // 0. Ленивая загрузка: первое обращение поднимает модель, ждём готовности
    if (this.status === 'unloaded') {
      this.initBackground();
    }
    if (this.status === 'loading') {
      await this.waitForReady();
    }
    if (this.status === 'error') {
      throw new Error(this.errorMessage || 'Local Whisper is in error state');
    }

    // 1. If Worker is available, dispatch to Worker thread
    if (this.worker) {
      const worker = this.worker;
      const id = `whisper-req-${++this.requestIdCounter}-${Date.now()}`;

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.pendingJobs.delete(id)) {
            reject(new Error(`Whisper transcription timed out after ${TRANSCRIBE_TIMEOUT_MS / 1000}s`));
          }
        }, TRANSCRIBE_TIMEOUT_MS);

        this.pendingJobs.set(id, { id, language, resolve, reject, startTime, timer });

        try {
          // Буфер передаётся в воркер без копирования (transferList)
          worker.postMessage(
            { type: 'transcribe', id, audioData: floatArray, language },
            [floatArray.buffer as ArrayBuffer]
          );
        } catch (err) {
          const job = this.takePendingJob(id);
          if (job) job.reject(err);
        }
      });
    }

    // 2. In-process fallback
    if (this.fallbackPipeline) {
      const targetLang = language === 'en' ? 'english' : 'russian';
      const output = await this.fallbackPipeline(floatArray, {
        language: targetLang,
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5
      });
      return { text: (output?.text || '').trim(), timeMs: Date.now() - startTime };
    }

    // 3. Not ready yet
    throw new Error('Local Whisper pipeline is currently initializing in background');
  }

  async dispose(): Promise<void> {
    this.disposing = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    const disposedError = new Error('Whisper service disposed');
    this.flushPendingWithError(disposedError);
    this.rejectReadyWaiters(disposedError);
    if (this.worker) {
      const worker = this.worker;
      this.worker = null;
      try {
        await worker.terminate();
      } catch (err) {
        console.warn('[LocalWhisper] Error terminating worker thread:', err);
      }
    }
    this.fallbackPipeline = null;
    this.status = 'unloaded';
    this.errorMessage = undefined;
    this.respawnAttempts = 0;
    console.log('[LocalWhisper] Service disposed and worker terminated');
  }
}

export const localWhisperService = new LocalWhisperService();
