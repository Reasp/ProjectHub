/**
 * IPC локального синтеза речи (TASK-69, decision-25).
 *
 * Генерация идёт в отдельном процессе (Piper — `utilityProcess`, Qwen3-TTS — сайдкар Python; движок
 * выбирается по голосу, TASK-104), а воспроизведение — в рендерере: только там есть
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
  listVoices,
  stageVoiceImport,
  TtsVoiceStoreError
} from '../services/ttsVoiceStore';
import { PiperVoiceConfigError } from '../services/piperVoiceConfig';
import { probeVoiceInSeparateProcess } from '../services/ttsVoiceProbe';
import { qwenTtsService, type QwenSpeakRequest } from '../services/qwenTtsService';
import { qwenTtsInstaller } from '../services/qwenTtsInstaller';
import {
  deleteDesignRecipe,
  getQwenInstallStatus,
  listQwenVoices,
  QwenTtsStoreError,
  recipeToListItem,
  saveDesignRecipe
} from '../services/qwenTtsStore';
import { QWEN_MODEL_KINDS, resolveVoiceEngine, type QwenModelKind } from '../services/qwenTtsRegistry';
import type { IpcContext } from './types';

/** Ошибки наружу уходят кодом, а не текстом: строки интерфейса живут в i18n рендерера. */
function toErrorPayload(err: unknown): { ok: false; error: string; errorCode?: string; detail?: string } {
  if (err instanceof TtsVoiceStoreError || err instanceof PiperVoiceConfigError || err instanceof QwenTtsStoreError) {
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
      // Файлы лежат во временном каталоге под id, не пересекающимся с установленными голосами
      // (TASK-93): неудачная проба не может задеть ни встроенный, ни ранее импортированный голос
      const staged = await stageVoiceImport(modelPath, configPath);
      // Чужая модель сначала проходит пробу в отдельном процессе (decision-34): на битом файле
      // sherpa аварийно завершает процесс, и в воркере main-процесса это уронило бы всё приложение.
      const probe = await probeVoiceInSeparateProcess(staged.voice);
      if (!probe.ok) {
        await staged.discard();
        return { ok: false, error: probe.detail, errorCode: probe.errorCode };
      }
      const installed = await staged.commit().finally(() => staged.discard());
      // Модель доказала, что загружается, — теперь её можно отдать общему процессу синтеза.
      // id только что создан этим импортом, поэтому откат удаляет только его файлы
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

  ipcMain.handle('tts:warmup', async (_event, voiceId: string, opts?: { auto?: boolean }) => {
    // Голос знает свой движок (TASK-104): прогревается тот процесс, которым он звучит
    if (resolveVoiceEngine(voiceId) === 'qwen') {
      // Недоступность после серии падений снимает только человек (выбор голоса в настройках).
      // Прогрев по реплике или при старте (`auto`, TASK-119) её не трогает: иначе сайдкар, падающий
      // на загрузке, перезапускался бы каждой репликой
      if (!opts?.auto) qwenTtsService.resetAvailability();
      const state = await qwenTtsService.warmup(voiceId);
      return { ...state, voiceId, workerActive: state.processActive, available: state.status !== 'unavailable' };
    }
    const state = await piperTtsService.loadVoice(voiceId);
    return { ...state, available: piperTtsService.isAvailable };
  });

  ipcMain.handle(
    'tts:speak',
    async (
      _event,
      req: { jobId: string; text: string; voiceId: string; speed?: number; speakerId?: number } & Partial<QwenSpeakRequest>
    ) => {
      if (!req?.jobId || !req?.text || !req?.voiceId) {
        return { ok: false, error: 'invalid_request', errorCode: 'invalid_request' };
      }
      const handlers = {
        onChunk: (chunk: unknown) => send('tts:chunk', chunk),
        onDone: (info: unknown) => send('tts:done', info),
        onError: (info: unknown) => send('tts:error', info)
      };
      // Не ждём окончания синтеза: чанки идут событиями, ответ возвращается сразу
      if (resolveVoiceEngine(req.voiceId) === 'qwen') {
        void qwenTtsService.speak(
          {
            jobId: req.jobId,
            text: req.text,
            voiceId: req.voiceId,
            language: req.language,
            instruct: req.instruct,
            draft: req.draft
          },
          handlers
        );
      } else {
        void piperTtsService.speak(req, handlers);
      }
      return { ok: true };
    }
  );

  // jobId уникален в пределах приложения, поэтому отмена адресуется обоим движкам
  ipcMain.handle('tts:cancel', async (_event, jobId: string) => {
    const piper = piperTtsService.cancel(jobId);
    const qwen = qwenTtsService.cancel(jobId);
    return piper || qwen;
  });

  ipcMain.handle('tts:cancelAll', async () => {
    piperTtsService.cancelAll();
    qwenTtsService.cancelAll();
    return true;
  });

  // ── Второй движок: Qwen3-TTS в сайдкаре Python (TASK-104, decision-64) ──

  ipcMain.handle('tts:qwen:getStatus', async () => ({
    ...qwenTtsService.getState(),
    install: await getQwenInstallStatus(),
    installProgress: qwenTtsInstaller.getProgress()
  }));

  ipcMain.handle('tts:qwen:listVoices', async () => {
    try {
      return await listQwenVoices();
    } catch (err) {
      console.warn('[TTS] listQwenVoices failed:', err);
      return [];
    }
  });

  ipcMain.handle('tts:qwen:install', async (_event, req: { models?: string[]; hfEndpoint?: string }) => {
    const models = (Array.isArray(req?.models) ? req.models : []).filter((kind): kind is QwenModelKind =>
      (QWEN_MODEL_KINDS as readonly string[]).includes(kind)
    );
    if (models.length === 0) return { ok: false, error: 'invalid_request', errorCode: 'invalid_request' };
    // Сайдкар держит файлы окружения открытыми — на время установки он останавливается
    await qwenTtsService.unload();
    const result = await qwenTtsInstaller.start(
      { models, hfEndpoint: typeof req?.hfEndpoint === 'string' ? req.hfEndpoint : '' },
      (progress) => send('tts:qwen:installProgress', progress)
    );
    if (result.state !== 'done') {
      return { ok: false, error: result.error || result.errorCode || 'qwen_install_failed', errorCode: result.errorCode };
    }
    qwenTtsService.resetAvailability();
    return { ok: true };
  });

  ipcMain.handle('tts:qwen:cancelInstall', async () => qwenTtsInstaller.cancel());

  ipcMain.handle('tts:qwen:unload', async () => qwenTtsService.unload());

  // Пока Qwen выбран движком реплик, модель не выгружается по простою (TASK-119, decision-66)
  ipcMain.handle('tts:qwen:setKeepLoaded', async (_event, keep: unknown) => qwenTtsService.setKeepLoaded(keep === true));

  ipcMain.handle('tts:qwen:saveVoice', async (_event, input: { label?: unknown; instruct?: unknown; seed?: unknown }) => {
    try {
      // Эталоном голоса становится звук прослушанной пробы: сохраняется то, что прозвучало
      const reference = qwenTtsService.getDraftAudio(input?.instruct, input?.seed);
      const recipe = await saveDesignRecipe(input ?? {}, reference);
      const install = await getQwenInstallStatus();
      return { ok: true, voice: recipeToListItem(recipe, install.runtimeReady && install.models.base) };
    } catch (err) {
      return toErrorPayload(err);
    }
  });

  ipcMain.handle('tts:qwen:deleteVoice', async (_event, voiceId: string) => {
    try {
      return { ok: await deleteDesignRecipe(voiceId) };
    } catch (err) {
      return toErrorPayload(err);
    }
  });
}
