import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { PROJECT_ROOT } from './config.mjs';

// Документация (полный набор проверок: frontmatter, картинки, таблицы).
const DOC_ROOTS = ['backlog/docs', 'backlog/decisions'];
// Задачи и milestones: проверяется только frontmatter (id/title и типы значений, правило 16).
const FRONTMATTER_ONLY_ROOTS = ['backlog/tasks', 'backlog/milestones'];
// Проектные роли агентов (decision-9, TASK-60): frontmatter-only, свой набор обязательных полей.
const ROLE_ROOTS = [{ path: '.projecthub/roles', requiredFields: ['slug', 'name'] }];
const ROOT = PROJECT_ROOT;

let hasErrors = false;
let totalFilesChecked = 0;
let totalImagesChecked = 0;
let totalFrontmatterFieldsChecked = 0;

/**
 * Правило 16: YAML превращает незакавыченные значения вида `2026-09-03` в объекты Date.
 * Приложение отдаёт frontmatter в рендерер как есть, и React падает на Date как child (error #31).
 * Обходим данные рекурсивно (включая списки вроде tags/labels) и требуем строку в кавычках.
 */
function collectTypedValueErrors(value, keyPath, errors) {
  if (value instanceof Date) {
    const iso = isNaN(value.getTime()) ? 'invalid date' : value.toISOString().slice(0, 10);
    errors.push(
      `Frontmatter, поле "${keyPath}": незакавыченная дата (YAML распарсил как Date → ${iso}). ` +
        `Запишите строкой в кавычках: "${iso}" (правило 16)`
    );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectTypedValueErrors(item, `${keyPath}[${i}]`, errors));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectTypedValueErrors(v, keyPath ? `${keyPath}.${k}` : k, errors);
    return;
  }
  totalFrontmatterFieldsChecked++;
}

function validateMarkdownFile(relPath, { frontmatterOnly = false, requiredFields = ['id', 'title'] } = {}) {
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
      for (const field of requiredFields) {
        if (!frontmatter.includes(`${field}:`)) errors.push(`Отсутствует поле "${field}" во frontmatter`);
      }

      // 1b. Типы значений: тем же парсером, что и приложение (gray-matter), чтобы совпадало 1:1.
      try {
        const { data } = matter(content);
        collectTypedValueErrors(data, '', errors);
      } catch (e) {
        errors.push(`Frontmatter не парсится как YAML: ${e.message}`);
      }
    }
  }

  if (frontmatterOnly) {
    reportFileResult(relPath, errors, warnings);
    return;
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

  reportFileResult(relPath, errors, warnings);
}

function reportFileResult(relPath, errors, warnings) {
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

function walkMarkdown(root, options) {
  const absRoot = path.join(ROOT, root);
  if (!fs.existsSync(absRoot)) return;

  const entries = fs.readdirSync(absRoot, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const full = path.join(entry.parentPath ?? entry.path, entry.name);
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      validateMarkdownFile(rel, options);
    }
  }
}

for (const docRoot of DOC_ROOTS) walkMarkdown(docRoot, {});
for (const fmRoot of FRONTMATTER_ONLY_ROOTS) walkMarkdown(fmRoot, { frontmatterOnly: true });
for (const roleRoot of ROLE_ROOTS) walkMarkdown(roleRoot.path, { frontmatterOnly: true, requiredFields: roleRoot.requiredFields });

console.log(
  `\n📊 Проверено файлов: ${totalFilesChecked}, полей frontmatter: ${totalFrontmatterFieldsChecked}, изображений: ${totalImagesChecked}`
);

if (hasErrors) {
  console.error('\n🚨 Валидация документации завершилась с ошибками. Исправьте форматирование перед коммитом!');
  process.exit(1);
} else {
  console.log('✨ Вся документация, frontmatter и изображения полностью соответствуют стандартам!\n');
  process.exit(0);
}
