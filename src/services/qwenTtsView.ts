/**
 * Что показывает раздел Qwen3-TTS в настройках голоса (TASK-104, decision-64): строка статуса,
 * ход установки, объёмы загрузки, готовность рецепта голоса к сохранению.
 *
 * Объёмы повторяют `electron/workers/qwen/manifest.json` (рендерер не импортирует main-процесс);
 * совпадение проверяет unit-тест.
 *
 * Чистый модуль без React и `window` — покрыт unit-тестами.
 */
import type { QwenModelKind } from '../types/electron';

/** PyTorch с CUDA и зависимости сайдкара. */
export const QWEN_RUNTIME_BYTES = 5_500_000_000;
/** Веса одной модели 1.7B вместе с кодеком; моделей три: пресеты, создание голоса, озвучка эталоном. */
export const QWEN_MODEL_BYTES = 4_520_000_000;

export const MAX_QWEN_SEED = 2_147_483_647;
export const MIN_DESIGN_INSTRUCT_CHARS = 10;
export const MAX_QWEN_INSTRUCT_CHARS = 400;
export const MAX_QWEN_LABEL_CHARS = 60;

export interface QwenInstallLike {
  runtimeReady?: boolean;
  models?: Partial<Record<QwenModelKind, boolean>>;
}

export interface QwenStatusLike {
  status?: string;
  modelKind?: string | null;
  loadTimeMs?: number;
  vramMb?: number;
  error?: string;
  errorCode?: string;
  install?: QwenInstallLike;
}

export type QwenStatusView =
  | { kind: 'not-installed' }
  | { kind: 'ready'; modelKind: QwenModelKind; loadTimeSec: number | null; vramGb: number | null }
  | { kind: 'starting' }
  | { kind: 'loading' }
  | { kind: 'idle' }
  | { kind: 'error'; errorCode?: string; error?: string }
  | { kind: 'unavailable'; errorCode?: string; error?: string };

export function describeQwenStatus(status: QwenStatusLike | null | undefined): QwenStatusView {
  if (!status) return { kind: 'idle' };
  const models = status.install?.models;
  // Говорить можно пресетом или сохранённым голосом; одной модели создания голосов недостаточно
  if (!status.install?.runtimeReady || !(models?.custom || models?.base)) return { kind: 'not-installed' };
  if (status.status === 'unavailable') {
    return { kind: 'unavailable', errorCode: status.errorCode, error: status.error };
  }
  if (
    status.status === 'ready' &&
    (status.modelKind === 'custom' || status.modelKind === 'design' || status.modelKind === 'base')
  ) {
    return {
      kind: 'ready',
      modelKind: status.modelKind,
      loadTimeSec: status.loadTimeMs ? Math.round(status.loadTimeMs / 100) / 10 : null,
      vramGb: status.vramMb ? Math.round(status.vramMb / 100) / 10 : null
    };
  }
  if (status.status === 'starting') return { kind: 'starting' };
  if (status.status === 'loading') return { kind: 'loading' };
  if (status.status === 'error' && (status.errorCode || status.error)) {
    return { kind: 'error', errorCode: status.errorCode, error: status.error };
  }
  return { kind: 'idle' };
}

/** Модели, которых ещё нет на диске, — их и предлагает скачать кнопка установки. */
export function missingQwenModels(install: QwenInstallLike | null | undefined): QwenModelKind[] {
  const kinds: QwenModelKind[] = ['custom', 'design', 'base'];
  return kinds.filter((kind) => !install?.models?.[kind]);
}

/** Сколько придётся скачать: окружение (если его нет) и недостающие модели. */
export function qwenDownloadBytes(install: QwenInstallLike | null | undefined, models: QwenModelKind[]): number {
  return (install?.runtimeReady ? 0 : QWEN_RUNTIME_BYTES) + models.length * QWEN_MODEL_BYTES;
}

export function formatGigabytes(bytes: number): string {
  const gb = bytes / 1e9;
  return gb >= 10 ? String(Math.round(gb)) : gb.toFixed(1);
}

export interface InstallProgressLike {
  state?: string;
  phase?: string | null;
  overallReceived?: number;
  overallTotal?: number;
}

/** Доля загрузки весов в процентах; на шагах без счётчика байт — `null` (показывается только шаг). */
export function installPercent(progress: InstallProgressLike | null | undefined): number | null {
  if (!progress || progress.phase !== 'models' || !progress.overallTotal) return null;
  return Math.max(0, Math.min(100, Math.floor(((progress.overallReceived ?? 0) / progress.overallTotal) * 100)));
}

export interface QwenDraft {
  label: string;
  instruct: string;
  seed: number;
}

export function normalizeQwenText(text: string, maxChars: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxChars).trim();
}

export function isValidQwenSeed(seed: number): boolean {
  return Number.isInteger(seed) && seed >= 0 && seed <= MAX_QWEN_SEED;
}

/** Рецепт можно отправить на пробу: описание достаточно длинное, зерно корректно. */
export function canProbeDraft(draft: QwenDraft): boolean {
  return (
    normalizeQwenText(draft.instruct, MAX_QWEN_INSTRUCT_CHARS).length >= MIN_DESIGN_INSTRUCT_CHARS &&
    isValidQwenSeed(draft.seed)
  );
}

/** Ключ прослушанного рецепта: сохранить можно только то, что прозвучало. */
export function draftProbeKey(draft: QwenDraft): string {
  return `${draft.seed}|${normalizeQwenText(draft.instruct, MAX_QWEN_INSTRUCT_CHARS)}`;
}

/**
 * Голос сохраняется только после удачной пробы именно этого описания и зерна: звук пробы
 * становится эталонной записью голоса, и без неё сохранять нечего.
 */
export function canSaveDraft(draft: QwenDraft, probedKey: string | null): boolean {
  return (
    canProbeDraft(draft) &&
    normalizeQwenText(draft.label, MAX_QWEN_LABEL_CHARS).length > 0 &&
    probedKey === draftProbeKey(draft)
  );
}

export function randomQwenSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 1_000_000);
}
