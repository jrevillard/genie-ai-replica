# AMINA WhatsApp (Twilio) Bot — Security & 24/7 Architecture

**Channel:** WhatsApp via Twilio Programmable Messaging (Sandbox + Business)
**Public webhook URL:** `https://api.amina-design.com/api/v1/twilio/whatsapp/webhook`
**Backend container:** `haystack-chatqna`
**Backend route:** `POST /api/v1/twilio/whatsapp/webhook` (in [twilio_whatsapp_routes.py](../../haystack-stack/haystack-chatqna/src/api/twilio_whatsapp_routes.py))

This document is the production-state runbook for the WhatsApp bot. It mirrors
the structure of [telegram-bot-security.md](./telegram-bot-security.md) but
documents the differences forced by Twilio's signing model.

---

## 1. Why this exists (incident driver)

The Telegram bot was first to run into the same class of public-webhook attacks:

1. **Cloudflare Bot Fight Mode** blocks the no-User-Agent POSTs that messaging
   platforms send (Twilio sends `User-Agent: TwilioProxy/1.1`, Telegram sends
   none). Without a WAF Skip rule, every legitimate webhook returns HTTP 403
   from Cloudflare's edge.
2. **Public webhook URL is discoverable** — once a domain is known, anyone can
   POST forged Twilio-shape payloads. The app trusts `From` / `Body` / `MessageSid`
   form fields to invoke the agent, which can be abused for spam, prompt
   injection, or fraudulent message delivery.

Defence model: CF WAF Skip (to let real Twilio traffic in) + app-level HMAC
signature validation (to keep impostors out). Unlike Telegram, Twilio's
signature is dynamic per-request and depends on the URL plus the form body,
so the check has to happen in the application (nginx can't easily compute
HMAC-SHA1 over URL + sorted form params).

## 2. End-to-end traffic path

```
Twilio (User-Agent: TwilioProxy/1.1)
  │
  ▼
Cloudflare edge        ← WAF Skip rule lets the path through
  │
  ▼
cloudflared (named tunnel)
  │
  ▼
amina-gateway-lb       ← nginx LB, no special handling for /api/v1/twilio/*
  │                      (falls through to default /  → amina-gateways)
  ▼
amina-gateway-{1,2}    ← FastAPI gateway proxy
  │                      proxies /api/v1/* to haystack-chatqna
  ▼
haystack-chatqna       ← signature validation (HMAC-SHA1) + agent dispatch
```

The proxy chain (gateway-lb → amina-gateway → haystack-chatqna) **does not
preserve `X-Forwarded-Proto` or `X-Forwarded-Host`**, so the app sees the
request as `http://haystack-chatqna:8000/...`. That broke signature
validation. See §3 for the fix.

## 3. Why we pin the public URL (TWILIO_WEBHOOK_PUBLIC_URL)

Twilio computes the request signature as:

```
HMAC-SHA1(
    auth_token,
    public_url + "".join(k + v for k, v in sorted(form_params))
)  → base64
```

…where `public_url` is **the exact URL configured in the Twilio Console**, not
the URL the bot sees on the wire. With our multi-hop proxy chain dropping
`X-Forwarded-*`, the app would reconstruct
`http://haystack-chatqna:8000/api/v1/twilio/whatsapp/webhook` and compute a
mismatched signature against Twilio's
`https://api.amina-design.com/api/v1/twilio/whatsapp/webhook`.

Fix: env var `TWILIO_WEBHOOK_PUBLIC_URL` is the source of truth. The validator
in [twilio_whatsapp_routes.py](../../haystack-stack/haystack-chatqna/src/api/twilio_whatsapp_routes.py)
prefers this pinned value over header reconstruction.

```
# .env
TWILIO_WEBHOOK_PUBLIC_URL=https://api.amina-design.com/api/v1/twilio/whatsapp/webhook
TWILIO_VALIDATE_SIGNATURE=true
TWILIO_AUTH_TOKEN=<from Twilio Console > General Settings>
```

Wired into the container via the compose override:

```yaml
# docker-compose.override.yml — haystack-chatqna service env:
TWILIO_VALIDATE_SIGNATURE:   ${TWILIO_VALIDATE_SIGNATURE:-false}
TWILIO_WEBHOOK_PUBLIC_URL:   ${TWILIO_WEBHOOK_PUBLIC_URL:-}
```

**Rotation procedure** if the public URL ever changes (new domain, new path):

1. Update `TWILIO_WEBHOOK_PUBLIC_URL` in `/root/amina/haystack-stack/.env`
2. `docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --no-deps haystack-chatqna`
3. Update the **same** URL in Twilio Console → Messaging → WhatsApp Sender →
   "When a message comes in" → POST
4. Wait for the next 15-min cron; the watchdog will confirm `signature_validation:true`

## 4. Cloudflare WAF Custom Rule

**Zone:** `amina-design.com`
**Rule name:** `Skip security for Twilio WhatsApp webhook`
**When incoming requests match:**

```
(http.host eq "api.amina-design.com" and
 http.request.uri.path eq "/api/v1/twilio/whatsapp/webhook" and
 http.request.method eq "POST")
```

**Then:** `Skip`
- Skip remaining custom rules
- Skip phases: Managed Rules, Rate Limiting Rules, Super Bot Fight Mode

This rule is **path-exact for POST only**, so the rest of the API still gets
full WAF + Bot Fight Mode protection.

## 5. App-level signature validation

[twilio_whatsapp_routes.py](../../haystack-stack/haystack-chatqna/src/api/twilio_whatsapp_routes.py) does:

```python
if TWILIO_VALIDATE_SIGNATURE and TWILIO_AUTH_TOKEN:
    form = await request.form()
    form_dict = {k: v for k, v in form.items() if isinstance(v, str)}
    full_url = TWILIO_WEBHOOK_PUBLIC_URL or _reconstruct_from_headers(request)
    if not _validate_twilio_signature(full_url, form_dict, x_twilio_signature):
        raise HTTPException(403, detail="bad_signature")
```

Mismatch returns **HTTP 403 `{"detail":"bad_signature"}`**. Twilio retries on
5xx but **not** on 4xx, so we deliberately use 403 to break the loop and
prevent log spam from forged requests.

## 6. Verified scenarios (e2e — 2026-05-12)

| # | Scenario                                       | Expected | Result |
|---|------------------------------------------------|----------|--------|
| A | Correct `X-Twilio-Signature` (real token)      | 200 + TwiML | PASS |
| B | Missing `X-Twilio-Signature` header            | 403 `bad_signature` | PASS |
| C | Wrong/forged signature                         | 403 `bad_signature` | PASS |
| D | Correct signature, varied body content         | 200 + agent reply | PASS |
| E | GET `/health` (no signature required)          | 200 JSON | PASS |

The agent runs end-to-end (planner → tool gates → reply) on every valid request.
Twilio sandbox can't deliver replies to fake `From` numbers (returns error
63007) — that's expected and not a defence regression.

## 7. 24/7 reliability stack

**Three independent watchdogs cover this channel:**

| Watchdog | Cadence | Scope | Action on failure |
|----------|---------|-------|-------------------|
| `amina-watchdog.sh` | every 5 min | container-level: `haystack-chatqna` in CRITICAL list | restart unhealthy/exited container |
| `amina-whatsapp-watchdog.sh` | every 15 min | end-to-end probe of `/api/v1/twilio/whatsapp/health` + `signature_validation` flag + pinned URL env var | log + exit non-zero (alerting hook) |
| `amina-telegram-watchdog.sh` | every 15 min | Telegram-specific (unrelated, but proves the pattern) | re-register Telegram webhook on URL drift |

Log: `/var/log/amina-whatsapp-watchdog.log` (rotated weekly via
`/etc/logrotate.d/amina`).

Cron snapshot:

```
*/5  * * * * /usr/local/bin/amina-watchdog.sh
*/15 * * * * /usr/local/bin/amina-telegram-watchdog.sh
*/15 * * * * /usr/local/bin/amina-whatsapp-watchdog.sh
```

## 8. Common failure modes & recovery

| Symptom | Likely cause | Recovery |
|---------|--------------|----------|
| Every request 403 `bad_signature` | `TWILIO_WEBHOOK_PUBLIC_URL` missing or wrong scheme | Set env var, recreate `haystack-chatqna` |
| Every request 403 from CF (HTML body, "error code 1010") | CF WAF Skip rule deleted/disabled | Restore rule (§4) |
| Twilio Console shows webhook errors but app log is silent | Cloudflared tunnel down OR gateway-lb down | `docker logs amina-cloudflared` / `docker logs amina-gateway-lb` |
| `signature_validation:false` in `/health` despite env set | Compose recreate didn't propagate (network-label issue) | Use `docker compose ... up -d --force-recreate --no-deps haystack-chatqna` |
| Reply not delivered to user but 200 returned | `From` not joined to Twilio Sandbox; or business number not approved | Have the user re-join sandbox, or wait for WABA approval |

## 9. Secrets inventory

| Secret | Where it lives | Who reads it |
|--------|----------------|--------------|
| `TWILIO_AUTH_TOKEN` | `/root/amina/haystack-stack/.env` (mode 0644 in docker group) | `haystack-chatqna` container env at start |
| `TWILIO_ACCOUNT_SID` | same | same |
| `TWILIO_WEBHOOK_PUBLIC_URL` | same — not strictly a secret, but a security-critical config | same |

**Rotation:** rotate `TWILIO_AUTH_TOKEN` in Twilio Console → General Settings →
Auth Tokens, then update `.env`, then recreate haystack-chatqna. The watchdog
will flag any mismatch within 15 min.

## 10. Testing locally

```bash
# Trigger the same signed request the production smoke test uses
TOKEN=$(docker exec haystack-chatqna printenv TWILIO_AUTH_TOKEN)
echo "$TOKEN" | python3 /tmp/twilio_e2e.py
```

`twilio_e2e.py` lives in this repo at `.claude/_tmp_test_twilio.py`
(temporary deploy file, deleted after each campaign). Re-create from
[telegram-bot-security.md §10](./telegram-bot-security.md#10-testing-locally) pattern if needed.
