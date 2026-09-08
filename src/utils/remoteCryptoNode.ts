import crypto from 'node:crypto';
import type { EncryptedPacket } from '../types/remote.js';

/**
 * Генерирует случайный 256-битный секретный ключ в hex (64 символа).
 */
export function generateSecretKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Генерирует 6-значный пин-код для быстрого спаривания.
 */
export function generatePairingPin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Шифрует произвольный JSON-объект с помощью AES-256-GCM.
 */
export function encryptPayload(data: any, keyHex: string): EncryptedPacket {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    e2ee: true,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: ciphertext.toString('hex')
  };
}

/**
 * Расшифровывает пакет AES-256-GCM и возвращает распарсенный JSON.
 */
export function decryptPayload(payload: EncryptedPacket, keyHex: string): any {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const ciphertext = Buffer.from(payload.data, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}
