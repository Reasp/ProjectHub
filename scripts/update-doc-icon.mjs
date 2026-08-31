import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const buildDir = 'F:/ProjectHub/build';
const docPath = 'F:/ProjectHub/backlog/docs/doc-1 - App-Icon-Concepts.md';
const srcJpg = 'C:/Users/Professional/.gemini/antigravity-ide/brain/02766efe-5b4d-480b-b8cb-b10b62abde67/projecthub_perfect_icon_1788157030691.jpg';

const sizesDir = path.join(buildDir, 'sizes');
if (!fs.existsSync(sizesDir)) {
  fs.mkdirSync(sizesDir, { recursive: true });
}

// 1. Генерируем PNG всех размеров с кропом и контрастом
const psScriptPath = path.join(buildDir, 'export-sizes.ps1');
const psScriptContent = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile('${srcJpg.replace(/\\/g, '/')}')

[int]$cropSize = 580
[int]$cropX = 222
[int]$cropY = 180

$cropRect = New-Object System.Drawing.Rectangle $cropX, $cropY, $cropSize, $cropSize
$croppedBmp = New-Object System.Drawing.Bitmap $cropSize, $cropSize
$cropG = [System.Drawing.Graphics]::FromImage($croppedBmp)
$cropG.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$cropG.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$cropG.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$cropG.DrawImage($src, 0, 0, $cropRect, [System.Drawing.GraphicsUnit]::Pixel)
$cropG.Dispose()

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
    
    $outPath = "${sizesDir.replace(/\\/g, '/')}/icon-$s.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

$croppedBmp.Dispose()
$src.Dispose()
`;

fs.writeFileSync(psScriptPath, psScriptContent, 'utf-8');
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`, { stdio: 'inherit' });
fs.unlinkSync(psScriptPath);

// Читаем base64 для каждого размера
const b64_256 = fs.readFileSync(path.join(sizesDir, 'icon-256.png')).toString('base64');
const b64_128 = fs.readFileSync(path.join(sizesDir, 'icon-128.png')).toString('base64');
const b64_64 = fs.readFileSync(path.join(sizesDir, 'icon-64.png')).toString('base64');
const b64_48 = fs.readFileSync(path.join(sizesDir, 'icon-48.png')).toString('base64');
const b64_32 = fs.readFileSync(path.join(sizesDir, 'icon-32.png')).toString('base64');
const b64_16 = fs.readFileSync(path.join(sizesDir, 'icon-16.png')).toString('base64');

// Читаем doc-1
let docContent = fs.readFileSync(docPath, 'utf-8');

const concept11Section = `
---

### Концепт #11: Neon Cyber Nexus (Финальная официальная версия без рамок и текста)
![#11 Neon Cyber Nexus](data:image/png;base64,${b64_256})

- **Метафора**: Полноразмерный 3D изометрический кибер-куб со схемотехникой, серверными кластерами и неоновыми узлами циан/маджента/индиго.
- **Особенности и оптимизация**:
  - **Без надписей и лишнего шума**: максимальная чистота символа.
  - **Без рамок и внешних бордеров**: куб плотно заполняет ~90% площади кадра без пустых отступов.
  - **Повышенная контрастность и четкость**: отличная читаемость и узнаваемость в любых масштабах операционной системы.
- **Статус**: **Принято в качестве официальной иконки приложения ProjectHub**.

---

## 2. Финальная иконка во всех стандартных размерах Windows / macOS

Ниже представлена витрина утвержденной иконки во всех размерах из многослойного файла \`build/icon.ico\`:

| Размер | Пиксели | Отображение (Реальный масштаб) | Назначение в ОС |
|:---:|:---:|:---:|:---|
| **256 px** | 256×256 | <img src="data:image/png;base64,${b64_256}" width="256" height="256" alt="256px" /> | Крупный предпросмотр, магазин приложений, инсталлятор |
| **128 px** | 128×128 | <img src="data:image/png;base64,${b64_128}" width="128" height="128" alt="128px" /> | Свойства файла, диалоговые окна Windows |
| **64 px** | 64×64 | <img src="data:image/png;base64,${b64_64}" width="64" height="64" alt="64px" /> | Панель задач Windows (крупный режим), Launchpad macOS |
| **48 px** | 48×48 | <img src="data:image/png;base64,${b64_48}" width="48" height="48" alt="48px" /> | Значки Рабочего стола Windows (стандартный вид) |
| **32 px** | 32×32 | <img src="data:image/png;base64,${b64_32}" width="32" height="32" alt="32px" /> | Заголовок окна приложения, проводник Windows, Alt+Tab |
| **16 px** | 16×16 | <img src="data:image/png;base64,${b64_16}" width="16" height="16" alt="16px" /> | Системный трей Windows, Favicon в браузере, адресная строка |
`;

// Вставляем концепт 11 перед секцией "## 3. Сводная сравнительная плитка" или добавляем в конец
if (docContent.includes('## 3. Сводная сравнительная плитка')) {
  docContent = docContent.replace('## 3. Сводная сравнительная плитка', `${concept11Section}\n\n## 3. Сводная сравнительная плитка`);
} else {
  docContent += `\n\n${concept11Section}`;
}

fs.writeFileSync(docPath, docContent, 'utf-8');
console.log('✅ doc-1 - App-Icon-Concepts.md успешно обновлен с 11-м концептом и всеми размерами!');
