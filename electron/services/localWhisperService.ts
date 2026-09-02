import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

export type LocalWhisperStatus = 'unloaded' | 'loading' | 'ready' | 'error';

export interface LocalWhisperState {
  status: LocalWhisperStatus;
  model: string;
  cacheDir: string;
  workerActive: boolean;
  queueLength: number;
  error?: string;
  loadTimeMs?: number;
}

interface PendingJob {
  id: string;
  audioData: Float32Array | number[];
  language: 'ru' | 'en';
  resolve: (res: { text: string; timeMs: number }) => void;
  reject: (err: any) => void;
  startTime: number;
}

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

  constructor() {
    this.cacheDir = path.join(os.homedir(), '.cache', 'projecthub', 'whisper');
  }

  getState(): LocalWhisperState {
    return {
      status: this.status,
      model: this.modelName,
      cacheDir: this.cacheDir,
      workerActive: Boolean(this.worker),
      queueLength: this.pendingJobs.size,
      error: this.errorMessage,
      loadTimeMs: this.loadTimeMs
    };
  }

  /**
   * Non-blocking background initialization.
   * Spawns an isolated Node.js Worker thread so инференс runs 100% in a separate thread.
   */
  initBackground() {
    if (this.status === 'loading' || this.status === 'ready') return;

    this.status = 'loading';
    this.loadStartTime = Date.now();
    console.log(`[LocalWhisper] Initializing isolated Worker thread for ${this.modelName}...`);

    this.spawnWorker();
  }

  private resolveWorkerPath(): string | null {
    const candidates = [
      path.join(process.cwd(), 'dist-electron', 'workers', 'whisperWorker.mjs'),
      path.join(process.cwd(), 'electron', 'workers', 'whisperWorker.mjs'),
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../workers/whisperWorker.mjs'),
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'workers/whisperWorker.mjs')
    ];

    for (const p of candidates) {
      if (existsSync(p)) return p;
    }

    return candidates[1];
  }

  private spawnWorker() {
    try {
      const workerPath = this.resolveWorkerPath();
      if (!workerPath || !existsSync(workerPath)) {
        console.warn(`[LocalWhisper] Worker script not found at ${workerPath}, using in-process fallback`);
        this.initInProcessFallback();
        return;
      }

      console.log(`[LocalWhisper] Spawning Worker thread at ${workerPath}`);
      const worker = new Worker(workerPath);
      this.worker = worker;

      worker.on('message', (msg) => {
        if (!msg) return;

        if (msg.type === 'ready') {
          this.status = 'ready';
          this.loadTimeMs = msg.loadTimeMs || (Date.now() - this.loadStartTime);
          console.log(`[LocalWhisper] Isolated Worker thread is READY (${this.loadTimeMs}ms)`);
        } else if (msg.type === 'init_error') {
          this.status = 'error';
          this.errorMessage = msg.error;
          console.warn('[LocalWhisper] Worker initialization error:', msg.error);
        } else if (msg.type === 'result') {
          const job = this.pendingJobs.get(msg.id);
          if (job) {
            this.pendingJobs.delete(msg.id);
            job.resolve({ text: msg.text, timeMs: msg.timeMs });
          }
        } else if (msg.type === 'error') {
          const job = this.pendingJobs.get(msg.id);
          if (job) {
            this.pendingJobs.delete(msg.id);
            job.reject(new Error(msg.error));
          }
        }
      });

      worker.on('error', (err: any) => {
        console.error('[LocalWhisper] Worker thread runtime error:', err);
        this.status = 'error';
        this.errorMessage = err?.message || String(err);
        // Fallback for pending jobs
        this.flushPendingWithError(err);
      });

      worker.on('exit', (code) => {
        console.warn(`[LocalWhisper] Worker thread exited with code ${code}`);
        this.worker = null;
        if (code !== 0 && this.status !== 'ready') {
          this.initInProcessFallback();
        }
      });

      // Send initial trigger
      worker.postMessage({ type: 'init' });
    } catch (err: any) {
      console.error('[LocalWhisper] Failed to spawn worker thread:', err);
      this.initInProcessFallback();
    }
  }

  private flushPendingWithError(err: any) {
    for (const [id, job] of this.pendingJobs.entries()) {
      job.reject(err);
      this.pendingJobs.delete(id);
    }
  }

  private async initInProcessFallback() {
    try {
      console.log('[LocalWhisper] Initializing in-process Transformers fallback...');
      await fs.mkdir(this.cacheDir, { recursive: true });
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
    } catch (e: any) {
      this.status = 'error';
      this.errorMessage = e.message;
    }
  }

  /**
   * Transcribe 16kHz Mono PCM float audio data.
   * Delegates execution to the isolated Worker thread.
   */
  async transcribe(
    audioData: Float32Array | number[],
    language: 'ru' | 'en' = 'ru'
  ): Promise<{ text: string; timeMs: number }> {
    const startTime = Date.now();

    const floatArray = audioData instanceof Float32Array
      ? audioData
      : new Float32Array(audioData);

    if (floatArray.length < 1600) {
      return { text: '', timeMs: 0 };
    }

    // 1. If Worker is available, dispatch to Worker thread
    if (this.worker) {
      const id = `whisper-req-${++this.requestIdCounter}-${Date.now()}`;

      return new Promise((resolve, reject) => {
        this.pendingJobs.set(id, {
          id,
          audioData: floatArray,
          language,
          resolve,
          reject,
          startTime
        });

        // Convert to plain Float32Array or Array for safe worker message passing
        this.worker!.postMessage({
          type: 'transcribe',
          id,
          audioData: floatArray,
          language
        });

        // Safety timeout (30 seconds)
        setTimeout(() => {
          if (this.pendingJobs.has(id)) {
            this.pendingJobs.delete(id);
            reject(new Error('Whisper transcription timed out after 30s'));
          }
        }, 30000);
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
}

export const localWhisperService = new LocalWhisperService();
