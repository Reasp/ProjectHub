/** Типы чистой части установки сайдкара Qwen3-TTS — для main-процесса и unit-тестов. */

export const APP_DATA_NAME: string;
export const DEFAULT_HF_ENDPOINT: string;
export const MODEL_KINDS: readonly string[];

export interface QwenLayout {
  home: string;
  modelsDir: string;
  venvDir: string;
  venvPython: string;
  installManifest: string;
  requirementsCopy: string;
  sidecarCopy: string;
}

export interface QwenManifestFile {
  path: string;
  size: number;
  sha256: string;
}

export interface QwenManifestModel {
  repo: string;
  revision: string;
  dir: string;
  files: QwenManifestFile[];
}

export interface QwenManifest {
  version: number;
  runtime: {
    pythonMin: string;
    pythonMax: string;
    torchPackages: string[];
    torchIndexUrl: string;
    approxBytes: number;
  };
  models: Record<string, QwenManifestModel>;
  speakers: Array<{ id: string; label: string; native: string; gender: string }>;
}

export interface PythonVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface SetupOptions {
  json: boolean;
  force: boolean;
  help: boolean;
  skipModels: boolean;
  skipRuntime: boolean;
  userData: string;
  home: string;
  modelsDir: string;
  python: string;
  hfEndpoint: string;
  torchIndexUrl: string;
  models: string[];
}

export function defaultUserDataDir(platform?: string, env?: Record<string, string | undefined>, home?: string): string;
export function resolveLayout(userDataDir: string, overrides?: { home?: string; modelsDir?: string }): QwenLayout;
export function normalizeEndpoint(value: unknown): string;
export function buildFileUrl(endpoint: string, repo: string, revision: string, filePath: string): string;
export function resolveModelFile(modelDir: string, filePath: string): string;
export function parsePythonVersion(text: unknown): PythonVersion | null;
export function isSupportedPython(version: PythonVersion | null, min: string, max: string): boolean;
export function pythonCandidates(platform?: string, explicit?: string): Array<{ cmd: string; args: string[] }>;
export function planFileDownload(
  expectedSize: number,
  finalSize: number | undefined,
  partSize: number | undefined
): { action: 'done' | 'resume' | 'verify' | 'restart'; offset: number };
export function parseModelKinds(value: unknown): string[];
export function parseSetupArgs(argv: string[]): SetupOptions;
export function totalModelBytes(manifest: QwenManifest, kinds: string[]): number;
