import { create } from 'zustand';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  inputType?: string;
}

export interface AlertOptions {
  title?: string;
  message: string;
  confirmText?: string;
}

export type ActiveDialog =
  | { type: 'confirm'; options: ConfirmOptions; resolve: (val: boolean) => void }
  | { type: 'prompt'; options: PromptOptions; resolve: (val: string | null) => void }
  | { type: 'alert'; options: AlertOptions; resolve: () => void }
  | null;

interface DialogStore {
  activeDialog: ActiveDialog;
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  prompt: (options: PromptOptions | string, defaultValue?: string) => Promise<string | null>;
  alert: (options: AlertOptions | string) => Promise<void>;
  close: () => void;
}

export const useDialogStore = create<DialogStore>((set, get) => ({
  activeDialog: null,

  confirm: (options) => {
    const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      set({
        activeDialog: {
          type: 'confirm',
          options: opts,
          resolve: (val) => {
            set({ activeDialog: null });
            resolve(val);
          }
        }
      });
    });
  },

  prompt: (options, defaultValue = '') => {
    const opts: PromptOptions =
      typeof options === 'string'
        ? { message: options, defaultValue }
        : { defaultValue, ...options };

    return new Promise<string | null>((resolve) => {
      set({
        activeDialog: {
          type: 'prompt',
          options: opts,
          resolve: (val) => {
            set({ activeDialog: null });
            resolve(val);
          }
        }
      });
    });
  },

  alert: (options) => {
    const opts: AlertOptions = typeof options === 'string' ? { message: options } : options;
    return new Promise<void>((resolve) => {
      set({
        activeDialog: {
          type: 'alert',
          options: opts,
          resolve: () => {
            set({ activeDialog: null });
            resolve();
          }
        }
      });
    });
  },

  close: () => {
    const current = get().activeDialog;
    if (!current) return;
    if (current.type === 'confirm') {
      current.resolve(false);
    } else if (current.type === 'prompt') {
      current.resolve(null);
    } else if (current.type === 'alert') {
      current.resolve();
    }
    set({ activeDialog: null });
  }
}));
