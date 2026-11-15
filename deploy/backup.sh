#!/bin/sh
# Sauvegarde quotidienne de la base SIGA (cron conseillé : 30 3 * * *).
# Fichiers : /opt/siga/backups/siga-AAAAMMJJ-HHMM.sql.gz, conservés BACKUP_DAYS jours (14 par défaut).
set -eu
ROOT="${SIGA_ROOT:-/opt/siga}"
DEST="$ROOT/backups"
DAYS="${BACKUP_DAYS:-14}"
SIGA="sh $ROOT/siga-api/deploy/siga"

mkdir -p "$DEST"
chmod 700 "$DEST"
FILE="$DEST/siga-$(date +%Y%m%d-%H%M).sql.gz"

# --single-transaction : copie cohérente sans bloquer le bot
$SIGA exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --no-tablespaces --databases siga' \
  | gzip -9 > "$FILE.part"

# Une sauvegarde vide signale un échec
if [ "$(gzip -dc "$FILE.part" | head -c 100 | wc -c)" -lt 100 ]; then
  rm -f "$FILE.part"
  echo "[siga] ÉCHEC : sauvegarde vide" >&2
  exit 1
fi
mv "$FILE.part" "$FILE"
chmod 600 "$FILE"

find "$DEST" -name 'siga-*.sql.gz' -mtime +"$DAYS" -delete
echo "[siga] Sauvegarde OK : $FILE ($(du -h "$FILE" | cut -f1))"
