import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { connect } from '@lancedb/lancedb';
import matter from 'gray-matter';
import { pipeline, env } from '@huggingface/transformers';
import type { RagSearchOptions, RagSearchResult } from '../../src/types/electron';
import { projectRegistry } from './projectRegistry';

env.cacheDir = path.join(process.cwd(), '.rag-cache');

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
let embedderPromise: any = null;

function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32' });
  }
  return embedderPromise;
}

async function embed(texts: string[]): Promise<number[][]> {
  const embedder = await getEmbedder();
  const output = await embedder(texts, { pooling: 'mean', normalize: true });
  const dim = output.dims[output.dims.length - 1];
  const data = output.data;
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
  }
  return vectors;
}

async function scanProjectMarkdownFiles(projectPath: string): Promise<Array<{ filePath: string; relative: string; category: 'doc' | 'decision' | 'task' }>> {
  const results: Array<{ filePath: string; relative: string; category: 'doc' | 'decision' | 'task' }> = [];

  const targets = [
    { dir: path.join(projectPath, 'backlog', 'docs'), category: 'doc' as const },
    { dir: path.join(projectPath, 'backlog', 'decisions'), category: 'decision' as const },
    { dir: path.join(projectPath, 'backlog', 'tasks'), category: 'task' as const }
  ];

  for (const { dir, category } of targets) {
    if (existsSync(dir)) {
      try {
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const fullPath = path.join(dir, file);
            results.push({
              filePath: fullPath,
              relative: path.relative(projectPath, fullPath),
              category
            });
          }
        }
      } catch (err) {
        console.error(`Failed to scan dir ${dir}:`, err);
      }
    }
  }

  // Also include root README.md if exists
  const readme = path.join(projectPath, 'README.md');
  if (existsSync(readme)) {
    results.push({
      filePath: readme,
      relative: 'README.md',
      category: 'doc'
    });
  }

  return results;
}

export async function searchProjectDocs(options: RagSearchOptions): Promise<RagSearchResult[]> {
  const query = options.query?.trim();
  if (!query) return [];

  const mode = options.mode || 'all';
  const limit = options.limit || 15;
  const isGlobal = options.global ?? false;

  let targetProjects: Array<{ name: string; path: string }> = [];

  if (isGlobal || !options.projectPath) {
    const all = await projectRegistry.getProjects();
    targetProjects = all.map((p) => ({ name: path.basename(p.path), path: p.path }));
  } else {
    const pName = path.basename(options.projectPath);
    targetProjects = [{ name: pName, path: options.projectPath }];
  }


  const searchResults: RagSearchResult[] = [];

  for (const proj of targetProjects) {
    const projPath = proj.path;

    // 1. Semantic Vector RAG search (if mode is 'vector' or 'all')
    if (mode === 'vector' || mode === 'all') {
      const indexDir = path.join(projPath, '.rag-index');
      if (existsSync(indexDir)) {
        try {
          const db = await connect(indexDir);
          const tableNames = await db.tableNames();
          if (tableNames.includes('docs')) {
            const table = await db.openTable('docs');
            const [queryVector] = await embed([query]);
            const vectorResults = await table.search(queryVector).limit(limit).toArray();

            for (const r of vectorResults) {
              const distance = typeof r._distance === 'number' ? r._distance : 0.5;
              const similarityScore = Math.max(0, Math.min(1, 1 - distance / 1.5));

              const rel = r.file || '';
              let cat: 'doc' | 'decision' | 'task' = 'doc';
              if (rel.includes('decisions')) cat = 'decision';
              else if (rel.includes('tasks')) cat = 'task';

              searchResults.push({
                projectName: proj.name,
                projectPath: projPath,
                filePath: path.join(projPath, rel),
                fileRelative: rel,
                heading: r.heading || undefined,
                snippet: r.text || '',
                score: Math.round(similarityScore * 100) / 100,
                type: 'vector',
                category: cat
              });
            }
          }
        } catch (e) {
          console.error(`Vector search error for ${projPath}:`, e);
        }
      }
    }

    // 2. Full-text / Keyword search (if mode is 'text' or 'all')
    if (mode === 'text' || mode === 'all') {
      try {
        const mdFiles = await scanProjectMarkdownFiles(projPath);
        const lowerQuery = query.toLowerCase();

        for (const f of mdFiles) {
          const content = await fs.readFile(f.filePath, 'utf-8');
          const parsed = matter(content);
          const title = parsed.data?.title || path.basename(f.filePath, '.md');
          const body = parsed.content;

          const titleMatch = title.toLowerCase().includes(lowerQuery);
          const bodyIndex = body.toLowerCase().indexOf(lowerQuery);

          if (titleMatch || bodyIndex !== -1) {
            let snippet = '';
            if (bodyIndex !== -1) {
              const start = Math.max(0, bodyIndex - 80);
              const end = Math.min(body.length, bodyIndex + lowerQuery.length + 120);
              snippet = (start > 0 ? '...' : '') + body.slice(start, end).trim() + (end < body.length ? '...' : '');
            } else {
              snippet = body.slice(0, 160).trim() + (body.length > 160 ? '...' : '');
            }

            searchResults.push({
              projectName: proj.name,
              projectPath: projPath,
              filePath: f.filePath,
              fileRelative: f.relative,
              heading: title,
              snippet: snippet.replace(/\n+/g, ' '),
              score: titleMatch ? 0.95 : 0.75,
              type: 'text',
              category: f.category
            });
          }
        }
      } catch (err) {
        console.error(`Text search error for ${projPath}:`, err);
      }
    }
  }

  // Sort by score descending and limit results
  searchResults.sort((a, b) => b.score - a.score);
  return searchResults.slice(0, limit);
}

export async function getProjectRagStats(projectPath: string): Promise<{
  hasIndex: boolean;
  chunksCount: number;
  lastModified?: string;
}> {
  const indexDir = path.join(projectPath, '.rag-index');
  if (!existsSync(indexDir)) {
    return { hasIndex: false, chunksCount: 0 };
  }

  try {
    const db = await connect(indexDir);
    const tables = await db.tableNames();
    if (tables.includes('docs')) {
      const table = await db.openTable('docs');
      const count = await table.countRows();
      const stats = await fs.stat(indexDir);
      return {
        hasIndex: true,
        chunksCount: count,
        lastModified: stats.mtime.toISOString()
      };
    }
  } catch (e) {
    console.error(`Failed to get RAG stats for ${projectPath}:`, e);
  }

  return { hasIndex: false, chunksCount: 0 };
}
