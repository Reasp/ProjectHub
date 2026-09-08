#!/usr/bin/env node
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

/**
 * ProjectHub Remote Relay Server
 * Легковесный релей-сервер для связи между десктопом ProjectHub и удаленными мобильными клиентами.
 * Поддерживает E2EE (End-to-End Encryption): сервер не имеет доступа к содержимому сообщений.
 */

const PORT = parseInt(process.env.RELAY_PORT || process.env.PORT || '42055', 10);
const HOST = process.env.RELAY_HOST || '0.0.0.0';

// Хранилище подключений
// hostId -> { ws: WebSocket, hostInfo: any, clients: Map<clientId, { ws: WebSocket, clientInfo: any }> }
const sessions = new Map();

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

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
        version: '1.0.0',
        activeHosts: sessions.size,
        activeClients: totalClients,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      })
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const role = url.searchParams.get('role'); // 'host' | 'client'
  const hostId = url.searchParams.get('hostId');
  const clientId = url.searchParams.get('clientId') || `c_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const clientName = url.searchParams.get('name') || 'Remote Client';

  if (!hostId || !role) {
    ws.close(1008, 'Missing role or hostId');
    return;
  }

  // Роль: HOST (десктопное приложение ProjectHub)
  if (role === 'host') {
    let session = sessions.get(hostId);
    if (!session) {
      session = {
        hostWs: ws,
        hostId,
        clients: new Map()
      };
      sessions.set(hostId, session);
    } else {
      // Заменяем старое подключение хоста
      try {
        if (session.hostWs && session.hostWs !== ws && session.hostWs.readyState === WebSocket.OPEN) {
          session.hostWs.close(1000, 'Replaced by new host connection');
        }
      } catch {
        // ignore
      }
      session.hostWs = ws;
    }

    console.log(`[Relay] Host registered: ${hostId} (IP: ${req.socket.remoteAddress})`);

    // Подтверждение хосту
    ws.send(JSON.stringify({ type: 'relay_ack', role: 'host', hostId }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

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
      // Оповещаем подключенных клиентов
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

    return;
  }

  // Роль: CLIENT (телефон, браузер, удаленный ПК)
  if (role === 'client') {
    const session = sessions.get(hostId);
    if (!session || !session.hostWs || session.hostWs.readyState !== WebSocket.OPEN) {
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
