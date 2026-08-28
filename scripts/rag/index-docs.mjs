import fs from 'node:fs';
import path from 'node:path';
import { connect } from '@lancedb/lancedb';
import { embed, EMBEDDING_MODEL } from './embed.mjs';
import { chunkMarkdown } from './chunk.mjs';
import { PROJECT_ROOT, requireFeature } from '../config.mjs';

requireFeature('docsRag');

const ROOT = PROJECT_ROOT;
const INDEX_DIR = path.join(ROOT, '.rag-index');
const TABLE_NAME = 'docs';

// Где искать документацию для индекса. Код — сюда не входит, это отдельно от GitNexus.
// Намеренно без отдельной верхнеуровневой docs/ — вся документация живёт внутри backlog/
// (backlog/docs/, backlog/decisions/), рядом с задачами, а не параллельно им.
const DOC_ROOTS = ['backlog/docs', 'backlog/decisions'];

function collectMarkdownFiles() {
  const files = [];
  for (const root of DOC_ROOTS) {
    const abs = path.join(ROOT, root);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const full = path.join(entry.parentPath ?? entry.path, entry.name);
        files.push(path.relative(ROOT, full).split(path.sep).join('/'));
      }
    }
  }
  return files;
}

async function main() {
  const files = collectMarkdownFiles();
  if (files.length === 0) {
    console.log(`Нет .md файлов в: ${DOC_ROOTS.join(', ')}. Индекс не создан.`);
    return;
  }

  const rows = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
    const chunks = chunkMarkdown(text);
    chunks.forEach((chunk, i) => {
      rows.push({ file, chunk_index: i, heading: chunk.heading, text: chunk.text });
    });
  }

  console.log(`Найдено файлов: ${files.length}, чанков: ${rows.length}. Строим эмбеддинги (модель ${EMBEDDING_MODEL})...`);

  const BATCH = 16;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vectors = await embed(batch.map((r) => r.text));
    batch.forEach((row, j) => {
      row.vector = vectors[j];
    });
    console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }

  fs.mkdirSync(INDEX_DIR, { recursive: true });
  const db = await connect(INDEX_DIR);
  const existing = await db.tableNames();
  if (existing.includes(TABLE_NAME)) {
    await db.dropTable(TABLE_NAME);
  }
  await db.createTable(TABLE_NAME, rows);

  fs.writeFileSync(
    path.join(INDEX_DIR, 'meta.json'),
    JSON.stringify(
      { model: EMBEDDING_MODEL, files, chunks: rows.length, builtAt: new Date().toISOString() },
      null,
      2,
    ),
  );

  console.log(`Готово. Индекс: ${path.relative(ROOT, INDEX_DIR)} (${rows.length} чанков из ${files.length} файлов).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
