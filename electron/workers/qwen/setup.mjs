/**
 * Установка сайдкара Qwen3-TTS (TASK-104, decision-64): venv, PyTorch, зависимости и веса моделей.
 *
 * Запускается двумя способами и делает одно и то же:
 *   - из терминала: `npm run qwen-tts-setup -- [--models custom,design] [--hf-endpoint URL]`;
 *   - из приложения: `utilityProcess.fork(setup.mjs, ['--json', ...])`, ход установки читается из stdout.
 *
 * Ничего не ставится без явной команды: фича по умолчанию выключена (правило 7 infra-dev).
 * Установка повторяема — готовые шаги пропускаются, прерванная загрузка весов докачивается.
 *
 * Адрес Hugging Face — параметр (`--hf-endpoint` или `HF_ENDPOINT`): прямой доступ к
 * huggingface.co нестабилен (decision-50 п. 5). Веса берутся закреплённой ревизией и сверяются
 * по sha256 из `manifest.json`, поэтому зеркалу доверять не нужно.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildFileUrl,
  defaultUserDataDir,
  isSupportedPython,
  normalizeEndpoint,
  parsePythonVersion,
  parseSetupArgs,
  planFileDownload,
  pythonCandidates,
  resolveLayout,
  resolveModelFile,
  totalModelBytes
} from './setupCore.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIN_VRAM_MB = 6000;
const DOWNLOAD_ATTEMPTS = 12;
const STALL_TIMEOUT_MS = 60_000;
const PROGRESS_INTERVAL_MS = 500;

class SetupError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

let options;
let activeChild = null;
let cancelled = false;

function emit(event) {
  if (options?.json) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
    return;
  }
  if (event.type === 'phase') console.log(`\n=== ${event.phase}${event.detail ? `: ${event.detail}` : ''} ===`);
  else if (event.type === 'log') console.log(`  ${event.line}`);
  else if (event.type === 'progress') {
    const mb = (n) => Math.round(n / 1048576);
    process.stdout.write(`\r  ${event.file}: ${mb(event.receivedBytes)} / ${mb(event.totalBytes)} МБ      `);
    if (event.receivedBytes >= event.totalBytes) process.stdout.write('\n');
  } else if (event.type === 'done') console.log('\nГотово. Включите движок Qwen3-TTS в настройках голоса ProjectHub.');
  else if (event.type === 'error') console.error(`\nОшибка (${event.code}): ${event.error}`);
}

function killActiveChild() {
  const child = activeChild;
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // pip запускает дочерние процессы сборки — снимаем дерево целиком
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function cancel() {
  if (cancelled) return;
  cancelled = true;
  killActiveChild();
  emit({ type: 'error', code: 'qwen_install_cancelled', error: 'cancelled' });
  process.exit(130);
}

/** Запускает процесс и отдаёт его вывод построчно как события `log`. */
function run(cmd, args, { env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }, windowsHide: true });
    activeChild = child;
    let tail = '';
    const onData = (data) => {
      const text = tail + data.toString('utf8');
      const lines = text.split(/\r?\n|\r/);
      tail = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) emit({ type: 'log', line: line.trim().slice(0, 300) });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => resolve({ status: -1, error: err.message }));
    child.on('close', (status) => {
      if (tail.trim()) emit({ type: 'log', line: tail.trim().slice(0, 300) });
      if (activeChild === child) activeChild = null;
      resolve({ status });
    });
  });
}

function capture(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) return null;
  return `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
}

function findPython(manifest) {
  const { pythonMin, pythonMax } = manifest.runtime;
  for (const { cmd, args } of pythonCandidates(process.platform, options.python || process.env.PROJECTHUB_QWEN_PYTHON || '')) {
    const version = parsePythonVersion(capture(cmd, [...args, '--version']));
    if (!isSupportedPython(version, pythonMin, pythonMax)) continue;
    // Первый `python` в PATH бывает окружением стороннего приложения с нерабочим pip/venv
    if (capture(cmd, [...args, '-c', 'import venv, ensurepip']) === null) continue;
    return { cmd, args, version };
  }
  return null;
}

function checkGpu() {
  const out = capture('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  if (!out) return null;
  const [name, memory] = out.split(/\r?\n/)[0].split(',').map((s) => s.trim());
  return { name, memoryMb: Number(memory) || 0 };
}

async function freeBytes(dir) {
  let probe = dir;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return null;
    probe = parent;
  }
  try {
    const stat = await fsp.statfs(probe);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
}

async function sizeOf(filePath) {
  const stat = await fsp.stat(filePath).catch(() => null);
  return stat ? stat.size : undefined;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** У fetch причина обрыва лежит в `cause`: без неё в логе остаётся только «fetch failed». */
function describeError(err) {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause;
  const detail = cause && typeof cause === 'object' ? cause.code || cause.message : '';
  return detail ? `${err.message}: ${detail}` : err.message;
}

/** Одна попытка загрузки: дописывает `.part` с текущего размера, обрывается при простое канала. */
async function downloadAttempt(url, partPath, offset, expectedSize, onBytes) {
  const controller = new AbortController();
  let stall = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
  const touch = () => {
    clearTimeout(stall);
    stall = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
  };
  try {
    const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
    const response = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (offset > 0 && response.status === 200) {
      // Сервер проигнорировал Range и отдаёт файл с начала
      await fsp.rm(partPath, { force: true });
      offset = 0;
    } else if (!(response.status === 200 || response.status === 206)) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('empty response body');

    const out = fs.createWriteStream(partPath, { flags: offset > 0 ? 'a' : 'w' });
    let received = offset;
    try {
      for await (const chunk of response.body) {
        touch();
        received += chunk.length;
        if (received > expectedSize) throw new Error('server sent more bytes than expected');
        if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
        onBytes(received);
      }
    } finally {
      await new Promise((resolve) => out.end(resolve));
    }
    return received;
  } finally {
    clearTimeout(stall);
  }
}

async function ensureModelFile(model, file, modelDir, endpoint, progress) {
  const target = resolveModelFile(modelDir, file.path);
  const part = `${target}.part`;
  await fsp.mkdir(path.dirname(target), { recursive: true });

  const verifyAndPlace = async (source) => {
    const actual = await sha256File(source);
    if (actual !== file.sha256) return false;
    if (source !== target) await fsp.rename(source, target);
    return true;
  };

  let plan = planFileDownload(file.size, await sizeOf(target), await sizeOf(part));
  if (plan.action === 'done') {
    if (await verifyAndPlace(target)) {
      progress(file, file.size);
      return;
    }
    emit({ type: 'log', line: `${file.path}: контрольная сумма не совпала, файл загружается заново` });
    await fsp.rm(target, { force: true });
    plan = { action: 'restart', offset: 0 };
  }
  if (plan.action === 'restart') await fsp.rm(part, { force: true });

  const url = buildFileUrl(endpoint, model.repo, model.revision, file.path);
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    const offset = (await sizeOf(part)) ?? 0;
    if (offset < file.size) {
      try {
        await downloadAttempt(url, part, offset, file.size, (received) => progress(file, received));
      } catch (err) {
        lastError = describeError(err);
        emit({ type: 'log', line: `${file.path}: попытка ${attempt}/${DOWNLOAD_ATTEMPTS} оборвалась (${lastError})` });
        await sleep(Math.min(30_000, 2000 * attempt));
        continue;
      }
    }
    if ((await sizeOf(part)) !== file.size) {
      lastError = 'incomplete download';
      await sleep(2000);
      continue;
    }
    if (await verifyAndPlace(part)) {
      progress(file, file.size);
      return;
    }
    // Докачанный файл не сошёлся по хэшу — частичная копия была чужой, начинаем с нуля
    await fsp.rm(part, { force: true });
    lastError = 'checksum mismatch';
    if (attempt >= 2) throw new SetupError('qwen_checksum_mismatch', `${file.path}: sha256 mismatch`);
  }
  throw new SetupError('qwen_download_failed', `${file.path}: ${lastError}`);
}

async function installModels(manifest, layout, endpoint) {
  const overallTotal = totalModelBytes(manifest, options.models);
  const perFile = new Map();
  let lastEmit = 0;

  for (const kind of options.models) {
    const model = manifest.models[kind];
    const modelDir = path.join(layout.modelsDir, model.dir);
    emit({ type: 'phase', phase: 'models', detail: `${model.repo} → ${modelDir}` });

    const progress = (file, receivedBytes) => {
      perFile.set(`${kind}/${file.path}`, receivedBytes);
      const now = Date.now();
      if (receivedBytes < file.size && now - lastEmit < PROGRESS_INTERVAL_MS) return;
      lastEmit = now;
      let overallReceived = 0;
      for (const value of perFile.values()) overallReceived += value;
      emit({
        type: 'progress',
        phase: 'models',
        model: kind,
        file: `${model.dir}/${file.path}`,
        receivedBytes,
        totalBytes: file.size,
        overallReceived,
        overallTotal
      });
    };

    for (const file of model.files) await ensureModelFile(model, file, modelDir, endpoint, progress);
  }
}

async function installRuntime(manifest, layout) {
  const requirementsSource = path.join(HERE, 'requirements.txt');
  const requirements = await fsp.readFile(requirementsSource, 'utf8');
  const torchIndexUrl = options.torchIndexUrl || process.env.PROJECTHUB_QWEN_TORCH_INDEX || manifest.runtime.torchIndexUrl;
  const runtimeKey = createHash('sha256')
    .update(requirements)
    .update(JSON.stringify(manifest.runtime.torchPackages))
    .update(torchIndexUrl)
    .digest('hex');

  const previous = await readInstallManifest(layout);
  const verify = () =>
    capture(layout.venvPython, [
      '-c',
      'import json, sys, torch, faster_qwen3_tts; print(json.dumps({"python": sys.version.split()[0], "torch": torch.__version__, "cuda": bool(torch.cuda.is_available())}))'
    ]);

  if (!options.force && previous?.runtimeKey === runtimeKey && fs.existsSync(layout.venvPython)) {
    const probe = verify();
    if (probe) {
      emit({ type: 'phase', phase: 'runtime', detail: 'уже установлено' });
      return { runtimeKey, info: JSON.parse(probe.split(/\r?\n/).pop()) };
    }
  }

  emit({ type: 'phase', phase: 'python' });
  const python = findPython(manifest);
  if (!python) {
    throw new SetupError(
      'qwen_python_missing',
      `Python ${manifest.runtime.pythonMin}–${manifest.runtime.pythonMax} not found (py / python / python3)`
    );
  }
  emit({ type: 'log', line: `Python ${python.version.major}.${python.version.minor}.${python.version.patch}: ${python.cmd} ${python.args.join(' ')}` });

  emit({ type: 'phase', phase: 'venv', detail: layout.venvDir });
  if (options.force) await fsp.rm(layout.venvDir, { recursive: true, force: true });
  if (!fs.existsSync(layout.venvPython)) {
    await fsp.mkdir(layout.home, { recursive: true });
    const res = await run(python.cmd, [...python.args, '-m', 'venv', layout.venvDir]);
    if (res.status !== 0) throw new SetupError('qwen_venv_failed', res.error || `venv exited with ${res.status}`);
  }

  // pip читает файл зависимостей с диска, а из архива приложения его не видно
  await fsp.writeFile(layout.requirementsCopy, requirements, 'utf8');

  const pip = (args) => run(layout.venvPython, ['-m', 'pip', '--disable-pip-version-check', '--no-input', ...args]);
  emit({ type: 'phase', phase: 'torch', detail: torchIndexUrl });
  let res = await pip(['install', ...manifest.runtime.torchPackages, '--index-url', torchIndexUrl]);
  if (res.status !== 0) throw new SetupError('qwen_pip_failed', `torch install exited with ${res.status}`);

  emit({ type: 'phase', phase: 'packages' });
  res = await pip(['install', '-r', layout.requirementsCopy]);
  if (res.status !== 0) throw new SetupError('qwen_pip_failed', `packages install exited with ${res.status}`);

  emit({ type: 'phase', phase: 'verify' });
  const probe = verify();
  if (!probe) throw new SetupError('qwen_runtime_broken', 'torch or faster_qwen3_tts cannot be imported');
  const info = JSON.parse(probe.split(/\r?\n/).pop());
  if (!info.cuda) throw new SetupError('qwen_gpu_missing', 'torch does not see a CUDA device');
  return { runtimeKey, info };
}

async function readInstallManifest(layout) {
  try {
    return JSON.parse(await fsp.readFile(layout.installManifest, 'utf8'));
  } catch {
    return null;
  }
}

function printHelp() {
  console.log(`Установка сайдкара Qwen3-TTS для ProjectHub

  npm run qwen-tts-setup -- [параметры]

  --models custom,design   какие модели скачать (по умолчанию обе, ~4.5 ГБ каждая)
  --hf-endpoint URL        адрес Hugging Face или зеркала (по умолчанию HF_ENDPOINT или huggingface.co)
  --torch-index-url URL    индекс колёс PyTorch (по умолчанию cu128)
  --python PATH            интерпретатор Python 3.10–3.13
  --user-data DIR          каталог данных ProjectHub (по умолчанию системный)
  --skip-models            только окружение Python
  --skip-runtime           только веса моделей
  --force                  пересоздать окружение; не проверять видеокарту и место на диске
  --json                   ход установки строками JSON (для приложения)`);
}

async function main() {
  options = parseSetupArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const manifest = JSON.parse(await fsp.readFile(path.join(HERE, 'manifest.json'), 'utf8'));
  const userData = options.userData || defaultUserDataDir();
  const layout = resolveLayout(userData, { home: options.home, modelsDir: options.modelsDir });
  const endpoint = normalizeEndpoint(options.hfEndpoint || process.env.HF_ENDPOINT || '');

  emit({ type: 'phase', phase: 'check', detail: layout.home });

  const gpu = checkGpu();
  if (gpu) emit({ type: 'log', line: `GPU: ${gpu.name}, ${gpu.memoryMb} MiB` });
  if (!options.force) {
    if (!gpu) throw new SetupError('qwen_gpu_missing', 'nvidia-smi not found: an NVIDIA GPU with CUDA is required');
    if (gpu.memoryMb < MIN_VRAM_MB) {
      throw new SetupError('qwen_gpu_missing', `GPU memory ${gpu.memoryMb} MiB is below ${MIN_VRAM_MB} MiB`);
    }
  }

  if (!options.force) {
    const needRuntime = options.skipRuntime || fs.existsSync(layout.venvPython) ? 0 : manifest.runtime.approxBytes;
    let needModels = 0;
    if (!options.skipModels) {
      for (const kind of options.models) {
        const model = manifest.models[kind];
        for (const file of model.files) {
          const have = (await sizeOf(resolveModelFile(path.join(layout.modelsDir, model.dir), file.path))) ?? 0;
          needModels += Math.max(0, file.size - have);
        }
      }
    }
    const checks = [
      [layout.home, needRuntime],
      [layout.modelsDir, needModels]
    ];
    for (const [dir, need] of checks) {
      const free = await freeBytes(dir);
      if (free !== null && need > 0 && free < need * 1.05) {
        throw new SetupError(
          'qwen_disk_space',
          `${dir}: need ${Math.ceil(need / 1e9)} GB, free ${Math.floor(free / 1e9)} GB`
        );
      }
    }
  }

  let runtime = null;
  if (!options.skipRuntime) runtime = await installRuntime(manifest, layout);
  if (!options.skipModels) await installModels(manifest, layout, endpoint);

  await fsp.mkdir(layout.home, { recursive: true });
  // Чтение и запись вместо copyFile: в упакованном приложении исходник лежит внутри app.asar
  await fsp.writeFile(layout.sidecarCopy, await fsp.readFile(path.join(HERE, 'sidecar.py')));

  const previous = (await readInstallManifest(layout)) ?? {};
  const installedModels = { ...(previous.models ?? {}) };
  if (!options.skipModels) {
    for (const kind of options.models) {
      installedModels[kind] = { revision: manifest.models[kind].revision, verifiedAt: new Date().toISOString() };
    }
  }
  const record = {
    version: manifest.version,
    installedAt: new Date().toISOString(),
    runtimeKey: runtime?.runtimeKey ?? previous.runtimeKey ?? null,
    python: runtime?.info.python ?? previous.python ?? null,
    torch: runtime?.info.torch ?? previous.torch ?? null,
    gpu: gpu?.name ?? previous.gpu ?? null,
    models: installedModels
  };
  await fsp.writeFile(layout.installManifest, JSON.stringify(record, null, 2), 'utf8');

  emit({ type: 'done', home: layout.home, modelsDir: layout.modelsDir, models: Object.keys(installedModels) });
}

process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);
// В приложении установку отменяет main-процесс сообщением в канал utility process
process.parentPort?.on('message', (event) => {
  if (event?.data?.type === 'cancel') cancel();
});

main().then(
  () => process.exit(0),
  (err) => {
    killActiveChild();
    const code = err instanceof SetupError ? err.code : 'qwen_install_failed';
    emit({ type: 'error', code, error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
);
