/**
 * Нативный источник состояния клавиши для push-to-talk (TASK-112, [[decision-63]]).
 *
 * `globalShortcut` не различает левый и правый модификатор и не сообщает об отпускании, поэтому
 * клавиши-модификаторы слушает `uiohook-napi` — низкоуровневый хук клавиатуры (N-API, пребилды в
 * пакете, пересборка под Electron не нужна).
 *
 * Хук видит все нажатия в системе, поэтому правила жёсткие: он запущен, только пока push-to-talk
 * включён и назначен на клавишу-модификатор; наружу уходят только код клавиши и флаги
 * модификаторов; в лог события не пишутся вовсе.
 *
 * Модуль грузится лениво: его отсутствие или отказ ОС — штатный исход с кодом причины, а не
 * падение приложения.
 */
import { systemPreferences } from 'electron';
import { logger } from './logger.js';
import type { KeyHookEvent } from './pushToTalkPolicy.js';

/** `module` — модуль не загрузился; `permission` — нет разрешения ОС; `start` — ОС отказала в хуке. */
export type KeyHookProblem = 'module' | 'permission' | 'start';

export type KeyHookStartResult = { ok: true } | { ok: false; problem: KeyHookProblem; detail: string };

export interface KeyHookListener {
  onKeyDown: (event: KeyHookEvent) => void;
  onKeyUp: (event: KeyHookEvent) => void;
}

type HookEmitter = typeof import('uiohook-napi').uIOhook;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorCode(err: unknown): string {
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : '';
}

class NativeKeyHook {
  private hook: HookEmitter | null = null;
  private running = false;
  private listener: KeyHookListener | null = null;

  private readonly handleKeyDown = (event: KeyHookEvent) => this.listener?.onKeyDown(event);
  private readonly handleKeyUp = (event: KeyHookEvent) => this.listener?.onKeyUp(event);

  /** Есть ли разрешение ОС слушать клавиатуру. Нужно только macOS («Универсальный доступ»). */
  public hasPermission(): boolean {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.isTrustedAccessibilityClient(false);
  }

  /** Показывает системный запрос разрешения macOS; на остальных платформах ничего не делает. */
  public requestPermission(): boolean {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.isTrustedAccessibilityClient(true);
  }

  public async start(listener: KeyHookListener): Promise<KeyHookStartResult> {
    this.stop();

    if (!this.hasPermission()) {
      return { ok: false, problem: 'permission', detail: 'нет разрешения «Универсальный доступ»' };
    }

    if (!this.hook) {
      try {
        const mod = await import('uiohook-napi');
        this.hook = mod.uIOhook ?? (mod as { default?: { uIOhook?: HookEmitter } }).default?.uIOhook ?? null;
        if (!this.hook) throw new Error('модуль не экспортирует uIOhook');
      } catch (err) {
        return { ok: false, problem: 'module', detail: errorText(err) };
      }
    }

    this.listener = listener;
    this.hook.on('keydown', this.handleKeyDown);
    this.hook.on('keyup', this.handleKeyUp);

    try {
      this.hook.start();
    } catch (err) {
      this.detach();
      const problem: KeyHookProblem = errorCode(err) === 'UIOHOOK_ERROR_AXAPI_DISABLED' ? 'permission' : 'start';
      return { ok: false, problem, detail: errorCode(err) || errorText(err) };
    }

    this.running = true;
    return { ok: true };
  }

  public stop(): void {
    if (!this.hook) return;
    this.detach();
    if (!this.running) return;
    this.running = false;
    try {
      this.hook.stop();
    } catch (err) {
      logger.warn(`[NativeKeyHook] Хук не остановился: ${errorCode(err) || errorText(err)}`);
    }
  }

  private detach(): void {
    this.hook?.off('keydown', this.handleKeyDown);
    this.hook?.off('keyup', this.handleKeyUp);
    this.listener = null;
  }
}

export const nativeKeyHook = new NativeKeyHook();
