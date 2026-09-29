/**
 * Ход установки сайдкара Qwen3-TTS: события скрипта `setup.mjs` сворачиваются в состояние, которое
 * показывают настройки (TASK-104, decision-64).
 *
 * Чистый модуль: без процессов и Electron — покрыт unit-тестами.
 */
import { toQwenErrorCode, type QwenTtsErrorCode } from './ttsErrorCodes';

/** Шаги установки в порядке выполнения — рендерер переводит их названия. */
export const QWEN_INSTALL_PHASES = ['check', 'python', 'venv', 'torch', 'packages', 'verify', 'runtime', 'models'] as const;

export type QwenInstallPhase = (typeof QWEN_INSTALL_PHASES)[number];

export type QwenInstallEvent =
  | { type: 'phase'; phase: string; detail?: string }
  | { type: 'log'; line: string }
  | {
      type: 'progress';
      file: string;
      receivedBytes: number;
      totalBytes: number;
      overallReceived: number;
      overallTotal: number;
    }
  | { type: 'done' }
  | { type: 'error'; code: string; error: string };

export interface QwenInstallProgress {
  state: 'idle' | 'running' | 'done' | 'error';
  phase: QwenInstallPhase | null;
  /** Последняя строка вывода pip или загрузчика — признак того, что установка жива. */
  lastLine: string;
  file: string;
  receivedBytes: number;
  totalBytes: number;
  overallReceived: number;
  overallTotal: number;
  errorCode?: QwenTtsErrorCode;
  error?: string;
}

export const IDLE_INSTALL_PROGRESS: QwenInstallProgress = {
  state: 'idle',
  phase: null,
  lastLine: '',
  file: '',
  receivedBytes: 0,
  totalBytes: 0,
  overallReceived: 0,
  overallTotal: 0
};

export function parseInstallEvent(line: string): QwenInstallEvent | null {
  const text = line.trim();
  if (!text.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed.type !== 'string') return null;
    if (parsed.type === 'phase' && typeof parsed.phase === 'string') return parsed as QwenInstallEvent;
    if (parsed.type === 'log' && typeof parsed.line === 'string') return parsed as QwenInstallEvent;
    if (parsed.type === 'progress' && typeof parsed.receivedBytes === 'number') return parsed as QwenInstallEvent;
    if (parsed.type === 'done') return { type: 'done' };
    if (parsed.type === 'error') {
      return { type: 'error', code: String(parsed.code ?? ''), error: String(parsed.error ?? '') };
    }
    return null;
  } catch {
    return null;
  }
}

const isPhase = (value: string): value is QwenInstallPhase => (QWEN_INSTALL_PHASES as readonly string[]).includes(value);

export function reduceInstallEvent(state: QwenInstallProgress, event: QwenInstallEvent): QwenInstallProgress {
  switch (event.type) {
    case 'phase':
      return { ...state, state: 'running', phase: isPhase(event.phase) ? event.phase : state.phase, lastLine: '' };
    case 'log':
      return { ...state, state: 'running', lastLine: event.line.slice(0, 200) };
    case 'progress':
      return {
        ...state,
        state: 'running',
        phase: 'models',
        file: event.file,
        receivedBytes: event.receivedBytes,
        totalBytes: event.totalBytes,
        overallReceived: event.overallReceived,
        overallTotal: event.overallTotal
      };
    case 'done':
      return { ...state, state: 'done', lastLine: '', errorCode: undefined, error: undefined };
    case 'error':
      return {
        ...state,
        state: 'error',
        errorCode: toQwenErrorCode(event.code, 'qwen_install_failed'),
        error: event.error.slice(0, 300)
      };
  }
}

/**
 * Итог по коду выхода, если скрипт завершился, не сообщив ни `done`, ни `error` (снят системой,
 * упал на синтаксической ошибке).
 */
export function finalizeInstall(state: QwenInstallProgress, exitCode: number | null): QwenInstallProgress {
  if (state.state === 'done' || state.state === 'error') return state;
  if (exitCode === 0) return { ...state, state: 'done' };
  return {
    ...state,
    state: 'error',
    errorCode: 'qwen_install_failed',
    error: `setup exited with code ${exitCode ?? 'unknown'}`
  };
}
