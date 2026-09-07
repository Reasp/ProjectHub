import { defineConfig } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import tailwindcss from '@tailwindcss/vite';
import { createRequire } from 'node:module';

// Все runtime-зависимости main-процесса остаются внешними (electron-builder кладёт node_modules в
// app.asar): нативные и тяжёлые пакеты (node-pty, @lancedb/lancedb, @huggingface/transformers,
// apache-arrow, zod, @modelcontextprotocol/sdk с его подпутями) не должны попадать в бандл —
// см. scripts/check-bundle.mjs (TASK-49, аудит 1.7).
const pkg = createRequire(import.meta.url)('./package.json') as { dependencies: Record<string, string> };
const runtimeDeps = Object.keys(pkg.dependencies);
const isExternalForMain = (id: string) =>
  id === 'electron' || runtimeDeps.some((dep) => id === dep || id.startsWith(`${dep}/`));

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  define: {
    'process.env': {}
  },
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        // Main-Process entry file of the Electron App.
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: isExternalForMain
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/preload.ts',
              formats: ['cjs'],
              fileName: () => 'preload.cjs'
            },
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      }
    ])
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src')
    }
  },
  server: {
    port: 5173
  }
});
