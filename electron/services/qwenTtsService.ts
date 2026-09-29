/**
 * Второй движок озвучки: Qwen3-TTS в сайдкаре Python (TASK-104, decision-64).
 *
 * Сайдкар — отдельный процесс со своим venv (`electron/workers/qwen/sidecar.py`): PyTorch и веса в
 * процесс приложения не попадают, а падение инференса убивает только сайдкар (decision-34 п. 5).
 * Запускается по требованию и останавливается после простоя — модель держит около 4.5 ГБ
 * видеопамяти, и занимать их постоянно ради редких реплик незачем.
 *
 * Как и у Piper, fallback внутри main нет: при любой неисправности сервис отдаёт код ошибки, а
 * рендерер озвучивает фразу следующим движком по цепочке (Piper, затем системный голос).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { splitTextForTts } from './ttsTextSplit';
import { toQwenErrorCode, type QwenTtsErrorCode } from './ttsErrorCodes';
import {
  draftKey,
  isValidSeed,
  modelForVoice,
  normalizeInstruct,
  parseQwenVoiceId,
  QWEN_LANGUAGE_NAMES,
  QWEN_REFERENCE_TEXT,
  type QwenModelKind
} from './qwenTtsRegistry';
import {
  createLineSplitter,
  decodePcm16,
  encodeSidecarRequest,
  parseSidecarMessage,
  type QwenSidecarMessage
} from './qwenSidecarProtocol';
import {
  getDesignRecipe,
  getQwenInstallStatus,
  getQwenLayout,
  getQwenModelDir,
  materializeSidecarScript,
  referenceAudioPath,
  type QwenReferenceAudio
} from './qwenTtsStore';
import { DEFAULT_QWEN_CHUNK_SIZE, nextQwenChunkSize, steadyGenerationRate } from './qwenChunkPolicy';
import type { QwenInstallStatus } from './qwenTtsRegistry';
import type { SpeakHandlers } from './piperTtsService';

export type QwenTtsStatus = 'unloaded' | 'starting' | 'loading' | 'ready' | 'error' | 'unavailable';

export interface QwenTtsState {
  status: QwenTtsStatus;
  modelKind: QwenModelKind | null;
  sampleRate: number | null;
  processActive: boolean;
  queueLength: number;
  /** Загрузка весов и захват CUDA graphs, мс. */
  loadTimeMs?: number;
  vramMb?: number;
  gpu?: string;
  respawnAttempts: number;
  /** Текущий размер чанка потоковой генерации, кадров кодека. */
  chunkSize: number;
  idleUnloadMs: number;
  /** Модель держится в памяти без выгрузки по простою: Qwen выбран движком реплик (TASK-119). */
  keepLoaded: boolean;
  error?: string;
  errorCode?: QwenTtsErrorCode;
}

export interface QwenSpeakRequest {
  jobId: string;
  text: string;
  voiceId: string;
  language?: 'ru' | 'en';
  /** Инструкция подачи для пресет-голоса: эмоция, темп. */
  instruct?: string;
  /**
   * Рецепт несохранённого голоса — проба перед сохранением. Текст пробы задаёт сервис: это текст
   * эталонной записи, и прозвучавшая проба становится эталоном голоса.
   */
  draft?: { instruct?: unknown; seed?: unknown };
}

/** Эталон сохранённого голоса: запись, её текст и зерно для воспроизводимости реплик. */
export interface QwenVoiceReference {
  refAudio: string;
  refText: string;
  seed: number;
}

export class QwenTtsError extends Error {
  readonly code: QwenTtsErrorCode;
  constructor(code: QwenTtsErrorCode, message?: string) {
    super(message || code);
    this.name = 'QwenTtsError';
    this.code = code;
  }
}

export interface QwenTtsTimeouts {
  /** Импорт torch с холодного диска занимает десятки секунд. */
  startMs: number;
  /** Чтение 4.5 ГБ весов с диска и захват CUDA graphs. */
  loadMs: number;
  /** Один фрагмент — не длиннее 240 символов, это до ~25 с звука при RTF около 1. */
  synthMs: number;
  /** Сколько ждать завершения сайдкара по просьбе, прежде чем снять его принудительно. */
  stopGraceMs: number;
}

const DEFAULT_TIMEOUTS: QwenTtsTimeouts = { startMs: 120_000, loadMs: 300_000, synthMs: 90_000, stopGraceMs: 3_000 };

/** Внешние зависимости сервиса — подменяются в unit-тестах поддельным сайдкаром. */
export interface QwenTtsDeps {
  spawnSidecar: () => Promise<ChildProcessWithoutNullStreams>;
  getInstallStatus: () => Promise<Pick<QwenInstallStatus, 'runtimeReady' | 'models'>>;
  getModelDir: (kind: QwenModelKind) => string;
  getVoiceReference: (slug: string) => Promise<QwenVoiceReference | null>;
  idleUnloadMs: () => number;
  timeouts: QwenTtsTimeouts;
}

async function spawnInstalledSidecar(): Promise<ChildProcessWithoutNullStreams> {
  const script = await materializeSidecarScript();
  if (!script) throw new QwenTtsError('qwen_sidecar_missing', 'sidecar.py not found next to the app bundle');
  return spawn(getQwenLayout().venvPython, ['-u', script], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', HF_HUB_OFFLINE: '1' }
  });
}
const MAX_RESPAWN_ATTEMPTS = 2;
const DEFAULT_IDLE_UNLOAD_MS = 10 * 60_000;

function idleUnloadMs(): number {
  const raw = Number(process.env.PROJECTHUB_QWEN_IDLE_MS);
  return Number.isFinite(raw) && raw >= 1000 ? raw : DEFAULT_IDLE_UNLOAD_MS;
}

interface PendingRequest {
  resolve: (msg: QwenSidecarMessage | { type: 'cancelled'; id: string }) => void;
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
  /** Звук пробы копится, чтобы при сохранении голоса стать его эталоном. */
  capture?: Float32Array[];
}

interface SynthesisParams {
  kind: QwenModelKind;
  speaker?: string;
  instruct?: string;
  seed?: number;
  refAudio?: string;
  refText?: string;
  /** Ключ черновика: проба голоса, звук которой нужно запомнить. */
  draftKey?: string;
}

export class QwenTtsService {
  private readonly deps: QwenTtsDeps;

  constructor(deps: Partial<QwenTtsDeps> = {}) {
    this.deps = {
      spawnSidecar: spawnInstalledSidecar,
      getInstallStatus: getQwenInstallStatus,
      getModelDir: getQwenModelDir,
      getVoiceReference: async (slug) => {
        const recipe = await getDesignRecipe(slug);
        return recipe ? { refAudio: referenceAudioPath(slug), refText: recipe.refText, seed: recipe.seed } : null;
      },
      idleUnloadMs,
      ...deps,
      timeouts: { ...DEFAULT_TIMEOUTS, ...deps.timeouts }
    };
  }

  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<ChildProcessWithoutNullStreams> | null = null;
  /** Загрузки модели идут строго по очереди: на 8 ГБ видеопамяти две модели не помещаются. */
  private modelQueue: Promise<unknown> = Promise.resolve();
  private status: QwenTtsStatus = 'unloaded';
  private modelKind: QwenModelKind | null = null;
  private sampleRate: number | null = null;
  private loadTimeMs?: number;
  private vramMb?: number;
  private gpu?: string;
  private errorMessage?: string;
  private errorCode?: QwenTtsErrorCode;
  private respawnAttempts = 0;
  private disposed = false;
  private idleTimer: NodeJS.Timeout | null = null;
  /** Кадров кодека на чанк звука; подбирается по скорости генерации (`qwenChunkPolicy`). */
  private chunkSize: number = DEFAULT_QWEN_CHUNK_SIZE;
  /**
   * Не выгружать модель по простою. Включает рендерер, пока Qwen выбран движком реплик: иначе
   * первая реплика после простоя ждала бы загрузки модели (TASK-119, decision-66).
   */
  private keepLoaded = false;
  /** Последняя прослушанная целиком проба черновика — эталон голоса при сохранении. */
  private lastDraft: (QwenReferenceAudio & { key: string }) | null = null;

  private requestCounter = 0;
  private pending = new Map<string, PendingRequest>();
  private jobs = new Map<string, ActiveJob>();

  getState(): QwenTtsState {
    return {
      status: this.status,
      modelKind: this.modelKind,
      sampleRate: this.sampleRate,
      processActive: Boolean(this.child),
      queueLength: this.jobs.size,
      loadTimeMs: this.loadTimeMs,
      vramMb: this.vramMb,
      gpu: this.gpu,
      respawnAttempts: this.respawnAttempts,
      chunkSize: this.chunkSize,
      idleUnloadMs: this.deps.idleUnloadMs(),
      keepLoaded: this.keepLoaded,
      error: this.errorMessage,
      errorCode: this.errorCode
    };
  }

  private fail(code: QwenTtsErrorCode, message: string, status: QwenTtsStatus = 'error') {
    this.status = status;
    this.errorCode = code;
    this.errorMessage = message;
    console.warn(`[QwenTTS] ${status} (${code}): ${message}`);
  }

  private touchIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.child || this.keepLoaded) return;
    this.idleTimer = setTimeout(() => {
      if (this.jobs.size > 0 || this.pending.size > 0) {
        this.touchIdleTimer();
        return;
      }
      console.log('[QwenTTS] Idle timeout — stopping sidecar to free GPU memory');
      void this.unload();
    }, this.deps.idleUnloadMs());
    this.idleTimer.unref?.();
  }

  private async ensureProcess(): Promise<ChildProcessWithoutNullStreams> {
    if (this.disposed) throw new QwenTtsError('qwen_sidecar_crashed', 'service is disposed');
    if (this.child) return this.child;
    if (this.starting) return this.starting;
    if (this.respawnAttempts > MAX_RESPAWN_ATTEMPTS) {
      throw new QwenTtsError(this.errorCode ?? 'qwen_sidecar_crashed', this.errorMessage);
    }

    this.starting = (async () => {
      this.status = 'starting';
      this.errorCode = undefined;
      this.errorMessage = undefined;

      const child = await this.deps.spawnSidecar();

      const ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new QwenTtsError('qwen_sidecar_timeout', 'sidecar did not start in time')),
          this.deps.timeouts.startMs
        );
        timer.unref?.();
        this.pending.set('@ready', {
          resolve: () => resolve(),
          reject,
          timer
        });
      });

      child.stdout.on('data', createLineSplitter((line) => this.handleLine(child, line)));
      // Вывод библиотек — в общий лог main. Текст реплик сайдкар не печатает
      child.stderr.on(
        'data',
        createLineSplitter((line) => {
          if (line.trim()) console.log(`[QwenTTS:sidecar] ${line.trim().slice(0, 400)}`);
        })
      );
      child.stdin.on('error', () => {
        // канал закрыт упавшим сайдкаром — причину сообщит событие exit
      });
      child.on('error', (err) => this.handleFailure(child, 'qwen_sidecar_crashed', err.message));
      child.on('exit', (code, signal) =>
        this.handleFailure(child, 'qwen_sidecar_crashed', `sidecar exited with code ${code ?? signal}`)
      );

      this.child = child;
      try {
        await ready;
      } catch (err) {
        this.stopChild(child);
        throw err;
      }
      console.log(`[QwenTTS] Sidecar started (pid ${child.pid}${this.gpu ? `, ${this.gpu}` : ''})`);
      this.touchIdleTimer();
      return child;
    })();

    try {
      return await this.starting;
    } catch (err) {
      const error = err instanceof QwenTtsError ? err : new QwenTtsError('qwen_sidecar_crashed', String(err));
      this.fail(error.code, error.message, this.respawnAttempts > MAX_RESPAWN_ATTEMPTS ? 'unavailable' : 'error');
      throw error;
    } finally {
      this.starting = null;
    }
  }

  private handleLine(child: ChildProcessWithoutNullStreams, line: string) {
    if (this.child !== child) return;
    const msg = parseSidecarMessage(line);
    if (!msg) return;

    if (msg.type === 'ready') {
      this.gpu = msg.gpu ?? undefined;
      if (msg.cuda === false) {
        this.settle('@ready', new QwenTtsError('qwen_runtime_broken', 'torch does not see a CUDA device'));
      } else {
        this.settle('@ready', msg);
      }
      return;
    }

    if (msg.type === 'chunk') {
      const job = this.jobs.get(msg.id);
      if (!job || job.cancelled) return;
      const samples = decodePcm16(msg.pcm);
      if (samples.length === 0) return;
      job.audioSec += samples.length / msg.sampleRate;
      job.capture?.push(samples);
      this.sampleRate = msg.sampleRate;
      job.handlers.onChunk({ jobId: msg.id, samples, sampleRate: msg.sampleRate, index: job.chunks });
      job.chunks += 1;
      return;
    }

    if (msg.type === 'error') {
      const error = new QwenTtsError(toQwenErrorCode(msg.code, 'qwen_synthesis_failed'), msg.error);
      // Ошибка без id до готовности — сайдкар не смог подняться (не импортируется torch)
      this.settle(msg.id ?? '@ready', error);
      return;
    }

    this.settle(msg.id, msg);
  }

  private settle(id: string, outcome: QwenSidecarMessage | Error) {
    const request = this.pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(id);
    if (outcome instanceof Error) request.reject(outcome);
    else request.resolve(outcome);
  }

  private stopChild(child: ChildProcessWithoutNullStreams) {
    if (this.child === child) this.child = null;
    try {
      child.stdin.write(encodeSidecarRequest({ type: 'shutdown' }));
      child.stdin.end();
    } catch {
      // канал уже закрыт
    }
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }, this.deps.timeouts.stopGraceMs);
    timer.unref?.();
    child.once('exit', () => clearTimeout(timer));
  }

  private handleFailure(child: ChildProcessWithoutNullStreams, code: QwenTtsErrorCode, message: string) {
    if (this.child !== child) return;
    this.child = null;
    this.modelKind = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);

    const error = new QwenTtsError(code, message);
    for (const [id, request] of [...this.pending.entries()]) {
      clearTimeout(request.timer);
      this.pending.delete(id);
      request.reject(error);
    }
    for (const job of this.jobs.values()) {
      if (!job.cancelled) job.handlers.onError({ jobId: job.jobId, error: message, errorCode: code });
    }
    this.jobs.clear();

    if (this.disposed) return;
    this.respawnAttempts += 1;
    this.fail(code, message, this.respawnAttempts > MAX_RESPAWN_ATTEMPTS ? 'unavailable' : 'error');
  }

  private request(
    child: ChildProcessWithoutNullStreams,
    payload: Record<string, unknown> & { id: string },
    timeoutMs: number
  ): Promise<QwenSidecarMessage | { type: 'cancelled'; id: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(payload.id);
        // Сайдкар молчит дольше разумного — считаем его зависшим и снимаем
        const message = `sidecar request timed out after ${Math.round(timeoutMs / 1000)}s`;
        reject(new QwenTtsError('qwen_sidecar_timeout', message));
        if (this.child === child) {
          this.handleFailure(child, 'qwen_sidecar_timeout', message);
          child.kill();
        }
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(payload.id, { resolve, reject, timer });
      try {
        child.stdin.write(encodeSidecarRequest(payload));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(payload.id);
        reject(new QwenTtsError('qwen_sidecar_crashed', err instanceof Error ? err.message : String(err)));
      }
    });
  }

  /** Поднимает сайдкар и загружает модель нужного вида; параллельные вызовы выстраиваются в очередь. */
  ensureModel(kind: QwenModelKind): Promise<QwenTtsState> {
    const run = this.modelQueue.then(() => this.loadModel(kind));
    this.modelQueue = run.catch(() => undefined);
    return run;
  }

  private async loadModel(kind: QwenModelKind): Promise<QwenTtsState> {
    const install = await this.deps.getInstallStatus();
    if (!install.runtimeReady) {
      this.fail('qwen_not_installed', 'Qwen3-TTS runtime is not installed', 'unavailable');
      throw new QwenTtsError('qwen_not_installed');
    }
    if (!install.models[kind]) {
      this.fail('qwen_model_missing', `model ${kind} is not downloaded`);
      throw new QwenTtsError('qwen_model_missing', kind);
    }

    const child = await this.ensureProcess();
    if (this.modelKind === kind && this.status === 'ready') return this.getState();

    this.status = 'loading';
    this.errorCode = undefined;
    this.errorMessage = undefined;
    try {
      const res = await this.request(
        child,
        { type: 'load', id: `load-${++this.requestCounter}`, kind, modelDir: this.deps.getModelDir(kind) },
        this.deps.timeouts.loadMs
      );
      if (res.type !== 'loaded') throw new QwenTtsError('qwen_load_failed', `unexpected reply: ${res.type}`);
      this.modelKind = kind;
      this.sampleRate = res.sampleRate;
      this.loadTimeMs = res.loadMs + res.warmupMs;
      this.vramMb = res.vramMb;
      this.status = 'ready';
      console.log(`[QwenTTS] Model ${kind} loaded in ${this.loadTimeMs}ms (VRAM ${res.vramMb ?? '?'} MB)`);
      this.touchIdleTimer();
      return this.getState();
    } catch (err) {
      const error = err instanceof QwenTtsError ? err : new QwenTtsError('qwen_load_failed', String(err));
      this.modelKind = null;
      if (this.child === child) this.fail(error.code, error.message);
      throw error;
    }
  }

  /** Параметры синтеза из идентификатора голоса: пресет с инструкцией или рецепт VoiceDesign. */
  private async resolveSynthesis(req: QwenSpeakRequest): Promise<SynthesisParams> {
    const parsed = parseQwenVoiceId(req.voiceId);
    if (!parsed) throw new QwenTtsError('qwen_voice_not_found', req.voiceId);

    const kind = modelForVoice(parsed);
    if (parsed.kind === 'custom') {
      return { kind, speaker: parsed.speaker, instruct: normalizeInstruct(req.instruct) || undefined };
    }
    if ('draft' in parsed) {
      const instruct = normalizeInstruct(req.draft?.instruct);
      const seed = req.draft?.seed;
      if (instruct.length < 10 || !isValidSeed(seed)) throw new QwenTtsError('qwen_invalid_recipe');
      return { kind, instruct, seed, draftKey: draftKey(instruct, seed) };
    }
    // Сохранённый голос звучит клоном эталонной записи: сама VoiceDesign на разных фразах даёт
    // разные голоса под одно описание
    const reference = await this.deps.getVoiceReference(parsed.slug);
    if (!reference) throw new QwenTtsError('qwen_voice_not_found', req.voiceId);
    return { kind, refAudio: reference.refAudio, refText: reference.refText, seed: reference.seed };
  }

  /**
   * Звук прослушанной пробы для сохранения голоса. Отдаётся только проба именно этого описания и
   * зерна, доигранная до конца: оборванная отменой запись эталоном не становится.
   */
  getDraftAudio(instruct: unknown, seed: unknown): QwenReferenceAudio | null {
    if (!this.lastDraft || !isValidSeed(seed)) return null;
    if (this.lastDraft.key !== draftKey(normalizeInstruct(instruct), seed)) return null;
    const { samples, sampleRate, text } = this.lastDraft;
    return { samples, sampleRate, text };
  }

  /** Прогрев: поднять сайдкар и загрузить модель голоса, не озвучивая ничего. */
  async warmup(voiceId: string): Promise<QwenTtsState> {
    const parsed = parseQwenVoiceId(voiceId);
    if (!parsed) {
      this.fail('qwen_voice_not_found', voiceId);
      return this.getState();
    }
    try {
      return await this.ensureModel(modelForVoice(parsed));
    } catch {
      return this.getState();
    }
  }

  /** Синтезирует текст по фрагментам; звук уходит в обработчик по мере декодирования. */
  async speak(req: QwenSpeakRequest, handlers: SpeakHandlers): Promise<void> {
    const { jobId } = req;
    const job: ActiveJob = { jobId, handlers, cancelled: false, chunks: 0, audioSec: 0, startedAt: Date.now() };
    this.jobs.set(jobId, job);

    try {
      const params = await this.resolveSynthesis(req);
      const langKey = req.language === 'en' ? 'en' : 'ru';
      // Проба черновика произносит текст эталона целиком, одним фрагментом: запись не должна
      // склеиваться из кусков с разной интонацией
      const draftText = params.draftKey ? QWEN_REFERENCE_TEXT[langKey] : null;
      if (draftText) job.capture = [];
      const fragments = draftText ? [draftText] : splitTextForTts(req.text);
      if (fragments.length === 0) {
        handlers.onDone({ jobId, timeMs: 0, audioSec: 0, chunks: 0 });
        return;
      }

      await this.ensureModel(params.kind);
      const language = QWEN_LANGUAGE_NAMES[langKey];

      for (const fragment of fragments) {
        if (job.cancelled) break;
        // Модель могла смениться, пока звучал предыдущий фрагмент (проба голоса другого вида)
        if (this.modelKind !== params.kind) await this.ensureModel(params.kind);
        const child = this.child;
        if (!child) throw new QwenTtsError('qwen_sidecar_crashed', 'sidecar is not running');
        const chunkSize = this.chunkSize;
        const reply = await this.request(
          child,
          {
            type: 'synthesize',
            id: jobId,
            text: fragment,
            language,
            speaker: params.speaker,
            instruct: params.instruct,
            refAudio: params.refAudio,
            refText: params.refText,
            seed: params.seed,
            chunkSize
          },
          this.deps.timeouts.synthMs
        );
        if (reply.type === 'done') {
          // Размер чанка следует за измеренной скоростью: она зависит от загрузки видеокарты
          const rate = steadyGenerationRate(reply, chunkSize);
          // В лог идут только времена: по ним видно, успевает ли движок за воспроизведением.
          // Текст реплики не пишется
          console.log(
            `[QwenTTS] ${params.kind}: first chunk ${reply.firstChunkMs ?? '-'}ms, ${reply.audioSec}s audio in ` +
              `${reply.genMs}ms, chunk ${chunkSize}${rate === null ? '' : `, rate ${rate.toFixed(2)}`}`
          );
          const next = nextQwenChunkSize(chunkSize, rate);
          if (next !== this.chunkSize) {
            console.log(`[QwenTTS] Generation rate ${rate?.toFixed(2)} — chunk size ${this.chunkSize} → ${next}`);
            this.chunkSize = next;
          }
        }
        // Фрагмент озвучен — сайдкар здоров, перезапуски снова разрешены. После одной лишь загрузки
        // модели счётчик не сбрасывается: иначе сайдкар, падающий на синтезе, перезапускался бы вечно
        if (!job.cancelled) this.respawnAttempts = 0;
        this.touchIdleTimer();
      }

      if (!job.cancelled) {
        if (params.draftKey && draftText && job.capture && job.capture.length > 0) {
          const total = job.capture.reduce((sum, part) => sum + part.length, 0);
          const samples = new Float32Array(total);
          let offset = 0;
          for (const part of job.capture) {
            samples.set(part, offset);
            offset += part.length;
          }
          this.lastDraft = { key: params.draftKey, samples, sampleRate: this.sampleRate ?? 24000, text: draftText };
        }
        handlers.onDone({ jobId, timeMs: Date.now() - job.startedAt, audioSec: job.audioSec, chunks: job.chunks });
      }
    } catch (err) {
      // Падение сайдкара уже сообщено обработчику в handleFailure, задание там же снято
      if (!job.cancelled && this.jobs.has(jobId)) {
        const error = err instanceof QwenTtsError ? err : new QwenTtsError('qwen_synthesis_failed', String(err));
        handlers.onError({ jobId, error: error.message, errorCode: error.code });
      }
    } finally {
      this.jobs.delete(jobId);
    }
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.cancelled = true;
    try {
      this.child?.stdin.write(encodeSidecarRequest({ type: 'cancel', id: jobId }));
    } catch {
      // сайдкар уже завершился — отменять нечего
    }
    // Ожидающий фрагмент разрешаем сразу, чтобы цикл speak() вышел немедленно
    this.settle(jobId, { type: 'cancelled', id: jobId });
    return true;
  }

  cancelAll() {
    for (const jobId of [...this.jobs.keys()]) this.cancel(jobId);
  }

  /** Останавливает сайдкар и освобождает видеопамять; следующий запрос поднимет его заново. */
  async unload(): Promise<QwenTtsState> {
    this.cancelAll();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const child = this.child;
    this.modelKind = null;
    this.vramMb = undefined;
    if (child) this.stopChild(child);
    if (this.status !== 'unavailable') {
      this.status = 'unloaded';
      this.errorCode = undefined;
      this.errorMessage = undefined;
    }
    return this.getState();
  }

  /**
   * Держать модель в памяти, пока Qwen выбран движком реплик, или вернуть выгрузку по простою.
   * Выключение заводит таймер простоя заново: модель освободит видеопамять через обычный срок.
   */
  setKeepLoaded(keep: boolean): QwenTtsState {
    if (this.keepLoaded !== keep) {
      this.keepLoaded = keep;
      console.log(`[QwenTTS] Keep model loaded: ${keep ? 'on' : 'off'}`);
      this.touchIdleTimer();
    }
    return this.getState();
  }

  /**
   * Снимает признак недоступности после серии падений: окружение переустановлено или пользователь
   * сам выбрал голос в настройках и готов попробовать ещё раз.
   */
  resetAvailability() {
    this.respawnAttempts = 0;
    if (!this.child) {
      this.status = 'unloaded';
      this.errorCode = undefined;
      this.errorMessage = undefined;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.cancelAll();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const child = this.child;
    this.child = null;
    this.modelKind = null;
    this.status = 'unloaded';
    if (child) {
      try {
        child.stdin.end();
      } catch {
        // канал уже закрыт
      }
      child.kill();
    }
    console.log('[QwenTTS] Service disposed');
  }
}

export const qwenTtsService = new QwenTtsService();
