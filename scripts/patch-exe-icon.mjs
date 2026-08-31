import fs from 'node:fs';
import path from 'node:path';
import * as ResEdit from 'resedit';

const exePath = 'F:/ProjectHub/release/win-unpacked/ProjectHub.exe';
const icoPath = 'F:/ProjectHub/build/icon.ico';

if (!fs.existsSync(exePath)) {
  console.log('⚠️ ProjectHub.exe не найден для патчинга иконки.');
  process.exit(0);
}

if (!fs.existsSync(icoPath)) {
  console.error('❌ build/icon.ico не найден.');
  process.exit(1);
}

try {
  const exeBuf = fs.readFileSync(exePath);
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
  fs.writeFileSync(exePath, newBuf);
  console.log('✅ Иконка Neon Neural Core успешно вшита напрямую в PE-ресурсы ProjectHub.exe!');
} catch (err) {
  console.error('❌ Ошибка при вшивании иконки в PE-ресурсы:', err);
  process.exit(1);
}
