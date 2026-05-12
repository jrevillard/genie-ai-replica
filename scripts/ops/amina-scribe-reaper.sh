#!/usr/bin/env bash
# ============================================================
#  AMINA scribe orphan-audio reaper — runs daily via cron
# ============================================================
#  Calls scribe_service.cleanup_orphan_audio_files() inside the
#  haystack-chatqna container so we use the same code path the
#  service knows about (Redis client, SCRIBE_DIR resolution).
#
#  Triggered by Bug 5: every abandoned /scribe/start leaves a
#  webm file on disk that becomes an orphan once the Redis
#  session TTL (2h) expires. With real recordings, this would
#  grow unbounded.
#
#  Schedule: 03:15 UTC daily — well outside the 03:30 backup
#  window so the two cron jobs never contend for arcadedb.
#
#  Logs: /var/log/amina-scribe-reaper.log (logrotated weekly).
# ============================================================
set -u
LOG=/var/log/amina-scribe-reaper.log
ts() { date -Iseconds; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

log "==== reap start ===="

# Run inside the haystack container so SCRIBE_DIR + REDIS_URL match what
# the service uses at request time. 1h grace = the threshold below which
# we treat a file as "in-flight create_session, don't reap".
out=$(docker exec haystack-chatqna python -c "
from src.services.scribe_service import cleanup_orphan_audio_files
import json
print(json.dumps(cleanup_orphan_audio_files(grace_seconds=3600)))
" 2>&1)
rc=$?

if [[ $rc -ne 0 ]]; then
    log "FAIL  haystack exec returned $rc: ${out:0:300}"
    exit 1
fi
log "OK    ${out}"

# Show current scribe dir size for the log
size=$(du -sh /root/amina/haystack-stack/scribe_audio 2>/dev/null | cut -f1)
files=$(ls /root/amina/haystack-stack/scribe_audio 2>/dev/null | wc -l)
log "post-reap scribe_audio: ${files} files, ${size}"

exit 0
