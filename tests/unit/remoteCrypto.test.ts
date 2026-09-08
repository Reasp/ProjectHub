import { describe, it, expect } from 'vitest';
import { generateSecretKey, encryptPayload, decryptPayload } from '../../src/utils/remoteCryptoNode.js';
import { encryptPayloadWeb, decryptPayloadWeb } from '../../src/utils/remoteCryptoWeb.js';

describe('Remote Control E2EE Crypto', () => {
  const secretKey = generateSecretKey();

  it('generates 64-char hex secret key', () => {
    expect(secretKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('encrypts and decrypts payload in Node.js', () => {
    const payload = {
      type: 'rpc_req',
      id: 'msg-1',
      method: 'start_process',
      params: { name: 'dev', command: 'npm run dev' }
    };

    const encrypted = encryptPayload(payload, secretKey);
    expect(encrypted.e2ee).toBe(true);
    expect(encrypted.iv).toHaveLength(24); // 12 bytes hex
    expect(encrypted.tag).toHaveLength(32); // 16 bytes hex

    const decrypted = decryptPayload(encrypted, secretKey);
    expect(decrypted).toEqual(payload);
  });

  it('encrypts and decrypts payload in Web Crypto', async () => {
    const payload = {
      type: 'rpc_res',
      id: 'msg-2',
      result: { ok: true, status: 'started' }
    };

    const encrypted = await encryptPayloadWeb(payload, secretKey);
    expect(encrypted.e2ee).toBe(true);
    expect(encrypted.iv).toHaveLength(24);
    expect(encrypted.tag).toHaveLength(32);

    const decrypted = await decryptPayloadWeb(encrypted, secretKey);
    expect(decrypted).toEqual(payload);
  });

  it('interoperability: Node encrypt -> Web decrypt', async () => {
    const payload = {
      event: 'process:logChunk',
      data: { processId: 'proc-123', text: 'Server running on port 3000\n' }
    };

    const nodeEncrypted = encryptPayload(payload, secretKey);
    const webDecrypted = await decryptPayloadWeb(nodeEncrypted, secretKey);
    expect(webDecrypted).toEqual(payload);
  });

  it('interoperability: Web encrypt -> Node decrypt', async () => {
    const payload = {
      method: 'hitl_decision',
      params: { decision: 'approve', reason: 'User approved from smartphone' }
    };

    const webEncrypted = await encryptPayloadWeb(payload, secretKey);
    const nodeDecrypted = decryptPayload(webEncrypted, secretKey);
    expect(nodeDecrypted).toEqual(payload);
  });
});
