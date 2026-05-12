# AMINA Messenger (Meta) Bot — Security & 24/7 Architecture

**Channel:** Facebook Messenger via Meta Messenger Platform (Graph API v19.0)
**Public webhook URL:** `https://api.amina-design.com/api/v1/meta/webhook/messenger`
**Backend container:** `haystack-chatqna`
**Backend routes:** [meta_routes.py](../../haystack-stack/haystack-chatqna/src/api/meta_routes.py)
**Adapter:** [meta_bridge.py](../../haystack-stack/haystack-chatqna/src/services/meta_bridge.py) — `MessengerBridge` class

This document is the production-state runbook for the Messenger bot. It
mirrors [telegram-bot-security.md](./telegram-bot-security.md) and
[whatsapp-bot-security.md](./whatsapp-bot-security.md) but documents the
Meta-specific signing model and App Dashboard webhook flow.

---

## 1. Why this exists

Same threat model as the other channels:

1. **Cloudflare Bot Fight Mode** issues a "Just a moment…" Managed Challenge
   to any POST that arrives without a valid User-Agent. Meta sometimes
   retries with a bare UA (or one CF doesn't recognise), so without a WAF
   Skip rule, legitimate webhook deliveries get 403'd at the edge.
2. **Public webhook URL is discoverable.** Once a domain is known, anyone
   can POST forged `messaging` payloads. The app trusts `sender.id` and
   `message.text` to invoke the agent — abuse vector for spam, prompt
   injection, or replying to attacker-chosen PSIDs through our page token.

Defence model: CF WAF Skip (let real Meta traffic in) + app-level
HMAC-SHA256 signature validation (keep impostors out) + verify-token
handshake (prevent webhook hijack during App Dashboard setup).

## 2. End-to-end traffic path

```
Meta (User-Agent: facebookplatform/1.0 (+http://developers.facebook.com))
  │
  ▼
Cloudflare edge       ← WAF Skip rule lets the path through
  │
  ▼
cloudflared (named tunnel)
  │
  ▼
amina-gateway-lb      ← falls through to default location /
  │
  ▼
amina-gateway-{1,2}   ← FastAPI gateway proxy
  │                     proxies /api/v1/* to haystack-chatqna
  ▼
haystack-chatqna      ← verify-token (GET) OR signature check (POST) + agent
                       routes in meta_routes.py
                       payload normalised by MessengerBridge.parse_inbound
                       reply sent via Graph API /me/messages
```

## 3. Three security gates

### 3.1 Verify-token handshake (GET)

When Meta first connects (or reconnects after a token rotation) it sends
a `GET /webhook/messenger?hub.mode=subscribe&hub.verify_token=<X>&hub.challenge=<Y>`.
We echo `<Y>` only if `<X>` matches `MESSENGER_VERIFY_TOKEN`. Wrong token
→ HTTP 403.

This is what stops an attacker from registering their own webhook URL on
top of our App ID — without the verify token they can't complete Meta's
handshake.

### 3.2 X-Hub-Signature-256 (POST)

Meta computes:

```
HMAC-SHA256(app_secret, raw_body) → hex → "sha256=<hex>"
```

…and sends it in `X-Hub-Signature-256`. The app re-computes against the
**raw request body bytes** (not the parsed JSON — byte-exact match
matters) and rejects mismatches with HTTP 403 `{"detail":"bad signature"}`.

### 3.3 CF WAF Skip rule (edge)

Without this, Meta's POSTs get challenged by Bot Fight Mode and never
reach the app at all. Same pattern as Telegram and Twilio.

## 4. Environment

```
# /root/amina/haystack-stack/.env (mode 0644 in docker group)
FACEBOOK_APP_ID=<your meta app id>
FACEBOOK_APP_SECRET=<from Meta App Dashboard → Basic Settings>
MESSENGER_APP_SECRET=<same value — kept separately for the bridge>
MESSENGER_PAGE_ACCESS_TOKEN=<from Meta App → Messenger → Settings → Access Tokens>
MESSENGER_VERIFY_TOKEN=amina_health_2026
META_GRAPH_VERSION=v19.0
```

Wired into the container via the compose override:

```yaml
# docker-compose.override.yml — haystack-chatqna service env:
MESSENGER_PAGE_ACCESS_TOKEN: ${MESSENGER_PAGE_ACCESS_TOKEN:-}
MESSENGER_VERIFY_TOKEN:      ${MESSENGER_VERIFY_TOKEN:-amina_health_2026}
MESSENGER_APP_SECRET:        ${MESSENGER_APP_SECRET:-}
META_GRAPH_VERSION:          ${META_GRAPH_VERSION:-v19.0}
```

## 5. Cloudflare WAF Custom Rule

**Zone:** `amina-design.com`
**Rule name:** `Skip security for Messenger webhook`
**When incoming requests match:**

```
(http.host eq "api.amina-design.com" and
 http.request.uri.path eq "/api/v1/meta/webhook/messenger" and
 http.request.method eq "POST")
```

**Then:** `Skip` → check *Managed Rules*, *Rate Limiting Rules*,
*Super Bot Fight Mode*. Order: First (matches the Telegram + Twilio
rules' placement).

The GET verify handshake works fine without a Skip rule because Meta
sends a normal UA and CF doesn't challenge GET requests as aggressively.

## 6. Meta App Dashboard configuration

One-time setup (Meta has already approved this app — page token is
live and Graph API returns `{"name":"Amina","id":"1047710801765129"}`):

1. **App Dashboard** → Messenger → Settings → **Webhooks**:
   - Callback URL: `https://api.amina-design.com/api/v1/meta/webhook/messenger`
   - Verify Token: `amina_health_2026`
   - Subscription Fields: `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`
2. **Page Access Tokens** → "Add or Remove Pages" → select the Amina Page
   → copy the page token into `MESSENGER_PAGE_ACCESS_TOKEN`.
3. **App Review** → if the Page is in public mode, Messenger requires
   Standard Access for `pages_messaging` permission. Without it, only
   admins/testers/developers of the FB App can message the bot.

## 7. Verified scenarios (e2e — 2026-05-12)

| # | Scenario                                                    | Expected | Result |
|---|-------------------------------------------------------------|----------|--------|
| A | GET verify with correct token → echo challenge              | 200 | PASS |
| B | GET verify with WRONG token                                 | 403 | PASS |
| C | POST with correct `X-Hub-Signature-256`                     | 200 + agent invoked | PASS |
| D | POST with NO signature header                               | 403 `bad signature` | PASS |
| E | POST with WRONG signature                                   | 403 `bad signature` | PASS |
| F | POST varied body, correct signature, agent runs end-to-end  | 200 + agent invoked | PASS |

`AGENT_TRACE` confirms `"channel":"messenger"` on valid POSTs.

## 8. 24/7 reliability stack

Four watchdogs cover messaging now:

| Watchdog | Cadence | Scope | Action on failure |
|----------|---------|-------|-------------------|
| `amina-watchdog.sh` | every 5 min | container-level: `haystack-chatqna` in CRITICAL list | restart unhealthy/exited container |
| `amina-telegram-watchdog.sh` | every 15 min | Telegram URL drift | re-register webhook |
| `amina-whatsapp-watchdog.sh` | every 15 min | `/api/v1/twilio/whatsapp/health` + signature_validation + pinned URL | log + non-zero exit |
| `amina-messenger-watchdog.sh` | every 15 min | (1) verify-token handshake reachable end-to-end (2) `/api/v1/meta/status` reports `messenger.enabled=true` & `signature_checks=true` (3) Graph API confirms page token still valid | log + non-zero exit |

Log: `/var/log/amina-messenger-watchdog.log` (rotated weekly via
`/etc/logrotate.d/amina`).

Cron snapshot:

```
*/5  * * * * /usr/local/bin/amina-watchdog.sh
*/15 * * * * /usr/local/bin/amina-telegram-watchdog.sh
*/15 * * * * /usr/local/bin/amina-whatsapp-watchdog.sh
*/15 * * * * /usr/local/bin/amina-messenger-watchdog.sh
```

## 9. Common failure modes & recovery

| Symptom | Likely cause | Recovery |
|---------|--------------|----------|
| All POSTs return 403 `bad signature` | `MESSENGER_APP_SECRET` rotated in Meta dashboard, not in `.env` | Update `.env`, recreate `haystack-chatqna` |
| GET verify returns 403 `verify token mismatch` | `MESSENGER_VERIFY_TOKEN` mismatch with Meta App Dashboard | Align both sides; update whichever is wrong |
| `/status` shows `messenger.enabled=false` | `MESSENGER_PAGE_ACCESS_TOKEN` blank or revoked | Re-issue page token from Meta App → Messenger → Access Tokens |
| Watchdog reports `Graph API rejected page token` | Token revoked, page admin changed, or app review status downgraded | Re-issue page token; verify app is still in good standing in App Review |
| No-UA POSTs get `error code 1010` / "Just a moment..." HTML | CF WAF Skip rule missing or disabled | Restore rule (§5) |
| Webhook returns 200 but the user never gets a reply | Bot is not allowed to message the user (24h window for non-checkbox users; or `pages_messaging` perm not granted) | Test from a user who has messaged the page in the last 24h; or get Meta App Review approval for Standard Access |

## 10. Secrets inventory

| Secret | Where it lives | Who reads it |
|--------|----------------|--------------|
| `MESSENGER_APP_SECRET` | `/root/amina/haystack-stack/.env` (mode 0644 in docker group) | `haystack-chatqna` container env at start |
| `MESSENGER_PAGE_ACCESS_TOKEN` | same | same — used for both inbound auth and outbound Graph API calls |
| `MESSENGER_VERIFY_TOKEN` | same — shared with Meta App Dashboard | same |

**Rotation:**
- App secret: rotate in Meta App → Basic Settings → App Secret → Reset.
  Then update `.env` and recreate haystack-chatqna. Watchdog flags within 15 min.
- Page access token: in production these should be long-lived; if rotated,
  re-issue from Messenger → Access Tokens, paste into `.env`, recreate.
- Verify token: change in `.env`, recreate container, then enter the new
  value in Meta App Dashboard → Webhooks → Edit Callback URL and click
  "Verify and Save". Meta will perform the GET handshake to confirm.

## 11. Testing locally

```bash
# From the A40, run the same e2e the production smoke test uses:
SECRET=$(docker exec haystack-chatqna printenv MESSENGER_APP_SECRET)
echo "$SECRET" | python3 /tmp/messenger_e2e.py
```

`messenger_e2e.py` exercises the 6 scenarios above. Re-create it from
the pattern in [whatsapp-bot-security.md §10](./whatsapp-bot-security.md#10-testing-locally) if missing.
