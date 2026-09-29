/**
 * Раздел второго движка озвучки — Qwen3-TTS — во вкладке «Озвучка» настроек голоса
 * (TASK-104, decision-64): установка окружения и весов, пресет-голоса с инструкцией подачи,
 * создание голоса по описанию с пробой перед сохранением.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Dices,
  Download,
  Play,
  Power,
  Radio,
  RefreshCw,
  Save,
  Sparkles,
  Speech,
  Trash2
} from 'lucide-react';
import { voiceService, type VoiceConfig } from '../../services/voiceService';
import type { QwenInstallProgressInfo, QwenTtsStatusInfo, QwenVoiceListItem } from '../../types/electron';
import {
  canProbeDraft,
  canSaveDraft,
  describeQwenStatus,
  draftProbeKey,
  formatGigabytes,
  installPercent,
  MAX_QWEN_INSTRUCT_CHARS,
  MAX_QWEN_LABEL_CHARS,
  missingQwenModels,
  qwenDownloadBytes,
  randomQwenSeed,
  type QwenDraft
} from '../../services/qwenTtsView';
import { DEFAULT_QWEN_VOICE_ID } from '../../services/ttsEngineChain';
import { useTranslation } from '../../i18n/useTranslation';
import { useDialog } from '../../hooks/useDialog';

interface QwenTtsSettingsProps {
  voiceConfig: VoiceConfig;
  onConfigChange: (patch: Partial<VoiceConfig>) => void;
  /** Уведомление вверху вкладки — общее с разделом Piper. */
  notify: (message: string) => void;
}

const panel = 'p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3';
const field =
  'bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-indigo-500 disabled:opacity-50';
const input = `w-full ${field}`;

export const QwenTtsSettings: React.FC<QwenTtsSettingsProps> = ({ voiceConfig, onConfigChange, notify }) => {
  const { t, language } = useTranslation();
  const q = t.voice.settingsModal.qwen;
  const dialog = useDialog();
  const lang = language === 'ru' ? 'ru' : 'en';

  const [status, setStatus] = useState<QwenTtsStatusInfo | null>(null);
  const [voices, setVoices] = useState<QwenVoiceListItem[]>([]);
  const [progress, setProgress] = useState<QwenInstallProgressInfo | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [busyVoiceId, setBusyVoiceId] = useState<string | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<QwenDraft>({ label: '', instruct: '', seed: 1234 });
  const [probedKey, setProbedKey] = useState<string | null>(null);

  const translateError = useCallback(
    (code?: string | null, fallback?: string | null): string =>
      (code && t.voice.settingsModal.ttsErrors[code]) || fallback || code || '',
    [t]
  );

  const refreshStatus = useCallback(async () => {
    const next = await window.api?.getQwenTtsStatus?.().catch(() => null);
    if (next) setStatus(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!window.api?.getQwenTtsStatus) return;
    const [nextStatus, nextVoices] = await Promise.all([
      window.api.getQwenTtsStatus().catch(() => null),
      window.api.listQwenTtsVoices?.().catch(() => []) ?? []
    ]);
    setStatus(nextStatus);
    setVoices(nextVoices);
    if (nextStatus?.installProgress.state === 'running') {
      setProgress(nextStatus.installProgress);
      setIsInstalling(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = window.api?.onQwenTtsInstallProgress?.((next) => {
      setProgress(next);
      if (next.state === 'done' || next.state === 'error') {
        setIsInstalling(false);
        void refresh();
      } else {
        setIsInstalling(true);
      }
    });
    return () => unsubscribe?.();
  }, [refresh]);

  // Состояние движка меняется без событий: сайдкар грузит модель, падает, выгружается по простою,
  // его запускает реплика из другого окна. Пока раздел открыт, статус опрашивается — чаще, когда
  // идёт запуск или загрузка
  const transient = status?.status === 'starting' || status?.status === 'loading';
  useEffect(() => {
    const timer = setInterval(() => void refreshStatus(), transient ? 1000 : 3000);
    return () => clearInterval(timer);
  }, [transient, refreshStatus]);

  const view = describeQwenStatus(status);
  const install = status?.install ?? null;
  const missing = missingQwenModels(install);
  const needsInstall = !install?.runtimeReady || missing.length > 0;
  // Создать голос можно, когда есть обе модели: одна записывает эталон, другая им озвучивает
  const designReady = Boolean(install?.runtimeReady && install.models.design && install.models.base);
  const selectedVoiceId = voiceConfig.ttsQwenVoiceId || DEFAULT_QWEN_VOICE_ID;
  const presets = voices.filter((v) => v.kind === 'custom');
  const designed = voices.filter((v) => v.kind === 'design');
  const percent = installPercent(progress);
  const idleMinutes = Math.round((status?.idleUnloadMs ?? 600_000) / 60_000);

  const handleInstall = async () => {
    if (isInstalling || !window.api?.installQwenTts) return;
    const models = missing.length > 0 ? missing : (['custom', 'design', 'base'] as const).slice();
    const size = formatGigabytes(qwenDownloadBytes(install, [...models]));
    if (!(await dialog.confirm(q.installConfirm.replace('{size}', size)))) return;
    setIsInstalling(true);
    setProgress(null);
    try {
      const res = await window.api.installQwenTts({
        models: [...models],
        hfEndpoint: voiceConfig.ttsQwenHfEndpoint || ''
      });
      notify(res.ok ? q.installDone : `${q.installFailed}: ${translateError(res.errorCode, res.error)}`);
    } finally {
      setIsInstalling(false);
      await refresh();
    }
  };

  const handleSelectVoice = (voiceId: string) => {
    onConfigChange({ ttsQwenVoiceId: voiceId });
    // Модель выбранного голоса грузится заранее, чтобы первая реплика прозвучала им. Неудачу
    // показываем: иначе голос молча не звучал бы, а причина осталась бы только в строке статуса
    void window.api
      ?.warmupTts?.(voiceId)
      .then((state) => {
        if (state && state.status !== 'ready') notify(`${q.warmupFailed}: ${translateError(state.errorCode, state.error)}`);
      })
      .catch((err: unknown) => notify(`${q.warmupFailed}: ${err instanceof Error ? err.message : String(err)}`))
      .then(() => refresh());
    void refresh();
  };

  const handlePreview = async (voice: QwenVoiceListItem) => {
    if (busyVoiceId) return;
    setBusyVoiceId(voice.id);
    const pending = setTimeout(() => void refresh(), 600);
    try {
      const played = await voiceService.previewQwenVoice(t.voice.settingsModal.ttsPreviewText, lang, {
        voiceId: voice.id,
        instruct: voice.kind === 'custom' ? voiceConfig.ttsQwenInstruct : undefined
      });
      if (!played) notify(`${q.previewFailed}: ${translateError(voiceService.getLastTtsError())}`);
    } finally {
      clearTimeout(pending);
      setBusyVoiceId(null);
      await refresh();
    }
  };

  const handleProbe = async () => {
    if (isProbing || !canProbeDraft(draft)) return;
    setIsProbing(true);
    const pending = setTimeout(() => void refresh(), 600);
    const key = draftProbeKey(draft);
    try {
      // Текст пробы задаёт main: это текст эталонной записи, и проба станет эталоном голоса
      const played = await voiceService.previewQwenVoice(t.voice.settingsModal.ttsPreviewText, lang, {
        draft: { instruct: draft.instruct, seed: draft.seed }
      });
      if (played) setProbedKey(key);
      else notify(`${q.previewFailed}: ${translateError(voiceService.getLastTtsError())}`);
    } finally {
      clearTimeout(pending);
      setIsProbing(false);
      await refresh();
    }
  };

  const handleSave = async () => {
    if (isSaving || !canSaveDraft(draft, probedKey) || !window.api?.saveQwenTtsVoice) return;
    setIsSaving(true);
    try {
      const res = await window.api.saveQwenTtsVoice(draft);
      if (res.ok && res.voice) {
        notify(q.designSaved.replace('{name}', res.voice.label));
        onConfigChange({ ttsQwenVoiceId: res.voice.id });
        setDraft({ label: '', instruct: '', seed: randomQwenSeed() });
        setProbedKey(null);
      } else {
        notify(translateError(res.errorCode, res.error));
      }
    } finally {
      setIsSaving(false);
      await refresh();
    }
  };

  const handleDelete = async (voice: QwenVoiceListItem) => {
    if (!(await dialog.confirm(t.voice.settingsModal.ttsDeleteConfirm.replace('{name}', voice.label)))) return;
    await window.api?.deleteQwenTtsVoice?.(voice.id);
    if (selectedVoiceId === voice.id) onConfigChange({ ttsQwenVoiceId: DEFAULT_QWEN_VOICE_ID });
    await refresh();
  };

  const handleUnload = async () => {
    await voiceService.stopSpeaking();
    await window.api?.unloadQwenTts?.();
    await refresh();
  };

  const statusText =
    view.kind === 'ready'
      ? `${q.statusReady}: ${q.models[view.modelKind]}` +
        (view.vramGb !== null ? ` · ${q.vramUsed.replace('{size}', String(view.vramGb))}` : '') +
        (view.loadTimeSec !== null ? ` · ${view.loadTimeSec.toFixed(1)} s` : '')
      : view.kind === 'starting'
      ? q.statusStarting
      : view.kind === 'loading'
      ? q.statusLoading
      : view.kind === 'not-installed'
      ? q.statusNotInstalled
      : view.kind === 'unavailable'
      ? `${q.statusUnavailable}: ${translateError(view.errorCode, view.error)}`
      : view.kind === 'error'
      ? `${q.statusError}: ${translateError(view.errorCode, view.error)}`
      : q.statusUnloaded;

  const renderVoiceRow = (voice: QwenVoiceListItem) => {
    const isSelected = selectedVoiceId === voice.id;
    return (
      <div
        key={voice.id}
        className={`p-3 rounded-lg border transition flex items-center justify-between gap-3 ${
          isSelected ? 'bg-indigo-950/30 border-indigo-500/40' : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
        }`}
      >
        <label className="flex items-center gap-2.5 min-w-0 cursor-pointer">
          <input
            type="radio"
            name="tts-qwen-voice"
            checked={isSelected}
            disabled={!voice.installed}
            onChange={() => handleSelectVoice(voice.id)}
            className="accent-indigo-500 shrink-0 disabled:opacity-40"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white truncate">{voice.label}</span>
              {voice.native && (
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 font-mono uppercase">
                  {voice.native}
                </span>
              )}
            </span>
            <span className="block text-[10px] text-slate-500 truncate mt-0.5">
              {voice.kind === 'design'
                ? `${voice.instruct ?? ''} · seed ${voice.seed ?? ''}`
                : `${q.gender[voice.gender ?? ''] ?? ''} · ${q.native[voice.native ?? ''] ?? voice.native ?? ''}`}
            </span>
          </span>
        </label>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void handlePreview(voice)}
            disabled={!voice.installed || Boolean(busyVoiceId) || isInstalling}
            title={t.voice.settingsModal.ttsPreview}
            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition disabled:opacity-40"
          >
            <Play className={`w-3.5 h-3.5 ${busyVoiceId === voice.id ? 'animate-pulse text-emerald-400' : ''}`} />
          </button>
          {voice.kind === 'design' && (
            <button
              type="button"
              onClick={() => void handleDelete(voice)}
              title={t.voice.settingsModal.ttsDelete}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Состояние движка и установка */}
      <div className={panel} data-testid="qwen-tts-install">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-semibold text-white">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Cpu className="w-4 h-4" />
            </div>
            <span>{q.title}</span>
          </div>
          {view.kind === 'ready' && (
            <button
              type="button"
              onClick={() => void handleUnload()}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300 hover:text-white px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 transition"
            >
              <Power className="w-3.5 h-3.5" />
              <span>{q.unload}</span>
            </button>
          )}
        </div>

        <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center gap-2 text-[11px]">
          {view.kind === 'ready' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : view.kind === 'starting' || view.kind === 'loading' ? (
            <RefreshCw className="w-4 h-4 text-indigo-400 shrink-0 animate-spin" />
          ) : view.kind === 'error' || view.kind === 'unavailable' ? (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          ) : (
            <Radio className="w-4 h-4 text-slate-500 shrink-0" />
          )}
          <span className="text-slate-300 min-w-0 truncate" data-testid="qwen-tts-status">
            {statusText}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-[11px]">
          {(
            [
              [q.runtimeLabel, Boolean(install?.runtimeReady), install?.torch ? `torch ${install.torch}` : ''],
              [q.modelCustom, Boolean(install?.models.custom), ''],
              // голосам по описанию нужны обе модели: одна создаёт эталон, другая им озвучивает
              [q.modelDesign, Boolean(install?.models.design && install.models.base), '']
            ] as const
          ).map(([label, ready, detail]) => (
            <div key={label} className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
              <div className="text-slate-400 truncate">{label}</div>
              <div className={`font-semibold truncate ${ready ? 'text-emerald-400' : 'text-slate-500'}`}>
                {ready ? detail || q.partReady : q.partMissing}
              </div>
            </div>
          ))}
        </div>

        <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>
            {/* Объём загрузки важен до установки; после неё — только задержка и видеопамять */}
            {needsInstall ? `${q.sizeWarning} ` : ''}
            {q.delayWarning.replace('{minutes}', String(idleMinutes))} {q.vramWarning}
          </span>
        </div>

        {needsInstall && (
          <div className="space-y-2">
            <label className="block text-slate-300 font-semibold">{q.hfEndpointLabel}</label>
            <input
              type="text"
              value={voiceConfig.ttsQwenHfEndpoint ?? ''}
              placeholder="https://huggingface.co"
              disabled={isInstalling}
              onChange={(e) => onConfigChange({ ttsQwenHfEndpoint: e.target.value })}
              className={input}
            />
            <p className="text-[11px] text-slate-400 leading-relaxed">{q.hfEndpointHint}</p>
          </div>
        )}

        {isInstalling && (
          <div className="space-y-1.5" data-testid="qwen-tts-progress">
            <div className="flex items-center justify-between text-[11px] text-slate-300">
              <span className="truncate">
                {q.phases[progress?.phase ?? 'check'] ?? q.installing}
                {progress?.phase === 'models' && progress.file ? ` · ${progress.file}` : ''}
              </span>
              {percent !== null && <span className="font-mono text-indigo-400">{percent}%</span>}
            </div>
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full bg-indigo-500 transition-all ${percent === null ? 'animate-pulse w-full opacity-40' : ''}`}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </div>
            {progress?.lastLine && <div className="text-[10px] text-slate-500 font-mono truncate">{progress.lastLine}</div>}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400 leading-relaxed min-w-0">
            {q.installCommand} <span className="font-mono text-slate-300">npm run qwen-tts-setup</span>
          </p>
          {isInstalling ? (
            <button
              type="button"
              onClick={() => void window.api?.cancelQwenTtsInstall?.()}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition"
            >
              {q.cancelInstall}
            </button>
          ) : (
            needsInstall && (
              <button
                type="button"
                onClick={() => void handleInstall()}
                className="flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {q.install} · {formatGigabytes(qwenDownloadBytes(install, missing))} {q.gigabytes}
                </span>
              </button>
            )
          )}
        </div>
      </div>

      {/* Пресет-голоса и инструкция подачи */}
      <div className={panel} data-testid="qwen-tts-presets">
        <div className="flex items-center gap-2 font-semibold text-white">
          <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Speech className="w-4 h-4" />
          </div>
          <span>{q.presetsLabel}</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">{q.presetsHint}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{presets.map(renderVoiceRow)}</div>

        <div className="space-y-1.5 pt-1">
          <label className="block text-slate-300 font-semibold">{q.instructLabel}</label>
          <input
            type="text"
            value={voiceConfig.ttsQwenInstruct ?? ''}
            maxLength={MAX_QWEN_INSTRUCT_CHARS}
            placeholder={q.instructPlaceholder}
            onChange={(e) => onConfigChange({ ttsQwenInstruct: e.target.value })}
            className={input}
          />
          <p className="text-[11px] text-slate-400 leading-relaxed">{q.instructHint}</p>
        </div>
      </div>

      {/* Голоса по описанию */}
      <div className={panel} data-testid="qwen-tts-design">
        <div className="flex items-center gap-2 font-semibold text-white">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <span>{q.designedLabel}</span>
        </div>

        {designed.length === 0 ? (
          <div className="p-3 text-center text-slate-500 text-[11px] bg-slate-900/40 rounded-lg border border-slate-800">
            {q.designedEmpty}
          </div>
        ) : (
          <div className="space-y-2">{designed.map(renderVoiceRow)}</div>
        )}

        <div className="space-y-2 p-3 rounded-lg bg-slate-900/60 border border-slate-800">
          <div className="text-slate-300 font-semibold">{q.designTitle}</div>
          <input
            type="text"
            value={draft.label}
            maxLength={MAX_QWEN_LABEL_CHARS}
            placeholder={q.designNamePlaceholder}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            className={input}
          />
          <textarea
            value={draft.instruct}
            maxLength={MAX_QWEN_INSTRUCT_CHARS}
            rows={3}
            placeholder={q.designInstructPlaceholder}
            onChange={(e) => setDraft((d) => ({ ...d, instruct: e.target.value }))}
            className={`${input} resize-none`}
          />
          <div className="flex items-center gap-2">
            <label className="text-slate-400 shrink-0">{q.designSeed}</label>
            <input
              type="number"
              min={0}
              value={draft.seed}
              onChange={(e) => setDraft((d) => ({ ...d, seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
              className={`${field} w-28 font-mono`}
            />
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, seed: randomQwenSeed() }))}
              title={q.designSeedRandom}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition"
            >
              <Dices className="w-3.5 h-3.5" />
              <span>{q.designSeedRandom}</span>
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void handleProbe()}
              disabled={isProbing || isInstalling || !designReady || !canProbeDraft(draft)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-semibold transition"
            >
              <Play className={`w-3.5 h-3.5 ${isProbing ? 'animate-pulse' : ''}`} />
              <span>{q.designProbe}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || !canSaveDraft(draft, probedKey)}
              title={canSaveDraft(draft, probedKey) ? undefined : q.designProbeFirst}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-semibold transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{q.designSave}</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {q.designHint} {q.designLanguageHint}
          </p>
        </div>
      </div>
    </>
  );
};
