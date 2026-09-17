/**
 * Пробная загрузка импортированного голоса в отдельном процессе Electron (TASK-69, decision-34).
 *
 * Исход (сообщение, код выхода, таймаут) разбирает чистый модуль `ttsVoiceProbeOutcome`.
 */
import { existsSync } from 'node:fs';
import { utilityProcess } from 'electron';
import { getWorkerScriptCandidates } from './appPaths';
import type { InstalledVoice } from './ttsVoiceStore';
import {
  interpretVoiceProbe,
  isVoiceProbeMessage,
  type VoiceProbeMessage,
  type VoiceProbeResult
} from './ttsVoiceProbeOutcome';

/** Загрузка medium-голоса занимает около секунды; запас — на холодный диск и медленный CPU. */
const PROBE_TIMEOUT_MS = 60_000;

function resolveProbeScript(): string | null {
  for (const candidate of getWorkerScriptCandidates('ttsProbe.mjs')) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function probeVoiceInSeparateProcess(voice: InstalledVoice, timeoutMs = PROBE_TIMEOUT_MS): Promise<VoiceProbeResult> {
  const script = resolveProbeScript();
  if (!script) {
    return Promise.resolve({ ok: false, errorCode: 'probe_unavailable', detail: 'ttsProbe.mjs not found next to the app bundle' });
  }

  return new Promise<VoiceProbeResult>((resolve) => {
    let message: VoiceProbeMessage | null = null;
    let settled = false;
    const startedAt = Date.now();

    let child: Electron.UtilityProcess;
    try {
      child = utilityProcess.fork(script, [], { serviceName: 'ProjectHub TTS voice probe', stdio: 'ignore' });
    } catch (err) {
      resolve({ ok: false, errorCode: 'probe_unavailable', detail: err instanceof Error ? err.message : String(err) });
      return;
    }

    const settle = (exitCode: number | null, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = interpretVoiceProbe({ message, exitCode, timedOut });
      if (result.ok) {
        console.log(`[TtsVoiceProbe] ${voice.id}: ok in ${Date.now() - startedAt}ms (load ${result.loadTimeMs}ms, ${result.sampleRate} Hz)`);
      } else {
        console.warn(`[TtsVoiceProbe] ${voice.id}: ${result.errorCode} — ${result.detail}`);
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      settle(null, true);
    }, timeoutMs);

    child.on('message', (data: unknown) => {
      if (isVoiceProbeMessage(data)) message = data;
    });
    child.on('exit', (code) => settle(code, false));

    child.postMessage({
      voice: {
        model: voice.modelPath,
        tokens: voice.tokensPath,
        dataDir: voice.dataDir,
        noiseScale: voice.noiseScale,
        noiseScaleW: voice.noiseScaleW,
        lengthScale: voice.lengthScale
      },
      text: voice.language === 'ru' ? 'Проверка голоса.' : 'Voice check.'
    });
  });
}
