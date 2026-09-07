import path from 'node:path';
import { connect } from '@lancedb/lancedb';
import { embedQuery, readIndexModel } from './embed.mjs';
import { PROJECT_ROOT, requireFeature } from '../config.mjs';

requireFeature('docsRag');

const INDEX_DIR = path.join(PROJECT_ROOT, '.rag-index');
const TABLE_NAME = 'docs';

const query = process.argv.slice(2).join(' ');
if (!query) {
  console.error('Использование: npm run rag-search -- "текст запроса"');
  process.exit(1);
}

const db = await connect(INDEX_DIR);
const table = await db.openTable(TABLE_NAME);
const model = readIndexModel(INDEX_DIR);
if (!model) {
  console.error('Индекс не найден или без meta.json. Сначала выполните: npm run index-docs');
  process.exit(1);
}
const vector = await embedQuery(query, model);
const results = await table.search(vector).limit(5).toArray();

if (results.length === 0) {
  console.log('Ничего не найдено.');
} else {
  for (const r of results) {
    console.log(`\n[${r.file} — "${r.heading || '(без заголовка)'}", чанк ${r.chunk_index}, distance=${r._distance.toFixed(4)}]`);
    console.log(r.text);
  }
}
