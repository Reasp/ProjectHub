import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  Copy,
  Check,
  RefreshCw,
  Power,
  Shield,
  ExternalLink,
  Lock,
  X,
  UserCheck,
  UserX,
  Sliders,
  QrCode,
  Send,
  Bot,
  AlertCircle,
  Globe,
  Laptop
} from 'lucide-react';
import QRCode from 'qrcode';
import { useTranslation } from '../../i18n';
import type { RemoteControlStatus } from '../../types/electron';

export const RemoteControlBadge: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RemoteControlStatus | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'connect' | 'devices' | 'settings' | 'telegram'>('connect');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrTelegramDataUrl, setQrTelegramDataUrl] = useState<string>('');

  // Local settings state
  const [port, setPort] = useState<number>(49200);
  const [relayUrl, setRelayUrl] = useState<string>('ws://localhost:8765');
  const [useRelay, setUseRelay] = useState<boolean>(true);
  const [useP2P, setUseP2P] = useState<boolean>(true);
  const [readOnly, setReadOnly] = useState<boolean>(false);
  const [requireApproval, setRequireApproval] = useState<boolean>(true);
  const [machineName, setMachineName] = useState<string>('');
  const [autoStart, setAutoStart] = useState<boolean>(false);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [startingTunnel, setStartingTunnel] = useState<boolean>(false);

  // Telegram settings state
  const [telegramBotToken, setTelegramBotToken] = useState<string>('');
  const [telegramChatId, setTelegramChatId] = useState<string>('');
  const [telegramBotUsername, setTelegramBotUsername] = useState<string>('');
  const [telegramMiniAppUrl, setTelegramMiniAppUrl] = useState<string>('');
  const [testNotificationResult, setTestNotificationResult] = useState<string | null>(null);
  const [testingNotification, setTestingNotification] = useState<boolean>(false);

  const fetchStatus = async () => {
    if (window.api?.getRemoteStatus) {
      try {
        const st = await window.api.getRemoteStatus();
        setStatus(st);
        setPort(st.port);
        setRelayUrl(st.relayUrl);
        setUseRelay(st.useRelay);
        setUseP2P(st.useP2P);
        if (st.machineName !== undefined) setMachineName(st.machineName);
        if (st.autoStart !== undefined) setAutoStart(st.autoStart);
        if (st.telegramBotToken !== undefined) setTelegramBotToken(st.telegramBotToken);
        if (st.telegramChatId !== undefined) setTelegramChatId(st.telegramChatId);
        if (st.telegramBotUsername !== undefined) setTelegramBotUsername(st.telegramBotUsername);
        if (st.telegramMiniAppUrl !== undefined) setTelegramMiniAppUrl(st.telegramMiniAppUrl);
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
      if (next.machineName !== undefined) setMachineName(next.machineName);
      if (next.autoStart !== undefined) setAutoStart(next.autoStart);
      if (next.telegramBotToken !== undefined) setTelegramBotToken(next.telegramBotToken);
      if (next.telegramChatId !== undefined) setTelegramChatId(next.telegramChatId);
      if (next.telegramBotUsername !== undefined) setTelegramBotUsername(next.telegramBotUsername);
      if (next.telegramMiniAppUrl !== undefined) setTelegramMiniAppUrl(next.telegramMiniAppUrl);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  // Генерация QR-кода при открытии модального окна или изменении статуса
  useEffect(() => {
    if (!status || !isOpen) return;

    const localIp = status.localAddresses?.[0] || 'localhost';
    const pairingUrl = `http://${localIp}:${status.port}/remote#host=${status.hostId}&key=${status.secretToken}&relay=${encodeURIComponent(status.relayUrl)}&mode=${status.useP2P ? 'p2p' : status.useRelay ? 'relay' : 'lan'}`;

    QRCode.toDataURL(pairingUrl, {
      margin: 2,
      width: 240,
      color: { dark: '#0f172a', light: '#f8fafc' }
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('QR code generation error:', err));

    // QR код для Telegram Mini App (приоритет публичному HTTPS туннелю)
    const effectiveTgUrl = status.tunnelUrl
      ? `${status.tunnelUrl}/telegram`
      : telegramBotUsername
      ? `https://t.me/${telegramBotUsername}?startapp=k_${status.secretToken.slice(0, 32)}`
      : `http://${localIp}:${status.port}/telegram#host=${status.hostId}&key=${status.secretToken}`;

    QRCode.toDataURL(effectiveTgUrl, {
      margin: 2,
      width: 240,
      color: { dark: '#0f172a', light: '#f8fafc' }
    })
      .then((url) => setQrTelegramDataUrl(url))
      .catch(() => {});
  }, [status, isOpen, telegramBotUsername]);

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
        requireApproval,
        machineName,
        autoStart,
        telegramBotToken,
        telegramChatId,
        telegramBotUsername,
        telegramMiniAppUrl
      });
      setStatus(updated);
      setTestNotificationResult(t.remote.settingsSavedSuccess);
      setTimeout(() => setTestNotificationResult(null), 3000);
    } catch (e) {
      console.error('Failed to update remote config:', e);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRestartTunnel = async () => {
    if (!window.api?.startRemoteTunnel) return;
    setStartingTunnel(true);
    try {
      await window.api.startRemoteTunnel();
      await fetchStatus();
    } catch (e) {
      console.error('Failed to restart tunnel:', e);
    } finally {
      setStartingTunnel(false);
    }
  };

  const handleTestNotification = async () => {
    if (!window.api?.testTelegramNotification) return;
    setTestingNotification(true);
    setTestNotificationResult(null);
    try {
      const ok = await window.api.testTelegramNotification(t.remote.testTelegramMessageText);
      if (ok) {
        setTestNotificationResult(t.remote.testMsgSuccess);
      } else {
        setTestNotificationResult(t.remote.testMsgError);
      }
    } catch (e: any) {
      setTestNotificationResult(t.remote.testMsgPrefixError.replace('{msg}', e?.message || String(e)));
    } finally {
      setTestingNotification(false);
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
  const telegramDirectUrl = `http://${primaryIp}:${status.port}/telegram#host=${status.hostId}&key=${status.secretToken}`;
  const telegramBotDeepLink = telegramBotUsername
    ? `https://t.me/${telegramBotUsername}?startapp=host_${status.hostId}`
    : '';

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
        title={t.remote.badgeTooltip}
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
                    {t.remote.modalTitle}
                    {status.enabled ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono font-normal">
                        {t.remote.statusActive}
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-mono font-normal">
                        {t.remote.statusDisabled}
                      </span>
                    )}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {t.remote.modalSubtitle}
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
                  {status.enabled ? t.remote.stopBtn : t.remote.startBtn}
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
                {t.remote.tabConnect}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('telegram')}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition ${
                  activeTab === 'telegram'
                    ? 'border-sky-500 text-sky-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                {t.remote.tabTelegram}
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
                {t.remote.tabDevices} ({connectedCount})
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
                {t.remote.tabSettings}
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {/* TAB: ПОДКЛЮЧЕНИЕ */}
              {activeTab === 'connect' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                    <div className="bg-white p-2.5 rounded-xl flex items-center justify-center shrink-0 shadow-lg">
                      {qrDataUrl ? (
                        <img src={qrDataUrl} alt="Remote QR Code" className="w-32 h-32 rounded-lg" />
                      ) : (
                        <div className="w-32 h-32 flex items-center justify-center text-slate-400 text-xs">
                          {t.remote.generatingQr}
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 text-left">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                        <Lock className="w-3.5 h-3.5 text-emerald-400" />
                        {t.remote.e2eeTitle}
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {t.remote.e2eeDesc}
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <span className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-[10px] text-indigo-300">
                          {status.useP2P ? t.remote.p2pBadge : t.remote.lanBadge}
                        </span>
                        {status.relayConnected && (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-300">
                            {t.remote.relayOnline}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] text-slate-300">
                          {t.remote.portLabel}: {status.port}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Ссылка для браузера */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300 flex justify-between">
                      <span>{t.remote.directWebLink}</span>
                      <button
                        type="button"
                        onClick={() => window.api?.openExternal(webClientUrl)}
                        className="text-indigo-400 hover:text-indigo-300 text-[11px] flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {t.remote.openInBrowser}
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
                        title={t.remote.copyLinkTooltip}
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
                        {t.remote.secretKeyTitle}
                      </label>
                      <button
                        type="button"
                        onClick={handleRegenerate}
                        className="text-[11px] text-slate-400 hover:text-indigo-400 flex items-center gap-1 transition"
                      >
                        <RefreshCw className="w-3 h-3" />
                        {t.remote.generateNewKey}
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
                        title={t.remote.copyTokenTooltip}
                      >
                        {copiedKey === 'secretToken' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Имя компьютера в Едином Hub */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                      <Laptop className="w-3.5 h-3.5 text-indigo-400" />
                      {t.remote.machineNameLabel}
                    </label>
                    <input
                      type="text"
                      placeholder={t.remote.machineNamePlaceholder}
                      value={machineName}
                      onChange={(e) => setMachineName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* TAB: TELEGRAM MINI APP */}
              {activeTab === 'telegram' && (
                <div className="space-y-4">
                  {/* Tunnel Status & Auto-start Banner */}
                  <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-sky-400" />
                        {t.remote.publicHttpsTunnel}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        status?.tunnelStatus === 'active'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : status?.tunnelStatus === 'starting'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-slate-800 text-slate-400'
                      }`}>
                        {status?.tunnelStatus === 'active' ? t.remote.tunnelActive : status?.tunnelStatus === 'starting' ? t.remote.tunnelStarting : t.remote.tunnelNotStarted}
                      </span>
                    </div>

                    {status?.tunnelUrl ? (
                      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg p-2 text-[11px] font-mono text-sky-300 overflow-hidden">
                        <span className="truncate flex-1">{status.tunnelUrl}/telegram</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(`${status.tunnelUrl}/telegram`, 'tg_tunnel')}
                          className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                          title={t.remote.copyAddressTooltip}
                        >
                          {copiedKey === 'tg_tunnel' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => window.api?.openExternal?.(`${status.tunnelUrl}/telegram`)}
                          className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
                          title={t.remote.openInBrowser}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-400">
                        {t.remote.cloudflareTunnelDesc}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoStart}
                          onChange={(e) => setAutoStart(e.target.checked)}
                          className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-0"
                        />
                        {t.remote.autoStartWithHub}
                      </label>
                      <button
                        type="button"
                        disabled={startingTunnel}
                        onClick={handleRestartTunnel}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-200 transition disabled:opacity-50 flex items-center gap-1"
                      >
                        <RefreshCw className={`w-3 h-3 ${startingTunnel ? 'animate-spin' : ''}`} />
                        {status?.tunnelStatus === 'active' ? t.remote.restartTunnel : t.remote.startTunnel}
                      </button>
                    </div>
                  </div>

                  {/* Telegram QR & DeepLink */}
                  <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-xl bg-sky-950/25 border border-sky-800/40">
                    <div className="bg-white p-2.5 rounded-xl flex items-center justify-center shrink-0 shadow-lg">
                      {qrTelegramDataUrl ? (
                        <img src={qrTelegramDataUrl} alt="Telegram Mini App QR" className="w-32 h-32 rounded-lg" />
                      ) : (
                        <div className="w-32 h-32 flex items-center justify-center text-slate-400 text-xs">
                          {t.remote.generatingQr}
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 text-left">
                      <div className="flex items-center gap-2 text-xs font-semibold text-sky-300">
                        <Send className="w-3.5 h-3.5 text-sky-400" />
                        {t.remote.tmaTitle}
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {t.remote.tmaDesc}
                      </p>
                      <div className="pt-1 flex flex-wrap gap-2">
                        {telegramBotDeepLink ? (
                          <button
                            type="button"
                            onClick={() => window.api?.openExternal(telegramBotDeepLink)}
                            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 transition"
                          >
                            <Send className="w-3.5 h-3.5" />
                            {t.remote.openInTelegram}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => window.api?.openExternal(telegramDirectUrl)}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition border border-slate-700"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            {t.remote.openTmaInBrowser}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Telegram Bot Settings */}
                  <div className="space-y-3 pt-2 text-xs">
                    <div>
                      <label className="text-slate-300 font-medium block mb-1">
                        {t.remote.tgBotTokenLabel}
                      </label>
                      <input
                        type="password"
                        placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                        value={telegramBotToken}
                        onChange={(e) => setTelegramBotToken(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-slate-300 font-medium block mb-1">
                          {t.remote.tgBotUsernameLabel}
                        </label>
                        <input
                          type="text"
                          placeholder="MyProjectHubBot"
                          value={telegramBotUsername}
                          onChange={(e) => setTelegramBotUsername(e.target.value.replace(/^@/, ''))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-slate-300 font-medium block mb-1">
                          {t.remote.tgChatIdLabel}
                        </label>
                        <input
                          type="text"
                          placeholder="12345678"
                          value={telegramChatId}
                          onChange={(e) => setTelegramChatId(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-slate-300 font-medium block mb-1">
                        {t.remote.publicWebappUrlLabel}
                      </label>
                      <input
                        type="text"
                        placeholder={telegramDirectUrl}
                        value={telegramMiniAppUrl}
                        onChange={(e) => setTelegramMiniAppUrl(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                      />
                    </div>

                    {testNotificationResult && (
                      <div className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                        testNotificationResult.startsWith('✅')
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                      }`}>
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{testNotificationResult}</span>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        disabled={savingSettings}
                        onClick={handleSaveConfig}
                        className="flex-1 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 font-semibold text-white transition disabled:opacity-50"
                      >
                        {savingSettings ? t.remote.saving : t.remote.saveTgSettings}
                      </button>
                      <button
                        type="button"
                        disabled={testingNotification || !telegramBotToken || !telegramChatId}
                        onClick={handleTestNotification}
                        className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition disabled:opacity-40"
                        title={t.remote.sendTestMsgTooltip}
                      >
                        <Bot className="w-4 h-4" />
                      </button>
                    </div>

                    {/* How to setup banner */}
                    <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1 text-slate-400 text-[11px] leading-relaxed">
                      <div className="font-semibold text-slate-300">{t.remote.howToConnectTitle}</div>
                      <ol className="list-decimal pl-4 space-y-0.5">
                        <li>{t.remote.howToStep1}</li>
                        <li>{t.remote.howToStep2}</li>
                        <li>{t.remote.howToStep3}</li>
                      </ol>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: УСТРОЙСТВА */}
              {activeTab === 'devices' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                    <span>{t.remote.connectedDevicesTitle} ({connectedCount})</span>
                    <span>{t.remote.approvedCount.replace('{count}', String(approvedCount))}</span>
                  </div>

                  {(!status.connectedDevices || status.connectedDevices.length === 0) ? (
                    <div className="p-8 text-center rounded-xl bg-slate-950/40 border border-slate-800 text-slate-500 text-xs">
                      {t.remote.noActiveConnections}
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
                                {t.remote.approveDevice}
                              </button>
                            ) : (
                              <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-medium">
                                <Check className="w-3 h-3" /> {t.remote.approvedBadge}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDisconnectDevice(dev.id)}
                              className="p-1.5 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition"
                              title={t.remote.disconnectDevice}
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

              {/* TAB: НАСТРОЙКИ СЕТИ */}
              {activeTab === 'settings' && (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-slate-300 font-medium block mb-1">{t.remote.localServerPort}</label>
                      <input
                        type="number"
                        value={port}
                        onChange={(e) => setPort(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-slate-300 font-medium block mb-1">{t.remote.wsRelayUrl}</label>
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
                      <span>{t.remote.enableWebRTC}</span>
                    </label>

                    <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useRelay}
                        onChange={(e) => setUseRelay(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
                      />
                      <span>{t.remote.useWsRelay}</span>
                    </label>

                    <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={requireApproval}
                        onChange={(e) => setRequireApproval(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0"
                      />
                      <span>{t.remote.requireApproval}</span>
                    </label>

                    <label className="flex items-center gap-2 text-amber-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={readOnly}
                        onChange={(e) => setReadOnly(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-950 text-amber-600 focus:ring-0"
                      />
                      <span>{t.remote.readOnlyMode}</span>
                    </label>
                  </div>

                  <div className="pt-3">
                    <button
                      type="button"
                      disabled={savingSettings}
                      onClick={handleSaveConfig}
                      className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-white transition disabled:opacity-50"
                    >
                      {savingSettings ? t.remote.saving : t.remote.saveSettings}
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
