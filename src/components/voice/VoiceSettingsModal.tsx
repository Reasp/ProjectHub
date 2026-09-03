import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, Activity, Zap, ShieldCheck, Sparkles, X } from 'lucide-react';
import { voiceService, type VoiceConfig, type WhisperProvider } from '../../services/voiceService';

interface VoiceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VoiceSettingsModal: React.FC<VoiceSettingsModalProps> = ({ isOpen, onClose }) => {
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig>(voiceService.getConfig());

  if (!isOpen) return null;

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150 select-none"
    >
      <div className="w-full max-w-md bg-[#121522] border border-slate-700/80 rounded-2xl shadow-2xl p-6 space-y-5 text-slate-200 font-sans">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Настройки Talon Voice & Whisper</h3>
              <p className="text-[11px] text-slate-400">Многопоточный конвейер Hands-Free</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          {/* Hands-Free Talon Toggle */}
          <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-center justify-between">
            <div>
              <div className="font-semibold text-white flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-indigo-400" />
                Непрерывный Hands-Free режим
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Не требует нажатия кнопок: звук пишется и нарезается на лету.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const next = !voiceConfig.handsFree;
                voiceService.saveConfig({ handsFree: next });
                setVoiceConfig((c) => ({ ...c, handsFree: next }));
              }}
              className={`w-11 h-6 rounded-full transition p-0.5 flex items-center ${
                voiceConfig.handsFree ? 'bg-indigo-600 justify-end' : 'bg-slate-800 justify-start'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white shadow-md" />
            </button>
          </div>

          {/* VAD Silence Threshold Slider */}
          <div>
            <div className="flex items-center justify-between mb-1 text-slate-300 font-semibold">
              <span>Чувствительность паузы тишины (VAD)</span>
              <span className="font-mono text-indigo-400">{voiceConfig.vadSilenceThresholdMs} мс</span>
            </div>
            <input
              type="range"
              min="300"
              max="1000"
              step="20"
              value={voiceConfig.vadSilenceThresholdMs}
              onChange={(e) => {
                const val = Number(e.target.value);
                voiceService.saveConfig({ vadSilenceThresholdMs: val });
                setVoiceConfig((c) => ({ ...c, vadSilenceThresholdMs: val }));
              }}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
              <span>Быстро (300мс)</span>
              <span>Баланс (480мс)</span>
              <span>Длинные паузы (1000мс)</span>
            </div>
          </div>

          {/* Whisper Provider */}
          <div className="space-y-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Движок распознавания</label>
              <select
                value={voiceConfig.whisperProvider}
                onChange={(e) => {
                  const prov = e.target.value as WhisperProvider;
                  const model = prov === 'openai' ? 'whisper-1' : prov === 'groq' ? 'whisper-large-v3' : 'Xenova/whisper-base';
                  voiceService.saveConfig({ whisperProvider: prov, whisperModel: model });
                  setVoiceConfig((c) => ({ ...c, whisperProvider: prov, whisperModel: model }));
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="local">Встроенный локальный Whisper (Изолированный Worker поток, 100% офлайн)</option>
                <option value="groq">Groq Whisper (whisper-large-v3, облачный ~150мс)</option>
                <option value="openai">OpenAI Whisper (whisper-1, облачный)</option>
              </select>
            </div>

            {voiceConfig.whisperProvider === 'local' && (
              <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-[11px] text-indigo-300 flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Инференс работает в отдельном потоке worker_threads без нагрузки на UI.</span>
              </div>
            )}

            {/* API Key */}
            {voiceConfig.whisperProvider !== 'local' && (
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  API Ключ {voiceConfig.whisperProvider === 'groq' ? 'Groq' : 'OpenAI'}
                </label>
                <input
                  type="password"
                  value={voiceConfig.whisperApiKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    voiceService.saveConfig({ whisperApiKey: val });
                    setVoiceConfig((c) => ({ ...c, whisperApiKey: val }));
                  }}
                  placeholder="Автоматически из настроек AI Studio или введите ключ"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-emerald-400 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>Ключ надёжно защищён системным шифрованием (safeStorage / DPAPI)</span>
                </div>
              </div>
            )}
          </div>

          {/* Supported Voice Commands Cheat Sheet */}
          <div className="p-3 rounded-xl bg-indigo-950/20 border border-indigo-900/40 text-[11px] space-y-1.5 text-slate-300">
            <div className="font-bold text-indigo-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Hands-Free команды (говорите вслух):
            </div>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li><strong className="text-slate-200">«Перейди на проект [Имя]»</strong> — переключение проекта</li>
              <li><strong className="text-slate-200">«Открой студию»</strong> — вход в Claude Studio</li>
              <li><strong className="text-slate-200">«Вкладка 1/2/3»</strong>, <strong className="text-slate-200">«Новый диалог»</strong> — сессии</li>
              <li><strong className="text-slate-200">«Промпт [Текст]»</strong> — диктовка и отправка агенту</li>
              <li><strong className="text-slate-200">«Принять» / «Отклонить»</strong>, <strong className="text-slate-200">«Вариант 1/2»</strong> — выбор в диалогах</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition"
          >
            Готово
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
