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
  resolveImportedVoiceId,
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
import { ArchiveExtractError, extractTarBz2 } from './archiveExtract';
import { parseContentLength, resolveTotalBytes } from './ttsDownloadProgress';
import type { TtsVoiceStoreErrorCode } from './ttsErrorCodes';

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

/** Полный список кодов — в `ttsErrorCodes`: оттуда же его берёт тест покрытия переводов. */
export type { TtsVoiceStoreErrorCode };

export class TtsVoiceStoreError extends Error {
  readonly code: TtsVoiceStoreErrorCode;
  readonly detail?: string;
  /** `options.cause` передаётся при перебрасывании пойманной ошибки, чтобы не терять исходную. */
  constructor(code: TtsVoiceStoreErrorCode, detail?: string, options?: ErrorOptions) {
    super(detail ? `${code}: ${detail}` : code, options);
    this.name = 'TtsVoiceStoreError';
    this.code = code;
    this.detail = detail;
  }
}

/** Активные загрузки: нужны и для отмены, и чтобы не запускать вторую загрузку того же голоса. */
const activeDownloads = new Map<string, AbortController>();

/** Импорты, ещё не перенесённые на место: их id заняты, а staging-каталоги — не мусор (TASK-93). */
const activeImports = new Set<string>();

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
 * Распаковка `.tar.bz2` внутри процесса (decision-32).
 *
 * Системный `tar` оказался неприменим: на Windows bsdtar собран без bz2lib и зовёт отсутствующий
 * `bzip2 -d`, а GNU tar читает `-f C:\...` как «хост:путь». Поэтому внешних программ здесь нет.
 */
async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  try {
    await extractTarBz2(archivePath, targetDir);
  } catch (err) {
    if (err instanceof ArchiveExtractError) {
      const code: TtsVoiceStoreErrorCode = err.code === 'unsafe_entry' ? 'unsafe_archive_entry' : 'archive_corrupted';
      throw new TtsVoiceStoreError(code, err.detail ?? err.message, { cause: err });
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new TtsVoiceStoreError('extract_failed', message, { cause: err });
  }
}

/**
 * Убирает временные каталоги от прерванных загрузок (AC#1).
 *
 * Чужие активные загрузки не трогаются: другой голос может качаться параллельно, и его
 * `.staging` ещё нужен.
 */
async function cleanupStaleTempArtifacts(root: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const match = /^\.(.+)\.(download|staging|import)$/.exec(entry.name);
    if (!match || activeDownloads.has(match[1]) || activeImports.has(match[1])) continue;
    await fs.rm(path.join(root, entry.name), { recursive: true, force: true }).catch(() => {});
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
  if (activeDownloads.has(voiceId)) throw new TtsVoiceStoreError('download_in_progress', voiceId);

  const models = await ttsRoot();
  const voiceDir = getVoiceDir(models, voiceId);
  const root = getTtsRootDir(models);
  const tmpArchive = path.join(root, `.${voiceId}.download`);
  const stagingDir = path.join(root, `.${voiceId}.staging`);
  // Хвосты прошлых неудачных попыток — до того, как эта загрузка станет активной
  await cleanupStaleTempArtifacts(root);

  const controller = new AbortController();
  activeDownloads.set(voiceId, controller);

  try {
    // 1. Загрузка с прогрессом
    const response = await fetch(definition.url, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new TtsVoiceStoreError('download_failed', `HTTP ${response.status}`);
    }
    // Знаменатель берётся только из Content-Length: при chunked-ответе его нет, и проценты от
    // размера из реестра были бы выдуманными — тогда показываем мегабайты (TASK-87, дефект 6)
    const contentLength = parseContentLength(response.headers.get('content-length'));
    let received = 0;
    const report = (phase: DownloadProgress['phase']) =>
      onProgress?.({
        voiceId,
        phase,
        receivedBytes: received,
        totalBytes: resolveTotalBytes(contentLength, received, phase)
      });

    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on('data', (chunk: Buffer) => {
      received += chunk.length;
      report('download');
    });
    await pipeline(source, createWriteStream(tmpArchive));

    // 2. Контрольная сумма
    report('verify');
    const actual = await sha256File(tmpArchive);
    if (actual !== definition.sha256) {
      throw new TtsVoiceStoreError('checksum_mismatch', `expected ${definition.sha256}, got ${actual}`);
    }

    // 3. Распаковка во временный каталог рядом, затем перенос
    report('extract');
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

    report('done');
    console.log(`[TtsVoiceStore] Voice ${voiceId} installed (${Math.round(installed.sizeBytes / 1048576)} MB)`);
    return installed;
  } finally {
    activeDownloads.delete(voiceId);
    // Мусор убирается на любом пути: ошибка распаковки, несовпадение sha256, отмена (AC#1)
    await fs.rm(tmpArchive, { force: true }).catch(() => {});
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Голос, подготовленный к импорту во временном каталоге и ещё не видимый в списке голосов. */
export interface StagedVoiceImport {
  /** Описание с путями во временном каталоге — для пробы в отдельном процессе (decision-34). */
  readonly voice: InstalledVoice;
  /** Переносит голос на место и возвращает описание с окончательными путями. */
  commit(): Promise<InstalledVoice>;
  /** Удаляет временный каталог; после `commit` ничего не делает. Удаляет только файлы этого импорта. */
  discard(): Promise<void>;
}

/** Каталоги голосов, уже лежащие в кэше: с ними id импорта пересекаться не должен. */
async function listTakenVoiceIds(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
}

/**
 * Готовит пользовательский голос из пары `.onnx` + `.onnx.json` во временном каталоге (TASK-93).
 *
 * Модель с Hugging Face не содержит metadata, которую требует sherpa, поэтому при импорте
 * metadata дописывается в копию файла, а `tokens.txt` строится из `phoneme_id_map`.
 *
 * Ни встроенный, ни ранее импортированный голос импорт не трогает: id выбирает
 * `resolveImportedVoiceId`, файлы пишутся в `.<id>.import`, и до `commit` голоса в списке нет.
 */
export async function stageVoiceImport(
  modelSourcePath: string,
  configSourcePath: string,
  label?: string
): Promise<StagedVoiceImport> {
  if (!existsSync(modelSourcePath)) throw new TtsVoiceStoreError('model_not_found', modelSourcePath);
  if (!existsSync(configSourcePath)) throw new TtsVoiceStoreError('config_not_found', configSourcePath);
  if (!(await hasEspeakData())) throw new TtsVoiceStoreError('espeak_data_missing');

  const configRaw = await fs.readFile(configSourcePath, 'utf8');
  // Ошибки разбора (PiperVoiceConfigError) уходят наверх с кодом — рендерер их переводит
  const config = parsePiperVoiceConfig(configRaw);

  const models = await ttsRoot();
  const root = getTtsRootDir(models);
  const taken = await listTakenVoiceIds(root);
  // Выбор id и резервирование — синхронно, без await между ними: параллельный импорт того же
  // файла увидит резерв и получит другой id
  const voiceId = resolveImportedVoiceId(path.basename(modelSourcePath), [...taken, ...activeImports]);
  activeImports.add(voiceId);

  const stagingDir = path.join(root, `.${voiceId}.import`);
  const finalPaths = getVoicePaths(models, voiceId, `${voiceId}.onnx`);
  const staged = {
    modelPath: path.join(stagingDir, `${voiceId}.onnx`),
    tokensPath: path.join(stagingDir, 'tokens.txt'),
    configPath: path.join(stagingDir, `${voiceId}.onnx.json`)
  };

  let settled = false;
  const discard = async () => {
    if (settled) return;
    settled = true;
    activeImports.delete(voiceId);
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    await cleanupStaleTempArtifacts(root);
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });

    // 1. Копия модели; если metadata нет — дописываем её в конец файла
    const modelBytes = await fs.readFile(modelSourcePath);
    const tail = modelBytes.subarray(Math.max(0, modelBytes.length - METADATA_TAIL_BYTES));
    if (onnxHasPiperMetadata(tail)) {
      await fs.writeFile(staged.modelPath, modelBytes);
    } else {
      const metadata = encodeOnnxMetadataProps(buildPiperOnnxMetadata(config));
      await fs.writeFile(staged.modelPath, Buffer.concat([modelBytes, Buffer.from(metadata)]));
    }

    // 2. tokens.txt из phoneme_id_map и копия исходного конфига (для справки и переустановки)
    await fs.writeFile(staged.tokensPath, buildTokensTxt(config), 'utf8');
    await fs.writeFile(staged.configPath, configRaw, 'utf8');

    const stagedVoice: InstalledVoice = {
      id: voiceId,
      label: label?.trim() || voiceId,
      language: config.espeakVoice.startsWith('ru') ? 'ru' : 'en',
      source: 'imported',
      modelPath: staged.modelPath,
      tokensPath: staged.tokensPath,
      dataDir: getSharedEspeakDataDir(models),
      sampleRate: config.sampleRate,
      numSpeakers: config.numSpeakers,
      noiseScale: config.noiseScale,
      noiseScaleW: config.noiseScaleW,
      lengthScale: config.lengthScale,
      installedAt: new Date().toISOString(),
      sizeBytes: await dirSize(stagingDir)
    };

    const commit = async (): Promise<InstalledVoice> => {
      if (settled) throw new Error(`Voice import ${voiceId} is already finished`);
      const voiceDir = getVoiceDir(models, voiceId);
      const installed: InstalledVoice = {
        ...stagedVoice,
        modelPath: finalPaths.modelPath,
        tokensPath: finalPaths.tokensPath,
        installedAt: new Date().toISOString()
      };
      // Манифест пишется до переноса: каталог голоса появляется на месте уже целиком
      await fs.writeFile(path.join(stagingDir, VOICE_MANIFEST_FILE), JSON.stringify(installed, null, 2), 'utf8');
      // Каталог, появившийся за время пробы (например, созданный вручную), не перезаписывается
      if (existsSync(voiceDir)) throw new TtsVoiceStoreError('invalid_voice_id', `${voiceId} already exists`);
      await fs.rename(stagingDir, voiceDir);
      settled = true;
      activeImports.delete(voiceId);
      console.log(`[TtsVoiceStore] Imported voice ${voiceId} (${config.espeakVoice}, ${config.sampleRate} Hz)`);
      return installed;
    };

    return { voice: stagedVoice, commit, discard };
  } catch (err) {
    await discard();
    throw err;
  }
}

/** Импорт без пробы: подготовка и сразу перенос на место. */
export async function importVoiceFromFiles(
  modelSourcePath: string,
  configSourcePath: string,
  label?: string
): Promise<InstalledVoice> {
  const staged = await stageVoiceImport(modelSourcePath, configSourcePath, label);
  try {
    return await staged.commit();
  } finally {
    await staged.discard();
  }
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
