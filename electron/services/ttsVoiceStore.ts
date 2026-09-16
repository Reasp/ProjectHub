/**
 * Хранилище голосов локального TTS: загрузка, проверка, импорт и удаление (TASK-69, decision-25).
 *
 * Модели лежат в общем кэше приложения `<userData>/models/tts/<voiceId>` и в бандл не входят.
 * Встроенные голоса скачиваются архивами из релизов sherpa-onnx с проверкой sha256; общий
 * `espeak-ng-data` (18 МБ, одинаковый во всех архивах) хранится один раз рядом с голосами.
 *
 * Пользовательский голос — обычная пара Piper `.onnx` + `.onnx.json` с Hugging Face. Такой файл
 * sherpa не принимает: в нём нет ни `tokens.txt`, ни metadata внутри ONNX. И то и другое строится
 * здесь же, без Python и без protobuf-зависимости (см. `piperVoiceConfig`).
 */
import fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { ensureModelsCacheDir } from './appPaths';
import {
  BUILTIN_TTS_VOICES,
  getArchiveRootDir,
  getBuiltinVoice,
  getSharedEspeakDataDir,
  getTtsRootDir,
  getVoiceDir,
  getVoicePaths,
  isValidVoiceId,
  makeImportedVoiceId,
  VOICE_MANIFEST_FILE,
  type TtsVoiceLanguage,
  type TtsVoiceSource
} from './ttsVoiceRegistry';
import {
  buildPiperOnnxMetadata,
  buildTokensTxt,
  encodeOnnxMetadataProps,
  onnxHasPiperMetadata,
  parsePiperVoiceConfig,
  PiperVoiceConfigError
} from './piperVoiceConfig';

const execFileAsync = promisify(execFile);

/** Хвост ONNX, в котором ищем metadata: она пишется в конец файла. */
const METADATA_TAIL_BYTES = 64 * 1024;

export interface InstalledVoice {
  id: string;
  label: string;
  language: TtsVoiceLanguage;
  source: TtsVoiceSource;
  modelPath: string;
  tokensPath: string;
  dataDir: string;
  sampleRate: number;
  numSpeakers: number;
  noiseScale: number;
  noiseScaleW: number;
  lengthScale: number;
  installedAt: string;
  sizeBytes: number;
}

export interface TtsVoiceListItem {
  id: string;
  label: string;
  language: TtsVoiceLanguage;
  source: TtsVoiceSource;
  installed: boolean;
  downloading: boolean;
  /** Размер архива для ещё не скачанного голоса. */
  archiveBytes?: number;
  /** Размер установленного голоса на диске. */
  sizeBytes?: number;
  sampleRate?: number;
}

export interface DownloadProgress {
  voiceId: string;
  phase: 'download' | 'verify' | 'extract' | 'done';
  receivedBytes: number;
  totalBytes: number;
}

export type TtsVoiceStoreErrorCode =
  | 'invalid_voice_id'
  | 'unknown_voice'
  | 'download_failed'
  | 'checksum_mismatch'
  | 'extract_failed'
  | 'tar_unavailable'
  | 'model_not_found'
  | 'config_not_found'
  | 'espeak_data_missing'
  | 'already_installed';

export class TtsVoiceStoreError extends Error {
  readonly code: TtsVoiceStoreErrorCode;
  readonly detail?: string;
  constructor(code: TtsVoiceStoreErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'TtsVoiceStoreError';
    this.code = code;
    this.detail = detail;
  }
}

/** Активные загрузки: нужны и для отмены, и чтобы не запускать вторую загрузку того же голоса. */
const activeDownloads = new Map<string, AbortController>();

async function ttsRoot(): Promise<string> {
  const models = await ensureModelsCacheDir();
  const root = getTtsRootDir(models);
  await fs.mkdir(root, { recursive: true });
  return models;
}

async function readManifest(manifestPath: string): Promise<InstalledVoice | null> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as InstalledVoice;
    return parsed && typeof parsed.id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await dirSize(full);
      else {
        const stat = await fs.stat(full).catch(() => null);
        if (stat) total += stat.size;
      }
    }
  } catch {
    // каталога нет — размер 0
  }
  return total;
}

/** Установлен ли общий espeak-ng-data (без него не работает ни один голос). */
export async function hasEspeakData(): Promise<boolean> {
  const models = await ensureModelsCacheDir();
  const dir = getSharedEspeakDataDir(models);
  if (!existsSync(dir)) return false;
  const entries = await fs.readdir(dir).catch(() => []);
  return entries.length > 0;
}

/** Описание установленного голоса или `null`, если он ещё не скачан. */
export async function getInstalledVoice(voiceId: string): Promise<InstalledVoice | null> {
  if (!isValidVoiceId(voiceId)) return null;
  const models = await ensureModelsCacheDir();
  const paths = getVoicePaths(models, voiceId);
  const manifest = await readManifest(paths.manifestPath);
  if (!manifest) return null;
  if (!existsSync(manifest.modelPath) || !existsSync(manifest.tokensPath)) return null;
  return manifest;
}

/** Встроенные и импортированные голоса с признаком «установлен». */
export async function listVoices(): Promise<TtsVoiceListItem[]> {
  const models = await ensureModelsCacheDir();
  const root = getTtsRootDir(models);
  await fs.mkdir(root, { recursive: true });

  const items: TtsVoiceListItem[] = [];
  const seen = new Set<string>();

  for (const voice of BUILTIN_TTS_VOICES) {
    const installed = await getInstalledVoice(voice.id);
    seen.add(voice.id);
    items.push({
      id: voice.id,
      label: voice.label,
      language: voice.language,
      source: 'builtin',
      installed: Boolean(installed),
      downloading: activeDownloads.has(voice.id),
      archiveBytes: voice.archiveBytes,
      sizeBytes: installed?.sizeBytes,
      sampleRate: installed?.sampleRate
    });
  }

  // Импортированные голоса — всё, что лежит в каталоге, но не входит во встроенный реестр
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || seen.has(entry.name) || entry.name === 'espeak-ng-data') continue;
    const installed = await getInstalledVoice(entry.name);
    if (!installed) continue;
    items.push({
      id: installed.id,
      label: installed.label,
      language: installed.language,
      source: 'imported',
      installed: true,
      downloading: false,
      sizeBytes: installed.sizeBytes,
      sampleRate: installed.sampleRate
    });
  }

  return items;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead <= 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

/**
 * Распаковка `.tar.bz2` системным `tar`: он есть в Windows 10 1803+, macOS и Linux.
 * Отдельной зависимости-декомпрессора в приложение не добавляем — bzip2 в Node нет.
 */
async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  try {
    // Жёсткий таймаут: зависший tar не должен навсегда подвесить установку голоса
    await execFileAsync('tar', ['-xjf', archivePath, '-C', targetDir], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
      windowsHide: true
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOENT|not recognized|not found/i.test(message)) {
      throw new TtsVoiceStoreError('tar_unavailable', message);
    }
    throw new TtsVoiceStoreError('extract_failed', message);
  }
}

/** Отменяет активную загрузку голоса. */
export function cancelDownload(voiceId: string): boolean {
  const controller = activeDownloads.get(voiceId);
  if (!controller) return false;
  controller.abort();
  activeDownloads.delete(voiceId);
  return true;
}

/**
 * Скачивает встроенный голос, проверяет sha256 и распаковывает в кэш.
 * Общий `espeak-ng-data` переносится из первого скачанного архива и дальше переиспользуется.
 */
export async function downloadBuiltinVoice(
  voiceId: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<InstalledVoice> {
  if (!isValidVoiceId(voiceId)) throw new TtsVoiceStoreError('invalid_voice_id', voiceId);
  const definition = getBuiltinVoice(voiceId);
  if (!definition) throw new TtsVoiceStoreError('unknown_voice', voiceId);
  if (activeDownloads.has(voiceId)) throw new TtsVoiceStoreError('already_installed', 'download already in progress');

  const models = await ttsRoot();
  const voiceDir = getVoiceDir(models, voiceId);
  const tmpArchive = path.join(getTtsRootDir(models), `.${voiceId}.download`);
  const controller = new AbortController();
  activeDownloads.set(voiceId, controller);

  try {
    // 1. Загрузка с прогрессом
    const response = await fetch(definition.url, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new TtsVoiceStoreError('download_failed', `HTTP ${response.status}`);
    }
    const totalBytes = Number(response.headers.get('content-length')) || definition.archiveBytes;
    let received = 0;

    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on('data', (chunk: Buffer) => {
      received += chunk.length;
      onProgress?.({ voiceId, phase: 'download', receivedBytes: received, totalBytes });
    });
    await pipeline(source, createWriteStream(tmpArchive));

    // 2. Контрольная сумма
    onProgress?.({ voiceId, phase: 'verify', receivedBytes: received, totalBytes });
    const actual = await sha256File(tmpArchive);
    if (actual !== definition.sha256) {
      throw new TtsVoiceStoreError('checksum_mismatch', `expected ${definition.sha256}, got ${actual}`);
    }

    // 3. Распаковка во временный каталог рядом, затем перенос
    onProgress?.({ voiceId, phase: 'extract', receivedBytes: received, totalBytes });
    const stagingDir = path.join(getTtsRootDir(models), `.${voiceId}.staging`);
    await fs.rm(stagingDir, { recursive: true, force: true });
    await extractArchive(tmpArchive, stagingDir);

    const archiveRoot = path.join(stagingDir, getArchiveRootDir(voiceId));
    const unpacked = existsSync(archiveRoot) ? archiveRoot : stagingDir;

    // espeak-ng-data — общий для всех голосов, держим одну копию
    const sharedEspeak = getSharedEspeakDataDir(models);
    const unpackedEspeak = path.join(unpacked, 'espeak-ng-data');
    if (existsSync(unpackedEspeak)) {
      if (!(await hasEspeakData())) {
        await fs.mkdir(path.dirname(sharedEspeak), { recursive: true });
        await fs.rename(unpackedEspeak, sharedEspeak).catch(async () => {
          await fs.cp(unpackedEspeak, sharedEspeak, { recursive: true });
        });
      }
      await fs.rm(unpackedEspeak, { recursive: true, force: true });
    }

    await fs.rm(voiceDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(voiceDir), { recursive: true });
    await fs.rename(unpacked, voiceDir).catch(async () => {
      await fs.cp(unpacked, voiceDir, { recursive: true });
      await fs.rm(unpacked, { recursive: true, force: true });
    });
    await fs.rm(stagingDir, { recursive: true, force: true });

    // 4. Манифест
    const paths = getVoicePaths(models, voiceId, definition.modelFile);
    if (!existsSync(paths.modelPath)) throw new TtsVoiceStoreError('model_not_found', paths.modelPath);

    let sampleRate = 22050;
    let numSpeakers = 1;
    let noiseScale = 0.667;
    let noiseScaleW = 0.8;
    let lengthScale = 1.0;
    // В архивах sherpa рядом лежит исходный конфиг Piper — берём параметры из него
    const configRaw = await fs.readFile(paths.configPath, 'utf8').catch(() => null);
    if (configRaw) {
      try {
        const cfg = parsePiperVoiceConfig(configRaw);
        sampleRate = cfg.sampleRate;
        numSpeakers = cfg.numSpeakers;
        noiseScale = cfg.noiseScale;
        noiseScaleW = cfg.noiseScaleW;
        lengthScale = cfg.lengthScale;
      } catch {
        // конфиг необязателен: модель уже конвертирована и содержит metadata
      }
    }

    const installed: InstalledVoice = {
      id: voiceId,
      label: definition.label,
      language: definition.language,
      source: 'builtin',
      modelPath: paths.modelPath,
      tokensPath: paths.tokensPath,
      dataDir: getSharedEspeakDataDir(models),
      sampleRate,
      numSpeakers,
      noiseScale,
      noiseScaleW,
      lengthScale,
      installedAt: new Date().toISOString(),
      sizeBytes: await dirSize(voiceDir)
    };
    await fs.writeFile(path.join(voiceDir, VOICE_MANIFEST_FILE), JSON.stringify(installed, null, 2), 'utf8');

    onProgress?.({ voiceId, phase: 'done', receivedBytes: received, totalBytes });
    console.log(`[TtsVoiceStore] Voice ${voiceId} installed (${Math.round(installed.sizeBytes / 1048576)} MB)`);
    return installed;
  } finally {
    activeDownloads.delete(voiceId);
    await fs.rm(tmpArchive, { force: true }).catch(() => {});
  }
}

/**
 * Импортирует пользовательский голос из пары `.onnx` + `.onnx.json`.
 *
 * Модель с Hugging Face не содержит metadata, которую требует sherpa, поэтому при импорте
 * metadata дописывается в копию файла, а `tokens.txt` строится из `phoneme_id_map`.
 */
export async function importVoiceFromFiles(
  modelSourcePath: string,
  configSourcePath: string,
  label?: string
): Promise<InstalledVoice> {
  if (!existsSync(modelSourcePath)) throw new TtsVoiceStoreError('model_not_found', modelSourcePath);
  if (!existsSync(configSourcePath)) throw new TtsVoiceStoreError('config_not_found', configSourcePath);
  if (!(await hasEspeakData())) throw new TtsVoiceStoreError('espeak_data_missing');

  const configRaw = await fs.readFile(configSourcePath, 'utf8');
  // Ошибки разбора (PiperVoiceConfigError) уходят наверх с кодом — рендерер их переводит
  const config = parsePiperVoiceConfig(configRaw);

  const models = await ttsRoot();
  const voiceId = makeImportedVoiceId(path.basename(modelSourcePath));
  const voiceDir = getVoiceDir(models, voiceId);
  const paths = getVoicePaths(models, voiceId, `${voiceId}.onnx`);

  await fs.rm(voiceDir, { recursive: true, force: true });
  await fs.mkdir(voiceDir, { recursive: true });

  // 1. Копия модели; если metadata нет — дописываем её в конец файла
  const modelBytes = await fs.readFile(modelSourcePath);
  const tail = modelBytes.subarray(Math.max(0, modelBytes.length - METADATA_TAIL_BYTES));
  if (onnxHasPiperMetadata(tail)) {
    await fs.writeFile(paths.modelPath, modelBytes);
  } else {
    const metadata = encodeOnnxMetadataProps(buildPiperOnnxMetadata(config));
    await fs.writeFile(paths.modelPath, Buffer.concat([modelBytes, Buffer.from(metadata)]));
  }

  // 2. tokens.txt из phoneme_id_map и копия исходного конфига (для справки и переустановки)
  await fs.writeFile(paths.tokensPath, buildTokensTxt(config), 'utf8');
  await fs.writeFile(paths.configPath, configRaw, 'utf8');

  const installed: InstalledVoice = {
    id: voiceId,
    label: label?.trim() || voiceId,
    language: config.espeakVoice.startsWith('ru') ? 'ru' : 'en',
    source: 'imported',
    modelPath: paths.modelPath,
    tokensPath: paths.tokensPath,
    dataDir: getSharedEspeakDataDir(models),
    sampleRate: config.sampleRate,
    numSpeakers: config.numSpeakers,
    noiseScale: config.noiseScale,
    noiseScaleW: config.noiseScaleW,
    lengthScale: config.lengthScale,
    installedAt: new Date().toISOString(),
    sizeBytes: await dirSize(voiceDir)
  };
  await fs.writeFile(path.join(voiceDir, VOICE_MANIFEST_FILE), JSON.stringify(installed, null, 2), 'utf8');
  console.log(`[TtsVoiceStore] Imported voice ${voiceId} (${config.espeakVoice}, ${config.sampleRate} Hz)`);
  return installed;
}

/** Удаляет установленный голос. Общий `espeak-ng-data` остаётся — он нужен остальным. */
export async function deleteVoice(voiceId: string): Promise<boolean> {
  if (!isValidVoiceId(voiceId)) throw new TtsVoiceStoreError('invalid_voice_id', voiceId);
  const models = await ensureModelsCacheDir();
  const dir = getVoiceDir(models, voiceId);
  if (!existsSync(dir)) return false;
  await fs.rm(dir, { recursive: true, force: true });
  return true;
}

export { PiperVoiceConfigError };
