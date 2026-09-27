#!/usr/bin/env node
/**
 * Самопроверка ProjectHub: скриншот главного окна и сравнение с базой (TASK-78, decision-55 п. 8).
 *
 *   npm run selfcheck:ui                       # release/win-unpacked/ProjectHub.exe
 *   npm run selfcheck:ui -- --dev              # electron.exe поверх `npx vite build` (worktree без exe)
 *   npm run selfcheck:ui -- --update-baseline  # принять текущий кадр как базу (только человек)
 *
 * Изоляция от запущенного ProjectHub пользователя: свой временный --user-data-dir (нет общих
 * настроек, автоматизаций, Telegram, Remote Control), ответ `projects:list` подменяется пустым
 * списком — кадр не зависит от реестра проектов и не трогает его. ELECTRON_RUN_AS_NODE из
 * окружения агента убирается, иначе Electron запускается как node и молча выходит.
 *
 * Кадр, база и diff пишутся в PROJECTHUB_ARTIFACTS_DIR (запуск как проверка ui-smoke) или в
 * .visual-output/. Код выхода 0 — кадр совпал с базой (или база обновлена), 1 — нет.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
import { DEFAULT_MAX_DIFF_RATIO, DEFAULT_PIXEL_TOLERANCE, buildDiffBitmap, compareBitmaps, parseMask } from './imageDiff.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Изменчивые зоны главного окна 1280×800: шапка справа от сайдбара — живые индикаторы (Usage подгружается
 * асинхронно и сдвигает соседей, порт MCP, Remote, голос). Выключаются флагом --no-default-masks.
 */
const DEFAULT_MASKS = [{ x: 320, y: 0, width: 960, height: 56 }];

function parseArgs(argv) {
  const args = {
    exe: path.join(REPO, 'release', 'win-unpacked', process.platform === 'win32' ? 'ProjectHub.exe' : 'projecthub'),
    dev: false,
    baseline: path.join(REPO, 'tests', 'visual', 'baseline', `main-window.${process.platform}.png`),
    out: process.env.PROJECTHUB_ARTIFACTS_DIR || path.join(REPO, '.visual-output'),
    updateBaseline: false,
    width: 1280,
    height: 800,
    settleMs: 4000,
    pixelTolerance: DEFAULT_PIXEL_TOLERANCE,
    maxDiffRatio: DEFAULT_MAX_DIFF_RATIO,
    masks: [],
    defaultMasks: true
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--exe') args.exe = path.resolve(next());
    else if (a === '--dev') args.dev = true;
    else if (a === '--baseline') args.baseline = path.resolve(next());
    else if (a === '--out') args.out = path.resolve(next());
    else if (a === '--update-baseline') args.updateBaseline = true;
    else if (a === '--width') args.width = Number(next());
    else if (a === '--height') args.height = Number(next());
    else if (a === '--settle-ms') args.settleMs = Number(next());
    else if (a === '--pixel-tolerance') args.pixelTolerance = Number(next());
    else if (a === '--max-diff-ratio') args.maxDiffRatio = Number(next());
    else if (a === '--no-default-masks') args.defaultMasks = false;
    else if (a === '--mask') {
      const m = parseMask(next());
      if (!m) throw new Error('--mask ожидает x,y,w,h');
      args.masks.push(m);
    } else throw new Error(`Неизвестный аргумент: ${a}`);
  }
  return args;
}

function launchOptions(args, userDataDir) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const common = { env, cwd: REPO, timeout: 60_000 };
  if (args.dev) {
    const electronBin = path.join(REPO, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
    if (!fs.existsSync(path.join(REPO, 'dist', 'index.html'))) throw new Error('Нет dist/index.html — сначала `npx vite build`.');
    return { ...common, executablePath: electronBin, args: [REPO, `--user-data-dir=${userDataDir}`] };
  }
  if (!fs.existsSync(args.exe)) throw new Error(`Нет ${args.exe} — соберите \`npm run pack:win\` или запустите с --dev.`);
  return { ...common, executablePath: args.exe, args: [`--user-data-dir=${userDataDir}`] };
}

/** PNG → bitmap BGRA через nativeImage запущенного приложения (без зависимостей для декодирования). */
async function decodePng(app, file) {
  const res = await app.evaluate(({ nativeImage }, p) => {
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    return { width, height, data: img.toBitmap().toString('base64') };
  }, file);
  if (!res) throw new Error(`Не удалось прочитать PNG: ${file}`);
  return { width: res.width, height: res.height, data: new Uint8Array(Buffer.from(res.data, 'base64')) };
}

async function encodePng(app, bitmap, file) {
  const b64 = await app.evaluate(
    ({ nativeImage }, { data, width, height }) => nativeImage.createFromBitmap(Buffer.from(data, 'base64'), { width, height }).toPNG().toString('base64'),
    { data: Buffer.from(bitmap.data).toString('base64'), width: bitmap.width, height: bitmap.height }
  );
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-selfcheck-'));
  const actualPath = path.join(args.out, 'main-window.png');
  const report = { mode: args.dev ? 'dev' : 'exe', baseline: path.relative(REPO, args.baseline), size: `${args.width}x${args.height}` };
  let app;
  try {
    app = await _electron.launch(launchOptions(args, userDataDir));
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Реестр проектов читается из настоящего HOME — в копии отвечаем пустым списком (кадр детерминирован).
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('projects:list');
      ipcMain.handle('projects:list', async () => []);
    });
    await app.evaluate(({ BrowserWindow }, { width, height }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isMaximized()) win.unmaximize();
      if (win.isFullScreen()) win.setFullScreen(false);
      win.setContentSize(width, height);
    }, { width: args.width, height: args.height });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(args.settleMs);

    // scale: 'css' — размер кадра не зависит от масштаба экрана Windows.
    await page.screenshot({ path: actualPath, scale: 'css', animations: 'disabled', caret: 'hide' });
    console.log(`Кадр: ${actualPath}`);

    if (args.updateBaseline) {
      fs.mkdirSync(path.dirname(args.baseline), { recursive: true });
      fs.copyFileSync(actualPath, args.baseline);
      console.log(`База обновлена: ${args.baseline}`);
      fs.writeFileSync(path.join(args.out, 'selfcheck.json'), JSON.stringify({ ...report, updated: true }, null, 2));
      return 0;
    }
    if (!fs.existsSync(args.baseline)) {
      console.error(`Нет базы ${args.baseline}. Проверьте кадр и примите его: npm run selfcheck:ui -- --update-baseline`);
      fs.writeFileSync(path.join(args.out, 'selfcheck.json'), JSON.stringify({ ...report, passed: false, reason: 'нет базы' }, null, 2));
      return 1;
    }

    fs.copyFileSync(args.baseline, path.join(args.out, 'baseline.png'));
    const [base, actual] = [await decodePng(app, args.baseline), await decodePng(app, actualPath)];
    const masks = [...(args.defaultMasks ? DEFAULT_MASKS : []), ...args.masks];
    const result = compareBitmaps(base, actual, { pixelTolerance: args.pixelTolerance, maxDiffRatio: args.maxDiffRatio, masks });
    if (result.diffMask && result.diffPixels > 0) {
      await encodePng(app, { width: base.width, height: base.height, data: buildDiffBitmap(base, result.diffMask, 'bgra') }, path.join(args.out, 'diff.png'));
    }
    const summary = {
      ...report,
      passed: result.passed,
      diffPixels: result.diffPixels,
      comparedPixels: result.comparedPixels,
      ratio: Number(result.ratio.toFixed(5)),
      pixelTolerance: args.pixelTolerance,
      maxDiffRatio: args.maxDiffRatio,
      masks,
      ...(result.reason ? { reason: result.reason } : {})
    };
    fs.writeFileSync(path.join(args.out, 'selfcheck.json'), JSON.stringify(summary, null, 2));
    console.log(
      result.passed
        ? `✅ Совпадает с базой: отличается ${(result.ratio * 100).toFixed(2)} % пикселей (допуск ${(args.maxDiffRatio * 100).toFixed(2)} %).`
        : `❌ Не совпадает с базой: ${result.reason}. См. ${path.join(args.out, 'diff.png')}`
    );
    return result.passed ? 0 : 1;
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`Самопроверка не выполнена: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
);
