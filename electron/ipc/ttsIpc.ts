/**
 * IPC локального синтеза речи (TASK-69, decision-25).
 *
 * Генерация идёт в воркере main-процесса, а воспроизведение — в рендерере: только там есть
 * `AudioContext` с `setSinkId`, то есть выбор устройства вывода, которого системный
 * `speechSynthesis` не умеет. Поэтому PCM-чанки уходят в рендерер событиями по мере готовности.
 */
import { dialog, ipcMain } from 'electron';
import { piperTtsService } from '../services/piperTtsService';
import {
  cancelDownload,
  deleteVoice,
  downloadBuiltinVoice,
  hasEspeakData,
  importVoiceFromFiles,
  listVoices,
  TtsVoiceStoreError
} from '../services/ttsVoiceStore';
import { PiperVoiceConfigError } from '../services/piperVoiceConfig';
import { probeVoiceInSeparateProcess } from '../services/ttsVoiceProbe';
import type { IpcContext } from './types';

/** Ошибки наружу уходят кодом, а не текстом: строки интерфейса живут в i18n рендерера. */
function toErrorPayload(err: unknown): { ok: false; error: string; errorCode?: string; detail?: string } {
  if (err instanceof TtsVoiceStoreError || err instanceof PiperVoiceConfigError) {
    return { ok: false, error: err.message, errorCode: err.code, detail: err.detail };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: message };
}

export function registerTtsIpc(ctx: IpcContext) {
  const send = (channel: string, payload: unknown) => {
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  ipcMain.handle('tts:getStatus', async () => ({
    ...piperTtsService.getState(),
    available: piperTtsService.isAvailable,
    espeakDataInstalled: await hasEspeakData()
  }));

  ipcMain.handle('tts:listVoices', async () => {
    try {
      return await listVoices();
    } catch (err) {
      console.warn('[TTS] listVoices failed:', err);
      return [];
    }
  });

  ipcMain.handle('tts:downloadVoice', async (_event, voiceId: string) => {
    try {
      const installed = await downloadBuiltinVoice(voiceId, (progress) => send('tts:downloadProgress', progress));
      return { ok: true, voice: installed };
    } catch (err) {
      console.warn(`[TTS] Download of ${voiceId} failed:`, err);
      send('tts:downloadProgress', { voiceId, phase: 'done', receivedBytes: 0, totalBytes: 0 });
      return toErrorPayload(err);
    }
  });

  ipcMain.handle('tts:cancelDownload', async (_event, voiceId: string) => cancelDownload(voiceId));

  ipcMain.handle('tts:deleteVoice', async (_event, voiceId: string) => {
    try {
      const removed = await deleteVoice(voiceId);
      return { ok: removed };
    } catch (err) {
      return toErrorPayload(err);
    }
  });

  /**
   * Импорт пользовательского голоса: пользователь выбирает `.onnx`, парный `.onnx.json`
   * подбирается рядом автоматически, а если его нет — запрашивается вторым диалогом.
   */
  ipcMain.handle('tts:importVoice', async () => {
    const win = ctx.getMainWindow();
    if (!win || win.isDestroyed()) return { ok: false, error: 'no_window', errorCode: 'no_window' };

    const modelPick = await dialog.showOpenDialog(win, {
      title: 'Piper voice model (.onnx)',
      properties: ['openFile'],
      filters: [{ name: 'Piper voice', extensions: ['onnx'] }]
    });
    if (modelPick.canceled || modelPick.filePaths.length === 0) return { ok: false, canceled: true };
    const modelPath = modelPick.filePaths[0];

    let configPath = `${modelPath}.json`;
    const { existsSync } = await import('node:fs');
    if (!existsSync(configPath)) {
      const configPick = await dialog.showOpenDialog(win, {
        title: 'Piper voice config (.onnx.json)',
        properties: ['openFile'],
        filters: [{ name: 'Piper config', extensions: ['json'] }]
      });
      if (configPick.canceled || configPick.filePaths.length === 0) return { ok: false, canceled: true };
      configPath = configPick.filePaths[0];
    }

    try {
      const installed = await importVoiceFromFiles(modelPath, configPath);
      // Чужая модель сначала проходит пробу в отдельном процессе (decision-34): на битом файле
      // sherpa аварийно завершает процесс, и в воркере main-процесса это уронило бы всё приложение.
      const probe = await probeVoiceInSeparateProcess(installed);
      if (!probe.ok) {
        await deleteVoice(installed.id).catch(() => {});
        return { ok: false, error: probe.detail, errorCode: probe.errorCode };
      }
      // Модель доказала, что загружается, — теперь её можно отдать общему воркеру синтеза
      const state = await piperTtsService.loadVoice(installed.id);
      if (state.status !== 'ready') {
        await deleteVoice(installed.id).catch(() => {});
        return { ok: false, error: state.error || 'load_failed', errorCode: state.errorCode || 'load_failed' };
      }
      return { ok: true, voice: installed };
    } catch (err) {
      console.warn('[TTS] Voice import failed:', err);
      return toErrorPayload(err);
    }
  });

  ipcMain.handle('tts:warmup', async (_event, voiceId: string) => {
    const state = await piperTtsService.loadVoice(voiceId);
    return { ...state, available: piperTtsService.isAvailable };
  });

  ipcMain.handle(
    'tts:speak',
    async (_event, req: { jobId: string; text: string; voiceId: string; speed?: number; speakerId?: number }) => {
      if (!req?.jobId || !req?.text || !req?.voiceId) {
        return { ok: false, error: 'invalid_request', errorCode: 'invalid_request' };
      }
      // Не ждём окончания синтеза: чанки идут событиями, ответ возвращается сразу
      void piperTtsService.speak(req, {
        onChunk: (chunk) => send('tts:chunk', chunk),
        onDone: (info) => send('tts:done', info),
        onError: (info) => send('tts:error', info)
      });
      return { ok: true };
    }
  );

  ipcMain.handle('tts:cancel', async (_event, jobId: string) => piperTtsService.cancel(jobId));

  ipcMain.handle('tts:cancelAll', async () => {
    piperTtsService.cancelAll();
    return true;
  });
}
