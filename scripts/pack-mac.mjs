import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const releaseDir = path.join(rootDir, 'release');

console.log('🚀 Сборка приложения ProjectHub для macOS...');

// 1. Build frontend & electron bundles
console.log('📦 Сборка frontend & electron...');
execSync('npm run build', { stdio: 'inherit', cwd: rootDir });

// 2. Copy worker scripts to dist-electron
const srcWorkers = path.join(rootDir, 'electron', 'workers');
const destWorkers = path.join(rootDir, 'dist-electron', 'workers');
if (fs.existsSync(srcWorkers)) {
  fs.mkdirSync(destWorkers, { recursive: true });
  fs.cpSync(srcWorkers, destWorkers, { recursive: true });
  console.log('📦 Воркеры скопированы в dist-electron/workers');
}

// 3. Run electron-builder for mac
// --dir creates fast unpacked .app, without --dir creates .dmg/.zip distribution
const isFullDist = process.argv.includes('--dist') || process.argv.includes('--dmg');
const archArg = process.argv.find((a) => a === '--x64' || a === '--arm64' || a === '--universal');
const archFlag = archArg ? archArg : '';
const dirFlag = isFullDist ? '' : '--dir';

const builderCmd = `npx electron-builder --mac ${dirFlag} ${archFlag}`.trim();
console.log(`⚡ Запуск ${builderCmd}...`);
execSync(builderCmd, { stdio: 'inherit', cwd: rootDir });

console.log(`✨ Сборка для macOS успешно завершена в каталоге: ${releaseDir}`);
