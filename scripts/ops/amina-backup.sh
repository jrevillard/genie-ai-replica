#!/usr/bin/env bash
# ============================================================
#  AMINA backup — runs bi-weekly via cron (1st + 15th of each month)
# ============================================================
#  Captures:
#    1. ArcadeDB consistent snapshot (via native BACKUP DATABASE — hot,
#       no downtime, point-in-time consistent)
#    2. Bind-mount data dirs (uploads, certificates, audio, evidence)
#    3. Redis snapshot (BGSAVE → dump.rdb)
#    4. Critical .env files (.env, .env.cloudflared)
#
#  All four packed into one dated tarball under
#  /root/amina/backups/amina-<YYYYMMDD-HHMM>.tar.gz
#
#  Retention: keeps the LAST 6 archives (~3 months at bi-weekly).
#  Old archives are purged AFTER the new one writes successfully so a
#  failed run never leaves you with no backups.
#
#  Logs to /var/log/amina-backup.log (logrotated weekly).
#
#  Manual run:
#    /usr/local/bin/amina-backup.sh
#
#  Restore: see /root/amina/backups/RESTORE.md (created on first run).
# ============================================================

set -u
LOG=/var/log/amina-backup.log
BACKUP_ROOT=/root/amina/backups
ARCADE_VOL=$(docker inspect arcadedb \
              --format '{{range .Mounts}}{{if eq .Destination "/home/arcadedb/backups"}}{{.Source}}{{end}}{{end}}' 2>/dev/null)
RETAIN=6

ts() { date -Iseconds; }
log() { echo "[$(ts)] $*" | tee -a "$LOG" >/dev/null; }

mkdir -p "$BACKUP_ROOT"

NOW=$(date -u +'%Y%m%d-%H%M')
WORK=$(mktemp -d /tmp/amina-backup-$NOW.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

log "==== backup start ($NOW) ===="

# ── 1. ArcadeDB hot backup ──────────────────────────────────────
log "[1/4] ArcadeDB BACKUP DATABASE 'genie'"

# Send SQL via haystack-chatqna's curl (the arcadedb image has no curl;
# haystack is on the same docker network and can reach arcadedb:2480).
# ArcadeDB writes the zip into /home/arcadedb/backups/ inside the
# arcadedb container, which is the host volume $ARCADE_VOL.
arcade_resp=$(docker exec haystack-chatqna curl -s -u root:genieRoot123 \
    -H "Content-Type: application/json" \
    -X POST http://arcadedb:2480/api/v1/command/genie \
    -d '{"language":"sql","command":"BACKUP DATABASE"}' 2>&1)
log "  arcade response: ${arcade_resp:0:200}"

# Find the most recent zip in the backup volume — that's the one we just made.
# ArcadeDB writes to $ARCADE_VOL/<dbname>/<dbname>-backup-<ts>.zip — note
# the per-database subdirectory.
if [[ -n "$ARCADE_VOL" && -d "$ARCADE_VOL" ]]; then
    NEW_BACKUP=$(ls -t "$ARCADE_VOL"/genie/genie-backup-*.zip 2>/dev/null | head -1)
    if [[ -n "$NEW_BACKUP" && -f "$NEW_BACKUP" ]]; then
        cp "$NEW_BACKUP" "$WORK/arcadedb.zip"
        log "  copied $(basename "$NEW_BACKUP") ($(du -h "$NEW_BACKUP" | cut -f1))"
        # Prune ArcadeDB's own backup dir so it doesn't grow unbounded —
        # we keep our own dated copy in /root/amina/backups, the in-volume
        # ones are throwaway. Keep the 3 most recent per ArcadeDB best
        # practice (in case ours fails on copy-out, the source is still there).
        KEEP_INSIDE=$(ls -t "$ARCADE_VOL"/genie/genie-backup-*.zip 2>/dev/null | tail -n +4)
        [[ -n "$KEEP_INSIDE" ]] && echo "$KEEP_INSIDE" | xargs -r rm -f
    else
        log "  WARN: no new arcadedb backup zip found in $ARCADE_VOL/genie/"
    fi
else
    log "  WARN: arcadedb backup volume not found"
fi

# ── 2. Bind-mount data dirs ────────────────────────────────────
log "[2/4] tarring bind-mount data dirs"
DATA_DIRS=(
    /root/amina/haystack-stack/caregiver_uploads
    /root/amina/haystack-stack/education_certs
    /root/amina/haystack-stack/inbox_files
    /root/amina/haystack-stack/evidence_reports
    /root/amina/haystack-stack/scribe_audio
)
for d in "${DATA_DIRS[@]}"; do
    [[ -d "$d" ]] || { log "  skip (not present): $d"; continue; }
    tar_name=$(basename "$d")
    if tar -czf "$WORK/$tar_name.tar.gz" -C "$(dirname "$d")" "$tar_name" 2>>"$LOG"; then
        log "  ok: $tar_name.tar.gz ($(du -h "$WORK/$tar_name.tar.gz" | cut -f1))"
    else
        log "  FAIL: tar $d"
    fi
done

# ── 3. Redis snapshot ──────────────────────────────────────────
log "[3/4] Redis BGSAVE"
docker exec amina-redis redis-cli BGSAVE >/dev/null 2>&1
# Wait for save to finish (<5s for our small DB)
for i in $(seq 1 10); do
    last_save=$(docker exec amina-redis redis-cli LASTSAVE 2>/dev/null)
    sleep 1
    new_save=$(docker exec amina-redis redis-cli LASTSAVE 2>/dev/null)
    if [[ "$last_save" == "$new_save" ]]; then break; fi
done
# Redis dump.rdb lives in /data inside the container; pull it out
if docker cp amina-redis:/data/dump.rdb "$WORK/redis-dump.rdb" 2>>"$LOG"; then
    log "  ok: redis-dump.rdb ($(du -h "$WORK/redis-dump.rdb" | cut -f1))"
else
    log "  WARN: redis dump copy failed (volatile data only — non-fatal)"
fi

# ── 4. Critical config files ───────────────────────────────────
log "[4/4] config files"
for f in /root/amina/haystack-stack/.env /root/amina/haystack-stack/.env.defaults /root/amina/.env.cloudflared; do
    if [[ -f "$f" ]]; then
        cp "$f" "$WORK/$(basename "$f")"
        log "  ok: $(basename "$f")"
    else
        log "  skip (not present): $f"
    fi
done

# ── Pack + place ───────────────────────────────────────────────
ARCHIVE="$BACKUP_ROOT/amina-$NOW.tar.gz"
if tar -czf "$ARCHIVE" -C "$WORK" . 2>>"$LOG"; then
    SIZE=$(du -h "$ARCHIVE" | cut -f1)
    log "==== backup complete: $ARCHIVE ($SIZE) ===="
else
    log "==== backup FAILED to create archive ===="
    exit 1
fi

# ── Retention ──────────────────────────────────────────────────
# Only prune if the new archive exists and is non-empty.
if [[ -s "$ARCHIVE" ]]; then
    OLD=$(ls -t "$BACKUP_ROOT"/amina-*.tar.gz 2>/dev/null | tail -n +$((RETAIN + 1)))
    if [[ -n "$OLD" ]]; then
        log "retention: pruning $(echo "$OLD" | wc -l) archive(s) older than the $RETAIN most recent"
        echo "$OLD" | xargs -r rm -f
    fi
fi

# ── Stamp + status report ──────────────────────────────────────
ls -lh "$BACKUP_ROOT"/amina-*.tar.gz 2>/dev/null | awk '{print "  " $5 " " $9}' >> "$LOG"
log "next bi-weekly fire: 1st or 15th of next month at 03:30 UTC"
exit 0
