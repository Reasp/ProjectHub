import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import type { DocItem, CreateDocParams } from '../../src/types/electron';

/**
 * YAML в frontmatter превращает незакавыченные значения вида `2026-09-03` в объекты Date,
 * а числа — в number. Рендерер ожидает строки (React падает на Date как child),
 * поэтому всё, что уходит в UI, приводим к строкам здесь.
 */
function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  return String(value);
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => toOptionalString(v)).filter((v): v is string => v !== undefined);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\sа-яё\-]/gi, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

export async function listProjectDocs(projectPath: string): Promise<DocItem[]> {
  const items: DocItem[] = [];
  const normalizedProject = path.normalize(projectPath);

  // 1. Scan backlog/decisions
  const decisionsDir = path.join(normalizedProject, 'backlog', 'decisions');
  if (existsSync(decisionsDir)) {
    try {
      const files = await fs.readdir(decisionsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const filePath = path.join(decisionsDir, file);
          const stat = await fs.stat(filePath);
          const raw = await fs.readFile(filePath, 'utf-8');
          const { data, content } = matter(raw);

          let title = data.title;
          if (!title) {
            const h1Match = content.match(/^#\s+(.+)$/m);
            title = h1Match ? h1Match[1].trim() : file.replace(/\.md$/, '');
          }

          items.push({
            id: `decision-${file}`,
            title,
            category: 'decision',
            filePath,
            fileRelative: path.relative(normalizedProject, filePath).replace(/\\/g, '/'),
            tags: toStringList(data.tags),
            status: toOptionalString(data.status) || 'Accepted',
            date: toOptionalString(data.date),
            updatedAt: stat.mtime.toISOString(),
            size: stat.size
          });
        }
      }
    } catch (e) {
      console.error('Error scanning decisions:', e);
    }
  }

  // 2. Scan backlog/docs (including subdirectories up to 2 levels)
  const docsDir = path.join(normalizedProject, 'backlog', 'docs');
  if (existsSync(docsDir)) {
    async function scanDocsDir(currentDir: string) {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await scanDocsDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const stat = await fs.stat(fullPath);
            const raw = await fs.readFile(fullPath, 'utf-8');
            const { data, content } = matter(raw);

            let title = data.title;
            if (!title) {
              const h1Match = content.match(/^#\s+(.+)$/m);
              title = h1Match ? h1Match[1].trim() : entry.name.replace(/\.md$/, '');
            }

            items.push({
              id: `doc-${entry.name}`,
              title,
              category: 'doc',
              filePath: fullPath,
              fileRelative: path.relative(normalizedProject, fullPath).replace(/\\/g, '/'),
              tags: toStringList(data.tags),
              status: toOptionalString(data.status),
              date: toOptionalString(data.date),
              updatedAt: stat.mtime.toISOString(),
              size: stat.size
            });
          }
        }
      } catch (e) {
        console.error('Error scanning docs:', e);
      }
    }

    await scanDocsDir(docsDir);
  }

  return items.sort((a, b) => a.title.localeCompare(b.title));
}

export async function readDocFile(filePath: string): Promise<string> {
  const normalized = path.normalize(filePath);
  if (!existsSync(normalized)) {
    throw new Error(`Файл не найден: ${normalized}`);
  }
  return await fs.readFile(normalized, 'utf-8');
}

export async function saveDocFile(filePath: string, content: string): Promise<boolean> {
  const normalized = path.normalize(filePath);
  const parentDir = path.dirname(normalized);
  if (!existsSync(parentDir)) {
    await fs.mkdir(parentDir, { recursive: true });
  }
  await fs.writeFile(normalized, content, 'utf-8');
  return true;
}

export async function createProjectDoc(
  projectPath: string,
  params: CreateDocParams
): Promise<DocItem> {
  const normalizedProject = path.normalize(projectPath);
  const type = params.type || 'doc';
  const cleanTitle = params.title.trim();
  const slug = slugify(cleanTitle);

  let targetDir: string;
  let filename: string;
  let initialContent = params.content;

  if (type === 'decision') {
    targetDir = path.join(normalizedProject, 'backlog', 'decisions');
    await fs.mkdir(targetDir, { recursive: true });

    // Find next index
    let nextNum = 1;
    try {
      const existingFiles = await fs.readdir(targetDir);
      for (const f of existingFiles) {
        const match = f.match(/^(\d{4})/);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n >= nextNum) nextNum = n + 1;
        }
      }
    } catch (e) {
      // ignore
    }

    const paddedNum = String(nextNum).padStart(4, '0');
    filename = `${paddedNum}-${slug}.md`;

    if (!initialContent) {
      const dateStr = new Date().toISOString().split('T')[0];
      const tagsYaml = params.tags && params.tags.length > 0 
        ? JSON.stringify(params.tags) 
        : JSON.stringify(['adr', 'decision', slug]);

      initialContent = `---
title: "${cleanTitle}"
tags: ${tagsYaml}
status: "${params.status || 'Accepted'}"
date: "${dateStr}"
---

# ${paddedNum}. ${cleanTitle}

## Контекст и проблематика
Опишите контекст проблемы, технические ограничения и требования, которые привели к необходимости принятия этого архитектурного решения.

## Рассматриваемые варианты
1. **Вариант 1**: Плюсы и минусы
2. **Вариант 2**: Плюсы и минусы

## Принятое решение
Опишите выбранный подход и обоснование выбора.

## Последствия
### Положительные
- 

### Отрицательные / Риски
- 
`;
    }
  } else {
    targetDir = path.join(normalizedProject, 'backlog', 'docs');
    await fs.mkdir(targetDir, { recursive: true });
    filename = `${slug}.md`;

    if (!initialContent) {
      const dateStr = new Date().toISOString().split('T')[0];
      const tagsYaml = params.tags && params.tags.length > 0 
        ? JSON.stringify(params.tags) 
        : JSON.stringify(['documentation', slug]);

      initialContent = `---
title: "${cleanTitle}"
tags: ${tagsYaml}
date: "${dateStr}"
---

# ${cleanTitle}

## Обзор
Краткое описание назначения и содержания данного документа.

## Основные разделы
### 1. Введение
Описание архитектуры или процесса.

### 2. Спецификация
Детальные спецификации, схемы или примеры использования.
`;
    }
  }

  const fullPath = path.join(targetDir, filename);
  await fs.writeFile(fullPath, initialContent, 'utf-8');

  const stat = await fs.stat(fullPath);
  return {
    id: `${type}-${filename}`,
    title: cleanTitle,
    category: type,
    filePath: fullPath,
    fileRelative: path.relative(normalizedProject, fullPath).replace(/\\/g, '/'),
    tags: params.tags || [],
    status: params.status || (type === 'decision' ? 'Accepted' : undefined),
    date: new Date().toISOString().split('T')[0],
    updatedAt: stat.mtime.toISOString(),
    size: stat.size
  };
}
