import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from './config.mjs';

const DOC_ROOTS = ['backlog/docs', 'backlog/decisions'];
const ROOT = PROJECT_ROOT;

let hasErrors = false;
let totalFilesChecked = 0;
let totalImagesChecked = 0;

function validateMarkdownFile(relPath) {
  const fullPath = path.join(ROOT, relPath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  totalFilesChecked++;

  const errors = [];
  const warnings = [];

  // 1. Проверка YAML Frontmatter
  if (!content.startsWith('---')) {
    errors.push('Отсутствует YAML Frontmatter в начале файла (должен начинаться с "---")');
  } else {
    const endMatch = content.indexOf('\n---', 3);
    if (endMatch === -1) {
      errors.push('YAML Frontmatter не закрыт (отсутствует закрывающий "---")');
    } else {
      const frontmatter = content.substring(3, endMatch);
      if (!frontmatter.includes('id:')) errors.push('Отсутствует поле "id" во frontmatter');
      if (!frontmatter.includes('title:')) errors.push('Отсутствует поле "title" во frontmatter');
    }
  }

  // 2. Проверка невалидных HTML-тегов img с разрывами строк внутри таблиц
  const lines = content.split('\n');
  let inTable = false;
  let rawImgMultiLine = false;

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      inTable = true;
      // Проверка на многострочные или сырые теги <img> в строке таблицы
      if (/<img\b[^>]*$/i.test(trimmed)) {
        errors.push(`Строка ${lineNum}: Незакрытый HTML-тег <img> в строке таблицы (разрыв строки ломает Markdown-таблицу)`);
      }
      if (/<img\b/i.test(trimmed) && !/!\[.*?\]\(.*?\)/.test(trimmed)) {
        warnings.push(`Строка ${lineNum}: Обнаружен сырой HTML-тег <img> в таблице. Рекомендуется стандартный синтаксис ![alt](src)`);
      }
    } else {
      inTable = false;
    }

    // 3. Проверка локальных путей к изображениям ![alt](path)
    const imgMatches = line.matchAll(/!\[(.*?)\]\((.*?)\)/g);
    for (const match of imgMatches) {
      totalImagesChecked++;
      const alt = match[1];
      const src = match[2];

      if (!src || !src.trim()) {
        errors.push(`Строка ${lineNum}: Пустой путь к изображению с описанием "${alt}"`);
      } else if (src.startsWith('data:image/')) {
        // Data URI валидация
        if (!src.includes(';base64,')) {
          errors.push(`Строка ${lineNum}: Некорректный data URI для изображения "${alt}"`);
        }
      } else if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('file://')) {
        // Относительный путь
        const resolvedPath = path.resolve(path.dirname(fullPath), src);
        if (!fs.existsSync(resolvedPath)) {
          errors.push(`Строка ${lineNum}: Локальный файл изображения не найден: "${src}" (ожидался по пути ${resolvedPath})`);
        }
      }
    }
  });

  if (errors.length > 0) {
    hasErrors = true;
    console.error(`\n❌ Ошибки в [${relPath}]:`);
    errors.forEach((err) => console.error(`   • ${err}`));
  }

  if (warnings.length > 0) {
    console.warn(`\n⚠️ Предупреждения в [${relPath}]:`);
    warnings.forEach((warn) => console.warn(`   • ${warn}`));
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log(`✅ [${relPath}] — формат корректен`);
  }
}

console.log('🔍 Запуск линтера и валидатора документации ProjectHub...\n');

for (const docRoot of DOC_ROOTS) {
  const absRoot = path.join(ROOT, docRoot);
  if (!fs.existsSync(absRoot)) continue;

  const entries = fs.readdirSync(absRoot, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const full = path.join(entry.parentPath ?? entry.path, entry.name);
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      validateMarkdownFile(rel);
    }
  }
}

console.log(`\n📊 Проверено файлов: ${totalFilesChecked}, проверено изображений: ${totalImagesChecked}`);

if (hasErrors) {
  console.error('\n🚨 Валидация документации завершилась с ошибками. Исправьте форматирование перед коммитом!');
  process.exit(1);
} else {
  console.log('✨ Вся документация, frontmatter и изображения полностью соответствуют стандартам!\n');
  process.exit(0);
}
