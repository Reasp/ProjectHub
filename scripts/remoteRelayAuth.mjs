import crypto from 'node:crypto';

/**
 * Чистые (без сети/сайд-эффектов) функции аутентификации хоста на relay (TASK-65,
 * decision-11 п.2) — вынесены из `remote-relay-server.mjs`, чтобы их можно было юнит-тестировать
 * без поднятия реального WS-сервера.
 */

/** Декодирует presented `pubkey` (base64url SPKI PEM) в PEM-строку и объект ключа; null при ошибке. */
export function decodePubkey(rawBase64Url) {
  try {
    const pem = Buffer.from(rawBase64Url, 'base64url').toString('utf8');
    return { pem, keyObject: crypto.createPublicKey(pem) };
  } catch {
    return null;
  }
}

/** Проверяет Ed25519-подпись nonce присланным публичным ключом. */
export function verifySignature(publicKeyObject, nonce, signatureHex) {
  try {
    return crypto.verify(null, Buffer.from(nonce, 'utf8'), publicKeyObject, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/**
 * true, если presented pubkey пытается захватить `hostId`, уже занятый ДРУГИМ ключом
 * (trust-on-first-use: первый ключ для hostId становится владельцем).
 */
export function isHijackAttempt(existingPubkeyPem, presentedPubkeyPem) {
  return Boolean(existingPubkeyPem) && existingPubkeyPem !== presentedPubkeyPem;
}

/**
 * Доступ к HTTP-каталогу хостов релея (`GET /api/federation/hosts`, TASK-65 п.6): каталог выдаёт
 * имена машин и их онлайн-статус, поэтому требует `Authorization: Bearer <RELAY_API_TOKEN>`.
 * Если токен на релее не задан, каталог считается выключенным — публиковать список машин в
 * открытый интернет «по умолчанию» нельзя (decision-5 п.5). Сравнение — константное по времени.
 */
export function isRelayApiAuthorized(authorizationHeader, configuredToken) {
  if (!configuredToken) return false;
  const presented = String(authorizationHeader || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(configuredToken, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
