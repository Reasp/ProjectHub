/**
 * Загрузка и сохранение настроек автосудьи арены (decision-12, TASK-61).
 *
 * Источник истины — `.projecthub.json` проекта (секции `checks` и `arena`), читаемый через
 * `actionConfigService`. Чего в файле нет, то выводится из `package.json` проекта: список
 * проверок собирается из скриптов, веса и пороги берутся из дефолтов. Разбор и слияние вынесены
 * в чистую `resolveArenaConfig`, чтобы её можно было тестировать без файловой системы.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { actionConfigService, type ArenaSettings, type ProjectActionConfig } from './actionConfigService.js';
import {
  DEFAULT_MAX_CONCURRENT_CHECKS,
  defaultChecksFromProject,
  normalizeCheckDefinition,
  type DefaultChecksInput
} from './arenaChecks.js';
import { DEFAULT_SCORE_WEIGHTS, normalizeWeights } from './arenaScoring.js';
import type { ArenaConfig, CheckDefinition } from './arenaTypes.js';

/** Порог балла для авто-мерджа по умолчанию (высокий: авто-слияние должно быть редким). */
export const DEFAULT_AUTO_MERGE_MIN_SCORE = 85;

export const DEFAULT_REVIEWER_ROLE_SLUG = 'reviewer';

export interface ResolveArenaConfigInput {
  /** Секция `checks` из `.projecthub.json`; `undefined` — секции нет, берутся дефолты. */
  checks?: unknown;
  arena?: ArenaSettings;
  project: DefaultChecksInput;
}

/** Слияние настроек проекта с дефолтами. Чистая функция — покрыта unit-тестами. */
export function resolveArenaConfig(input: ResolveArenaConfigInput): ArenaConfig {
  const arena = input.arena ?? {};

  let checks: CheckDefinition[];
  if (Array.isArray(input.checks)) {
    // Пустой массив — осознанное «проверок нет», не повод подставлять дефолты.
    checks = input.checks
      .map((raw, i) => normalizeCheckDefinition(raw, i))
      .filter((c): c is CheckDefinition => c !== null);
  } else {
    checks = defaultChecksFromProject(input.project);
  }

  const minScoreRaw = arena.autoMerge?.minScore;
  const maxConcurrentRaw = arena.maxConcurrentChecks;

  return {
    checks,
    weights: normalizeWeights(arena.weights ?? DEFAULT_SCORE_WEIGHTS),
    autoMerge: {
      // Выключен по умолчанию (decision-12 п.4): включение — только явным `true`.
      enabled: arena.autoMerge?.enabled === true,
      minScore:
        typeof minScoreRaw === 'number' && Number.isFinite(minScoreRaw)
          ? Math.min(100, Math.max(0, minScoreRaw))
          : DEFAULT_AUTO_MERGE_MIN_SCORE
    },
    reviewer: {
      enabled: arena.reviewer?.enabled !== false,
      roleSlug: arena.reviewer?.roleSlug?.trim() || DEFAULT_REVIEWER_ROLE_SLUG,
      ...(arena.reviewer?.provider ? { provider: arena.reviewer.provider } : {}),
      ...(arena.reviewer?.model ? { model: arena.reviewer.model } : {})
    },
    maxConcurrentChecks:
      typeof maxConcurrentRaw === 'number' && Number.isFinite(maxConcurrentRaw) && maxConcurrentRaw >= 1
        ? Math.min(8, Math.trunc(maxConcurrentRaw))
        : DEFAULT_MAX_CONCURRENT_CHECKS
  };
}

/** Признаки стека проекта для дефолтных проверок: `package.json` scripts, Cargo, Python. */
export async function readProjectStack(projectPath: string): Promise<DefaultChecksInput> {
  const out: DefaultChecksInput = {
    packageManager: 'npm',
    hasCargoToml: existsSync(path.join(projectPath, 'Cargo.toml')),
    hasPyProject:
      existsSync(path.join(projectPath, 'pyproject.toml')) || existsSync(path.join(projectPath, 'requirements.txt'))
  };

  const pkgPath = path.join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const parsed = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      if (parsed?.scripts && typeof parsed.scripts === 'object') out.scripts = parsed.scripts;
      const pm = typeof parsed?.packageManager === 'string' ? parsed.packageManager : '';
      if (pm.startsWith('pnpm')) out.packageManager = 'pnpm';
      else if (pm.startsWith('yarn')) out.packageManager = 'yarn';
      else if (pm.startsWith('bun')) out.packageManager = 'bun';
    } catch (err) {
      console.warn(`[ArenaConfig] Не удалось прочитать ${pkgPath}:`, err);
    }
  } else if (existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
    out.packageManager = 'pnpm';
  }

  return out;
}

/** Полный конфиг судьи для проекта: `.projecthub.json` поверх дефолтов стека. */
export async function loadArenaConfig(projectPath: string): Promise<ArenaConfig> {
  const config = await actionConfigService.getConfig(projectPath);
  const project = await readProjectStack(projectPath);
  return resolveArenaConfig({ checks: config.checks, arena: config.arena, project });
}

/** Сохраняет только секции судьи, не трогая остальные действия проекта. */
export async function saveArenaConfig(
  projectPath: string,
  patch: { checks?: CheckDefinition[]; arena?: ArenaSettings }
): Promise<boolean> {
  const current: ProjectActionConfig = await actionConfigService.getConfig(projectPath);
  const next: ProjectActionConfig = {
    ...current,
    ...(patch.checks !== undefined ? { checks: patch.checks } : {}),
    ...(patch.arena !== undefined ? { arena: { ...current.arena, ...patch.arena } } : {})
  };
  return actionConfigService.saveConfig(projectPath, next);
}
