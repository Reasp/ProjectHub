/**
 * Что делать с репликой, пока модель Qwen3-TTS не в памяти (TASK-119, decision-66).
 *
 * Раньше реплика при незагруженной модели без ожидания уходила запасному движку (decision-64 п. 8),
 * а если и тот молчал — пропадала без следа. Теперь, если Qwen выбран движком реплик:
 *   - модель держится в памяти без выгрузки по простою и прогревается заранее — при старте
 *     приложения и при включении Qwen;
 *   - если модели всё же нет в памяти (запуск, ручная выгрузка, падение сайдкара), реплика ждёт
 *     её загрузки сколько нужно — предел задают тайм-ауты main — и звучит выбранным голосом;
 *   - запасных движков у Qwen нет: не смог (не установлен, признан недоступным, загрузка или синтез
 *     упали) — реплика не звучит, пользователь видит причину.
 *
 * Чистый модуль без React и `window` — покрыт unit-тестами.
 */
import { qwenReadiness, qwenVoiceModel, type QwenStatusLike, type TtsEngine } from './ttsEngineChain';

/**
 * Сколько ждать начала системной озвучки, мс. Без голосов или устройства вывода `speechSynthesis`
 * иногда не присылает ни `start`, ни `error` — без предела реплика висела бы вечно.
 */
export const SYSTEM_TTS_START_TIMEOUT_MS = 5_000;

/** Код причины: системный голос не зазвучал — нет голосов, устройства вывода или синтез отказал. */
export const SYSTEM_TTS_FAILED = 'system_tts_failed';
/** Коды причин, которые рождаются в рендерере, а не в main, — их тоже переводит `ttsErrors`. */
export const RENDERER_TTS_ERROR_CODES: readonly string[] = [SYSTEM_TTS_FAILED];

export type QwenReplyDecision =
  /** Модель голоса в памяти — озвучиваем сразу. */
  | { action: 'speak' }
  /** Модель грузится или её нужно загрузить — ждём прогрева, сколько бы он ни длился. */
  | { action: 'wait' }
  /** Qwen не может озвучить реплику — она не звучит, причина показывается. */
  | { action: 'fail'; reason: string };

/** Причина, по которой движок пропускается целиком: не установлен, нет модели, признан недоступным. */
export function qwenSkipReason(status: (QwenStatusLike & { errorCode?: string }) | null | undefined): string {
  if (status?.status === 'unavailable' && status.errorCode) return status.errorCode;
  if (!status?.install?.runtimeReady) return 'qwen_not_installed';
  return status.errorCode || 'qwen_model_missing';
}

/**
 * Решение до ожидания — по статусу движка из main. Прошлая загрузка упала (статус `error`) — всё
 * равно ждём повтора: пользователь выбрал Qwen, а серию падений сайдкара останавливает признак
 * недоступности (decision-64 п. 9).
 */
export function decideQwenReply(
  status: (QwenStatusLike & { errorCode?: string }) | null | undefined,
  voiceId: string
): QwenReplyDecision {
  const readiness = qwenReadiness(status, voiceId);
  if (readiness === 'speak') return { action: 'speak' };
  if (readiness === 'skip') return { action: 'fail', reason: qwenSkipReason(status) };
  return { action: 'wait' };
}

/** Решение после прогрева — по состоянию, которое он вернул. */
export function decideAfterQwenWarmup(
  warmed: { status?: string; modelKind?: string | null; error?: string; errorCode?: string },
  voiceId: string
): QwenReplyDecision {
  const kind = qwenVoiceModel(voiceId);
  if (kind && warmed.status === 'ready' && warmed.modelKind === kind) return { action: 'speak' };
  return { action: 'fail', reason: warmed.errorCode || warmed.error || 'qwen_load_failed' };
}

/**
 * Реплики звучат голосом Qwen3-TTS: озвучка включена и выбран этот движок. Пока это так, модель
 * держится в памяти без выгрузки по простою.
 */
export function speaksWithQwen(config: { ttsEnabled?: boolean; ttsEngine?: TtsEngine }): boolean {
  return Boolean(config.ttsEnabled) && config.ttsEngine === 'qwen';
}

/** Прогревать ли модель заранее: озвучка включена, выбран Qwen, а модели голоса нет в памяти. */
export function shouldPrewarmQwen(
  config: { ttsEnabled?: boolean; ttsEngine?: TtsEngine },
  status: QwenStatusLike | null | undefined,
  voiceId: string
): boolean {
  if (!speaksWithQwen(config)) return false;
  // Упавший прогрев сам себя не повторяет: при старте причину покажут, повтор — по реплике
  return qwenReadiness(status, voiceId) === 'warmup' && status?.status !== 'error';
}

/**
 * Ошибка `speechSynthesis` — это отказ системного голоса или лишь отмена: реплику перебили
 * новой (`cancel()` даёт `interrupted`/`canceled`), и молчать тут правильно.
 */
export function isSystemSpeechFailure(error: string | undefined): boolean {
  return error !== 'interrupted' && error !== 'canceled';
}

/** Попытка озвучить реплику одним движком: какой движок и почему не прозвучал. */
export interface TtsAttemptFailure {
  engine: TtsEngine;
  reason: string;
}

/** Что показать пользователю о реплике. `null` — показывать нечего, она прозвучала выбранным голосом. */
export type TtsNotice =
  | { kind: 'loading' }
  | { kind: 'fallback'; engine: TtsEngine; reason: string }
  | { kind: 'warmupFailed'; reason: string }
  | { kind: 'failed'; failures: TtsAttemptFailure[] };

/**
 * Итог реплики для пользователя: прозвучала запасным движком — почему не выбранным; не прозвучала
 * вовсе — причины по каждому движку. Озвученная выбранным движком реплика уведомления не даёт.
 */
export function replyOutcomeNotice(
  chain: TtsEngine[],
  failures: TtsAttemptFailure[],
  playedBy: TtsEngine | null
): TtsNotice | null {
  if (!playedBy) return { kind: 'failed', failures };
  if (playedBy === chain[0] || failures.length === 0) return null;
  return { kind: 'fallback', engine: playedBy, reason: failures[0].reason };
}

/** Строки уведомления об озвучке — из i18n (`voice.ttsNotice`). */
export interface TtsNoticeLabels {
  loading: string;
  fallback: string;
  warmupFailed: string;
  failed: string;
  engines: Record<TtsEngine, string>;
}

/**
 * Текст уведомления и сколько его держать: ожидание и полный отказ висят до замены или закрытия
 * (отказ должны увидеть, даже если окно открыли позже), остальное гаснет само.
 * `translate` переводит код причины (`ttsErrors`), незнакомый текст оставляет как есть.
 */
export function ttsNoticeView(
  notice: TtsNotice,
  labels: TtsNoticeLabels,
  translate: (reason: string) => string
): { text: string; tone: 'info' | 'warn' | 'error'; autoHideMs: number | null } {
  switch (notice.kind) {
    case 'loading':
      return { text: labels.loading, tone: 'info', autoHideMs: null };
    case 'fallback':
      return {
        text: labels.fallback.replace('{engine}', labels.engines[notice.engine]).replace('{reason}', translate(notice.reason)),
        tone: 'warn',
        autoHideMs: 6000
      };
    case 'warmupFailed':
      return { text: labels.warmupFailed.replace('{reason}', translate(notice.reason)), tone: 'error', autoHideMs: 10000 };
    case 'failed':
      return {
        text: labels.failed.replace(
          '{reasons}',
          notice.failures.map((f) => `${labels.engines[f.engine]} — ${translate(f.reason)}`).join('; ')
        ),
        tone: 'error',
        autoHideMs: null
      };
  }
}
