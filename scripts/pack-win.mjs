import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const releaseDir = path.join(rootDir, 'release');
const targetUnpackedDir = path.join(releaseDir, 'win-unpacked');
const tempOutputDir = path.join(rootDir, 'release_tmp');
const tempUnpackedDir = path.join(tempOutputDir, 'win-unpacked');

console.log('🚀 Быстрая сборка распакованного приложения ProjectHub...');

// 1. Build frontend & electron bundles
console.log('📦 Сборка frontend & electron...');
execSync('npm run build', { stdio: 'inherit', cwd: rootDir });

// 1.1. Copy worker scripts to dist-electron
const srcWorkers = path.join(rootDir, 'electron', 'workers');
const destWorkers = path.join(rootDir, 'dist-electron', 'workers');
if (fs.existsSync(srcWorkers)) {
  fs.mkdirSync(destWorkers, { recursive: true });
  fs.cpSync(srcWorkers, destWorkers, { recursive: true });
  console.log('📦 Воркеры скопированы в dist-electron/workers');
}

// 2. Try packaging directly first, or use unique tempOutputDir on EBUSY
let usedTemp = false;
const uniqueTempOutputDir = path.join(rootDir, `release_tmp_${Date.now()}`);
const uniqueTempUnpackedDir = path.join(uniqueTempOutputDir, 'win-unpacked');

try {
  console.log('⚡ Запуск electron-builder --win --dir...');
  execSync('npx electron-builder --win --dir', { stdio: 'inherit', cwd: rootDir });
} catch (err) {
  console.warn('⚠️ Прямая сборка в release/win-unpacked заблокирована (EBUSY/Explorer), переключаемся на временный каталог...');
  usedTemp = true;
  execSync(`npx electron-builder --win --dir -c.directories.output="${uniqueTempOutputDir}"`, {
    stdio: 'inherit',
    cwd: rootDir
  });
}

// 3. If used temp, copy files into release/win-unpacked
if (usedTemp && fs.existsSync(uniqueTempUnpackedDir)) {
  console.log('📂 Синхронизация файлов в release/win-unpacked...');
  if (!fs.existsSync(targetUnpackedDir)) {
    fs.mkdirSync(targetUnpackedDir, { recursive: true });
  }
  try {
    fs.cpSync(uniqueTempUnpackedDir, targetUnpackedDir, { recursive: true, force: true });
  } catch (copyErr) {
    console.warn('⚠️ Некоторые файлы заблокированы запущенным процессом (ProjectHub.exe). Для полного обновления перезапустите приложение.', copyErr.message);
  }
  try {
    fs.rmSync(uniqueTempOutputDir, { recursive: true, force: true });
  } catch {}
}

// 4. Run icon patcher
console.log('🎨 Вшивание иконки в PE-ресурсы...');
try {
  execSync('node scripts/patch-exe-icon.mjs', { stdio: 'inherit', cwd: rootDir });
} catch (e) {
  console.warn('Предупреждение при пропатчивании иконки:', e.message);
}

console.log('✨ Распакованное приложение успешно собрано в release/win-unpacked/ProjectHub.exe');
