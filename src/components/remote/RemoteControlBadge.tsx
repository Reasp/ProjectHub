import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  Radio,
  Copy,
  Check,
  RefreshCw,
  Power,
  Shield,
  ExternalLink,
  Wifi,
  Globe,
  Lock,
  X,
  UserCheck,
  UserX,
  Sliders,
  QrCode
} from 'lucide-react';
import QRCode from 'qrcode';
import type { RemoteControlStatus, RemoteConfig } from '../../types/electron';

export const RemoteControlBadge: React.FC = () => {
  const [status, setStatus] = useState<RemoteControlStatus | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'connect' | 'devices' | 'settings'>('connect');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  // Local settings state
  const [port, setPort] = useState<number>(49200);
  const [relayUrl, setRelayUrl] = useState<string>('ws://localhost:8765');
  const [useRelay, setUseRelay] = useState<boolean>(true);
  const [useP2P, setUseP2P] = useState<boolean>(true);
  const [readOnly, setReadOnly] = useState<boolean>(false);
  const [requireApproval, setRequireApproval] = useState<boolean>(true);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);

  const fetchStatus = async () => {
    if (window.api?.getRemoteStatus) {
      try {
        const st = await window.api.getRemoteStatus();
        setStatus(st);
        setPort(st.port);
        setRelayUrl(st.relayUrl);
        setUseRelay(st.useRelay);
        setUseP2P(st.useP2P);
      } catch (e) {
        console.error('Failed to get remote control status:', e);
      }
    }
  };

  useEffect(() => {
    fetchStatus();
    const unsubscribe = window.api?.onRemoteControlStatusChanged?.((next) => {
      setStatus(next);
      setPort(next.port);
      setRelayUrl(next.relayUrl);
      setUseRelay(next.useRelay);
      setUseP2P(next.useP2P);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  // Генерация QR-кода при открытии модального окна или изменении статуса
  useEffect(() => {
    if (!status || !isOpen) return;

    // Ссылка для подключения из QR кода
    const localIp = status.localAddresses?.[0] || 'localhost';
    const pairingUrl = `http://${localIp}:${status.port}/remote#host=${status.hostId}&key=${status.secretToken}&relay=${encodeURIComponent(status.relayUrl)}&mode=${status.useP2P ? 'p2p' : status.useRelay ? 'relay' : 'lan'}`;

    QRCode.toDataURL(pairingUrl, {
      margin: 2,
      width: 260,
      color: {
        dark: '#0f172a',
        light: '#f8fafc'
      }
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('QR code generation error:', err));
  }, [status, isOpen]);

  const handleToggle = async () => {
    if (!status || !window.api?.toggleRemoteControl) return;
    try {
      const next = await window.api.toggleRemoteControl(!status.enabled);
      setStatus(next);
    } catch (e) {
      console.error('Failed to toggle remote control:', e);
    }
  };

  const handleRegenerate = async () => {
    if (!window.api?.regenerateRemoteToken) return;
    try {
      const nextToken = await window.api.regenerateRemoteToken();
      setStatus((prev) => (prev ? { ...prev, secretToken: nextToken } : null));
    } catch (e) {
      console.error('Failed to regenerate remote token:', e);
    }
  };

  const handleSaveConfig = async () => {
    if (!window.api?.updateRemoteConfig) return;
    setSavingSettings(true);
    try {
      const updated = await window.api.updateRemoteConfig({
        port,
        relayUrl,
        useRelay,
        useP2P,
        readOnly,
        requireApproval
      });
      setStatus(updated);
      setActiveTab('connect');
    } catch (e) {
      console.error('Failed to update remote config:', e);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleApproveDevice = async (deviceId: string) => {
    if (!window.api?.approveRemoteDevice) return;
    try {
      await window.api.approveRemoteDevice(deviceId);
      fetchStatus();
    } catch (e) {
      console.error('Failed to approve device:', e);
    }
  };

  const handleDisconnectDevice = async (deviceId: string) => {
    if (!window.api?.disconnectRemoteDevice) return;
    try {
      await window.api.disconnectRemoteDevice(deviceId);
      fetchStatus();
    } catch (e) {
      console.error('Failed to disconnect device:', e);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  if (!status) return null;

  const connectedCount = status.connectedDevices?.length || 0;
  const approvedCount = status.connectedDevices?.filter((d) => d.isApproved).length || 0;
  const primaryIp = status.localAddresses?.[0] || 'localhost';
  const webClientUrl = `http://${primaryIp}:${status.port}/remote#host=${status.hostId}&key=${status.secretToken}&relay=${encodeURIComponent(status.relayUrl)}`;

  return (
    <>
      {/* Header Pill Button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition border ${
          status.enabled
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
            : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:bg-slate-800 hover:text-slate-300'
        }`}
        title="Удаленное управление (Remote Control)"
      >
        <span className="relative flex h-2 w-2">
          {status.enabled && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              status.enabled ? 'bg-emerald-400' : 'bg-slate-500'
            }`}
          />
        </span>
        <Smartphone className="w-3.5 h-3.5" />
        <span className="font-semibold">Remote</span>
        {status.enabled && connectedCount > 0 && (
          <span className="ml-0.5 px-1.5 py-0.2 bg-emerald-500/25 border border-emerald-500/40 text-[10px] text-emerald-300 rounded-full font-mono">
            {connectedCount}
          </span>
        )}
      </button>

      {/* Modal Dialog */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div
            className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    Удаленное управление (Remote Control)
                    {status.enabled ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono font-normal">
                        АКТИВЕН
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-mono font-normal">
                        ОТКЛЮЧЕН
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Управление процессами, задачами и AI через смартфон или браузер
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggle}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition border ${
                    status.enabled
                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-300 hover:bg-rose-500/25'
                      : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  {status.enabled ? 'Остановить' : 'Включить'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex border-b border-slate-800 bg-slate-900/50 px-5 pt-2">
              <button
                type="button"
                onClick={() => setActiveTab('connect')}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition ${
                  activeTab === 'connect'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" />
                Подключение и QR
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('devices')}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition ${
                  activeTab === 'devices'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Устройства ({connectedCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition ${
                  activeTab === 'settings'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                Настройки сети
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {activeTab === 'connect' && (
                <div className="space-y-4">
                  {/* QR-код и инструкция */}
                  <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                    <div className="bg-white p-2.5 rounded-xl flex items-center justify-center shrink-0 shadow-lg">
                      {qrDataUrl ? (
                        <img src={qrDataUrl} alt="Remote QR Code" className="w-36 h-36 rounded-lg" />
                      ) : (
                        <div className="w-36 h-36 flex items-center justify-center text-slate-400 text-xs">
                          Генерация QR...
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 text-left">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                        <Lock className="w-3.5 h-3.5 text-emerald-400" />
                        Сквозное шифрование E2EE (AES-256-GCM)
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Отсканируйте камерой смартфона в одной Wi-Fi сети или скопируйте ссылку для удаленного доступа через Relay / P2P.
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <span className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-[10px] text-indigo-300">
                          {status.useP2P ? 'Peer-to-Peer (WebRTC)' : 'Direct LAN'}
                        </span>
                        {status.relayConnected && (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-300">
                            Relay онлайн
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-300">
                          Порт: {status.port}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Ссылка для браузера */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300 flex justify-between">
                      <span>Прямая ссылка веб-клиента</span>
                      <button
                        type="button"
                        onClick={() => window.api?.openExternal(webClientUrl)}
                        className="text-indigo-400 hover:text-indigo-300 text-[11px] flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Открыть в браузере
                      </button>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={webClientUrl}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 font-mono select-all focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(webClientUrl, 'webUrl')}
                        className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition"
                        title="Скопировать ссылку"
                      >
                        {copiedKey === 'webUrl' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Секретный ключ шифрования */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-indigo-400" />
                        Секретный ключ (AES-256)
                      </label>
                      <button
                        type="button"
                        onClick={handleRegenerate}
                        className="text-[11px] text-slate-400 hover:text-indigo-400 flex items-center gap-1 transition"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Сгенерировать новый
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        readOnly
                        value={status.secretToken}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 font-mono select-all focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(status.secretToken, 'secretToken')}
                        className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition"
                        title="Скопировать токен"
                      >
                        {copiedKey === 'secretToken' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'devices' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                    <span>Подключенные устройства ({connectedCount})</span>
                    <span>Одобрено: {approvedCount}</span>
                  </div>

                  {(!status.connectedDevices || status.connectedDevices.length === 0) ? (
                    <div className="p-8 text-center rounded-xl bg-slate-950/40 border border-slate-800 text-slate-500 text-xs">
                      Нет активных подключений. Отсканируйте QR-код на вкладке "Подключение".
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {status.connectedDevices.map((dev) => (
                        <div
                          key={dev.id}
                          className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-slate-800 text-indigo-400">
                              <Smartphone className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-xs font-semibold text-white flex items-center gap-2">
                                {dev.name}
                                <span className="px-1.5 py-0.2 bg-slate-800 text-[10px] text-slate-400 rounded">
                                  {dev.connectionMode.toUpperCase()}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {dev.platform} • {dev.ip || 'Remote IP'}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {!dev.isApproved ? (
                              <button
                                type="button"
                                onClick={() => handleApproveDevice(dev.id)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/30 transition"
                              >
                                <UserCheck className="w-3 h-3" />
                                Одобрить
                              </button>
                            ) : (
                              <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-medium">
                                <Check className="w-3 h-3" /> Одобрено
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDisconnectDevice(dev.id)}
                              className="p-1.5 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition"
                              title="Отключить"
                            >
                              <UserX className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'settings' && (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-slate-300 font-medium block mb-1">Порт локального сервера</label>
                      <input
                        type="number"
                        value={port}
                        onChange={(e) => setPort(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-medium block mb-1">WebSocket Relay URL</label>
                      <input
                        type="text"
                        value={relayUrl}
                        onChange={(e) => setRelayUrl(e.target.value)}
                        placeholder="ws://localhost:8765"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-2.5 pt-2 border-t border-slate-800">
                    <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useP2P}
                        onChange={(e) => setUseP2P(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
                      />
                      <span>Включить WebRTC Peer-to-Peer (прямой P2P туннель)</span>
                    </label>

                    <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useRelay}
                        onChange={(e) => setUseRelay(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
                      />
                      <span>Использовать WebSocket Relay (для доступа из интернета без белого IP)</span>
                    </label>

                    <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={requireApproval}
                        onChange={(e) => setRequireApproval(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
                      />
                      <span>Требовать подтверждение хоста при первом подключении устройства</span>
                    </label>

                    <label className="flex items-center gap-2 text-amber-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={readOnly}
                        onChange={(e) => setReadOnly(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-950 text-amber-600 focus:ring-0"
                      />
                      <span>Режим только для чтения (запретить остановку процессов и коммиты)</span>
                    </label>
                  </div>

                  <div className="pt-3">
                    <button
                      type="button"
                      disabled={savingSettings}
                      onClick={handleSaveConfig}
                      className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-white transition disabled:opacity-50"
                    >
                      {savingSettings ? 'Сохранение...' : 'Сохранить настройки'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
