#!/usr/bin/env bash
# ============================================================
#  AMINA WhatsApp (Twilio) webhook watchdog
# ============================================================
#  Runs every 15 min via cron. Twilio doesn't expose a
#  "registered webhook URL" API like Telegram does — instead the
#  webhook URL is configured once in the Twilio Console per the
#  WhatsApp Sender. So this watchdog can't re-register a drifted
#  URL; instead it watches the things we CAN observe:
#
#    1. /api/v1/twilio/whatsapp/health is reachable end-to-end
#       (CF -> cloudflared -> gateway-lb -> haystack-chatqna)
#    2. signature_validation is reported as true
#    3. TWILIO_AUTH_TOKEN is set inside the container
#
#  If any check fails we just log + alert (loud entries). We don't
#  bounce containers here — the broader amina-watchdog.sh handles
#  container restarts for haystack-chatqna already.
#
#  Log: /var/log/amina-whatsapp-watchdog.log (rotated weekly via
#  the existing /etc/logrotate.d/amina rule).
# ============================================================
set -u

LOG=/var/log/amina-whatsapp-watchdog.log
HEALTH_URL="https://api.amina-design.com/api/v1/twilio/whatsapp/health"

ts()  { date -Iseconds; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# 1. End-to-end health probe via the public URL (proves the whole
#    proxy chain works, not just the container).
#    User-Agent matters: CF Bot Fight Mode blocks no-UA probes.
resp=$(curl -sS --max-time 10 \
    -H "User-Agent: amina-whatsapp-watchdog/1.0" \
    "$HEALTH_URL" 2>&1)
code=$?
if [[ $code -ne 0 ]]; then
    log "FAIL: health endpoint unreachable (curl exit=$code) — $resp"
    exit 1
fi

# 2. Parse JSON (status + signature_validation)
status=$(echo "$resp" | grep -oE '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
sigval=$(echo "$resp" | grep -oE '"signature_validation":(true|false)' | head -1 | cut -d: -f2)
auth=$(echo "$resp" | grep -oE '"auth_token_present":(true|false)' | head -1 | cut -d: -f2)

if [[ "$status" != "ok" ]]; then
    log "FAIL: /health returned status='$status' (expected 'ok') — full: ${resp:0:300}"
    exit 2
fi

if [[ "$sigval" != "true" ]]; then
    log "FAIL: signature_validation=$sigval (expected true). TWILIO_VALIDATE_SIGNATURE flipped off?"
    exit 3
fi

if [[ "$auth" != "true" ]]; then
    log "FAIL: auth_token_present=$auth (TWILIO_AUTH_TOKEN missing in container env)"
    exit 4
fi

# 3. Sanity: TWILIO_WEBHOOK_PUBLIC_URL is set inside the container.
#    Otherwise the signature validator falls back to header
#    reconstruction, which fails because the proxy chain strips
#    X-Forwarded-Proto/Host (see whatsapp-bot-security.md §3).
pinned=$(docker exec haystack-chatqna printenv TWILIO_WEBHOOK_PUBLIC_URL 2>/dev/null || echo "")
if [[ -z "$pinned" ]]; then
    log "FAIL: TWILIO_WEBHOOK_PUBLIC_URL not set inside haystack-chatqna — signature validation will silently start rejecting everything"
    exit 5
fi

log "OK: health=ok signature_validation=true auth_token_present=true pinned_url=${pinned}"
exit 0
