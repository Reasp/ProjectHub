import { ipcMain } from 'electron';
import { localWhisperService } from '../services/localWhisperService';
import type { IpcContext } from './types';

export function registerVoiceIpc(ctx: IpcContext) {
  // Voice Overlay Sync & Action
  ipcMain.on('voice:overlay-sync', (_event, state) => {
    const shouldBeVisible = Boolean(state?.isListening || state?.isPaused);
    let voiceOverlayWin = ctx.getVoiceOverlayWindow();

    if (shouldBeVisible) {
      if (!voiceOverlayWin || voiceOverlayWin.isDestroyed()) {
        voiceOverlayWin = ctx.createVoiceOverlayWindow();
      }
    }

    if (voiceOverlayWin && !voiceOverlayWin.isDestroyed()) {
      if (shouldBeVisible) {
        if (!voiceOverlayWin.isVisible()) {
          voiceOverlayWin.showInactive();
        }
      } else {
        if (voiceOverlayWin.isVisible()) {
          voiceOverlayWin.hide();
        }
      }

      if (!voiceOverlayWin.webContents.isLoading()) {
        voiceOverlayWin.webContents.send('voice:overlay-update', state);
      } else {
        voiceOverlayWin.webContents.once('did-finish-load', () => {
          voiceOverlayWin?.webContents.send('voice:overlay-update', state);
        });
      }
    }
  });

  ipcMain.on('voice:overlay-action', (_event, action) => {
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('voice:external-control', action);
    }
  });

  // Local Whisper STT Engine
  ipcMain.handle('voice:transcribeLocal', async (_event, { audioData, language }) => {
    return await localWhisperService.transcribe(audioData, language);
  });

  ipcMain.handle('voice:getLocalWhisperStatus', async () => {
    return localWhisperService.getState();
  });

  ipcMain.handle('voice:warmupLocalWhisper', async () => {
    localWhisperService.initBackground();
    return localWhisperService.getState();
  });
}
