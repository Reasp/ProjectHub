import fs from 'node:fs';
import path from 'node:path';
import * as ResEdit from 'resedit';

const releaseDir = 'F:/ProjectHub/release';
const icoPath = 'F:/ProjectHub/build/icon.ico';

if (!fs.existsSync(icoPath)) {
  console.error('❌ build/icon.ico не найден.');
  process.exit(1);
}

const exeTargets = [];

const unpackedExe = path.join(releaseDir, 'win-unpacked', 'ProjectHub.exe');
if (fs.existsSync(unpackedExe)) {
  exeTargets.push(unpackedExe);
}

if (fs.existsSync(releaseDir)) {
  const files = fs.readdirSync(releaseDir);
  for (const file of files) {
    if (file.endsWith('.exe')) {
      exeTargets.push(path.join(releaseDir, file));
    }
  }
}

if (exeTargets.length === 0) {
  console.log('⚠️ Исполняемые файлы .exe не найдены в release для патчинга иконки.');
  process.exit(0);
}

for (const targetPath of exeTargets) {
  try {
    const exeBuf = fs.readFileSync(targetPath);
    const exe = ResEdit.NtExecutable.from(exeBuf);
    const res = ResEdit.NtExecutableResource.from(exe);
    const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));

    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      1,
      1033,
      iconFile.icons.map((i) => i.data)
    );

    res.outputResource(exe);
    const newBuf = Buffer.from(exe.generate());
    fs.writeFileSync(targetPath, newBuf);
    console.log(`✅ Иконка успешно вшита напрямую в PE-ресурсы: ${path.basename(targetPath)}`);
  } catch (err) {
    console.warn(`⚠️ Не удалось пропатчить иконку для ${targetPath} (возможно, файл упакован как SFX):`, err.message);
  }
}
