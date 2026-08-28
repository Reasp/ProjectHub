import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = path.join(__dirname, 'stack.json');

function ok(cmd) {
  const res = spawnSync(cmd, { shell: true, stdio: 'ignore' });
  return res.status === 0;
}

function run(cmd) {
  console.log(`  $ ${cmd}`);
  const res = spawnSync(cmd, { shell: true, stdio: 'inherit' });
  return res.status === 0;
}

function detectPackageManager() {
  if (process.platform === 'win32') {
    return ok('winget --version') ? 'winget' : null;
  }
  if (process.platform === 'darwin') {
    return ok('brew --version') ? 'brew' : null;
  }
  // linux
  for (const pm of ['apt', 'dnf', 'pacman']) {
    const probe = { apt: 'apt-get --version', dnf: 'dnf --version', pacman: 'pacman --version' }[pm];
    if (ok(probe)) return pm;
  }
  return null;
}

function installCommand(pm, pkg) {
  switch (pm) {
    case 'winget':
      return `winget install --id ${pkg} --silent --accept-package-agreements --accept-source-agreements`;
    case 'brew':
      return `brew install ${pkg}`;
    case 'apt':
      return `sudo apt-get update && sudo apt-get install -y ${pkg}`;
    case 'dnf':
      return `sudo dnf install -y ${pkg}`;
    case 'pacman':
      return `sudo pacman -Sy --noconfirm ${pkg}`;
    default:
      return null;
  }
}

async function main() {
  const manifestPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_MANIFEST;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  const pm = detectPackageManager();
  console.log(`Платформа: ${process.platform}. Менеджер пакетов: ${pm ?? 'не найден'}.\n`);

  const results = { present: [], installed: [], manual: [] };

  for (const tool of manifest.tools) {
    console.log(`== ${tool.name} ==`);
    if (ok(tool.check)) {
      console.log('  уже установлен.\n');
      results.present.push(tool.name);
      continue;
    }

    const pkg = pm ? tool[pm] : undefined;
    if (!pm || !pkg) {
      console.log(`  не найден автоустановщик для этой системы — установите вручную: ${tool.name}\n`);
      results.manual.push(tool.name);
      continue;
    }

    const cmd = installCommand(pm, pkg);
    console.log(`  устанавливаю через ${pm}...`);
    if (run(cmd) && ok(tool.check)) {
      console.log('  готово.\n');
      results.installed.push(tool.name);
    } else {
      console.log(`  не удалось установить автоматически — установите вручную: ${tool.name}\n`);
      results.manual.push(tool.name);
    }
  }

  console.log('--- Итог ---');
  console.log(`Уже было: ${results.present.join(', ') || '—'}`);
  console.log(`Установлено: ${results.installed.join(', ') || '—'}`);
  console.log(`Нужно руками: ${results.manual.join(', ') || '—'}`);

  if (results.manual.length > 0) {
    process.exitCode = 1;
  }
}

main();
