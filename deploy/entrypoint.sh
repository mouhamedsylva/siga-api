#!/bin/sh
# Démarrage du conteneur API : migrations (non destructives) puis lancement.
set -e

echo "[siga] Application des migrations Prisma…"
npx --no-install prisma migrate deploy

echo "[siga] Démarrage de l'API"
exec node dist/main
