#!/bin/sh
# Restaure une sauvegarde de la base SIGA (REMPLACE les données actuelles).
#   sh restore.sh /opt/siga/backups/siga-20261115-0330.sql.gz
set -eu
ROOT="${SIGA_ROOT:-/opt/siga}"
SIGA="sh $ROOT/siga-api/deploy/siga"
FILE="${1:-}"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage : sh $0 <fichier .sql.gz>" >&2
  ls -1t "$ROOT/backups"/siga-*.sql.gz 2>/dev/null | head -5 >&2 || true
  exit 1
fi

echo "ATTENTION : la base actuelle sera remplacée par $FILE"
printf "Tape RESTAURER pour continuer : "
read -r answer
[ "$answer" = "RESTAURER" ] || { echo "Annulé."; exit 1; }

# Arrêt de l'API pendant la restauration (aucun message traité à moitié)
$SIGA stop api caddy
gzip -dc "$FILE" | $SIGA exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'
$SIGA start api caddy
echo "[siga] Restauration terminée. Vérifie : $SIGA ps"
