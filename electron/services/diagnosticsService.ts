import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import { getUserDataDir } from './appPaths.js';
import { DEFAULT_LOG_FILE, rotatedFileName, DEFAULT_MAX_FILES, logger } from './logger.js';
import { ZipWriter } from './zipWriter.js';

/**
 * Экран «Диагностика» (TASK-58, decision-14 п.4): версия и пути приложения, сбор архива
 * `main.log` + ротации + crash-дампов в один .zip без утечки секретов. Никакая часть архива
 * не отправляется автоматически — только вручную через диалог сохранения файла (decision-7).
 */

export interface DiagnosticsInfo {
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  userDataDir: string;
  logsDir: string;
  crashDumpsDir: string;
  logLevel: string;
}

function safeApp(): typeof app | null {
  return app && typeof app === 'object' ? app : null;
}

export function getDiagnosticsInfo(): DiagnosticsInfo {
  const a = safeApp();
  const userDataDir = getUserDataDir();
  return {
    appVersion: a?.getVersion?.() ?? 'dev',
    electronVersion: process.versions.electron ?? 'n/a',
    chromeVersion: process.versions.chrome ?? 'n/a',
    nodeVersion: process.versions.node ?? 'n/a',
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    isPackaged: Boolean(a?.isPackaged),
    userDataDir,
    logsDir: path.join(userDataDir, 'logs'),
    crashDumpsDir: a?.getPath ? a.getPath('crashDumps') : path.join(userDataDir, 'Crashpad'),
    logLevel: logger.level
  };
}

/** Файлы логов: основной + ротированные (`main.log`, `main.1.log`, …), только существующие. */
async function collectLogFiles(logsDir: string): Promise<Array<{ name: string; path: string }>> {
  const candidates = [DEFAULT_LOG_FILE, ...Array.from({ length: DEFAULT_MAX_FILES }, (_, i) => rotatedFileName(DEFAULT_LOG_FILE, i + 1))];
  const found: Array<{ name: string; path: string }> = [];
  for (const name of candidates) {
    const p = path.join(logsDir, name);
    if (existsSync(p)) found.push({ name: `logs/${name}`, path: p });
  }
  return found;
}

/** Дампы падений Electron `crashReporter` (только имена файлов, без обхода вложенных отчётов Crashpad). */
async function collectCrashDumps(crashDumpsDir: string): Promise<Array<{ name: string; path: string }>> {
  if (!existsSync(crashDumpsDir)) return [];
  const found: Array<{ name: string; path: string }> = [];
  try {
    const entries = await fs.readdir(crashDumpsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && /\.(dmp|txt|json)$/i.test(entry.name)) {
        found.push({ name: `crashDumps/${entry.name}`, path: path.join(crashDumpsDir, entry.name) });
      }
    }
  } catch {
    // Каталог недоступен/пуст — архив просто не будет содержать дампов.
  }
  return found;
}

/** Собирает архив логов + crash-дампов + info.json (без секретов) и пишет его в `destZipPath`. */
export async function collectDiagnosticsArchive(destZipPath: string): Promise<void> {
  const info = getDiagnosticsInfo();
  const zip = new ZipWriter();
  zip.addFile('info.json', Buffer.from(JSON.stringify(info, null, 2), 'utf8'));

  for (const file of await collectLogFiles(info.logsDir)) {
    try {
      zip.addFile(file.name, await fs.readFile(file.path));
    } catch {
      // Файл лог-ротации мог исчезнуть между листингом и чтением — пропускаем, не прерывая архив.
    }
  }

  for (const dump of await collectCrashDumps(info.crashDumpsDir)) {
    try {
      zip.addFile(dump.name, await fs.readFile(dump.path));
    } catch {
      // Аналогично: пропускаем недоступный файл дампа.
    }
  }

  await fs.mkdir(path.dirname(destZipPath), { recursive: true });
  await fs.writeFile(destZipPath, zip.toBuffer());
}
