import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import pngToIco from 'png-to-ico';

const srcJpg = 'C:/Users/Professional/.gemini/antigravity-ide/brain/02766efe-5b4d-480b-b8cb-b10b62abde67/projecthub_icon_v2_1788156864507.jpg';
const buildDir = 'F:/ProjectHub/build';
const iconPng = path.join(buildDir, 'icon.png');
const iconIco = path.join(buildDir, 'icon.ico');

if (!fs.existsSync(srcJpg)) {
  console.error('❌ Исходный JPG не найден:', srcJpg);
  process.exit(1);
}

if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

const tempSizesDir = path.join(buildDir, 'temp-sizes');
if (!fs.existsSync(tempSizesDir)) {
  fs.mkdirSync(tempSizesDir, { recursive: true });
}

const psScriptPath = path.join(buildDir, 'resize.ps1');
const psScriptContent = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('${srcJpg.replace(/\\/g, '/')}')
$sizes = @(256, 128, 64, 48, 32, 16)
foreach ($sz in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $sz, $sz
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($src, 0, 0, $sz, $sz)
    
    $outPath = "${tempSizesDir.replace(/\\/g, '/')}/icon-$sz.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}
$src.Dispose()
`;

fs.writeFileSync(psScriptPath, psScriptContent, 'utf-8');

console.log('🔄 Генерация PNG слоев разного разрешения...');
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`, { stdio: 'inherit' });
fs.unlinkSync(psScriptPath);

// Копируем 256x256 как главный icon.png
fs.copyFileSync(path.join(tempSizesDir, 'icon-256.png'), iconPng);
console.log('✅ icon.png (256x256) обновлен в build/!');

const publicDir = 'F:/ProjectHub/public';
if (fs.existsSync(publicDir)) {
  fs.copyFileSync(path.join(tempSizesDir, 'icon-256.png'), path.join(publicDir, 'icon.png'));
  fs.copyFileSync(path.join(tempSizesDir, 'icon-64.png'), path.join(publicDir, 'favicon.png'));
}

// 2. Собираем многослойный .ico файл
const pngList = [256, 128, 64, 48, 32, 16].map((sz) => path.join(tempSizesDir, `icon-${sz}.png`));

console.log('🔄 Сборка многослойного icon.ico...');
const buf = await pngToIco(pngList);
fs.writeFileSync(iconIco, buf);
if (fs.existsSync(publicDir)) {
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), buf);
}
console.log('✅ icon.ico успешно создан и содержит слои 256, 128, 64, 48, 32, 16px!');

// Удаляем временную папку
fs.rmSync(tempSizesDir, { recursive: true, force: true });
console.log('🎉 Все иконки успешно подготовлены в build/ и public/!');
