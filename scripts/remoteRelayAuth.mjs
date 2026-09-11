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
