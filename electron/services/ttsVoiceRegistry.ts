/**
 * Реестр голосов локального TTS и раскладка кэша моделей на диске (TASK-69, decision-25).
 *
 * Встроенные голоса — уже конвертированные архивы Piper из релизов `sherpa-onnx` (`tts-models`):
 * внутри лежат `<id>.onnx` с нужной metadata, `tokens.txt` и общий `espeak-ng-data`.
 * В бандл приложения модели не входят (размер ~64 МБ на голос и неясная лицензия датасета
 * RHVoice) — пользователь скачивает их кнопкой, sha256 зафиксированы здесь и проверяются
 * после загрузки.
 *
 * Чистый модуль: без Electron и файловых операций, только пути и константы — покрыт unit-тестами.
 */

export type TtsVoiceLanguage = 'ru' | 'en';
export type TtsVoiceSource = 'builtin' | 'imported';

export interface TtsVoiceDefinition {
  /** Идентификатор голоса, он же имя каталога в кэше: `ru_RU-irina-medium`. */
  id: string;
  /** Отображаемое имя: на языке голоса, без перевода. */
  label: string;
  language: TtsVoiceLanguage;
  quality: 'low' | 'medium' | 'high';
  /** Имя файла модели внутри архива. */
  modelFile: string;
  /** Архив в релизах sherpa-onnx. */
  url: string;
  /** sha256 архива (посчитан 2026-09-16, см. decision-25). */
  sha256: string;
  /** Размер архива в байтах — для прогресса загрузки до получения Content-Length. */
  archiveBytes: number;
}

/** База релизных архивов sherpa-onnx с конвертированными голосами Piper. */
const SHERPA_TTS_MODELS_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

function builtinVoice(
  id: string,
  label: string,
  language: TtsVoiceLanguage,
  sha256: string,
  archiveBytes: number
): TtsVoiceDefinition {
  return {
    id,
    label,
    language,
    quality: 'medium',
    modelFile: `${id}.onnx`,
    url: `${SHERPA_TTS_MODELS_BASE}/vits-piper-${id}.tar.bz2`,
    sha256,
    archiveBytes
  };
}

/**
 * Встроенный каталог голосов: русские (обучены на данных RHVoice) и английские.
 * Хэши и размеры сняты с релизных архивов sherpa-onnx 2026-09-16.
 */
export const BUILTIN_TTS_VOICES: readonly TtsVoiceDefinition[] = [
  builtinVoice('ru_RU-irina-medium', 'Ирина', 'ru', '1fc0f54e5e084fe287c07909f2f6e0ba6d857864cf800e3ab80286a4e8233008', 67153308),
  builtinVoice('ru_RU-dmitri-medium', 'Дмитрий', 'ru', 'c86d0803737de13d441923ff3b3f309482fab8d7af3ec85949942809eb9a3660', 67188551),
  builtinVoice('ru_RU-denis-medium', 'Денис', 'ru', 'efa4c18e0b5e32b81d1b6df36b9d312831e5d545200e27848ef926a4cd930300', 67190991),
  builtinVoice('ru_RU-ruslan-medium', 'Руслан', 'ru', '0690b1cad01f86e8db9ba988af24898bdc1af774e23cb2e46b9c730269b6fd83', 67210684),
  builtinVoice('en_US-amy-medium', 'Amy', 'en', '9a5d1fc497f85e8022b785bff5f8105203b1e33099ee6265203efc70b0cb0264', 67223746),
  builtinVoice('en_US-lessac-medium', 'Lessac', 'en', '9e3febfacf0abf4270172d2958bcec246032b7e88efc2720840cc80c93de334e', 67230653)
];

/** Голос, выбираемый по умолчанию для языка интерфейса. */
export const DEFAULT_VOICE_BY_LANGUAGE: Record<TtsVoiceLanguage, string> = {
  ru: 'ru_RU-irina-medium',
  en: 'en_US-amy-medium'
};

export function getBuiltinVoice(voiceId: string): TtsVoiceDefinition | undefined {
  return BUILTIN_TTS_VOICES.find((v) => v.id === voiceId);
}

export function getBuiltinVoicesForLanguage(language: TtsVoiceLanguage): TtsVoiceDefinition[] {
  return BUILTIN_TTS_VOICES.filter((v) => v.language === language);
}

/**
 * Идентификатор голоса становится именем каталога в `userData`, а для импортированных голосов
 * приходит от пользователя — поэтому допускаются только безопасные символы, без разделителей
 * пути и переходов вверх (защита от `../`, как в `pathGuard`).
 */
const VOICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** Зарезервированные в Windows имена устройств: каталог с таким именем создать нельзя. */
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function isValidVoiceId(voiceId: string): boolean {
  if (typeof voiceId !== 'string' || !VOICE_ID_PATTERN.test(voiceId)) return false;
  // точки допустимы внутри имени, но не как переход вверх
  return !voiceId.includes('..');
}

/**
 * Приводит имя файла пользовательской модели к безопасному идентификатору голоса:
 * `ru_RU-irina-medium.onnx` → `ru_RU-irina-medium`.
 */
export function makeImportedVoiceId(fileName: string): string {
  const base = String(fileName)
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.onnx(\.json)?$/i, '');
  const sanitized = base.replace(/[^A-Za-z0-9_.-]/g, '-').replace(/\.{2,}/g, '.').replace(/^[^A-Za-z0-9]+/, '');
  // Хвостовые точки Windows отбрасывает: «voice.» и «voice» указывали бы на один каталог
  const trimmed = sanitized.slice(0, 64).replace(/\.+$/, '');
  if (!isValidVoiceId(trimmed) || WINDOWS_RESERVED_NAMES.test(trimmed)) {
    // Случайный суффикс, а не только время: два импорта в одну миллисекунду не должны
    // получить один id и затереть каталог друг друга
    return `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return trimmed;
}

/** Префикс импортированного голоса, чьё имя файла совпало со встроенным (TASK-93). */
export const IMPORTED_VOICE_PREFIX = 'custom-';

/** Имена каталогов в корне кэша голосов, которые не могут быть голосом. */
const RESERVED_VOICE_DIR_NAMES = ['espeak-ng-data'];

/**
 * Идентификатор импортированного голоса, не пересекающийся ни со встроенным реестром, ни с уже
 * занятыми каталогами (TASK-93).
 *
 * Раньше `ru_RU-irina-medium.onnx` получал id встроенной Ирины, выдавал себя за неё и при неудачной
 * пробе удалял её каталог. Теперь имя встроенного голоса получает префикс `custom-`, а занятое —
 * числовой суффикс `-2`, `-3`… Сравнение без учёта регистра: на Windows и macOS `Voice` и `voice` —
 * один каталог.
 *
 * @param takenIds идентификаторы уже существующих каталогов голосов (включая импорты в процессе).
 */
export function resolveImportedVoiceId(fileName: string, takenIds: Iterable<string> = []): string {
  const base = makeImportedVoiceId(fileName);
  const builtin = new Set(BUILTIN_TTS_VOICES.map((v) => v.id.toLowerCase()));
  const taken = new Set([...takenIds].map((id) => id.toLowerCase()));
  for (const id of builtin) taken.add(id);
  for (const name of RESERVED_VOICE_DIR_NAMES) taken.add(name);

  const clashesWithReserved = (id: string) =>
    builtin.has(id.toLowerCase()) || RESERVED_VOICE_DIR_NAMES.includes(id.toLowerCase());
  const stem = clashesWithReserved(base) ? `${IMPORTED_VOICE_PREFIX}${base}`.slice(0, 64).replace(/\.+$/, '') : base;
  if (!taken.has(stem.toLowerCase())) return stem;

  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${stem.slice(0, 64 - suffix.length).replace(/\.+$/, '')}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Слэш-независимое соединение путей: модуль чистый и не тянет `node:path`. */
function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/');
}

/** Корень кэша голосов: `<userData>/models/tts`. */
export function getTtsRootDir(modelsCacheDir: string): string {
  return joinPath(modelsCacheDir, 'tts');
}

/** Каталог конкретного голоса: `<userData>/models/tts/<voiceId>`. */
export function getVoiceDir(modelsCacheDir: string, voiceId: string): string {
  return joinPath(getTtsRootDir(modelsCacheDir), voiceId);
}

/**
 * Общий `espeak-ng-data` — один на все голоса: он одинаков во всех архивах и весит 18 МБ,
 * дублировать его на каждый голос незачем.
 */
export function getSharedEspeakDataDir(modelsCacheDir: string): string {
  return joinPath(getTtsRootDir(modelsCacheDir), 'espeak-ng-data');
}

/** Файл описания установленного голоса внутри его каталога. */
export const VOICE_MANIFEST_FILE = 'voice.json';

export interface TtsVoicePaths {
  dir: string;
  modelPath: string;
  tokensPath: string;
  configPath: string;
  manifestPath: string;
  dataDir: string;
}

/** Полная раскладка файлов установленного голоса. */
export function getVoicePaths(modelsCacheDir: string, voiceId: string, modelFile?: string): TtsVoicePaths {
  const dir = getVoiceDir(modelsCacheDir, voiceId);
  return {
    dir,
    modelPath: joinPath(dir, modelFile || `${voiceId}.onnx`),
    tokensPath: joinPath(dir, 'tokens.txt'),
    configPath: joinPath(dir, `${modelFile || `${voiceId}.onnx`}.json`),
    manifestPath: joinPath(dir, VOICE_MANIFEST_FILE),
    dataDir: getSharedEspeakDataDir(modelsCacheDir)
  };
}

/** Имя каталога внутри релизного архива sherpa: `vits-piper-<id>`. */
export function getArchiveRootDir(voiceId: string): string {
  return `vits-piper-${voiceId}`;
}
