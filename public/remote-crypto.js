/**
 * Канонический браузерный E2EE-модуль Remote Control (TASK-65, decision-11 п.3), без сборки —
 * plain-JS зеркало `remoteCryptoWeb.ts`, отдаётся как есть по `GET /remote-crypto.js` и
 * подключается через `<script src="/remote-crypto.js"></script>` во встроенном веб-клиенте и
 * Telegram Mini App (оба без бандлера). Формат пакета совпадает с `remoteCryptoNode.ts`:
 * `{e2ee:true, iv, tag, data}` в hex, AES-256-GCM. Держать в синхроне с `remoteCryptoWeb.ts`
 * вручную — файл маленький и стабильный.
 */
(function (global) {
  function hexToBytes(hex) {
    const cleanHex = hex.trim();
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  async function getCryptoKey(keyHex, usage) {
    const rawKey = hexToBytes(keyHex);
    return await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, usage);
  }

  async function encryptPayloadWeb(data, keyHex) {
    const key = await getCryptoKey(keyHex, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));

    const encryptedBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, plaintext);

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

  async function decryptPayloadWeb(payload, keyHex) {
    const key = await getCryptoKey(keyHex, ['decrypt']);
    const iv = hexToBytes(payload.iv);
    const cipherBytes = hexToBytes(payload.data);
    const tagBytes = hexToBytes(payload.tag);

    const combined = new Uint8Array(cipherBytes.length + tagBytes.length);
    combined.set(cipherBytes, 0);
    combined.set(tagBytes, cipherBytes.length);

    const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, combined);
    return JSON.parse(new TextDecoder().decode(decryptedBuffer));
  }

  global.RemoteCrypto = { hexToBytes, bytesToHex, encryptPayloadWeb, decryptPayloadWeb };
})(typeof window !== 'undefined' ? window : globalThis);
