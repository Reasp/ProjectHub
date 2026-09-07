#!/usr/bin/env node
/**
 * Проверка бандла main-процесса (TASK-49, аудит 1.7): тяжёлые и нативные зависимости должны
 * оставаться внешними (`import ... from '<pkg>'`), а не вбандливаться в dist-electron/main.js.
 *
 * Падает, если в main.js найден код из node_modules перечисленных пакетов или относительный
 * импорт чанка с их содержимым (например `./transformers.node-*.js`).
 */
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const mainJs = path.join(rootDir, 'dist-electron', 'main.js');
if (!fs.existsSync(mainJs)) {
  console.error(`❌ check-bundle: не найден ${path.relative(rootDir, mainJs)} — сначала npm run build`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const deps = Object.keys(pkg.dependencies ?? {});
const src = fs.readFileSync(mainJs, 'utf8');

// Все спецификаторы импортов в бандле.
const specifiers = new Set();
for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)) specifiers.add(m[1]);

const problems = [];

// 1. Следы кода пакетов из dependencies внутри бандла (rolldown/rollup оставляют пути node_modules в комментариях и ключах).
for (const dep of deps) {
  const marker = `node_modules/${dep}/`;
  if (src.includes(marker)) problems.push(`в main.js вбандлен код пакета ${dep} (найдено "${marker}")`);
}

// 2. Относительные чанки с тяжёлыми модулями (динамический import через code-splitting).
const heavyChunk = /^\.\/(transformers|onnxruntime|lancedb|arrow|node-pty|pty)[^"']*/i;
for (const s of specifiers) {
  if (heavyChunk.test(s)) problems.push(`main.js импортирует чанк ${s} — тяжёлая зависимость должна быть external`);
}

// 3. Нативные модули обязаны быть внешними импортами по имени пакета.
const mustBeExternal = ['node-pty', '@lancedb/lancedb', '@huggingface/transformers'];
const usedExternals = [...specifiers].filter((s) => deps.some((d) => s === d || s.startsWith(`${d}/`)));
for (const name of mustBeExternal) {
  const referenced = src.includes(name);
  const external = usedExternals.some((s) => s === name || s.startsWith(`${name}/`));
  if (referenced && !external) problems.push(`${name} упоминается в main.js, но не как внешний импорт`);
}

if (problems.length > 0) {
  console.error('❌ check-bundle: проблемы с dist-electron/main.js:');
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}

const sizeKb = Math.round(fs.statSync(mainJs).size / 1024);
console.log(`✅ check-bundle: main.js ${sizeKb} KB, внешние зависимости: ${usedExternals.sort().join(', ') || '—'}`);
