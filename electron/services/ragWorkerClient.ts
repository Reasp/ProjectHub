import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { ensureModelsCacheDir, getWorkerScriptCandidates } from './appPaths';
import type { EmbeddingModel } from './ragEmbeddingModel';

/**
 * Клиент изолированного воркера векторного поиска (TASK-50).
 *
 * `@huggingface/transformers` и `@lancedb/lancedb` больше не грузятся в main-процесс:
 * кодирование запроса и поиск по LanceDB выполняются в отдельном OS-потоке, поэтому
 * event loop main не блокируется на время эмбеддинга.
 *
 * Если воркер недоступен (скрипт не найден, поток не поднялся, нативный модуль не
 * загрузился), методы возвращают `null` — вызывающий код честно падает обратно на
 * выполнение в main-процессе, а не теряет функциональность.
 */

/** Таймаут одной операции: эмбеддинг + поиск на холодном старте модели заметно дольше. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Сколько раз пересоздавать воркер после аварийного выхода, прежде чем уйти в fallback. */
const MAX_RESPAWN_ATTEMPTS = 2;

export interface VectorSearchRow {
  file: string;
  heading: string;
  text: string;
  distance: number | null;
}

/** Сообщения, которые присылает `electron/workers/ragWorker.mjs`. */
type WorkerMessage =
  | { type: 'ready' }
  | { type: 'result'; id: string; ok: true; data: unknown }
  | { type: 'result'; id: string; ok: false; error?: string };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

class RagWorkerClient {
  private worker: Worker | null = null;
  private starting: Promise<Worker | null> | null = null;
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private respawnAttempts = 0;
  /** Воркер признан нерабочим — больше не пытаемся, всё уходит в in-process fallback. */
  private unavailable = false;
  private disposed = false;

  /** Воркер сейчас поднят (для диагностики). */
  get isActive(): boolean {
    return Boolean(this.worker);
  }

  private resolveWorkerPath(): string | null {
    for (const candidate of getWorkerScriptCandidates('ragWorker.mjs')) {
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
        console.warn('[RAG] ragWorker.mjs not found, falling back to in-process search');
        this.unavailable = true;
        return null;
      }

      try {
        const cacheDir = await ensureModelsCacheDir();
        const worker = new Worker(workerPath, { workerData: { cacheDir } });
        worker.on('message', (msg) => this.handleMessage(worker, msg));
        worker.on('error', (err) => this.handleFailure(worker, err instanceof Error ? err : new Error(String(err))));
        worker.on('exit', (code) => {
          if (this.worker !== worker) return;
          this.handleFailure(worker, new Error(`RAG worker exited with code ${code}`));
        });
        // Воркер не должен удерживать процесс при выходе из приложения
        worker.unref();
        this.worker = worker;
        console.log('[RAG] Vector search worker thread started');
        return worker;
      } catch (err) {
        console.warn('[RAG] Failed to start vector search worker:', err);
        this.unavailable = true;
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
    const msg = raw as WorkerMessage;
    if (msg.type === 'ready') {
      // Воркер поднялся успешно — разрешаем будущие перезапуски заново
      this.respawnAttempts = 0;
      return;
    }
    if (msg.type !== 'result' || typeof msg.id !== 'string') return;

    const request = this.pending.get(msg.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(msg.id);

    if (msg.ok) request.resolve(msg.data);
    else request.reject(new Error(msg.error || 'RAG worker error'));
  }

  private handleFailure(worker: Worker, err: Error) {
    if (this.worker !== worker) return;
    this.worker = null;

    for (const [id, request] of this.pending.entries()) {
      clearTimeout(request.timer);
      this.pending.delete(id);
      request.reject(err);
    }

    if (this.disposed) return;

    this.respawnAttempts += 1;
    if (this.respawnAttempts > MAX_RESPAWN_ATTEMPTS) {
      console.warn(`[RAG] Vector search worker failed ${this.respawnAttempts} times, using in-process fallback:`, err.message);
      this.unavailable = true;
    } else {
      console.warn('[RAG] Vector search worker failed, will respawn on next request:', err.message);
    }
  }

  /** Отправляет запрос в воркер; `null` — воркер недоступен, нужен in-process fallback. */
  private async request<T>(payload: Record<string, unknown>): Promise<T | null> {
    const worker = await this.ensureWorker();
    if (!worker) return null;

    const id = `rag-${++this.requestCounter}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RAG worker request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
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

  /**
   * Векторный поиск в готовом индексе.
   * @returns строки результата или `null`, если воркер недоступен.
   */
  async vectorSearch(params: {
    indexDir: string;
    query: string;
    model: EmbeddingModel;
    limit: number;
  }): Promise<VectorSearchRow[] | null> {
    const data = await this.request<{ rows: VectorSearchRow[] }>({ type: 'vector_search', ...params });
    return data ? data.rows : null;
  }

  /**
   * Число чанков в индексе.
   * @returns статистика или `null`, если воркер недоступен.
   */
  async stats(indexDir: string): Promise<{ chunksCount: number; hasTable: boolean } | null> {
    return this.request<{ chunksCount: number; hasTable: boolean }>({ type: 'stats', indexDir });
  }

  /** Останавливает воркер (выход из приложения). */
  async dispose() {
    this.disposed = true;
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate().catch(() => {});
  }
}

export const ragWorkerClient = new RagWorkerClient();
