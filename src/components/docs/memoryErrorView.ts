/**
 * Текст ошибки операции с памятью проекта для интерфейса (TASK-76, decision-51). Main отдаёт код
 * и подробности (коды проблем формата, виды секретов, id похожего факта), строки живут в i18n.
 *
 * Чистый модуль: без React и Electron — покрыт тестом вместе с проверкой, что у каждого кода есть
 * перевод в ru и en.
 */
import type { MemoryFailure } from '../../types/electron';

export interface MemoryStrings {
  errors: Record<string, string>;
  issues: Record<string, string>;
  secretKinds: Record<string, string>;
}

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key] : m));

export function describeMemoryFailure(s: MemoryStrings, failure: Pick<MemoryFailure, 'error' | 'errorCode' | 'details'>): string {
  const code = failure.errorCode;
  const details = failure.details ?? {};
  if (code === 'invalid_draft') {
    const issues = (details.issues ?? []).map((i) => s.issues[i.code] ?? i.code);
    return fill(s.errors.invalid_draft, { issues: [...new Set(issues)].join('; ') });
  }
  if (code === 'secret_detected') {
    const kinds = (details.secretKinds ?? []).map((k) => s.secretKinds[k] ?? k);
    return fill(s.errors.secret_detected, { kinds: kinds.join(', ') });
  }
  if (code === 'duplicate') {
    return fill(s.errors.duplicate, { id: details.duplicateOf ?? '', title: details.duplicateTitle ?? '' });
  }
  if (code && s.errors[code]) return s.errors[code];
  return fill(s.errors.unknown, { error: failure.error || code || '' });
}
