#!/usr/bin/env node
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { decodePubkey, verifySignature, isHijackAttempt, isRelayApiAuthorized } from './remoteRelayAuth.mjs';

/**
 * ProjectHub Remote Relay Server
 * Легковесный релей-сервер для связи между десктопом ProjectHub и удаленными мобильными клиентами.
 * Поддерживает E2EE (End-to-End Encryption): сервер не имеет доступа к содержимому сообщений.
 *
 * Регистрация хоста (TASK-65, decision-11 п.2): хост предъявляет свой Ed25519 identity-публичный
 * ключ и подписывает случайный nonce приватным ключом (challenge-response) — без валидной подписи
 * `hostId` не регистрируется. Один и тот же `hostId` с ДРУГИМ ключом отклоняется — так чужой
 * hostId нельзя захватить, даже зная его (он не секрет, публикуется в QR/deep-link).
 */

const PORT = parseInt(process.env.RELAY_PORT || process.env.PORT || '42055', 10);
const HOST = process.env.RELAY_HOST || '0.0.0.0';
const AUTH_TIMEOUT_MS = 5000;
/** Токен HTTP-каталога хостов; не задан — каталог выключен, а не открыт всем (TASK-65 п.6). */
const API_TOKEN = process.env.RELAY_API_TOKEN || '';

// Хранилище подключений
// hostId -> { hostWs, hostId, hostPubkey, hostMeta, clients: Map<clientId, {...}> }
const sessions = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    let totalClients = 0;
    for (const session of sessions.values()) {
      totalClients += session.clients.size;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'ProjectHub-Remote-Relay',
        version: '2.0.0',
        activeHosts: sessions.size,
        activeClients: totalClients,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      })
    );
    return;
  }

  // GET /api/federation/hosts - список всех активных хостов в федерации на этом релее.
  // Каталог раскрывает имена машин, поэтому требует Bearer-токен; без `RELAY_API_TOKEN` он
  // выключен целиком (раньше отдавался анонимно любому, кто знает адрес релея).
  if (req.url === '/api/federation/hosts') {
    if (!isRelayApiAuthorized(req.headers.authorization, API_TOKEN)) {
      res.writeHead(API_TOKEN ? 401 : 403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: API_TOKEN ? 'unauthorized' : 'catalog_disabled',
          message: API_TOKEN
            ? 'Требуется заголовок Authorization: Bearer <RELAY_API_TOKEN>'
            : 'Каталог хостов выключен: задайте RELAY_API_TOKEN на relay-сервере'
        })
      );
      return;
    }
    const hosts = [];
    for (const s of sessions.values()) {
      if (s.authenticated && s.hostWs && s.hostWs.readyState === WebSocket.OPEN) {
        hosts.push(
          s.hostMeta || {
            hostId: s.hostId,
            machineName: 'ProjectHub Host',
            platform: 'unknown',
            isOnline: true,
            lastSeen: Date.now()
          }
        );
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hosts }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

const wss = new WebSocketServer({ server });

function setupHostMessageRouting(ws, hostId, session) {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Обновление метаданных хоста (проекты, процессы)
      if (msg.type === 'host_meta_update' && msg.meta) {
        session.hostMeta = { ...session.hostMeta, ...msg.meta, lastSeen: Date.now() };
        return;
      }

      // Если хост отправляет сообщение конкретному клиенту
      if (msg.targetClientId) {
        const client = session.clients.get(msg.targetClientId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(raw);
        }
      } else {
        // Broadcast всем клиентам данного хоста
        for (const client of session.clients.values()) {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(raw);
          }
        }
      }
    } catch (err) {
      console.error('[Relay] Error handling host message:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[Relay] Host disconnected: ${hostId}`);
    const current = sessions.get(hostId);
    if (current && current.hostWs === ws) {
      for (const client of current.clients.values()) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'host_disconnected', hostId }));
        }
      }
      sessions.delete(hostId);
    }
  });
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const role = url.searchParams.get('role'); // 'host' | 'client'
  const hostId = url.searchParams.get('hostId');
  const clientId = url.searchParams.get('clientId') || `c_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const clientName = url.searchParams.get('name') || 'Remote Client';
  const machineName = url.searchParams.get('machineName') || 'Desktop PC';
  const platform = url.searchParams.get('platform') || 'win32';
  const tunnelUrl = url.searchParams.get('tunnelUrl') || '';

  if (!hostId || !role) {
    ws.close(1008, 'Missing role or hostId');
    return;
  }

  // Роль: HOST (десктопное приложение ProjectHub) — требует identity-ключ и подпись nonce.
  if (role === 'host') {
    const pubkeyParam = url.searchParams.get('pubkey');
    const decoded = pubkeyParam && decodePubkey(pubkeyParam);
    if (!decoded) {
      ws.close(1008, 'Missing or invalid pubkey');
      return;
    }

    const existing = sessions.get(hostId);
    if (isHijackAttempt(existing?.hostPubkey, decoded.pem)) {
      console.warn(`[Relay] Rejected host registration for ${hostId}: pubkey mismatch (possible hijack attempt)`);
      ws.close(4001, 'hostId already registered with a different identity key');
      return;
    }

    const nonce = crypto.randomBytes(24).toString('hex');
    ws.send(JSON.stringify({ type: 'auth_challenge', nonce }));

    const authTimer = setTimeout(() => {
      ws.close(1008, 'Auth challenge timeout');
    }, AUTH_TIMEOUT_MS);

    const onAuthMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type !== 'auth_response') return;

      ws.removeListener('message', onAuthMessage);
      clearTimeout(authTimer);

      if (!verifySignature(decoded.keyObject, nonce, msg.signature || '')) {
        console.warn(`[Relay] Rejected host registration for ${hostId}: invalid signature`);
        ws.close(1008, 'Invalid signature');
        return;
      }

      const hostMeta = {
        hostId,
        machineName,
        platform,
        tunnelUrl,
        isOnline: true,
        projectsCount: 0,
        activeProcessesCount: 0,
        lastSeen: Date.now()
      };

      let session = sessions.get(hostId);
      if (!session) {
        session = { hostWs: ws, hostId, hostPubkey: decoded.pem, hostMeta, clients: new Map(), authenticated: true };
        sessions.set(hostId, session);
      } else {
        try {
          if (session.hostWs && session.hostWs !== ws && session.hostWs.readyState === WebSocket.OPEN) {
            session.hostWs.close(1000, 'Replaced by new host connection');
          }
        } catch {
          // ignore
        }
        session.hostWs = ws;
        session.hostPubkey = decoded.pem;
        session.hostMeta = hostMeta;
        session.authenticated = true;
      }

      console.log(`[Relay] Host authenticated: ${hostId} [${machineName}] (IP: ${req.socket.remoteAddress})`);
      ws.send(JSON.stringify({ type: 'relay_ack', role: 'host', hostId, machineName }));
      setupHostMessageRouting(ws, hostId, session);
    };

    ws.on('message', onAuthMessage);
    ws.on('close', () => clearTimeout(authTimer));
    return;
  }

  // Роль: CLIENT (телефон, браузер, удаленный ПК) — сам транспорт не аутентифицирует клиента,
  // это делает хост через E2EE-пакет handshake (PIN/ключ/token), см. remoteControlService.
  if (role === 'client') {
    const session = sessions.get(hostId);
    if (!session || !session.authenticated || !session.hostWs || session.hostWs.readyState !== WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', error: 'Host offline or not found', hostId }));
      ws.close(1002, 'Host not found');
      return;
    }

    const clientEntry = {
      ws,
      clientId,
      name: clientName,
      connectedAt: Date.now()
    };
    session.clients.set(clientId, clientEntry);

    console.log(`[Relay] Client connected: ${clientId} (${clientName}) to host ${hostId}`);

    // Оповещаем хост о новом клиенте
    session.hostWs.send(
      JSON.stringify({
        type: 'client_connected',
        clientId,
        name: clientName,
        ip: req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown'
      })
    );

    // Подтверждаем клиенту
    ws.send(
      JSON.stringify({
        type: 'relay_ack',
        role: 'client',
        clientId,
        hostId
      })
    );

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Добавляем clientId в сообщение перед отправкой хосту
        msg.fromClientId = clientId;

        if (session.hostWs && session.hostWs.readyState === WebSocket.OPEN) {
          session.hostWs.send(JSON.stringify(msg));
        }
      } catch (err) {
        console.error('[Relay] Error handling client message:', err);
      }
    });

    ws.on('close', () => {
      console.log(`[Relay] Client disconnected: ${clientId}`);
      session.clients.delete(clientId);
      if (session.hostWs && session.hostWs.readyState === WebSocket.OPEN) {
        session.hostWs.send(JSON.stringify({ type: 'client_disconnected', clientId }));
      }
    });
  }
});

// Периодический Ping для поддержания активных соединений
const pingInterval = setInterval(() => {
  for (const session of sessions.values()) {
    if (session.hostWs && session.hostWs.readyState === WebSocket.OPEN) {
      session.hostWs.ping();
    }
    for (const client of session.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping();
      }
    }
  }
}, 30000);

server.listen(PORT, HOST, () => {
  console.log(`🚀 ProjectHub Remote Relay Server running at http://${HOST}:${PORT}`);
  console.log(`   Health check: http://127.0.0.1:${PORT}/health`);
});

process.on('SIGINT', () => {
  clearInterval(pingInterval);
  server.close(() => process.exit(0));
});
