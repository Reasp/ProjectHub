# ProjectHub Remote Relay — self-hosted каталог/транспорт для Remote Control (TASK-65, decision-11 п.2).
# Собирать из корня репозитория: docker build -f deploy/relay/Dockerfile -t projecthub-relay .
FROM node:20-alpine AS deps
WORKDIR /app
COPY deploy/relay/package.json ./
RUN npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY scripts/remote-relay-server.mjs ./scripts/remote-relay-server.mjs

# RELAY_PORT/RELAY_HOST настраиваются переменными окружения (см. deploy/relay/README.md).
EXPOSE 42055
USER node
CMD ["node", "scripts/remote-relay-server.mjs"]
