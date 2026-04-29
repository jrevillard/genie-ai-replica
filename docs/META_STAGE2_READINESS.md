# Meta Channels — Stage 2 Readiness Hardening

**Scope:** WhatsApp Business Cloud + Facebook Messenger.
**Status:** DEMO_READY by default. This doc covers what to verify before
flipping any single channel to LIVE_READY.

This is a readiness baseline — not the production launch. It does not
enable real credentials, does not call Meta APIs, and does not change
any runtime defaults.

---

## Table of contents

1. [Architecture today](#1-architecture-today)
2. [Stage definitions](#2-stage-definitions)
3. [Required env vars](#3-required-env-vars)
4. [Callback URLs](#4-callback-urls)
5. [Meta Dashboard setup checklist](#5-meta-dashboard-setup-checklist)
6. [Smoke tests](#6-smoke-tests)
7. [Production hardening checklist](#7-production-hardening-checklist)
8. [Common failures](#8-common-failures)
9. [Operational commands](#9-operational-commands)
10. [Files involved](#10-files-involved)

---

## 1. Architecture today

```
                   ┌──────────────┐
                   │   Patient    │
                   └─┬────────────┘
                     │
            ┌────────┴───────┐
            │                │
      WhatsApp           Messenger
       Cloud API          Platform
            │                │
            ▼                ▼
   POST /api/v1/meta/webhook/{whatsapp,messenger}
            │                │
            └────────┬───────┘
                     │   (signature-verified when APP_SECRET set;
                     │    bypassed in DEMO mode)
                     ▼
            ┌──────────────────┐
            │  meta_bridge.py  │   normalises both → MetaInboundMessage
            │  shared pipeline │
            └────────┬─────────┘
                     │
                     ▼
            ┌──────────────────────┐
            │  AminaAgent          │   same agent that serves /agent/chat
            │  process_message     │
            └────────┬─────────────┘
                     │
                     ▼  (reply text)
            ┌──────────────────┐
            │  send_text       │   per-channel Graph API call
            │  (suppressed in  │   (suppressed when access token empty)
            │   DEMO mode)     │
            └──────────────────┘
```

**Important:**

- Meta channels hit the **Haystack** service directly, mounted at
  `/api/v1/meta/*` via `src/main_with_rag_tuning.py`.
- **Telegram** uses the separate `components/multichannel-access`
  sidecar — that is **not** the path for Meta.
- The legacy [components/multichannel-access/app/channels/messenger.py](../components/multichannel-access/app/channels/messenger.py)
  file is a 1-line stub and is **not active** for the current Messenger
  flow. The real implementation is
  [haystack-stack/haystack-chatqna/src/services/meta_bridge.py](../haystack-stack/haystack-chatqna/src/services/meta_bridge.py).

---

## 2. Stage definitions

| Stage | What it means | Visible state on `/api/v1/meta/status` |
|---|---|---|
| **DEMO_READY** (default today) | Webhook handshakes succeed. Inbound POSTs are accepted. The agent is invoked. Outbound send is suppressed because no access token is configured. Signature verification is bypassed because no APP_SECRET is configured. **Safe — cannot accidentally talk to Meta.** | `enabled: false`, `signature_checks: false` |
| **LIVE_READY** | Real access token present and APP_SECRET present. Real outbound replies fire through Graph API. Inbound signatures are HMAC-verified. **Safe to use with real users.** | `enabled: true`, `signature_checks: true` |
| **MISCONFIGURED** | Access token present but APP_SECRET missing. Outbound replies work, but inbound signatures are *not* verified — an attacker could spoof Meta. **Do NOT use with real users.** | `enabled: true`, `signature_checks: false` |

The `meta_stage2_readiness.ps1` script reads this directly from the
`/status` endpoint and prints the classification.

---

## 3. Required env vars

### WhatsApp Business Cloud

| Var | Required for LIVE | Notes |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | yes | App > WhatsApp > API Setup |
| `WHATSAPP_PHONE_NUMBER_ID` | yes | App > WhatsApp > API Setup |
| `WHATSAPP_VERIFY_TOKEN` | yes | Any string; must match what you paste into Meta dashboard. Default `amina_health_2026`. |
| `WHATSAPP_APP_SECRET` | **yes (must set before real users)** | App > Settings > Basic > App Secret. Without this `signature_checks=false`. |

### Messenger

| Var | Required for LIVE | Notes |
|---|---|---|
| `MESSENGER_PAGE_ACCESS_TOKEN` | yes | App > Messenger > Settings > Access Tokens |
| `MESSENGER_VERIFY_TOKEN` | yes | Default `amina_health_2026` |
| `MESSENGER_APP_SECRET` | **yes (must set before real users)** | App > Settings > Basic > App Secret |

### Shared

| Var | Required | Notes |
|---|---|---|
| `META_GRAPH_VERSION` | optional | Defaults to `v19.0`. Pin if upstream forces |

**Where to set them:** add to `haystack-stack/.env` (which is bound into
`haystack-chatqna` via `env_file`) or pass via the
`docker-compose.meta-channels.yml` override which already declares all
8 passthroughs. **Never commit secrets.**

---

## 4. Callback URLs

Once you have a public HTTPS host (cloudflared tunnel, ngrok, or your
own ingress), the Meta dashboard webhook callbacks are:

```
https://<public-host>/api/v1/meta/webhook/whatsapp
https://<public-host>/api/v1/meta/webhook/messenger
```

The readiness script can print these for you with the trailing slash
normalised:

```powershell
.\scripts\meta_stage2_readiness.ps1 -PublicUrl "https://your-tunnel.example.com/" -Channel both
```

---

## 5. Meta Dashboard setup checklist

For each channel you want to bring online (WhatsApp first, Messenger
second is a sensible cadence):

1. **Configure webhook callback URL.**
   App → WhatsApp/Messenger → Configuration → Webhooks → Edit.
   Paste the channel's callback URL from §4.
2. **Enter the verify token** that matches `WHATSAPP_VERIFY_TOKEN` /
   `MESSENGER_VERIFY_TOKEN`. Meta will GET the URL with that token
   plus a `hub.challenge`. We echo the challenge back exactly when the
   token matches.
3. **Subscribe to fields:**
   - WhatsApp: `messages`
   - Messenger: `messages` and `messaging_postbacks` (for buttons later)
4. **For Messenger:** subscribe the Page itself to your app under
   App → Messenger → Settings → Access Tokens → Add or Remove Pages.
5. **Generate the access token:**
   - WhatsApp: Permanent System User token from Business Manager.
     Page-level temporary tokens expire in 24 h — do not use them in
     anything you intend to keep running.
   - Messenger: Page Access Token (does not expire as long as the user
     who created it remains a Page admin).
6. **Put secrets in `haystack-stack/.env`** or your external secret
   store. **Never commit them.** `.env.meta.example` shows the keys.
7. **Restart Haystack** picking up the meta-channels override:
   ```
   docker compose -f haystack-stack/docker-compose.yml \
                  -f haystack-stack/docker-compose.override.yml \
                  -f haystack-stack/docker-compose.meta-channels.yml \
                  up -d --force-recreate haystack-chatqna
   ```
8. **Confirm LIVE_READY** with the readiness script:
   ```powershell
   .\scripts\meta_stage2_readiness.ps1 -CheckStatus -CheckEnv -Channel whatsapp
   ```

---

## 6. Smoke tests

These cases stress the live pipeline (clinical safety, language
handling, refusal logic, signature defense). Run them once per channel
after flipping to LIVE_READY:

| # | Scenario | Send via | Expected behaviour |
|---|---|---|---|
| 1 | `hi` | the channel | Conversational greeting, no clinical content, no PHI fetched. |
| 2 | `my sugar is high` | the channel | Engaged response; AMINA asks clarifying question (severity, duration). No medication-recommend without confirmation. |
| 3 | `my BP is 180/120` | the channel | Should surface emergency/escalation guidance (call 116 / nearest facility). `triage_level=EMERGENCY` is a bonus. |
| 4 | photo / voice / unsupported attachment | the channel | "I can only read text messages" canned reply. Agent NOT invoked. |
| 5 | curl POST with bad `X-Hub-Signature-256` | curl | `HTTP 403`. No agent invocation, no bg task, no log of payload body. |
| 6 | log scan during 1–4 | docker logs | Phone numbers / sender IDs appear only as `sha256:<10>` hashes. No raw `+220…` strings. No tokens. |

For test 5:

```bash
curl -i -X POST -H "Content-Type: application/json" \
     -H "X-Hub-Signature-256: sha256=deadbeef" \
     -d '{"object":"whatsapp_business_account","entry":[]}' \
     https://<public-host>/api/v1/meta/webhook/whatsapp
# expect: HTTP/1.1 403 Forbidden
```

---

## 7. Production hardening checklist

| # | Item | Why it matters |
|---|---|---|
| 1 | `*_APP_SECRET` populated for the channel | Without it, `signature_checks=false` and any actor can post fake events. **Required before real users.** |
| 2 | Inbound message-id deduplication | Meta retries on timeout. Without dedupe, a slow turn double-bills the agent and double-replies. |
| 3 | Outbound retry with backoff | Graph API 5xx/429 are common; one retry with a 1–2 s delay avoids dropped replies. |
| 4 | Dead-letter for failed sends | After N retries, persist the failed payload with hashed sender so ops can replay. |
| 5 | Per-sender rate limiting | Same Redis rate limiter that already protects `/agent/chat`; key by hashed sender_id. |
| 6 | Tunnel health monitor | Cloudflared can drop. A simple cron hitting `/meta/status` (200 OK) catches it. |
| 7 | Command parity with Telegram | `/login`, `/profile`, `/vitals`, etc. — additive new file `meta_commands.py` parsed before `_call_agent`. |
| 8 | WhatsApp media support | Currently rejected with the canned reply. Adding image → prescription pipeline is the next big-ticket. |
| 9 | Outbound payload formatter | WhatsApp's 4096-char cap and Messenger's 2000-char cap are already respected; revisit when adding interactive replies. |
| 10 | Per-channel kill switch in admin UI | Mirror the Evidence Layer toggle pattern so an admin can pause Meta without redeploy. |

Items 1–6 are blockers before opening to real patients. Items 7–10 are
post-launch enhancements.

---

## 8. Common failures

| Symptom | Likely cause |
|---|---|
| `enabled: false` on `/meta/status` for a channel | The channel's access token (or phone-number-id for WhatsApp) is missing. |
| `signature_checks: false` for an `enabled: true` channel | `*_APP_SECRET` is missing. **MISCONFIGURED** — fix before real users. |
| Meta dashboard verification fails (cannot save webhook) | Verify token mismatch. The string in the dashboard must equal `WHATSAPP_VERIFY_TOKEN` / `MESSENGER_VERIFY_TOKEN`. |
| Inbound POST returns `403` from a real Meta retry | Bad signature. Either `*_APP_SECRET` is wrong, or the body was modified by a proxy. |
| User sends a message but never gets a reply | Outbound suppressed (DEMO mode), Page not subscribed (Messenger), or tunnel down. Check `meta_bridge` logs for `disabled -- skipping send`. |
| Phone number visible in logs | Bug — should be redacted via `_mask_sender`. File a ticket. |

---

## 9. Operational commands

### Quick status

```powershell
curl -s http://localhost:8000/api/v1/meta/status
```

### Full readiness check (the recommended one)

```powershell
.\scripts\meta_stage2_readiness.ps1 -CheckStatus -CheckEnv -VerifyHandshake -Channel both
```

### Local handshake only (no env scan, no Docker required)

```powershell
.\scripts\meta_stage2_readiness.ps1 -VerifyHandshake -Channel both
```

### Print callback URLs for a tunnel

```powershell
.\scripts\meta_stage2_readiness.ps1 -PublicUrl "https://your-tunnel.example.com/"
```

### Restart Haystack with the meta override layer

```bash
docker compose \
  -f haystack-stack/docker-compose.yml \
  -f haystack-stack/docker-compose.override.yml \
  -f haystack-stack/docker-compose.meta-channels.yml \
  up -d --force-recreate haystack-chatqna
```

### Run the deterministic test suites

```powershell
docker cp haystack-stack\haystack-chatqna\_meta_shared_pipeline_test.py haystack-chatqna:/app/_meta_shared_pipeline_test.py
docker cp haystack-stack\haystack-chatqna\_meta_sanity.py              haystack-chatqna:/app/_meta_sanity.py
docker exec haystack-chatqna python /app/_meta_shared_pipeline_test.py
docker exec haystack-chatqna python /app/_meta_sanity.py
# expect 45/45 and 24/24 respectively
```

---

## 10. Files involved

### Backend (active)

| Path | Role |
|---|---|
| [haystack-stack/haystack-chatqna/src/api/meta_routes.py](../haystack-stack/haystack-chatqna/src/api/meta_routes.py) | 5 FastAPI routes mounted at `/api/v1/meta/*` |
| [haystack-stack/haystack-chatqna/src/services/meta_bridge.py](../haystack-stack/haystack-chatqna/src/services/meta_bridge.py) | Adapters + shared pipeline + `_call_agent` + outbound send + signature verifier |
| [haystack-stack/haystack-chatqna/src/main_with_rag_tuning.py](../haystack-stack/haystack-chatqna/src/main_with_rag_tuning.py) | Mounts `meta_router` (additive try/except) |

### Compose / env

| Path | Role |
|---|---|
| [haystack-stack/docker-compose.override.yml](../haystack-stack/docker-compose.override.yml) | Bind mounts the two backend files; declares all 8 env passthroughs (defaults all empty → DEMO mode) |
| [haystack-stack/docker-compose.meta-channels.yml](../haystack-stack/docker-compose.meta-channels.yml) | Layer-on file with the same 8 passthroughs (used when you want to keep Meta separate from the main override) |
| [.env.meta.example](../.env.meta.example) | Documented template for credential values |

### Tests

| Path | Coverage |
|---|---|
| [haystack-stack/haystack-chatqna/_meta_shared_pipeline_test.py](../haystack-stack/haystack-chatqna/_meta_shared_pipeline_test.py) | 45 assertions: parse, signature, agent invocation, demo mode, unsupported media |
| [haystack-stack/haystack-chatqna/_meta_sanity.py](../haystack-stack/haystack-chatqna/_meta_sanity.py) | 24 assertions: import wiring, router shape, signature, handshakes, parse, handle |

### Scripts

| Path | Role |
|---|---|
| [scripts/meta_stage2_readiness.ps1](../scripts/meta_stage2_readiness.ps1) | Read-only readiness checker (this doc's companion script) |
| [scripts/setup_meta_channels.py](../scripts/setup_meta_channels.py) | Interactive setup wizard — validates credentials against Graph API, writes `.env`, restarts container |

### Inactive / placeholder

| Path | Status |
|---|---|
| [components/multichannel-access/app/channels/messenger.py](../components/multichannel-access/app/channels/messenger.py) | 1-line stub — **not active** for current Messenger flow |
| [components/multichannel-access/app/channels/whatsapp.py](../components/multichannel-access/app/channels/whatsapp.py) | 1-line stub — **not active** for current WhatsApp flow |

---

## Summary

- Today: **DEMO_READY** for both channels. Handshakes work, agent fires
  end-to-end on inbound, outbound is suppressed because no creds.
- Goal: **LIVE_READY** per channel — set the 4 (WhatsApp) or 3
  (Messenger) env vars, restart with the meta override, run the
  readiness script, expect `enabled: true, signature_checks: true`.
- Blocker before real users: items 1–6 in §7. Items 7–10 are
  enhancements.
- The readiness script is the canonical pre-launch check. Re-run it
  after every credential change.
