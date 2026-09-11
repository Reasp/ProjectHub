# Self-hosted Remote Relay

Relay (`scripts/remote-relay-server.mjs`) — лёгкий WebSocket-мост между десктопом ProjectHub и
удалёнными клиентами (телефон, Telegram Mini App, другой ProjectHub), когда прямое LAN-подключение
недоступно. Relay не расшифровывает трафик (E2EE между хостом и клиентом), но должен быть доступен
по `wss://` (TLS), а не по открытому `ws://`, если он смотрит в интернет — сам relay TLS не
терминирует, для этого нужен reverse-proxy.

Регистрация хоста на relay защищена подписью Ed25519 (challenge-response) — увидеть чужой `hostId`
недостаточно, чтобы его перехватить (TASK-65, decision-11 п.2).

## Быстрый запуск (Docker)

Из корня репозитория ProjectHub:

```bash
docker build -f deploy/relay/Dockerfile -t projecthub-relay .
docker run -d --name projecthub-relay \
  -p 42055:42055 \
  -e RELAY_PORT=42055 \
  -e RELAY_HOST=0.0.0.0 \
  --restart unless-stopped \
  projecthub-relay
```

Проверка: `curl http://127.0.0.1:42055/health` должен вернуть `{"status":"ok", ...}`.

## TLS через reverse-proxy

Relay слушает только `ws://`/`http://`; TLS терминирует reverse-proxy перед ним. Пример для Caddy
(автоматический сертификат Let's Encrypt) — `Caddyfile`:

```
relay.example.com {
  reverse_proxy 127.0.0.1:42055
}
```

Пример для Nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name relay.example.com;

  ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:42055;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

После этого в ProjectHub (бейдж Remote Control → Настройки сети) укажите `relayServerUrl` в
формате `wss://relay.example.com` и режим `relay`.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `RELAY_PORT` (или `PORT`) | `42055` | Порт, который слушает relay внутри контейнера |
| `RELAY_HOST` | `0.0.0.0` | Интерфейс для bind (внутри контейнера обычно не менять) |

## Что делает и чего не делает relay

- Каталог: `GET /api/federation/hosts` — список аутентифицированных (прошедших подпись) хостов,
  подключённых прямо сейчас.
- Транспорт: пересылает зашифрованные E2EE-пакеты между хостом и его клиентами, ничего в них не
  читая.
- Хост регистрируется подписью Ed25519 своего постоянного identity-ключа — захватить чужой
  `hostId` без приватного ключа нельзя, relay отклонит соединение (`4001`).
- Аутентификация клиента (PIN/ключ/per-device токен) — забота хоста, не relay: пакет `handshake`
  клиент отправляет хосту через relay так же, как в LAN.
- Cloudflare Quick Tunnel (в приложении, кнопка «Запустить туннель») остаётся быстрым fallback
  специально для Telegram Mini App — relay нужен для постоянного доступа с нескольких устройств
  без каждый раз новой ссылки.
