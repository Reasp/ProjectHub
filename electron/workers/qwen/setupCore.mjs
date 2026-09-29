/**
 * Чистая часть установки сайдкара Qwen3-TTS (TASK-104, decision-64): разбор аргументов, выбор
 * интерпретатора, адреса и план загрузки весов. Без запуска процессов и сети — покрыта unit-тестами.
 *
 * Отдельный файл `.mjs`, а не модуль main-процесса: установку запускает и приложение
 * (`utilityProcess`), и человек из терминала (`npm run qwen-tts-setup`), как у LightRAG.
 */
import os from 'node:os';
import path from 'node:path';

/** Имя каталога данных приложения — то же, что у Electron (`app.getPath('userData')`). */
export const APP_DATA_NAME = 'project-hub';

export const DEFAULT_HF_ENDPOINT = 'https://huggingface.co';

/**
 * Модели: `custom` — пресет-голоса с инструкцией подачи; `design` — создание голоса по описанию;
 * `base` — озвучка голосом эталонной записи (ею звучат сохранённые голоса по описанию).
 */
export const MODEL_KINDS = ['custom', 'design', 'base'];

/** Каталог данных приложения для запуска из терминала, когда Electron путь не передал. */
export function defaultUserDataDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') {
    return path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), APP_DATA_NAME);
  }
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', APP_DATA_NAME);
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, '.config'), APP_DATA_NAME);
}

/** Раскладка файлов сайдкара: окружение — в `qwen-tts`, веса — в общем кэше моделей (decision-7). */
export function resolveLayout(userDataDir, overrides = {}) {
  const join = (...parts) => path.join(...parts);
  const home = overrides.home || join(userDataDir, 'qwen-tts');
  const modelsDir = overrides.modelsDir || join(userDataDir, 'models', 'qwen-tts');
  const venvDir = join(home, 'venv');
  return {
    home,
    modelsDir,
    venvDir,
    venvPython:
      process.platform === 'win32' ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python'),
    installManifest: join(home, 'install.json'),
    requirementsCopy: join(home, 'requirements.txt'),
    sidecarCopy: join(home, 'sidecar.py')
  };
}

/** Адрес хаба без хвостового слэша; пустое значение — адрес по умолчанию. */
export function normalizeEndpoint(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_HF_ENDPOINT;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid endpoint: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`invalid endpoint protocol: ${raw}`);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Адрес файла закреплённой ревизии: `<endpoint>/<repo>/resolve/<revision>/<path>`. */
export function buildFileUrl(endpoint, repo, revision, filePath) {
  const encoded = String(filePath)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${normalizeEndpoint(endpoint)}/${repo}/resolve/${revision}/${encoded}`;
}

/**
 * Путь файла модели внутри её каталога. Список приходит из манифеста приложения, но путь всё равно
 * проверяется: запись за пределы каталога модели недопустима.
 */
export function resolveModelFile(modelDir, filePath) {
  const normalized = String(filePath).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`unsafe model file path: ${filePath}`);
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`unsafe model file path: ${filePath}`);
  }
  return path.join(modelDir, ...parts);
}

export function parsePythonVersion(text) {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text ?? ''));
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0) };
}

/** Версия в пределах `min`..`max` включительно (сравниваются major.minor). */
export function isSupportedPython(version, min, max) {
  if (!version) return false;
  const lo = parsePythonVersion(min);
  const hi = parsePythonVersion(max);
  if (!lo || !hi) return false;
  const value = version.major * 1000 + version.minor;
  return value >= lo.major * 1000 + lo.minor && value <= hi.major * 1000 + hi.minor;
}

/**
 * Кандидаты интерпретатора по убыванию предпочтения. Первым идёт 3.11 — на нём сняты замеры и
 * снимок зависимостей; затем остальные поддерживаемые версии через `py`, затем то, что в PATH.
 */
export function pythonCandidates(platform = process.platform, explicit = '') {
  const list = [];
  if (explicit) list.push({ cmd: explicit, args: [] });
  if (platform === 'win32') {
    for (const v of ['3.11', '3.12', '3.13', '3.10']) list.push({ cmd: 'py', args: [`-${v}`] });
    list.push({ cmd: 'python', args: [] }, { cmd: 'python3', args: [] });
  } else {
    for (const v of ['3.11', '3.12', '3.13', '3.10']) list.push({ cmd: `python${v}`, args: [] });
    list.push({ cmd: 'python3', args: [] }, { cmd: 'python', args: [] });
  }
  return list;
}

/**
 * Что делать с файлом весов: `done` — лежит целиком, `resume` — докачать с `offset`,
 * `restart` — начать заново (лишние байты означают чужой или повреждённый файл).
 */
export function planFileDownload(expectedSize, finalSize, partSize) {
  if (finalSize === expectedSize) return { action: 'done', offset: expectedSize };
  if (typeof partSize === 'number' && partSize > 0 && partSize <= expectedSize) {
    return { action: partSize === expectedSize ? 'verify' : 'resume', offset: partSize };
  }
  return { action: 'restart', offset: 0 };
}

export function parseModelKinds(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [...MODEL_KINDS];
  const kinds = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const kind of kinds) {
    if (!MODEL_KINDS.includes(kind)) throw new Error(`unknown model kind: ${kind}`);
  }
  return [...new Set(kinds)];
}

/** Разбор аргументов командной строки: `--name value`, `--name=value`, флаги без значения. */
export function parseSetupArgs(argv) {
  const flags = new Set(['json', 'force', 'skip-models', 'skip-runtime', 'help']);
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
    if (flags.has(name)) {
      options[name] = true;
      continue;
    }
    const value = eq > 0 ? arg.slice(eq + 1) : argv[(i += 1)];
    if (value === undefined) throw new Error(`missing value for --${name}`);
    options[name] = value;
  }
  return {
    json: Boolean(options.json),
    force: Boolean(options.force),
    help: Boolean(options.help),
    skipModels: Boolean(options['skip-models']),
    skipRuntime: Boolean(options['skip-runtime']),
    userData: options['user-data'] || '',
    home: options.home || '',
    modelsDir: options['models-dir'] || '',
    python: options.python || '',
    hfEndpoint: options['hf-endpoint'] || '',
    torchIndexUrl: options['torch-index-url'] || '',
    models: parseModelKinds(options.models)
  };
}

/** Суммарный объём загрузки выбранных моделей. */
export function totalModelBytes(manifest, kinds) {
  return kinds.reduce(
    (sum, kind) => sum + manifest.models[kind].files.reduce((s, f) => s + f.size, 0),
    0
  );
}
