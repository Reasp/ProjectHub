import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
// @ts-expect-error - plain .mjs script, no type declarations
import { decodePubkey, verifySignature, isHijackAttempt, isRelayApiAuthorized } from '../../scripts/remoteRelayAuth.mjs';

/**
 * Аутентификация хоста на Remote Relay (TASK-65, decision-11 п.2): challenge-response на
 * Ed25519 identity-ключе и защита от захвата чужого hostId. Логика вынесена в чистый модуль
 * `scripts/remoteRelayAuth.mjs` специально для юнит-тестов без поднятия реального WS-сервера.
 */
describe('remoteRelayAuth: decodePubkey', () => {
  it('декодирует валидный base64url SPKI PEM', () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const encoded = Buffer.from(pem).toString('base64url');

    const decoded = decodePubkey(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded.pem).toBe(pem);
  });

  it('возвращает null для мусорного/невалидного значения', () => {
    expect(decodePubkey('not-a-valid-base64url-key')).toBeNull();
    expect(decodePubkey('')).toBeNull();
  });
});

describe('remoteRelayAuth: verifySignature', () => {
  it('принимает верную Ed25519-подпись nonce', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const nonce = crypto.randomBytes(16).toString('hex');
    const signature = crypto.sign(null, Buffer.from(nonce, 'utf8'), privateKey).toString('hex');

    expect(verifySignature(publicKey, nonce, signature)).toBe(true);
  });

  it('отклоняет подпись под другим nonce (replay/подмена)', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const signature = crypto.sign(null, Buffer.from('nonce-a', 'utf8'), privateKey).toString('hex');

    expect(verifySignature(publicKey, 'nonce-b', signature)).toBe(false);
  });

  it('отклоняет подпись чужим ключом', () => {
    const signer = crypto.generateKeyPairSync('ed25519');
    const other = crypto.generateKeyPairSync('ed25519');
    const nonce = 'shared-nonce';
    const signature = crypto.sign(null, Buffer.from(nonce, 'utf8'), signer.privateKey).toString('hex');

    expect(verifySignature(other.publicKey, nonce, signature)).toBe(false);
  });

  it('не падает на мусорной подписи', () => {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    expect(verifySignature(publicKey, 'nonce', 'not-hex-garbage')).toBe(false);
  });
});

describe('remoteRelayAuth: isHijackAttempt (защита hostId от захвата)', () => {
  it('не считает захватом первую регистрацию (ключа ещё не было)', () => {
    expect(isHijackAttempt(undefined, 'pem-a')).toBe(false);
  });

  it('не считает захватом повторную регистрацию тем же ключом', () => {
    expect(isHijackAttempt('pem-a', 'pem-a')).toBe(false);
  });

  it('считает захватом регистрацию другим ключом поверх уже занятого hostId', () => {
    expect(isHijackAttempt('pem-a', 'pem-b')).toBe(true);
  });
});

describe('remoteRelayAuth: isRelayApiAuthorized (каталог хостов на релее, TASK-65 п.6)', () => {
  it('отказывает всем, пока RELAY_API_TOKEN не задан (каталог выключен, а не открыт)', () => {
    expect(isRelayApiAuthorized('Bearer whatever', '')).toBe(false);
    expect(isRelayApiAuthorized(undefined, '')).toBe(false);
  });

  it('принимает верный Bearer-токен', () => {
    expect(isRelayApiAuthorized('Bearer s3cret-token', 's3cret-token')).toBe(true);
  });

  it('принимает токен и без префикса Bearer', () => {
    expect(isRelayApiAuthorized('s3cret-token', 's3cret-token')).toBe(true);
  });

  it('отклоняет неверный токен и отсутствующий заголовок', () => {
    expect(isRelayApiAuthorized('Bearer wrong-token', 's3cret-token')).toBe(false);
    expect(isRelayApiAuthorized(undefined, 's3cret-token')).toBe(false);
  });
});
