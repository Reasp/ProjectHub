import { app, BrowserWindow } from 'electron';
import https from 'node:https';
// electron-updater — CommonJS-пакет; его именованный экспорт не синтезируется корректно под Node
// ESM-загрузчиком main-процесса ("SyntaxError: Named export 'autoUpdater' not found"), поэтому
// берём default-экспорт и деструктурируем вручную (обнаружено запуском `npm run dev` вживую).
import electronUpdaterPkg from 'electron-updater';
import { logger } from './logger.js';
import { isNewerVersion } from './versionCompare.js';

const { autoUpdater } = electronUpdaterPkg;

export { isNewerVersion };

/**
 * Проверка обновлений (TASK-58, decision-14 п.2): `electron-updater` + GitHub Releases для
 * Windows/Linux (авто-скачивание и установка при выходе), для macOS без подписи — только сверка
 * версии через GitHub API и ссылка на страницу релиза (Squirrel.Mac требует codesign, которого
 * пока нет). Проверка запускается один раз при старте (с задержкой) и по кнопке из «Диагностики».
 */

const GITHUB_OWNER = 'Reasp';
const GITHUB_REPO = 'ProjectHub';

export type UpdaterState = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

export interface UpdaterStatus {
  state: UpdaterState;
  currentVersion: string;
  latestVersion?: string;
  percent?: number;
  releaseUrl?: string;
  error?: string;
  /** false на macOS без подписи: там доступна только ссылка на релиз, не авто-установка. */
  supportsAutoInstall: boolean;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
}

class UpdaterService {
  private configured = false;
  private status: UpdaterStatus = {
    state: 'idle',
    currentVersion: app.isPackaged ? app.getVersion() : '0.0.0-dev',
    supportsAutoInstall: process.platform !== 'darwin'
  };

  getStatus(): UpdaterStatus {
    return this.status;
  }

  private setStatus(patch: Partial<UpdaterStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('updater:statusChanged', this.status);
    }
  }

  private configure(): void {
    if (this.configured) return;
    this.configured = true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => this.setStatus({ state: 'checking', error: undefined }));
    autoUpdater.on('update-available', (info) => {
      this.setStatus({ state: 'available', latestVersion: info.version });
      autoUpdater.downloadUpdate().catch((err) => {
        this.setStatus({ state: 'error', error: err?.message || String(err) });
      });
    });
    autoUpdater.on('update-not-available', () => this.setStatus({ state: 'not-available' }));
    autoUpdater.on('download-progress', (p) => this.setStatus({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => this.setStatus({ state: 'downloaded', latestVersion: info.version }));
    autoUpdater.on('error', (err) => {
      logger.warn(`[Updater] ${err?.message || err}`);
      this.setStatus({ state: 'error', error: err?.message || String(err) });
    });
  }

  public async checkForUpdates(): Promise<void> {
    if (!app.isPackaged) {
      logger.info('[Updater] Пропущено: dev-сборка не упакована');
      this.setStatus({ state: 'not-available' });
      return;
    }

    if (process.platform === 'darwin') {
      await this.checkGithubReleaseManually();
      return;
    }

    this.configure();
    try {
      this.setStatus({ state: 'checking', error: undefined });
      await autoUpdater.checkForUpdates();
    } catch (err: any) {
      this.setStatus({ state: 'error', error: err?.message || String(err) });
    }
  }

  private async checkGithubReleaseManually(): Promise<void> {
    this.setStatus({ state: 'checking', error: undefined });
    try {
      const release = await this.fetchLatestRelease();
      const latest = release.tag_name?.replace(/^v/, '');
      if (latest && isNewerVersion(latest, this.status.currentVersion)) {
        this.setStatus({ state: 'available', latestVersion: latest, releaseUrl: release.html_url });
      } else {
        this.setStatus({ state: 'not-available' });
      }
    } catch (err: any) {
      this.setStatus({ state: 'error', error: err?.message || String(err) });
    }
  }

  private fetchLatestRelease(): Promise<GithubRelease> {
    return new Promise((resolve, reject) => {
      const req = https.get(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        { headers: { 'User-Agent': 'ProjectHub-Updater' } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`GitHub API вернул статус ${res.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e as Error);
            }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Таймаут запроса к GitHub API')));
    });
  }

  /** Установка скачанного обновления при выходе (Windows/Linux) — доступно только после `downloaded`. */
  public installNow(): void {
    if (this.status.state !== 'downloaded') return;
    autoUpdater.quitAndInstall();
  }
}

export const updaterService = new UpdaterService();
