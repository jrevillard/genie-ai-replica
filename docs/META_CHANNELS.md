# Meta channels — Facebook Messenger + WhatsApp

> **One Meta brain, two thin adapters.** Both Messenger and WhatsApp
> share a single inbound→agent→outbound pipeline inside
> `haystack-chatqna`. Channel-specific differences live only in two
> small adapter classes. **Telegram is unrelated** and lives in its
> own sidecar (`components/multichannel-access`).

This document is the operational + architectural reference for the
Meta channel implementation as of 2026-04-27.

---

## 1. Architecture

```
                            HTTPS POST  (signed, Meta-side)
                                   |
                                   v
                ┌──────────────────────────────────────┐
                │  haystack-chatqna :8000              │
                │   src/api/meta_routes.py             │
                │     • verify GET handshake           │
                │     • verify X-Hub-Signature-256     │
                │     • ack {"status":"ok"} fast (<5s) │
                │     • BackgroundTask:                │
                │         handle_meta_payload(         │
                │           channel_name, payload )    │
                └──────────────────────┬───────────────┘
                                       │ in-process
                                       v
                ┌──────────────────────────────────────┐
                │  src/services/meta_bridge.py         │
                │   handle_meta_payload(name, payload) │
                │     • adapter = _ADAPTERS[name]      │
                │     • adapter.parse_inbound(payload) │
                │       -> [MetaInboundMessage, ...]   │
                │     • drop empty / echo / delivery   │
                │     • for each message:              │
                │         if unsupported:              │
                │           adapter.send_text(canned)  │
                │         else:                        │
                │           reply = _call_agent(text)  │
                │           adapter.send_text(reply)   │
                │     • log only safe metadata         │
                └──────┬───────────────────┬───────────┘
                       │                   │
        ┌──────────────▼─────┐  ┌──────────▼──────────────┐
        │ MessengerBridge    │  │ WhatsAppBridge          │
        │  • parse_inbound   │  │  • parse_inbound        │
        │  • send_text       │  │  • send_text            │
        │  • verify, enabled │  │  • verify, enabled      │
        └──────────┬─────────┘  └──────────┬──────────────┘
                   │                       │
                   v                       v
       graph.facebook.com/<v>      graph.facebook.com/<v>
       /me/messages                /<phone_number_id>/messages
```

Adapter responsibilities:

| Method | Purpose |
|---|---|
| `enabled() -> bool` | Whether this channel has all required env vars set. |
| `verify(mode, token, challenge) -> Optional[str]` | Echo `challenge` if Meta's GET-handshake matches our `*_VERIFY_TOKEN`. |
| `parse_inbound(payload) -> list[MetaInboundMessage]` | Normalize raw Meta JSON into the canonical envelope. |
| `send_text(to, text) -> bool` | POST a text reply via Graph API. |

**Not on the adapter** — anything that's the same across channels lives
in the shared pipeline:
- agent invocation
- response trimming (`MAX_REPLY_CHARS = 3500`)
- canned reply for unsupported media types
- safe logging (masked sender, no token / no full text)
- echo / delivery / read filtering at the parse step

---

## 2. The canonical envelope

```python
@dataclass
class MetaInboundMessage:
    channel:          str          # "messenger" | "whatsapp"
    sender_id:        str          # PSID for Messenger, wa_id for WhatsApp
    session_id:       str          # f"{channel}_{sender_id}"
    text:             str = ""
    sender_name:      Optional[str] = None
    phone:            Optional[str] = None    # E.164 with leading "+"
    message_id:       Optional[str] = None
    unsupported_type: Optional[str] = None    # "image", "audio", ...; None for text
    has_attachments:  bool = False
    raw:              dict                    # original message dict, debug only
```

A message is **unsupported** if `unsupported_type` is set OR the text is
empty AND the carrier reports attachments. The shared pipeline always
replies with the canned `UNSUPPORTED_TEXT_REPLY` for these — the agent
is not called.

---

## 3. Endpoints (paths preserved)

| Route | Method | Purpose |
|---|---|---|
| `/api/v1/meta/webhook/messenger` | GET | Meta verification handshake (echo `hub.challenge`) |
| `/api/v1/meta/webhook/messenger` | POST | Inbound Messenger events (signature-verified) |
| `/api/v1/meta/webhook/whatsapp` | GET | Meta verification handshake |
| `/api/v1/meta/webhook/whatsapp` | POST | Inbound WhatsApp Cloud API events (signature-verified) |
| `/api/v1/meta/status` | GET | `{enabled, signature_checks}` per channel |

Endpoint surface is unchanged from V1 — Meta dashboards configured
before the refactor keep working without re-pointing.

---

## 4. Required env vars (unchanged)

| Var | Purpose |
|---|---|
| `MESSENGER_PAGE_ACCESS_TOKEN` | Page access token from Meta App → Messenger → Settings → Access Tokens |
| `MESSENGER_VERIFY_TOKEN` | String you pick; Meta echoes this on the GET handshake. Default `amina_health_2026`. |
| `MESSENGER_APP_SECRET` | App secret from Meta App → Basic. **Required for production**; signature checks skip if empty (demo mode). |
| `WHATSAPP_ACCESS_TOKEN` | Permanent access token from Meta App → WhatsApp → API Setup |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone-number ID (NOT the phone number itself) from the same page |
| `WHATSAPP_VERIFY_TOKEN` | Same role as the Messenger verify token. Default `amina_health_2026`. |
| `WHATSAPP_APP_SECRET` | App secret. Required for production. |
| `META_GRAPH_VERSION` | Graph API version pin. Default `v19.0`. |

A channel reports `enabled: false` from `/meta/status` whenever its
required token(s) are unset. The rest of the stack keeps running.

---

## 5. Run the validation locally

```bash
# Restart the haystack container after editing meta_bridge.py / meta_routes.py
docker compose -f haystack-stack/docker-compose.yml restart haystack-chatqna

# Unit + parse + pipeline tests (45 assertions)
python haystack-stack/haystack-chatqna/_meta_shared_pipeline_test.py

# Live handshake — Messenger
curl "http://localhost:8000/api/v1/meta/webhook/messenger?hub.mode=subscribe&hub.verify_token=amina_health_2026&hub.challenge=AMINA_OK"
# expected: AMINA_OK

# Live handshake — WhatsApp
curl "http://localhost:8000/api/v1/meta/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=amina_health_2026&hub.challenge=AMINA_OK"
# expected: AMINA_OK

# Live status
curl http://localhost:8000/api/v1/meta/status
```

---

## 6. Going to production

1. **Set the secrets** in `haystack-stack/.env` (don't commit):
   ```
   MESSENGER_PAGE_ACCESS_TOKEN=...
   MESSENGER_APP_SECRET=...
   WHATSAPP_ACCESS_TOKEN=...
   WHATSAPP_PHONE_NUMBER_ID=...
   WHATSAPP_APP_SECRET=...
   ```
   `META_GRAPH_VERSION` and the verify tokens already have safe
   defaults; override only if Meta changes API versions.
2. **Recreate** the haystack container so the new env reaches it:
   ```
   docker compose -f haystack-stack/docker-compose.yml \
                  -f haystack-stack/docker-compose.meta-channels.yml \
                  up -d --force-recreate haystack-chatqna
   ```
3. **Open a public HTTPS URL to `:8000`** — same options as the
   Telegram side (ngrok, cloudflared quick tunnel, named tunnel,
   reverse proxy). Whatever you used for Telegram works here too.
4. **Register the URLs in the Meta App dashboard**:
   - Messenger Webhook URL: `https://YOUR-PUBLIC/api/v1/meta/webhook/messenger`
   - WhatsApp Webhook URL: `https://YOUR-PUBLIC/api/v1/meta/webhook/whatsapp`
   - Verify token: whatever `*_VERIFY_TOKEN` you set (default
     `amina_health_2026`)
5. **Subscribe** the page (Messenger) and the WhatsApp business
   account to `messages` (and `messaging_postbacks` if you add
   buttons). The shared pipeline already filters echoes, deliveries,
   and reads.
6. **Confirm** with the smoke checklist in §7.

---

## 7. Smoke checklist

Once both channels are enabled and webhooks registered, send a
message from a real Meta-side account:

| Send | Expected |
|---|---|
| WhatsApp / Messenger: `hi` | Greeting reply (varies by literacy mode) |
| `my sugar is high` | NCD response (LoRA / RAG) |
| `what should I eat for diabetes?` | Diet reply, deferred to LoRA |
| `I missed my BP medicine` | Adherence-aware reply |
| Send a photo / voice note | Canned `"I can only read text messages right now…"` |
| Send a sticker | Same canned unsupported reply |
| Mark message as read | No reply (delivery/read events ignored) |

Tail the haystack log for safe-metadata lines:

```
docker logs -f haystack-chatqna | grep meta_pipeline
```

You should see entries like:

```
meta_pipeline handled channel=whatsapp sender=sha256:abc12345 msg_id_present=True in_chars=20 out_chars=187 sent=True
meta_pipeline unsupported channel=messenger sender=sha256:def67890 type=image has_attachments=True msg_id_present=True sent=True
```

Never the actual phone number, PSID, message text, or token.

---

## 8. Adding a third Meta channel later

If Meta launches a new product (Threads, Instagram Direct, etc.) the
recipe is small:

1. Add `<NewChannel>Bridge` to `src/services/meta_bridge.py` with the
   four adapter methods (`enabled`, `verify`, `parse_inbound`,
   `send_text`).
2. Register it: `_ADAPTERS["instagram"] = InstagramBridge`.
3. Add the route pair in `src/api/meta_routes.py` calling
   `handle_meta_payload("instagram", payload)` from a BackgroundTask.
4. Add unit tests to `_meta_shared_pipeline_test.py`.

The shared pipeline doesn't need changes — that's the point.

---

## 9. Telegram

Lives in its own sidecar at `components/multichannel-access`. See
[components/multichannel-access/README.md](../components/multichannel-access/README.md)
for the operations guide. Deliberately **separate** from this Meta
pipeline because:

- Telegram has its own HTTP envelope shape (no `entry[].changes[]`
  nesting, no X-Hub-Signature-256, voice-note download is part of the
  standard flow rather than a "send a canned 'unsupported' reply")
- Telegram supports inline feedback buttons natively; Meta uses
  postbacks/quick-replies instead
- Sharing one pipeline across Telegram + Meta would force lowest-common
  denominator design and trade off features in either direction

The Meta pipeline covers Messenger and WhatsApp because those two ARE
genuinely the same Graph-API shape with two different POST targets.
That's why this refactor was viable.
