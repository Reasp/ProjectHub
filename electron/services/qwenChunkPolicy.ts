/**
 * Размер чанка потоковой генерации Qwen3-TTS подбирается по измеренной скорости (TASK-104,
 * decision-64).
 *
 * Модель выдаёт 12.5 кадра кодека в секунду; чанк — сколько кадров копится до декодирования в звук.
 * Маленький чанк даёт быстрый первый звук, но дороже: каждое декодирование пересчитывает контекст.
 * На RTX 2080, занятой ещё и игрой, чанк 8 генерируется на 5% медленнее, чем звучит, — речь
 * «заикается» микропаузами; чанк 12 укладывается в реальное время ценой +0.3 с до первого звука
 * (замеры 2026-09-28). На свободной видеокарте хватает чанка 8. Угадать заранее нельзя — скорость
 * зависит от того, чем ещё занята видеокарта, — поэтому размер следует за измерением.
 *
 * Чистый модуль: без процессов и Electron — покрыт unit-тестами.
 */

/** Длительность одного кадра кодека, с: 12.5 кадра в секунду. */
export const QWEN_FRAME_SEC = 0.08;

/** Допустимые размеры чанка по возрастанию: первый звук примерно через 0.8, 1.1 и 1.4 с. */
export const QWEN_CHUNK_SIZES = [8, 12, 16] as const;

export const DEFAULT_QWEN_CHUNK_SIZE = 8;

/** Генерация медленнее воспроизведения — чанк увеличивается. */
const STEP_UP_RATE = 0.99;
/**
 * Запас больше 12% — чанк уменьшается. Шаг размера меняет скорость примерно на 5%, поэтому
 * зазор между порогами исключает переключение туда-обратно.
 */
const STEP_DOWN_RATE = 0.88;
/** Короткий фрагмент скорость не показывает: в нём почти всё время — ожидание первого чанка. */
const MIN_TAIL_SEC = 1.0;

export interface QwenFragmentTiming {
  genMs: number;
  firstChunkMs: number | null;
  audioSec: number;
  chunks: number;
}

/**
 * Установившаяся скорость генерации: секунд работы на секунду звука после первого чанка.
 * Меньше 1 — звук копится быстрее, чем играет; больше 1 — воспроизведение догоняет генерацию.
 * `null`, если фрагмент слишком короткий для оценки.
 */
export function steadyGenerationRate(timing: QwenFragmentTiming, chunkSize: number): number | null {
  if (timing.firstChunkMs === null || timing.chunks < 3) return null;
  const tailAudioSec = timing.audioSec - chunkSize * QWEN_FRAME_SEC;
  const tailGenSec = (timing.genMs - timing.firstChunkMs) / 1000;
  if (!(tailAudioSec >= MIN_TAIL_SEC) || !(tailGenSec > 0)) return null;
  return tailGenSec / tailAudioSec;
}

/**
 * Таймаут синтеза одного фрагмента (TASK-116): базовый запас на первый чанк и разгон плюс время на
 * каждый символ. Русская речь — около 14 символов в секунду; 250 мс на символ — это скорость
 * генерации в 3.5 раза медленнее воспроизведения, прежде чем сайдкар сочтут зависшим. При базе 30 с
 * фрагмент в 240 символов получает прежние 90 с, фрагмент в 600 символов — 180 с.
 */
export function qwenSynthTimeoutMs(chars: number, baseMs: number, perCharMs: number): number {
  const length = Number.isFinite(chars) && chars > 0 ? chars : 0;
  return Math.round(baseMs + Math.max(0, perCharMs) * length);
}

/** Размер чанка для следующего фрагмента по скорости предыдущего. */
export function nextQwenChunkSize(current: number, rate: number | null): number {
  const sizes: readonly number[] = QWEN_CHUNK_SIZES;
  const index = sizes.indexOf(current);
  if (index < 0) return DEFAULT_QWEN_CHUNK_SIZE;
  if (rate === null || !Number.isFinite(rate)) return current;
  if (rate > STEP_UP_RATE) return sizes[Math.min(index + 1, sizes.length - 1)];
  if (rate < STEP_DOWN_RATE) return sizes[Math.max(index - 1, 0)];
  return current;
}
