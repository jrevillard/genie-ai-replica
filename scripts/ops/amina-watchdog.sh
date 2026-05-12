#!/usr/bin/env bash
# ============================================================
#  AMINA backend watchdog — runs every 5 min via cron
# ============================================================
#  Detects + recovers from these failure modes:
#
#   1. Container exited / dead    → docker start (covers cases where
#                                   restart: unless-stopped failed,
#                                   e.g. it was manually stopped)
#   2. Container "unhealthy" >30s → docker restart
#   3. Production URL not 200     → log alert (manual investigation)
#   4. amina-cloudflared with no  → docker restart cloudflared
#      QUIC connections registered
#
#  Output: /var/log/amina-watchdog.log (logrotated weekly)
#
#  NEVER restarts arcadedb (data corruption risk on cold restart) or
#  voice-tts during active synth (cuts user audio mid-sentence) —
#  those need manual intervention, but we log clearly.
# ============================================================

set -u
LOG=/var/log/amina-watchdog.log
ts() { date -Iseconds; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# Counter for actions taken this cycle (used by the closing heartbeat
# so the log proves both "watchdog ran" and "what it did").
actions=0

# Containers we'll auto-recover. Order matters for log readability,
# not behaviour.
CRITICAL=(
    haystack-chatqna
    amina-gateway
    amina-gateway-2
    amina-gateway-lb
    amina-cloudflared
    amina-redis
    voice-stt
    voice-tts-mnk
    nllb-translate
    multichannel-access
    multichannel-redis
    dataprep-worker
)

# Containers we monitor but never auto-restart (would cause data loss
# or user-visible cut-off mid-operation).
FRAGILE=(
    arcadedb         # cold restart can corrupt page cache mid-write
    voice-tts        # don't cut off active TTS synth
)

# ── 1+2. Per-container health ────────────────────────────────────
for c in "${CRITICAL[@]}"; do
    state=$(docker inspect "$c" --format '{{.State.Status}}' 2>/dev/null)
    if [[ -z "$state" ]]; then
        log "MISSING container $c — start-amina.sh likely needs to be re-run"
        continue
    fi

    if [[ "$state" == "exited" || "$state" == "dead" ]]; then
        log "RECOVER $c is $state, starting"
        if docker start "$c" >/dev/null 2>&1; then
            log "  ok: $c started"
            ((actions++))
        else
            log "  FAIL: $c could not be started"
        fi
        continue
    fi

    # Healthcheck-aware containers (most have one)
    health=$(docker inspect "$c" --format '{{.State.Health.Status}}' 2>/dev/null)
    if [[ "$health" == "unhealthy" ]]; then
        log "DETECT $c unhealthy, sleeping 30s grace before restart"
        sleep 30
        health2=$(docker inspect "$c" --format '{{.State.Health.Status}}' 2>/dev/null)
        if [[ "$health2" == "unhealthy" ]]; then
            log "RECOVER $c still unhealthy after grace, restarting"
            if docker restart "$c" >/dev/null 2>&1; then
                log "  ok: $c restarted"
                ((actions++))
            else
                log "  FAIL: $c restart errored"
            fi
        else
            log "  $c recovered to $health2 during grace, no action"
        fi
    fi
done

# Fragile containers: log only
for c in "${FRAGILE[@]}"; do
    state=$(docker inspect "$c" --format '{{.State.Status}}' 2>/dev/null)
    health=$(docker inspect "$c" --format '{{.State.Health.Status}}' 2>/dev/null)
    if [[ "$state" != "running" || "$health" == "unhealthy" ]]; then
        log "WARN fragile $c state=$state health=$health (manual restart needed)"
    fi
done

# ── 3. External probe ─────────────────────────────────────────────
status=$(curl -s -A 'Mozilla/5.0 (amina-watchdog)' -o /dev/null \
              -w '%{http_code}' -m 10 https://api.amina-design.com/health 2>/dev/null)
if [[ "$status" != "200" ]]; then
    log "ALERT prod URL api.amina-design.com/health returned $status (expected 200)"
fi

# ── 4. cloudflared connection count ───────────────────────────────
# A healthy named-tunnel should have 4 registered connections; if 0 the
# tunnel is up but disconnected — restart it to force re-handshake.
conns=$(docker logs amina-cloudflared --tail 200 2>&1 \
        | grep -c "Registered tunnel connection")
# Count is cumulative since container start; what we actually want is
# whether the tunnel is currently CONNECTED. Easier signal: any error
# in the last 60s.
recent_errs=$(docker logs amina-cloudflared --since 60s 2>&1 \
              | grep -cE "ERR|tunnel connection failed|disconnected")
if (( recent_errs > 5 )); then
    log "ALERT amina-cloudflared has $recent_errs errors in last 60s, restarting"
    if docker restart amina-cloudflared >/dev/null 2>&1; then
        log "  ok: cloudflared restarted"
        ((actions++))
    else
        log "  FAIL: cloudflared restart errored"
    fi
fi

# ── Heartbeat ───────────────────────────────────────────────────
# One line at the end of every cycle proves the watchdog is alive
# without needing to grep syslog. `actions=0` is the steady-state
# (everything healthy, no recovery needed); >0 means we did something
# this cycle, with the preceding RECOVER/ALERT lines explaining what.
log "tick actions=$actions"
exit 0
