/**
 * Детектор перебивания озвучки (barge-in), TASK-83 п. 3.
 *
 * Пока приложение говорит само, VAD намеренно не анализирует вход: флаг `ttsMuted` в
 * `voiceService` полностью отключает разбор звука, иначе приложение реагировало бы на собственную
 * речь. Второй механизм глушения здесь не заводится — вместо этого внутри того же гейта работает
 * отдельная, намеренно простая проверка: говорит ли человек достаточно громко и достаточно долго,
 * чтобы счесть это перебиванием и замолчать.
 *
 * Модель — **серия речи с паузами**, а не непрерывное превышение порога. Первая версия требовала
 * 350 мс подряд чанков громче 0.08 и на живой проверке (2026-09-17, фейковый микрофон, речь Piper)
 * не срабатывала вовсе: чанк захвата — около 85 мс, и RMS обычной фразы в таких окнах 0.02–0.1 с
 * провалами между словами, так что серия рвалась на каждой паузе. Теперь серия переживает паузы
 * до `maxGapMs` (два тихих чанка подряд), а срабатывание требует и длительности, и нескольких громких чанков.
 *
 * Порог громкости — **относительный**: доля (0.3) типичного уровня речи самого пользователя, который
 * VAD наблюдает на его командах (`phraseSpeechLevel`, `updateSpeechLevel`, `bargeInThresholdFor`).
 * Громкость фразы — 75-й перцентиль её звучащих чанков: среднее по всем чанкам тянут вниз тихие
 * концы слов. Доля 0.3, а не 0.5: на замере команда «Какие задачи?» дала p75 0.195, а «Замолчи,
 * хватит, замолчи» той же громкости — 0.073 (шипящие и паузы), и при половине уровня обычная
 * просьба замолчать озвучку не прерывала. Абсолютное число
 * не подходит: уровень зависит от микрофона и расстояния, а на замере 2026-09-17 одна и та же фраза
 * на входе приложения давала 0.17–0.28, а эхо той же фразы в 4 раза тише — 0.03–0.12, то есть
 * абсолютный порог, разделяющий их на одном микрофоне, на другом оказался бы мимо. Пока голос
 * пользователя не слышен ни разу, действует запасной порог.
 *
 * Защита от собственной озвучки держится прежде всего на `echoCancellation` захвата: громкостью
 * эхо от речи пользователя не отличить. На фейковом микрофоне без эхоподавления та же речь на
 * −12 и −18 дБ после AGC перебивала озвучку при любом пороге, при котором перебивает и обычная
 * просьба «замолчи». Поэтому устойчивость к эху через колонки проверяется только на живом
 * микрофоне (TASK-90); одиночный щелчок даёт один громкий чанк и серией не становится.
 *
 * Чистый модуль без React и Electron — покрыт unit-тестами.
 */

export interface BargeInOptions {
  /** Порог RMS: ниже него звук не считается речью пользователя. */
  threshold: number;
  /** Сколько миллисекунд должна длиться серия речи (от первого до последнего громкого чанка). */
  sustainMs: number;
  /** Пауза между громкими чанками, которая ещё не обрывает серию (промежутки между словами). */
  maxGapMs: number;
  /** Минимум громких чанков в серии: отсекает редкие щелчки, растянутые во времени. */
  minLoudChunks: number;
}

export const DEFAULT_BARGE_IN: BargeInOptions = {
  // Абсолютный порог — только значение по умолчанию; voiceService подставляет относительный
  threshold: 0.08,
  // Два чанка по 85 мс подряд: короткое «хватит» на замерах давало два–три громких чанка.
  // Ложное срабатывание лишь останавливает чтение, а пропущенное не даёт остановить его без рук.
  sustainMs: 80,
  maxGapMs: 300,
  minLoudChunks: 2
};

export interface BargeInThresholdOptions {
  /** Доля типичного уровня речи пользователя, выше которой звук считается перебиванием. */
  speechRatio: number;
  /** Нижняя граница порога: не ниже шумового порога VAD с запасом. */
  minThreshold: number;
  /** Верхняя граница: очень громкий пользователь не должен делать перебивание невозможным. */
  maxThreshold: number;
  /** Порог, пока уровень речи пользователя неизвестен (он ещё не произнёс ни одной команды). */
  fallbackThreshold: number;
}

export const DEFAULT_BARGE_IN_THRESHOLD: BargeInThresholdOptions = {
  speechRatio: 0.3,
  minThreshold: 0.035,
  maxThreshold: 0.2,
  fallbackThreshold: 0.08
};

/** Сглаживание между фразами: новая фраза весит 30 %, одна громкая реплика не перекашивает оценку. */
const SPEECH_LEVEL_ALPHA = 0.3;

/** Громкость одной фразы: 75-й перцентиль RMS чанков, где VAD слышал звук. `null` — звука не было. */
export function phraseSpeechLevel(rmsValues: readonly number[]): number | null {
  const values = rmsValues.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (values.length === 0) return null;
  return values[Math.min(values.length - 1, Math.floor(values.length * 0.75))];
}

/**
 * Обновляет типичный уровень речи пользователя по громкости очередной фразы.
 * `null` — уровень ещё неизвестен.
 */
export function updateSpeechLevel(level: number | null, rms: number): number | null {
  if (!Number.isFinite(rms) || rms <= 0) return level;
  return level === null ? rms : level * (1 - SPEECH_LEVEL_ALPHA) + rms * SPEECH_LEVEL_ALPHA;
}

/** Порог громкости barge-in для текущего уровня речи пользователя. */
export function bargeInThresholdFor(
  speechLevel: number | null,
  options: BargeInThresholdOptions = DEFAULT_BARGE_IN_THRESHOLD
): number {
  if (speechLevel === null || !Number.isFinite(speechLevel)) return options.fallbackThreshold;
  return Math.min(options.maxThreshold, Math.max(options.minThreshold, speechLevel * options.speechRatio));
}

export interface BargeInState {
  /** Момент первого громкого чанка текущей серии. */
  since: number;
  /** Момент последнего громкого чанка. */
  lastLoud: number;
  /** Сколько громких чанков в серии. */
  loudChunks: number;
  /**
   * Идёт ли серия. Отдельный флаг, а не `since === 0`: нулевая метка времени — совершенно
   * нормальное значение `now`, и сентинел на неё бы наложился.
   */
  active: boolean;
  /** Перебивание уже засчитано: повторно не срабатываем до сброса. */
  triggered: boolean;
}

export function createBargeInState(): BargeInState {
  return { since: 0, lastLoud: 0, loudChunks: 0, active: false, triggered: false };
}

/** Сбрасывается при старте и остановке озвучки: каждая реплика судится заново. */
export function resetBargeIn(state: BargeInState): void {
  state.since = 0;
  state.lastLoud = 0;
  state.loudChunks = 0;
  state.active = false;
  state.triggered = false;
}

function breakRun(state: BargeInState): void {
  state.since = 0;
  state.lastLoud = 0;
  state.loudChunks = 0;
  state.active = false;
}

/**
 * Скармливает детектору громкость очередного аудиочанка.
 *
 * @returns `true` ровно один раз — в момент, когда речь признана перебиванием.
 */
export function feedBargeIn(
  state: BargeInState,
  rms: number,
  now: number,
  options: BargeInOptions = DEFAULT_BARGE_IN
): boolean {
  if (state.triggered) return false;

  const loud = Number.isFinite(rms) && rms > options.threshold;

  if (!loud) {
    // Тихий чанк серию не обрывает, пока пауза укладывается в промежуток между словами
    if (state.active && now - state.lastLoud > options.maxGapMs) breakRun(state);
    return false;
  }

  if (!state.active || now - state.lastLoud > options.maxGapMs) {
    state.active = true;
    state.since = now;
    state.loudChunks = 0;
  }
  state.lastLoud = now;
  state.loudChunks += 1;

  if (now - state.since < options.sustainMs || state.loudChunks < options.minLoudChunks) return false;

  state.triggered = true;
  return true;
}
