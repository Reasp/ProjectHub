/**
 * Порядок движков озвучки и готовность второго движка к реплике (TASK-104, decision-64).
 *
 * Qwen3-TTS живёт в сайдкаре, который поднимается по требованию: импорт torch и загрузка весов
 * занимают 10–40 с. Пока Qwen выбран движком реплик, модель держится в памяти, а если её там нет,
 * реплика ждёт загрузки; решение принимает `ttsReplyPolicy` (TASK-119, decision-66).
 *
 * Чистый модуль без React и `window` — покрыт unit-тестами.
 */

/** Движок озвучки: системный speechSynthesis, локальный Piper или Qwen3-TTS в сайдкаре. */
export type TtsEngine = 'system' | 'piper' | 'qwen';

export const QWEN_VOICE_PREFIX = 'qwen:';
export const DEFAULT_QWEN_VOICE_ID = 'qwen:custom:serena';
/** Несохранённый голос VoiceDesign: проба рецепта в настройках. */
export const QWEN_DRAFT_VOICE_ID = 'qwen:design:@draft';

/**
 * Пауза пополнения буфера воспроизведения Qwen3-TTS при разрыве, с. На загруженной видеокарте
 * генерация отстаёт от воспроизведения на 3–5%: запаса в четверть секунды хватает примерно на
 * 5 с речи (замеры decision-64).
 */
export const QWEN_REBUFFER_SEC = 0.25;

/**
 * Движки в порядке попыток: каждый следующий — деградация предыдущего. У Qwen3-TTS запасных движков
 * нет: выбранный голос звучит всегда, а если не смог — реплика не звучит и пользователь видит
 * причину (TASK-119, decision-66). Piper по-прежнему подстрахован системным голосом.
 */
export function ttsEngineChain(engine: TtsEngine): TtsEngine[] {
  if (engine === 'qwen') return ['qwen'];
  if (engine === 'piper') return ['piper', 'system'];
  return ['system'];
}

export type QwenVoiceKind = 'custom' | 'design';
export type QwenModelKind = 'custom' | 'design' | 'base';

export function qwenVoiceKind(voiceId: string): QwenVoiceKind | null {
  if (!voiceId.startsWith(QWEN_VOICE_PREFIX)) return null;
  if (voiceId.startsWith(`${QWEN_VOICE_PREFIX}design:`)) return 'design';
  if (voiceId.startsWith(`${QWEN_VOICE_PREFIX}custom:`)) return 'custom';
  return null;
}

/**
 * Модель, которой звучит голос: пресет — CustomVoice, сохранённый голос по описанию — Base (клон
 * эталонной записи), черновик — VoiceDesign. Повторяет `modelForVoice` main-процесса.
 */
export function qwenVoiceModel(voiceId: string): QwenModelKind | null {
  const kind = qwenVoiceKind(voiceId);
  if (kind !== 'design') return kind;
  return voiceId === QWEN_DRAFT_VOICE_ID ? 'design' : 'base';
}

export interface QwenStatusLike {
  status?: string;
  modelKind?: string | null;
  install?: { runtimeReady?: boolean; models?: Partial<Record<QwenModelKind, boolean>> };
}

/**
 * Что делать с репликой:
 *   - `speak` — модель голоса загружена, озвучиваем;
 *   - `warmup` — движок установлен, но модель не в памяти: её нужно загрузить (см. `ttsReplyPolicy`);
 *   - `skip` — движок не установлен или неисправен, фразу отдаём дальше.
 */
export type QwenReadiness = 'speak' | 'warmup' | 'skip';

export function qwenReadiness(status: QwenStatusLike | null | undefined, voiceId: string): QwenReadiness {
  const kind = qwenVoiceModel(voiceId);
  if (!status || !kind) return 'skip';
  if (!status.install?.runtimeReady || !status.install.models?.[kind]) return 'skip';
  if (status.status === 'unavailable') return 'skip';
  if (status.status === 'ready' && status.modelKind === kind) return 'speak';
  return 'warmup';
}
