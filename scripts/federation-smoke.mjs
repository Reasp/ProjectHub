#!/usr/bin/env node
/**
 * Живая проверка каталога федерации (TASK-66, AC #1): поднимает relay-сервер на свободном порту,
 * подключает к нему три поддельных хоста (два с одним `ownerId`, один с чужим) и проверяет, что
 * каталог, heartbeat и изоляция по владельцу работают на реальных сокетах, а не только в юнитах.
 *
 * Запуск: `npm run federation-smoke`. Юнит-тесты покрывают чистые функции
 * (`tests/unit/remoteRelayCatalog.test.ts`), этот скрипт — их стыковку с WS-сервером.
 */
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const PORT = 42050 + Math.floor(Math.random() * 500);
const RELAY = `ws://127.0.0.1:${PORT}`;
/** Должно совпадать с `CATALOG_BROADCAST_THROTTLE_MS` в relay-сервере, плюс запас. */
const BROADCAST_WAIT_MS = 2600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeHost(name, ownerId) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const hostId = `ph_host_${name}`;
  const url = new URL(RELAY);
  url.searchParams.set('role', 'host');
  url.searchParams.set('hostId', hostId);
  url.searchParams.set('machineName', `PC-${name}`);
  url.searchParams.set('platform', 'win32');
  url.searchParams.set('pubkey', Buffer.from(pubPem).toString('base64url'));
  url.searchParams.set('protocolVersion', '1');
  url.searchParams.set('appVersion', '9.9.9');
  if (ownerId) url.searchParams.set('ownerId', ownerId);

  const ws = new WebSocket(url.toString());
  const state = { hostId, name, catalogs: [], ack: null, ws };

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'auth_challenge') {
      ws.send(
        JSON.stringify({
          type: 'auth_response',
          signature: crypto.sign(null, Buffer.from(msg.nonce, 'utf8'), privateKey).toString('hex')
        })
      );
      return;
    }
    if (msg.type === 'relay_ack') {
      state.ack = msg;
      ws.send(
        JSON.stringify({
          type: 'host_meta_update',
          meta: { projectsCount: 3, hitlPendingCount: 1, activeAgentsCount: 2 }
        })
      );
      ws.send(JSON.stringify({ type: 'catalog_request' }));
      return;
    }
    if (msg.type === 'catalog') state.catalogs.push(msg.hosts);
  });

  return state;
}

const relay = spawn(process.execPath, [path.join(scriptDir, 'remote-relay-server.mjs')], {
  env: { ...process.env, RELAY_PORT: String(PORT) },
  stdio: 'ignore'
});

let failed = 0;
try {
  await sleep(1200);

  const ownerA = crypto.createHash('sha256').update('projecthub-smoke-owner-a').digest('hex');
  const ownerB = crypto.createHash('sha256').update('projecthub-smoke-owner-b').digest('hex');

  const alpha = makeHost('alpha', ownerA);
  await sleep(400);
  const beta = makeHost('beta', ownerA);
  const gamma = makeHost('gamma', ownerB);
  await sleep(BROADCAST_WAIT_MS);

  const last = (h) => h.catalogs[h.catalogs.length - 1] || [];
  const ids = (h) => last(h).map((x) => x.hostId).sort();
  const betaEntry = last(alpha).find((x) => x.hostId === 'ph_host_beta');

  const checks = [
    ['relay_ack несёт версию протокола', alpha.ack?.protocolVersion === 1],
    ['relay_ack подтверждает включённый каталог', alpha.ack?.catalogEnabled === true],
    ['alpha видит beta', ids(alpha).includes('ph_host_beta')],
    ['beta видит alpha', ids(beta).includes('ph_host_alpha')],
    ['alpha НЕ видит хост чужого владельца', !ids(alpha).includes('ph_host_gamma')],
    ['хост чужого владельца видит только себя', JSON.stringify(ids(gamma)) === JSON.stringify(['ph_host_gamma'])],
    ['метаданные heartbeat доезжают до соседа', betaEntry?.projectsCount === 3 && betaEntry?.hitlPendingCount === 1],
    ['ownerId не раскрывается в каталоге', betaEntry !== undefined && betaEntry.ownerId === undefined],
    ['имя машины видно в каталоге', betaEntry?.machineName === 'PC-beta']
  ];

  beta.ws.close();
  await sleep(600);
  checks.push(['ушедший хост пропадает из каталога соседа', !ids(alpha).includes('ph_host_beta')]);

  for (const [label, ok] of checks) {
    if (!ok) failed++;
    console.log(`${ok ? '✅' : '❌'} ${label}`);
  }

  alpha.ws.close();
  gamma.ws.close();
} finally {
  relay.kill();
}

console.log(failed === 0 ? '\n✨ Каталог федерации работает на живых сокетах' : `\n✖ Провалено проверок: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
