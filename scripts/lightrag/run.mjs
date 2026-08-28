import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENV_PYTHON =
  process.platform === 'win32'
    ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '.venv', 'bin', 'python');

const [, , script, ...args] = process.argv;
if (!script) {
  console.error('Использование: node run.mjs <script.py> [аргументы]');
  process.exit(1);
}

const res = spawnSync(VENV_PYTHON, [path.join(__dirname, script), ...args], { stdio: 'inherit', cwd: __dirname });
if (res.error) {
  console.error(
    `Не удалось запустить ${VENV_PYTHON}. venv ещё не создан? Выполните: npm run lightrag-setup`,
  );
  process.exit(1);
}
process.exit(res.status ?? 1);
