/**
 * Отображение ошибки провайдера в renderer (TASK-70.6, decision-43) — чистые функции без React.
 *
 * Main-процесс присылает снимок `ProviderErrorInfo` (вид, причина, провайдер, адрес, модель, ответ
 * сервера). Заголовок и совет берутся из словаря по виду и причине — так они локализованы ru/en.
 * Ответ сервера показывается как есть: это текст провайдера, переводить его нельзя.
 */
import type { AIMessage, ProviderErrorInfo } from '../types/electron';
import type { TranslationDictionary } from '../i18n/types';

type ProviderErrorsDict = TranslationDictionary['providerErrors'];

export interface ProviderErrorDetail {
  label: string;
  value: string;
}

export interface ProviderErrorView {
  /** Что случилось — по причине, если она есть в словаре, иначе по виду. */
  title: string;
  /** Что сделать; для ошибки настройки — текст main-процесса (он уже говорит, что сделать). */
  advice?: string;
  details: ProviderErrorDetail[];
  serverMessage?: string;
  /** Поможет ли повтор без изменения настроек. */
  retryHint: string;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key] : m));
}

export function providerErrorTitle(info: ProviderErrorInfo, t: ProviderErrorsDict): string {
  const reason = info.reason as keyof ProviderErrorsDict['reasons'] | undefined;
  if (reason && reason in t.reasons) return t.reasons[reason];
  return t.kinds[info.kind] ?? t.kinds.unknown;
}

export function providerErrorAdvice(info: ProviderErrorInfo, t: ProviderErrorsDict): string | undefined {
  const a = t.advice;
  switch (info.kind) {
    case 'auth':
      if (info.reason === 'forbidden') return a.authForbidden;
      return fill(info.profileId ? a.authProfile : a.auth, { provider: info.provider ? `«${info.provider}»` : '' }).replace(/\s{2,}/g, ' ');
    case 'quota':
      return a.quota;
    case 'model_not_found':
      return info.local ? fill(a.modelNotFoundLocal, { model: info.model || '<model>' }) : a.modelNotFound;
    case 'rate_limit':
      return info.retryAfterMs !== undefined
        ? fill(a.rateLimitWait, { seconds: String(Math.max(1, Math.round(info.retryAfterMs / 1000))) })
        : a.rateLimit;
    case 'unavailable':
      switch (info.reason) {
        case 'refused':
          return info.local ? a.refusedLocal : a.refused;
        case 'dns':
          return a.dns;
        case 'timeout':
          return info.local ? a.timeoutLocal : a.timeout;
        case 'tls':
          return a.tls;
        default:
          return a.unavailable;
      }
    case 'bad_request':
      switch (info.reason) {
        case 'tools':
          return a.tools;
        case 'reasoning':
          return a.reasoning;
        case 'context':
          return a.context;
        case 'unsupported':
          return a.unsupported;
        case 'moderation':
          return a.moderation;
        default:
          return a.badRequest;
      }
    case 'config':
      return info.reason === 'endpoint' ? a.endpoint : info.message || undefined;
    default:
      return info.serverMessage ? undefined : info.message || undefined;
  }
}

export function providerErrorView(info: ProviderErrorInfo, t: ProviderErrorsDict): ProviderErrorView {
  const details: ProviderErrorDetail[] = [];
  if (info.provider) details.push({ label: t.provider, value: info.provider });
  if (info.model) details.push({ label: t.model, value: info.model });
  if (info.endpoint) details.push({ label: t.endpoint, value: info.endpoint });
  const code = [info.status !== undefined ? `HTTP ${info.status}` : '', info.code ?? ''].filter(Boolean).join(' · ');
  if (code) details.push({ label: t.status, value: code });
  return {
    title: providerErrorTitle(info, t),
    advice: providerErrorAdvice(info, t),
    details,
    ...(info.serverMessage ? { serverMessage: info.serverMessage } : {}),
    retryHint: info.retryable ? t.retryable : t.notRetryable
  };
}

/**
 * История для модели: ответ, упавший с ошибкой и без текста и вызовов, не отправляется — пустое
 * сообщение ассистента Messages API отвергает, а текст ошибки раньше попадал модели как её ответ.
 */
export function messagesForModel(messages: readonly AIMessage[]): AIMessage[] {
  return messages.filter(
    (m) => !(m.role === 'assistant' && (m.error || m.providerError) && !m.content?.trim() && !(m.toolCalls && m.toolCalls.length > 0))
  );
}

/**
 * Что повторить для упавшего ответа: текст предыдущего сообщения пользователя и id обоих сообщений,
 * которые убираются из диалога перед повтором. `undefined` — повторять нечего.
 */
export function retryTarget(messages: readonly AIMessage[], assistantMessageId: string): { userText: string; removeIds: string[] } | undefined {
  const idx = messages.findIndex((m) => m.id === assistantMessageId);
  if (idx <= 0) return undefined;
  const failed = messages[idx];
  if (failed.role !== 'assistant' || !(failed.error || failed.providerError)) return undefined;
  for (let i = idx - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') {
      return m.content.trim() ? { userText: m.content, removeIds: [m.id, failed.id] } : undefined;
    }
    if (m.role === 'assistant') return undefined;
  }
  return undefined;
}
