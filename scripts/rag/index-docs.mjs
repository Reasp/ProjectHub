import fs from 'node:fs';
import path from 'node:path';
import { connect } from '@lancedb/lancedb';
import { embedPassages, resolveModel } from './embed.mjs';
import { chunkMarkdown, CHUNKER_VERSION } from './chunk.mjs';
import { collectMarkdownFiles, computeDocsHash, DOC_ROOTS } from './docs-hash.mjs';
import { PROJECT_ROOT, requireFeature } from '../config.mjs';

requireFeature('docsRag');

const ROOT = PROJECT_ROOT;
const INDEX_DIR = path.join(ROOT, '.rag-index');
const TABLE_NAME = 'docs';

async function main() {
  const files = collectMarkdownFiles(ROOT);
  if (files.length === 0) {
    console.log(`Нет .md файлов в: ${DOC_ROOTS.join(', ')}. Индекс не создан.`);
    return;
  }

  const model = resolveModel();

  const rows = [];
  const embedTexts = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
    const chunks = chunkMarkdown(text, { title: path.basename(file, '.md') });
    chunks.forEach((chunk, i) => {
      rows.push({ file, chunk_index: i, heading: chunk.heading, text: chunk.text });
      embedTexts.push(chunk.embedText);
    });
  }

  console.log(`Найдено файлов: ${files.length}, чанков: ${rows.length}. Строим эмбеддинги (модель ${model.id})...`);

  const BATCH = 16;
  for (let i = 0; i < rows.length; i += BATCH) {
    const vectors = await embedPassages(embedTexts.slice(i, i + BATCH), model);
    vectors.forEach((vector, j) => {
      rows[i + j].vector = vector;
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

  // meta.json читают: rag-server/search-cli (модель и префиксы запроса), check-index
  // (docsHash, chunkerVersion), ProjectHub (projectScanner — статус RAG в карточке проекта,
  // ragSearch — модель для кодирования запроса).
  fs.writeFileSync(
    path.join(INDEX_DIR, 'meta.json'),
    JSON.stringify(
      {
        model: model.id,
        queryPrefix: model.queryPrefix,
        passagePrefix: model.passagePrefix,
        chunkerVersion: CHUNKER_VERSION,
        docsHash: computeDocsHash(ROOT, files),
        files,
        chunks: rows.length,
        builtAt: new Date().toISOString(),
      },
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
