# LabelBench — server image
#
# Build context is the repository root, so this image can carry both the
# TypeScript API server and the built SPA.
#
# Debian-based (glibc) rather than Alpine so the better-sqlite3 prebuilt native
# binding loads without a compiler toolchain in the image.

# ---------------------------------------------------------------- web build ---
FROM node:22-bookworm-slim AS web-builder

WORKDIR /build/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

# ------------------------------------------------------------- server build ---
FROM node:22-bookworm-slim AS api-builder

WORKDIR /build/app

COPY app/package.json app/package-lock.json ./
# allowScripts in package.json permits better-sqlite3's install script, which
# fetches the prebuilt native binding.
RUN npm ci

COPY app/tsconfig.json ./
COPY app/src ./src
RUN npm run build

# ------------------------------------------------------------------ runtime ---
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev \
 && npm rebuild better-sqlite3 \
 && npm cache clean --force

COPY --from=api-builder /build/app/dist ./dist
COPY --from=web-builder /build/web/dist ./public

RUN mkdir -p /data/assets && chown -R node:node /data /app

USER node

ENV LABELBENCH_HOST=0.0.0.0 \
    LABELBENCH_PORT=3000 \
    LABELBENCH_DATA_DIR=/data \
    LABELBENCH_DB_PATH=/data/labelbench.db \
    LABELBENCH_ASSET_DIR=/data/assets \
    LABELBENCH_STATIC_DIR=/app/public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
