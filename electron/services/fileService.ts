import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

export interface FileTreeNode {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  size?: number;
  extension?: string;
  children?: FileTreeNode[];
}

const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-electron',
  'release',
  '.rag-index',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  '.idea',
  '.vscode'
]);

class FileService {
  private validateSafePath(projectRoot: string, relativePath: string): string {
    const normalizedRoot = path.resolve(projectRoot);
    const resolved = path.resolve(normalizedRoot, relativePath);
    if (!resolved.startsWith(normalizedRoot)) {
      throw new Error(`Access Denied: Path traversal detected outside project root (${relativePath})`);
    }
    return resolved;
  }

  async readTree(projectPath: string, subDir = '', maxDepth = 6, currentDepth = 0): Promise<FileTreeNode[]> {
    const rootPath = path.resolve(projectPath);
    const targetDir = path.resolve(rootPath, subDir);

    if (!targetDir.startsWith(rootPath) || !existsSync(targetDir)) {
      return [];
    }

    if (currentDepth >= maxDepth) {
      return [];
    }

    try {
      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      const nodes: FileTreeNode[] = [];

      for (const entry of entries) {
        if (IGNORED_NAMES.has(entry.name)) continue;

        const fullPath = path.join(targetDir, entry.name);
        const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          const children = await this.readTree(projectPath, relPath, maxDepth, currentDepth + 1);
          nodes.push({
            name: entry.name,
            path: fullPath,
            relativePath: relPath,
            isDirectory: true,
            children
          });
        } else if (entry.isFile()) {
          let size = 0;
          try {
            const stat = await fs.stat(fullPath);
            size = stat.size;
          } catch {}

          nodes.push({
            name: entry.name,
            path: fullPath,
            relativePath: relPath,
            isDirectory: false,
            size,
            extension: path.extname(entry.name).toLowerCase()
          });
        }
      }

      // Sort: directories first, then alphabetical
      nodes.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        }
        return a.isDirectory ? -1 : 1;
      });

      return nodes;
    } catch (err) {
      console.error(`Failed to read directory tree for ${targetDir}:`, err);
      return [];
    }
  }

  async readFileContent(projectPath: string, relativePath: string): Promise<string> {
    const safe = this.validateSafePath(projectPath, relativePath);
    if (!existsSync(safe)) {
      throw new Error(`File not found: ${relativePath}`);
    }
    return await fs.readFile(safe, 'utf-8');
  }

  async saveFileContent(projectPath: string, relativePath: string, content: string): Promise<boolean> {
    const safe = this.validateSafePath(projectPath, relativePath);
    const dir = path.dirname(safe);
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.writeFile(safe, content, 'utf-8');
    return true;
  }

  async createFileOrFolder(projectPath: string, relativePath: string, isDirectory: boolean): Promise<boolean> {
    const safe = this.validateSafePath(projectPath, relativePath);
    if (existsSync(safe)) {
      throw new Error(`Item already exists: ${relativePath}`);
    }

    if (isDirectory) {
      await fs.mkdir(safe, { recursive: true });
    } else {
      const dir = path.dirname(safe);
      if (!existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }
      await fs.writeFile(safe, '', 'utf-8');
    }
    return true;
  }

  async deleteFileOrFolder(projectPath: string, relativePath: string): Promise<boolean> {
    const safe = this.validateSafePath(projectPath, relativePath);
    if (!existsSync(safe)) return true;
    await fs.rm(safe, { recursive: true, force: true });
    return true;
  }
}

export const fileService = new FileService();
