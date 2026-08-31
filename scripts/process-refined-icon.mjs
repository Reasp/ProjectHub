import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import pngToIco from 'png-to-ico';

const srcJpg = 'C:/Users/Professional/.gemini/antigravity-ide/brain/02766efe-5b4d-480b-b8cb-b10b62abde67/projecthub_perfect_icon_1788157030691.jpg';
const buildDir = 'F:/ProjectHub/build';
const publicDir = 'F:/ProjectHub/public';
const iconPng = path.join(buildDir, 'icon.png');
const iconIco = path.join(buildDir, 'icon.ico');

if (!fs.existsSync(srcJpg)) {
  console.error('❌ Исходный JPG не найден:', srcJpg);
  process.exit(1);
}

const tempSizesDir = path.join(buildDir, 'temp-sizes');
if (!fs.existsSync(tempSizesDir)) {
  fs.mkdirSync(tempSizesDir, { recursive: true });
}

const psScriptPath = path.join(buildDir, 'process-icon.ps1');
const psScriptContent = `
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::FromFile('${srcJpg.replace(/\\/g, '/')}')

[int]$cropSize = 580
[int]$cropX = 222
[int]$cropY = 180

Write-Host "Кадрирование: CropX=$cropX, CropY=$cropY, CropSize=$cropSize"

$cropRect = New-Object System.Drawing.Rectangle $cropX, $cropY, $cropSize, $cropSize
$croppedBmp = New-Object System.Drawing.Bitmap $cropSize, $cropSize
$cropG = [System.Drawing.Graphics]::FromImage($croppedBmp)
$cropG.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$cropG.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$cropG.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$cropG.DrawImage($src, 0, 0, $cropRect, [System.Drawing.GraphicsUnit]::Pixel)
$cropG.Dispose()

# Повышение контраста (1.30)
$contrast = 1.30
$t = (1.0 - $contrast) / 2.0
$cmElements = @(
    @($contrast, 0.0, 0.0, 0.0, 0.0),
    @(0.0, $contrast, 0.0, 0.0, 0.0),
    @(0.0, 0.0, $contrast, 0.0, 0.0),
    @(0.0, 0.0, 0.0, 1.0, 0.0),
    @($t, $t, $t, 0.0, 1.0)
)
$cm = New-Object System.Drawing.Imaging.ColorMatrix(,$cmElements)
$imgAttr = New-Object System.Drawing.Imaging.ImageAttributes
$imgAttr.SetColorMatrix($cm)

# Генерация слоев
$sizes = @(256, 128, 64, 48, 32, 16)
foreach ($sz in $sizes) {
    [int]$s = $sz
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    
    $destRect = New-Object System.Drawing.Rectangle 0, 0, $s, $s
    $g.DrawImage($croppedBmp, $destRect, 0, 0, $cropSize, $cropSize, [System.Drawing.GraphicsUnit]::Pixel, $imgAttr)
    
    $outPath = "${tempSizesDir.replace(/\\/g, '/')}/icon-$s.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

$croppedBmp.Dispose()
$src.Dispose()
Write-Host "✅ Обработка и генерация всех размеров завершена!"
`;

fs.writeFileSync(psScriptPath, psScriptContent, 'utf-8');

console.log('🔄 Кадрирование куба без отступов и повышение контраста...');
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`, { stdio: 'inherit' });
fs.unlinkSync(psScriptPath);

// Копируем 256x256
fs.copyFileSync(path.join(tempSizesDir, 'icon-256.png'), iconPng);
if (fs.existsSync(publicDir)) {
  fs.copyFileSync(path.join(tempSizesDir, 'icon-256.png'), path.join(publicDir, 'icon.png'));
  fs.copyFileSync(path.join(tempSizesDir, 'icon-64.png'), path.join(publicDir, 'favicon.png'));
}
console.log('✅ icon.png обновлен в build/ и public/!');

// Собираем .ico
const pngList = [256, 128, 64, 48, 32, 16].map((sz) => path.join(tempSizesDir, `icon-${sz}.png`));
console.log('🔄 Сборка многослойного icon.ico...');
const buf = await pngToIco(pngList);
fs.writeFileSync(iconIco, buf);
if (fs.existsSync(publicDir)) {
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), buf);
}
console.log('✅ icon.ico успешно создан (256, 128, 64, 48, 32, 16px)!');

fs.rmSync(tempSizesDir, { recursive: true, force: true });
console.log('🎉 Готово!');
