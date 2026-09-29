/**
 * Запуск установки сайдкара Qwen3-TTS из приложения (TASK-104, decision-64).
 *
 * Сама установка — скрипт `electron/workers/qwen/setup.mjs`, тот же, что запускается из терминала
 * командой `npm run qwen-tts-setup`. Здесь он выполняется в `utilityProcess`: из архива приложения
 * его читает только Electron, а main-процесс не блокируется на время загрузки нескольких гигабайт.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import { getUserDataDir, getWorkerScriptCandidates } from './appPaths';
import { createLineSplitter } from './qwenSidecarProtocol';
import {
  finalizeInstall,
  IDLE_INSTALL_PROGRESS,
  parseInstallEvent,
  reduceInstallEvent,
  type QwenInstallProgress
} from './qwenInstallProgress';
import { normalizeEndpoint } from '../workers/qwen/setupCore.mjs';
import type { QwenModelKind } from './qwenTtsRegistry';

export interface QwenInstallRequest {
  models: QwenModelKind[];
  /** Адрес Hugging Face или зеркала; пусто — адрес по умолчанию. */
  hfEndpoint?: string;
}

class QwenTtsInstaller {
  private child: UtilityProcess | null = null;
  private progress: QwenInstallProgress = IDLE_INSTALL_PROGRESS;

  get isRunning(): boolean {
    return Boolean(this.child);
  }

  getProgress(): QwenInstallProgress {
    return this.progress;
  }

  start(request: QwenInstallRequest, onProgress: (progress: QwenInstallProgress) => void): Promise<QwenInstallProgress> {
    const update = (next: QwenInstallProgress) => {
      this.progress = next;
      onProgress(next);
    };
    const failed = (errorCode: QwenInstallProgress['errorCode'], error: string): Promise<QwenInstallProgress> => {
      update({ ...IDLE_INSTALL_PROGRESS, state: 'error', errorCode, error });
      return Promise.resolve(this.progress);
    };

    if (this.child) {
      // Идущую установку не трогаем: отказ получает только второй вызов
      return Promise.resolve({ ...IDLE_INSTALL_PROGRESS, state: 'error', errorCode: 'qwen_install_in_progress' });
    }

    const script = getWorkerScriptCandidates(path.join('qwen', 'setup.mjs')).find((p) => existsSync(p));
    if (!script) return failed('qwen_setup_missing', 'setup.mjs not found next to the app bundle');

    const args = ['--json', '--user-data', getUserDataDir(), '--models', request.models.join(',')];
    try {
      if (request.hfEndpoint?.trim()) args.push('--hf-endpoint', normalizeEndpoint(request.hfEndpoint));
    } catch (err) {
      return failed('qwen_download_failed', err instanceof Error ? err.message : String(err));
    }

    return new Promise<QwenInstallProgress>((resolve) => {
      let child: UtilityProcess;
      try {
        child = utilityProcess.fork(script, args, { serviceName: 'ProjectHub Qwen3-TTS setup', stdio: 'pipe' });
      } catch (err) {
        resolve(failed('qwen_install_failed', err instanceof Error ? err.message : String(err)));
        return;
      }
      this.child = child;
      update({ ...IDLE_INSTALL_PROGRESS, state: 'running', phase: 'check' });
      console.log(`[QwenTTS] Setup started (models: ${request.models.join(', ')})`);

      child.stdout?.on(
        'data',
        createLineSplitter((line) => {
          const event = parseInstallEvent(line);
          if (event) update(reduceInstallEvent(this.progress, event));
        })
      );
      child.stderr?.on(
        'data',
        createLineSplitter((line) => {
          if (line.trim()) console.warn(`[QwenTTS:setup] ${line.trim().slice(0, 400)}`);
        })
      );
      child.on('exit', (code) => {
        if (this.child === child) this.child = null;
        update(finalizeInstall(this.progress, code));
        console.log(`[QwenTTS] Setup finished: ${this.progress.state}${this.progress.errorCode ? ` (${this.progress.errorCode})` : ''}`);
        resolve(this.progress);
      });
    });
  }

  cancel(): boolean {
    const child = this.child;
    if (!child) return false;
    try {
      // Скрипт сам снимает дерево pip и завершается с кодом отмены
      child.postMessage({ type: 'cancel' });
    } catch {
      child.kill();
    }
    const timer = setTimeout(() => {
      if (this.child === child) child.kill();
    }, 5000);
    timer.unref?.();
    return true;
  }

  dispose() {
    const child = this.child;
    this.child = null;
    if (child) child.kill();
  }
}

export const qwenTtsInstaller = new QwenTtsInstaller();
