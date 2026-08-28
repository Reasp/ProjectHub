import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENV_DIR = path.join(__dirname, '.venv');
const VENV_PYTHON =
  process.platform === 'win32' ? path.join(VENV_DIR, 'Scripts', 'python.exe') : path.join(VENV_DIR, 'bin', 'python');

const OLLAMA_HOST = process.env.LIGHTRAG_OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const LLM_MODEL = process.env.LIGHTRAG_LLM_MODEL ?? 'qwen2.5:7b-instruct';
const EMBED_MODEL = process.env.LIGHTRAG_EMBED_MODEL ?? 'bge-m3:latest';

function tryRun(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf-8' });
  return res.status === 0 ? res.stdout.trim() : null;
}

// Ищем рабочий системный Python. НЕ доверяем слепо первому "python"/"python3" в PATH —
// это может быть venv стороннего приложения (проверено на практике: на одной из машин
// "python" указывал в venv другого установленного агента с нерабочим pip). Кандидат
// считается годным, только если у него реально работает "-m pip" и версия >= 3.10.
function findSystemPython() {
  const candidates =
    process.platform === 'win32'
      ? [['py', ['-3']], ['python', []], ['python3', []]]
      : [['python3', []], ['python', []]];

  for (const [cmd, baseArgs] of candidates) {
    const version = tryRun(cmd, [...baseArgs, '--version']);
    if (!version) continue;
    const match = version.match(/(\d+)\.(\d+)/);
    if (!match) continue;
    const [, major, minor] = match.map(Number);
    if (major < 3 || (major === 3 && minor < 10)) continue;
    const pipOk = tryRun(cmd, [...baseArgs, '-m', 'pip', '--version']);
    if (!pipOk) continue;
    return { cmd, baseArgs, version };
  }
  return null;
}

async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.models?.map((m) => m.name) ?? [];
  } catch {
    return null;
  }
}

function pullOllamaModel(model) {
  console.log(`  ollama pull ${model} ...`);
  const res = spawnSync('ollama', ['pull', model], { stdio: 'inherit' });
  return res.status === 0;
}

async function main() {
  console.log('=== 1. Python-окружение ===');
  if (!fs.existsSync(VENV_PYTHON)) {
    const python = findSystemPython();
    if (!python) {
      console.error(
        'Не найден рабочий системный Python 3.10+ (проверялись py/python/python3). ' +
          'Установите Python (https://python.org/downloads/) и запустите заново.',
      );
      process.exitCode = 1;
      return;
    }
    console.log(`Найден системный Python: ${python.cmd} ${python.baseArgs.join(' ')} (${python.version})`);
    console.log(`Создаю venv в ${path.relative(__dirname, VENV_DIR) || '.'} ...`);
    const venvRes = spawnSync(python.cmd, [...python.baseArgs, '-m', 'venv', VENV_DIR], { stdio: 'inherit' });
    if (venvRes.status !== 0) {
      console.error('Не удалось создать venv.');
      process.exitCode = 1;
      return;
    }
  } else {
    console.log('venv уже есть, пропускаю создание.');
  }

  console.log('\n=== 2. lightrag-hku ===');
  const pipCheck = spawnSync(VENV_PYTHON, ['-m', 'pip', 'show', 'lightrag-hku'], { stdio: 'ignore' });
  if (pipCheck.status !== 0) {
    console.log('Устанавливаю lightrag-hku (может занять пару минут)...');
    spawnSync(VENV_PYTHON, ['-m', 'pip', 'install', '--upgrade', 'pip'], { stdio: 'inherit' });
    const installRes = spawnSync(VENV_PYTHON, ['-m', 'pip', 'install', 'lightrag-hku'], { stdio: 'inherit' });
    if (installRes.status !== 0) {
      console.error('Не удалось установить lightrag-hku.');
      process.exitCode = 1;
      return;
    }
  } else {
    console.log('lightrag-hku уже установлен, пропускаю.');
  }

  console.log('\n=== 3. Ollama ===');
  const models = await checkOllama();
  if (models === null) {
    console.error(
      `Ollama не отвечает на ${OLLAMA_HOST}. Установите и запустите Ollama: https://ollama.com/download\n` +
        `После установки повторите: npm run lightrag-setup`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Ollama доступна. Уже установленные модели: ${models.join(', ') || '—'}`);

  for (const model of [LLM_MODEL, EMBED_MODEL]) {
    if (models.includes(model)) {
      console.log(`  ${model} — уже есть.`);
    } else {
      console.log(`  ${model} — не найдена, скачиваю...`);
      if (!pullOllamaModel(model)) {
        console.error(`  Не удалось скачать ${model}. Попробуйте вручную: ollama pull ${model}`);
        process.exitCode = 1;
      }
    }
  }

  console.log('\nГотово. Дальше: npm run lightrag-index');
}

main();
