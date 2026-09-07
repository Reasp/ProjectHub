import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, FEATURES } from '../config.mjs';
import { collectMarkdownFiles, computeDocsHash } from './docs-hash.mjs';
import { CHUNKER_VERSION } from './chunk.mjs';

// Проверка актуальности векторного индекса (.rag-index/) относительно документации
// (backlog/docs, backlog/decisions). Сравнивается хэш содержимого всех .md-файлов и версия
// чанкера с тем, что записано в meta.json при последней сборке индекса.
//
//   node scripts/rag/check-index.mjs          # устарел → exit 1 (для lint:docs / pre-commit)
//   node scripts/rag/check-index.mjs --warn   # устарел → только предупреждение (для build)

const warnOnly = process.argv.includes('--warn');
const INDEX_DIR = path.join(PROJECT_ROOT, '.rag-index');
const META_PATH = path.join(INDEX_DIR, 'meta.json');

function fail(message) {
  const hint = 'Пересобери индекс: npm run index-docs (и закоммить .rag-index/).';
  if (warnOnly) {
    console.warn(`⚠️  RAG-индекс: ${message} ${hint}`);
    process.exit(0);
  }
  console.error(`✖ RAG-индекс: ${message}\n  ${hint}`);
  process.exit(1);
}

if (!FEATURES.docsRag) {
  console.log('RAG-индекс: features.docsRag выключен, проверка пропущена.');
  process.exit(0);
}

const files = collectMarkdownFiles(PROJECT_ROOT);
if (files.length === 0) {
  console.log('RAG-индекс: документации нет, проверять нечего.');
  process.exit(0);
}

if (!fs.existsSync(META_PATH)) {
  fail(`индекс не найден (${path.relative(PROJECT_ROOT, META_PATH)}), а документов — ${files.length}.`);
}

const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));

if (!meta.docsHash) {
  fail('meta.json старого формата без docsHash.');
}
if ((meta.chunkerVersion ?? 1) !== CHUNKER_VERSION) {
  fail(`индекс собран чанкером v${meta.chunkerVersion ?? 1}, текущий — v${CHUNKER_VERSION}.`);
}

const actual = computeDocsHash(PROJECT_ROOT, files);
if (actual !== meta.docsHash) {
  const indexed = new Set(meta.files ?? []);
  const added = files.filter((f) => !indexed.has(f));
  const removed = [...indexed].filter((f) => !files.includes(f));
  const details = [
    added.length ? `новые: ${added.join(', ')}` : '',
    removed.length ? `удалённые: ${removed.join(', ')}` : '',
    !added.length && !removed.length ? 'изменилось содержимое документов' : '',
  ]
    .filter(Boolean)
    .join('; ');
  fail(`устарел (${details}).`);
}

console.log(`✓ RAG-индекс актуален: ${files.length} файлов, ${meta.chunks} чанков, модель ${meta.model}.`);
