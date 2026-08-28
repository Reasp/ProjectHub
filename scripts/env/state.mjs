import fs from 'node:fs';
import path from 'node:path';
import { INFRA_ROOT, PROJECT_ROOT } from '../config.mjs';

// Служебное состояние (pid'ы, логи) — implementation detail самой инфраструктуры,
// живёт рядом со скриптами (INFRA_ROOT), а не в целевом проекте. Дефолтная рабочая
// директория для запускаемых процессов (dev-сервер и т.п.) — PROJECT_ROOT.
export const ROOT = PROJECT_ROOT;
export const STATE_DIR = path.join(INFRA_ROOT, '.env-state');
export const LOG_DIR = path.join(STATE_DIR, 'logs');
export const REGISTRY_PATH = path.join(STATE_DIR, 'processes.json');

export function ensureDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function readRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export function writeRegistry(registry) {
  ensureDirs();
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function logPath(name) {
  return path.join(LOG_DIR, `${name}.log`);
}
