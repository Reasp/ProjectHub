/**
 * Шаблоны секретов: маскировка для аудита и детектор для отказа записи (decision-51 п. 5, TASK-76).
 *
 * Маскировка (`REDACTION_PATTERNS`) заменяет похожее на секрет в команде или заголовке и может
 * позволить себе широкие шаблоны вроде `password=…`: лишняя звёздочка в аудите безвредна.
 * Детектор (`detectSecrets`) решает, отклонить ли запись в память проекта, — там ложное срабатывание
 * мешает работе, поэтому шаблоны строже: `ИМЯ=значение` считается секретом, только если значение
 * похоже на ключ (длинное, без пробелов, буквы вместе с цифрами).
 *
 * Чистый модуль: без Electron и файловой системы.
 */

/** Маскировка для аудита HITL (`hitlAudit.redactSecrets`): порядок важен, замены идут подряд. */
export const REDACTION_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Authorization: Bearer <token>, --header "Authorization: ..."
  [/(bearer\s+)[A-Za-z0-9\-_.=+/]+/gi, '$1***'],
  // key=value / key: value для типичных имён секретов
  [/((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd|authorization|client[_-]?secret)\s*[=:]\s*["']?)[^\s"'&;]+/gi, '$1***'],
  // Известные префиксы ключей
  [/\b(sk-(?:ant-)?[A-Za-z0-9\-_]{8,})/g, 'sk-***'],
  [/\b(gh[pousr]_[A-Za-z0-9]{10,})/g, 'gh*_***'],
  [/\b(xox[abpr]-[A-Za-z0-9-]{10,})/g, 'xox*-***'],
  [/\b(AKIA[0-9A-Z]{12,})/g, 'AKIA***'],
  // Пароли в URL: https://user:pass@host
  [/((?:https?|ftp|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s/@:]+:)[^\s/@]+@/gi, '$1***@'],
  // Переменные окружения вида FOO_TOKEN=... в начале команды
  [/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS)\s*=\s*)[^\s]+/g, '$1***']
];

export const SECRET_KINDS = [
  'provider_key',
  'github_token',
  'slack_token',
  'aws_key',
  'google_key',
  'huggingface_token',
  'private_key',
  'jwt',
  'url_password',
  'bearer_token',
  'assigned_secret'
] as const;

export type SecretKind = (typeof SECRET_KINDS)[number];

export interface SecretFinding {
  kind: SecretKind;
  /** Позиция начала находки — для подсветки; само значение наружу не отдаётся. */
  index: number;
}

/** Значение похоже на ключ, а не на слово: длинное, без пробелов, есть и буквы, и цифры. */
export function looksLikeSecretValue(value: string): boolean {
  const v = value.replace(/^["'`]+|["'`,;]+$/g, '');
  if (v.length < 12 || /\s/.test(v)) return false;
  if (/^\*+$/.test(v) || /^<.*>$/.test(v) || /^\$\{?[A-Za-z_]/.test(v) || /^%[A-Za-z_]+%$/.test(v)) return false;
  return /[A-Za-z]/.test(v) && /\d/.test(v);
}

interface Detector {
  kind: SecretKind;
  re: RegExp;
  /** Дополнительная проверка найденного (для шаблонов, которые ловят и безобидный текст). */
  accept?: (match: RegExpExecArray) => boolean;
}

const DETECTORS: readonly Detector[] = [
  { kind: 'private_key', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g },
  { kind: 'provider_key', re: /\b(?:sk-(?:ant-|or-v1-|or-|proj-)?|gsk_|xai-)[A-Za-z0-9_-]{16,}/g },
  { kind: 'github_token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { kind: 'slack_token', re: /\bxox[abpr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'aws_key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'google_key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'huggingface_token', re: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    kind: 'url_password',
    re: /\b(?:https?|ftp|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?|amqp):\/\/[^\s/@:]+:([^\s/@]+)@/gi,
    accept: (m) => !/^\*+$/.test(m[1]) && !/^<.*>$/.test(m[1]) && !/^\$\{?[A-Za-z_]/.test(m[1])
  },
  {
    kind: 'bearer_token',
    re: /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})/g,
    accept: (m) => looksLikeSecretValue(m[1])
  },
  {
    kind: 'assigned_secret',
    re: /\b((?:[A-Za-z][A-Za-z0-9_-]*?)?(?:api[_-]?key|key|token|secret|password|passwd|pwd))\s*[=:]\s*("[^"\n]*"|'[^'\n]*'|[^\s"'&;,]+)/gi,
    accept: (m) => looksLikeSecretValue(m[2])
  }
];

/**
 * Ищет в тексте похожее на секрет. Возвращает по одной находке каждого вида (первое вхождение),
 * без самих значений — вызывающий объясняет отказ видом находки.
 */
export function detectSecrets(text: string): SecretFinding[] {
  if (!text) return [];
  const found = new Map<SecretKind, number>();
  for (const { kind, re, accept } of DETECTORS) {
    if (found.has(kind)) continue;
    const pattern = new RegExp(re.source, re.flags);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (!accept || accept(match)) {
        found.set(kind, match.index);
        break;
      }
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
  return [...found.entries()].map(([kind, index]) => ({ kind, index })).sort((a, b) => a.index - b.index);
}
