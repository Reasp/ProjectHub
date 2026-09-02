import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

export type LocalWhisperStatus = 'unloaded' | 'loading' | 'ready' | 'error';

export interface LocalWhisperState {
  status: LocalWhisperStatus;
  model: string;
  cacheDir: string;
  error?: string;
  loadTimeMs?: number;
}

class LocalWhisperService {
  private status: LocalWhisperStatus = 'unloaded';
  private modelName = 'Xenova/whisper-base';
  private cacheDir: string;
  private pipelinePromise: Promise<any> | null = null;
  private asrPipeline: any = null;
  private errorMessage?: string;
  private loadStartTime = 0;
  private loadTimeMs?: number;

  constructor() {
    // Cache strictly in user profile on system drive (C:) where ample space is available
    this.cacheDir = path.join(os.homedir(), '.cache', 'projecthub', 'whisper');
  }

  getState(): LocalWhisperState {
    return {
      status: this.status,
      model: this.modelName,
      cacheDir: this.cacheDir,
      error: this.errorMessage,
      loadTimeMs: this.loadTimeMs
    };
  }

  /**
   * Non-blocking background initialization.
   * Runs in a separate asynchronous task and does not block Electron startup.
   */
  initBackground() {
    if (this.status === 'loading' || this.status === 'ready') return;

    this.status = 'loading';
    this.loadStartTime = Date.now();
    console.log(`[LocalWhisper] Starting background initialization for model: ${this.modelName}`);

    // Fire-and-forget background load
    this.getPipeline()
      .then(() => {
        this.status = 'ready';
        this.loadTimeMs = Date.now() - this.loadStartTime;
        console.log(`[LocalWhisper] Model is ready in background (${this.loadTimeMs}ms)`);
      })
      .catch((err) => {
        this.status = 'error';
        this.errorMessage = err?.message || String(err);
        console.warn('[LocalWhisper] Background model pre-load error:', err);
      });
  }

  private async getPipeline() {
    if (this.asrPipeline) return this.asrPipeline;

    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        try {
          await fs.mkdir(this.cacheDir, { recursive: true });

          const transformers = await import('@huggingface/transformers');
          if (transformers.env) {
            transformers.env.cacheDir = this.cacheDir;
            transformers.env.allowLocalModels = true;
          }

          console.log(`[LocalWhisper] Loading pipeline with cache at ${this.cacheDir}...`);
          const pipeline = await transformers.pipeline(
            'automatic-speech-recognition',
            this.modelName,
            {
              dtype: 'fp32'
            }
          );

          this.asrPipeline = pipeline;
          return pipeline;
        } catch (err: any) {
          this.pipelinePromise = null;
          throw err;
        }
      })();
    }

    return this.pipelinePromise;
  }

  /**
   * Transcribe 16kHz Mono PCM float audio data.
   */
  async transcribe(
    audioData: Float32Array | number[],
    language: 'ru' | 'en' = 'ru'
  ): Promise<{ text: string; timeMs: number }> {
    const startTime = Date.now();

    try {
      const pipeline = await this.getPipeline();
      this.status = 'ready';

      const floatArray = audioData instanceof Float32Array
        ? audioData
        : new Float32Array(audioData);

      if (floatArray.length < 1600) {
        // Less than 0.1s of audio
        return { text: '', timeMs: Date.now() - startTime };
      }

      console.log(`[LocalWhisper] Transcribing ${floatArray.length} samples (${(floatArray.length / 16000).toFixed(2)}s) in language: ${language}...`);

      const targetLang = language === 'en' ? 'english' : 'russian';
      const output = await pipeline(floatArray, {
        language: targetLang,
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5
      });

      const text = (output?.text || '').trim();
      const timeMs = Date.now() - startTime;
      console.log(`[LocalWhisper] Transcription completed in ${timeMs}ms: "${text}"`);

      return { text, timeMs };
    } catch (err: any) {
      console.error('[LocalWhisper] Transcription error:', err);
      this.status = 'error';
      this.errorMessage = err?.message || String(err);
      throw err;
    }
  }
}

export const localWhisperService = new LocalWhisperService();
