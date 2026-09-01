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

// 2. Try packaging directly first, or use tempOutputDir on EBUSY
let usedTemp = false;
try {
  console.log('⚡ Запуск electron-builder --win --dir...');
  execSync('npx electron-builder --win --dir', { stdio: 'inherit', cwd: rootDir });
} catch (err) {
  console.warn('⚠️ Прямая сборка в release/win-unpacked заблокирована (EBUSY/Explorer), переключаемся на временный каталог...');
  usedTemp = true;
  if (fs.existsSync(tempOutputDir)) {
    try {
      fs.rmSync(tempOutputDir, { recursive: true, force: true });
    } catch {}
  }
  execSync(`npx electron-builder --win --dir -c.directories.output="${tempOutputDir}"`, {
    stdio: 'inherit',
    cwd: rootDir
  });
}

// 3. If used temp, copy files into release/win-unpacked
if (usedTemp && fs.existsSync(tempUnpackedDir)) {
  console.log('📂 Синхронизация файлов в release/win-unpacked...');
  if (!fs.existsSync(targetUnpackedDir)) {
    fs.mkdirSync(targetUnpackedDir, { recursive: true });
  }
  fs.cpSync(tempUnpackedDir, targetUnpackedDir, { recursive: true, force: true });
  try {
    fs.rmSync(tempOutputDir, { recursive: true, force: true });
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
