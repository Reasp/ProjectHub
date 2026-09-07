import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Где искать документацию для индекса. Код — сюда не входит, это отдельно от GitNexus.
// Намеренно без отдельной верхнеуровневой docs/ — вся документация живёт внутри backlog/
// (backlog/docs/, backlog/decisions/), рядом с задачами, а не параллельно им.
export const DOC_ROOTS = ['backlog/docs', 'backlog/decisions'];

export function collectMarkdownFiles(root) {
  const files = [];
  for (const docRoot of DOC_ROOTS) {
    const abs = path.join(root, docRoot);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const full = path.join(entry.parentPath ?? entry.path, entry.name);
        files.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  }
  return files.sort();
}

/**
 * Хэш содержимого всей документации: по нему check-index понимает, что индекс устарел.
 * Переводы строк нормализуются, чтобы git autocrlf на Windows не менял хэш относительно
 * машины, где индекс собирали.
 */
export function computeDocsHash(root, files = collectMarkdownFiles(root)) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, file), 'utf-8').replace(/\r\n/g, '\n'));
    hash.update('\0');
  }
  return hash.digest('hex');
}
