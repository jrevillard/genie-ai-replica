#!/usr/bin/env bash
# ============================================================
#  AMINA Messenger (Meta) webhook watchdog
# ============================================================
#  Runs every 15 min via cron. Meta doesn't expose a per-page
#  "registered webhook URL" API like Telegram does — the URL is
#  set in the App Dashboard once and webhook subscriptions are
#  attached to the Page. So like the WhatsApp watchdog, we
#  monitor the things we CAN observe end-to-end:
#
#    1. The verify-token GET handshake works through the full
#       chain (CF -> cloudflared -> gateway-lb -> haystack-chatqna).
#       This is the same handshake Meta does when (re)connecting,
#       so if it breaks, every webhook delivery will silently 5xx.
#    2. /api/v1/meta/status reports messenger.enabled=true and
#       messenger.signature_checks=true.
#    3. The MESSENGER_PAGE_ACCESS_TOKEN is still valid against
#       Graph API (Meta tokens can expire/get revoked).
#
#  We don't bounce containers — the broader amina-watchdog.sh
#  handles haystack-chatqna restarts already.
#
#  Log: /var/log/amina-messenger-watchdog.log (rotated weekly via
#  the existing /etc/logrotate.d/amina rule).
# ============================================================
set -u

LOG=/var/log/amina-messenger-watchdog.log
STATUS_URL="https://api.amina-design.com/api/v1/meta/status"
VERIFY_URL="https://api.amina-design.com/api/v1/meta/webhook/messenger"

ts()  { date -Iseconds; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# 1. Read the verify token from inside the container (single source of truth).
VTOK=$(docker exec haystack-chatqna printenv MESSENGER_VERIFY_TOKEN 2>/dev/null)
if [[ -z "$VTOK" ]]; then
    log "FAIL: MESSENGER_VERIFY_TOKEN not set inside haystack-chatqna (signature handshake will fail)"
    exit 1
fi

# 2. End-to-end verify-token handshake through the public URL.
#    User-Agent matters: CF Bot Fight Mode blocks no-UA probes.
ch="wd_$(date +%s)"
resp=$(curl -sS --max-time 10 \
    -H "User-Agent: amina-messenger-watchdog/1.0" \
    "${VERIFY_URL}?hub.mode=subscribe&hub.verify_token=${VTOK}&hub.challenge=${ch}" 2>&1)
code=$?
if [[ $code -ne 0 ]]; then
    log "FAIL: verify endpoint unreachable (curl exit=$code) — ${resp:0:200}"
    exit 2
fi
if [[ "$resp" != "$ch" ]]; then
    log "FAIL: verify handshake did not echo challenge. expected='$ch' got='${resp:0:200}'"
    exit 3
fi

# 3. /status reports messenger enabled + signature_checks on.
status=$(curl -sS --max-time 10 \
    -H "User-Agent: amina-messenger-watchdog/1.0" \
    "$STATUS_URL" 2>&1)
m_enabled=$(echo "$status" | grep -oE '"messenger":\s*\{[^}]*\}' | head -1)
if [[ -z "$m_enabled" ]]; then
    log "FAIL: /status returned no messenger block — full: ${status:0:300}"
    exit 4
fi
echo "$m_enabled" | grep -q '"enabled":\s*true' || { log "FAIL: messenger.enabled != true — $m_enabled"; exit 5; }
echo "$m_enabled" | grep -q '"signature_checks":\s*true' || { log "FAIL: messenger.signature_checks != true — $m_enabled"; exit 6; }

# 4. Graph API token sanity. Tokens can be revoked when the FB
#    app passes/fails review, or a page admin rotates them.
TOK=$(docker exec haystack-chatqna printenv MESSENGER_PAGE_ACCESS_TOKEN 2>/dev/null)
if [[ -z "$TOK" ]]; then
    log "FAIL: MESSENGER_PAGE_ACCESS_TOKEN missing inside container"
    exit 7
fi
me=$(curl -sS --max-time 10 \
    "https://graph.facebook.com/v19.0/me?access_token=${TOK}" 2>&1)
if echo "$me" | grep -q '"error"'; then
    err=$(echo "$me" | grep -oE '"message":"[^"]*"' | head -1)
    log "FAIL: Graph API rejected page token — $err"
    exit 8
fi

page_name=$(echo "$me" | grep -oE '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
log "OK: verify_handshake=ok messenger_enabled=true signature_checks=true page=\"$page_name\""
exit 0
