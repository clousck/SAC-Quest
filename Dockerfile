# syntax=docker/dockerfile:1
# Imagen de SAC Quest: la API (server/) sirviendo tambien la pagina (dist/),
# todo en un dominio. Funciona en la Raspberry Pi 5 (arm64) y en un PC (amd64).
# Uso normal: docker compose up -d --build   (ver docs/docker.md)

# Mismo Node que .node-version (>= 22.13 por node:sqlite)
ARG NODE_VERSION=22

# ---------- 1. Pagina (Vite) ----------
FROM node:${NODE_VERSION}-bookworm-slim AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
# La pagina llama a /api del mismo dominio
RUN npm run build

# ---------- 2. Dependencias del servidor ----------
FROM node:${NODE_VERSION}-bookworm-slim AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- 3. Imagen final ----------
FROM node:${NODE_VERSION}-bookworm-slim
# HOST 0.0.0.0: dentro del contenedor hay que escuchar en todas las
# interfaces; quien queda expuesto lo decide docker-compose.yml.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app/server
COPY --from=server-deps /app/server/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/scripts ./scripts
COPY --from=web /src/dist /app/dist
# Base y fotos van en /data (volumen). Se corre como "node" (uid 1000), no root.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# node directo (no npm start) para que reciba SIGTERM y cierre la base bien
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
