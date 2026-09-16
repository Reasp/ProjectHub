/**
 * Детектор перебивания озвучки (barge-in), TASK-83 п. 3.
 *
 * Пока приложение говорит само, VAD намеренно не анализирует вход: флаг `ttsMuted` в
 * `voiceService` полностью отключает разбор звука, иначе приложение реагировало бы на собственную
 * речь. Второй механизм глушения здесь не заводится — вместо этого внутри того же гейта работает
 * отдельная, намеренно тупая проверка: достаточно ли громко и достаточно ли долго говорит человек,
 * чтобы счесть это перебиванием и замолчать.
 *
 * Порог заметно выше обычного порога VAD (тот адаптируется к шуму и стоит около 0.012): во время
 * воспроизведения микрофон слышит и саму озвучку, если пользователь сидит на колонках. Эхоподавление
 * `echoCancellation` в захвате включено, но полагаться только на него нельзя, поэтому требуется и
 * громкость, и длительность — случайный хлопок или щелчок озвучку не прервёт.
 *
 * Чистый модуль без React и Electron — покрыт unit-тестами.
 */

export interface BargeInOptions {
  /** Порог RMS: ниже него звук не считается речью пользователя. */
  threshold: number;
  /** Сколько миллисекунд подряд нужно держаться выше порога. */
  sustainMs: number;
}

export const DEFAULT_BARGE_IN: BargeInOptions = {
  threshold: 0.08,
  sustainMs: 350
};

export interface BargeInState {
  /** Момент, когда звук впервые превысил порог в текущей серии. */
  since: number;
  /**
   * Идёт ли серия превышений порога. Отдельный флаг, а не `since === 0`: нулевая метка времени —
   * совершенно нормальное значение `now`, и сентинел на неё бы наложился.
   */
  active: boolean;
  /** Перебивание уже засчитано: повторно не срабатываем до сброса. */
  triggered: boolean;
}

export function createBargeInState(): BargeInState {
  return { since: 0, active: false, triggered: false };
}

/** Сбрасывается при старте и остановке озвучки: каждая реплика судится заново. */
export function resetBargeIn(state: BargeInState): void {
  state.since = 0;
  state.active = false;
  state.triggered = false;
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
  if (!Number.isFinite(rms) || rms <= options.threshold) {
    // Провал ниже порога рвёт серию: перебивание — это непрерывная речь, а не отдельные всплески.
    state.since = 0;
    state.active = false;
    return false;
  }

  if (state.triggered) return false;

  if (!state.active) {
    state.active = true;
    state.since = now;
    return false;
  }

  if (now - state.since < options.sustainMs) return false;

  state.triggered = true;
  return true;
}
