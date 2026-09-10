import type { BrowserWindow } from 'electron';

export interface IpcContext {
  getMainWindow: () => BrowserWindow | null;
  getVoiceOverlayWindow: () => BrowserWindow | null;
  createVoiceOverlayWindow: () => BrowserWindow;
}
