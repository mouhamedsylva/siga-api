# syntax=docker/dockerfile:1.7
#
# Image de production SIGA : API NestJS + back-office (siga-admin) servi sous /backoffice.
# Contexte de construction = dossier parent contenant les deux dépôts :
#   /opt/siga/siga-api   et   /opt/siga/siga-admin
# Construite directement sur la VM (ARM) : Prisma génère le bon moteur, sans compilation croisée.

# ---------- 1. Back-office ----------
FROM node:20-bookworm-slim AS admin
WORKDIR /build/siga-admin
COPY siga-admin/package.json siga-admin/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY siga-admin/ ./
RUN npm run build

# ---------- 2. API ----------
FROM node:20-bookworm-slim AS api
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build/siga-api
COPY siga-api/package.json siga-api/package-lock.json ./
# Le schéma est nécessaire au « prisma generate » lancé par postinstall
COPY siga-api/prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY siga-api/ ./
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && npx prisma generate

# ---------- 3. Exécution ----------
FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    ADMIN_UI_DIR=/app/admin \
    FORMATS_DIR=/app/config/formats \
    STORAGE_LOCAL_DIR=/data/storage \
    OCR_CACHE_DIR=/data/tessdata

WORKDIR /app
COPY --from=api --chown=node:node /build/siga-api/package.json ./package.json
COPY --from=api --chown=node:node /build/siga-api/node_modules ./node_modules
COPY --from=api --chown=node:node /build/siga-api/dist ./dist
COPY --from=api --chown=node:node /build/siga-api/prisma ./prisma
COPY --from=api --chown=node:node /build/siga-api/config ./config
COPY --from=admin --chown=node:node /build/siga-admin/dist ./admin
COPY siga-api/deploy/entrypoint.sh /usr/local/bin/siga-entrypoint

# Fins de ligne Linux (au cas où le dépôt a été extrait sous Windows) et dossiers de données
RUN sed -i 's/\r$//' /usr/local/bin/siga-entrypoint \
 && chmod +x /usr/local/bin/siga-entrypoint \
 && mkdir -p /data/storage /data/tessdata \
 && chown -R node:node /data

USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "siga-entrypoint"]
