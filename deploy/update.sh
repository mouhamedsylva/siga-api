#!/bin/sh
# Mise à jour de la production : récupère le code des deux dépôts, reconstruit et redémarre.
# Les données (base, Redis, images) sont dans des volumes et ne sont pas touchées.
set -eu
ROOT="${SIGA_ROOT:-/opt/siga}"
SIGA="sh $ROOT/siga-api/deploy/siga"

echo "[siga] Sauvegarde préventive de la base…"
sh "$ROOT/siga-api/deploy/backup.sh"

echo "[siga] Récupération du code…"
git -C "$ROOT/siga-api" pull --ff-only
git -C "$ROOT/siga-admin" pull --ff-only

echo "[siga] Construction de l'image…"
$SIGA build api

echo "[siga] Redémarrage…"
$SIGA up -d
docker image prune -f >/dev/null

$SIGA ps
echo "[siga] Mise à jour terminée. Journaux : $SIGA logs -f api"
