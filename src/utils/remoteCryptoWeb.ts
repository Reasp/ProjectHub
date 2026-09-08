import type { EncryptedPacket } from '../types/remote';

export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.trim();
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function getCryptoKey(keyHex: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const rawKey = hexToBytes(keyHex);
  return await crypto.subtle.importKey('raw', rawKey as unknown as BufferSource, { name: 'AES-GCM' }, false, usage);
}

/**
 * Шифрование в веб-браузере через стандартный Web Crypto API.
 */
export async function encryptPayloadWeb(data: any, keyHex: string): Promise<EncryptedPacket> {
  const key = await getCryptoKey(keyHex, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));

  // Web Crypto возвращает [ciphertext + tag 16 байт]
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
      tagLength: 128
    },
    key,
    plaintext as unknown as BufferSource
  );

  const encryptedBytes = new Uint8Array(encryptedBuffer);
  const tagBytes = encryptedBytes.slice(encryptedBytes.length - 16);
  const cipherBytes = encryptedBytes.slice(0, encryptedBytes.length - 16);

  return {
    e2ee: true,
    iv: bytesToHex(iv),
    tag: bytesToHex(tagBytes),
    data: bytesToHex(cipherBytes)
  };
}

/**
 * Расшифрование в веб-браузере через стандартный Web Crypto API.
 */
export async function decryptPayloadWeb(payload: EncryptedPacket, keyHex: string): Promise<any> {
  const key = await getCryptoKey(keyHex, ['decrypt']);
  const iv = hexToBytes(payload.iv);
  const cipherBytes = hexToBytes(payload.data);
  const tagBytes = hexToBytes(payload.tag);

  // Для Web Crypto объединяем ciphertext и authTag
  const combined = new Uint8Array(cipherBytes.length + tagBytes.length);
  combined.set(cipherBytes, 0);
  combined.set(tagBytes, cipherBytes.length);

  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
      tagLength: 128
    },
    key,
    combined as unknown as BufferSource
  );

  const decryptedText = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(decryptedText);
}
