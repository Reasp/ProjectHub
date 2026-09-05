import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized: boolean;
}

const DEFAULT_STATE: WindowState = {
  width: 1400,
  height: 900,
  isMaximized: false
};

class WindowStateService {
  private configPath: string;
  private state: WindowState = { ...DEFAULT_STATE };
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor() {
    const homeDir = os.homedir();
    const hubDir = path.join(homeDir, '.projecthub');
    this.configPath = path.join(hubDir, 'window-state.json');
    this.loadState();
  }

  private loadState(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
          this.state = {
            width: Math.max(1024, parsed.width),
            height: Math.max(700, parsed.height),
            x: typeof parsed.x === 'number' ? parsed.x : undefined,
            y: typeof parsed.y === 'number' ? parsed.y : undefined,
            isMaximized: Boolean(parsed.isMaximized)
          };
        }
      }
    } catch (e) {
      console.warn('[WindowStateService] Failed to load window state:', e);
      this.state = { ...DEFAULT_STATE };
    }
  }

  public getInitialState(): WindowState {
    // Validate if the stored position is visible on any active display
    if (this.state.x !== undefined && this.state.y !== undefined) {
      const displays = screen.getAllDisplays();
      const isVisible = displays.some((d) => {
        const b = d.bounds;
        return (
          this.state.x! >= b.x &&
          this.state.x! < b.x + b.width &&
          this.state.y! >= b.y &&
          this.state.y! < b.y + b.height
        );
      });

      if (!isVisible) {
        // Position was on a disconnected display: reset coordinates so Electron centers the window
        return {
          width: this.state.width,
          height: this.state.height,
          isMaximized: this.state.isMaximized
        };
      }
    }

    return { ...this.state };
  }

  public saveStateSync(win: BrowserWindow): void {
    if (win.isDestroyed()) return;

    try {
      const isMaximized = win.isMaximized();
      if (isMaximized) {
        this.state.isMaximized = true;
      } else {
        const bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
        this.state = {
          width: bounds.width,
          height: bounds.height,
          x: bounds.x,
          y: bounds.y,
          isMaximized: false
        };
      }

      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (e) {
      console.error('[WindowStateService] Failed to save window state:', e);
    }
  }

  public trackWindow(win: BrowserWindow): void {
    const queueSave = () => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.saveStateSync(win);
      }, 300);
    };

    win.on('resize', queueSave);
    win.on('move', queueSave);
    win.on('maximize', () => {
      this.state.isMaximized = true;
      queueSave();
    });
    win.on('unmaximize', () => {
      this.state.isMaximized = false;
      queueSave();
    });
    win.on('close', () => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.saveStateSync(win);
    });
  }
}

export const windowStateService = new WindowStateService();
