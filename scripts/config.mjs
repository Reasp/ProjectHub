import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// INFRA_ROOT — папка, где лежит сама инфраструктура (scripts/, infra-dev.md, package.json,
// infra.config.json). PROJECT_ROOT — корень проекта, который эта инфраструктура обслуживает:
// содержит backlog/ (включая backlog/docs/, backlog/decisions/), CLAUDE.md/GEMINI.md/AGENTS.md,
// .mcp.json, .rag-index/.
// Когда инфраструктура — сам корень проекта (обычный случай), INFRA_ROOT === PROJECT_ROOT
// (projectRoot: "." в конфиге, значение по умолчанию). Когда инфраструктуру подключили как
// подпапку в уже существующий проект — projectRoot указывает вверх, например "..".
export const INFRA_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(INFRA_ROOT, 'infra.config.json');

const DEFAULT_CONFIG = {
  projectRoot: '.',
  features: {
    docsRag: true,
    envTools: true,
    bootstrap: true,
    lightrag: false, // требует Python + Ollama — опциональная тяжёлая фича, по умолчанию выключена
  },
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return structuredClone(DEFAULT_CONFIG);
  }
  const onDisk = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  return {
    ...DEFAULT_CONFIG,
    ...onDisk,
    features: { ...DEFAULT_CONFIG.features, ...(onDisk.features ?? {}) },
  };
}

export const CONFIG = loadConfig();
export const PROJECT_ROOT = path.resolve(INFRA_ROOT, CONFIG.projectRoot);
export const FEATURES = CONFIG.features;
export const CONFIG_PATH_EXPORTED = CONFIG_PATH;

export function requireFeature(name) {
  if (!FEATURES[name]) {
    throw new Error(
      `Функция "${name}" выключена в infra.config.json (features.${name} = false). ` +
        `Включи её через scripts/setup.mjs, если она нужна.`,
    );
  }
}
