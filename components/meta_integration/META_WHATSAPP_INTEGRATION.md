# Amina x Meta WhatsApp Cloud API — Integration Guide

## Overview

This document covers integrating Amina AI Health Assistant with Meta's official WhatsApp Business Platform (Cloud API). Users will be able to message Amina on WhatsApp and receive health guidance via text and voice notes.

```
WhatsApp User                    Meta Cloud API                 Amina Backend
    │                                │                              │
    ├── "What is diabetes?" ────────►│                              │
    │                                ├── Webhook POST ─────────────►│
    │                                │                              ├── /v1/text-chat → LLM
    │                                │                              ├── /v1/tts → Voice note
    │                                │◄── Send text reply ──────────┤
    │◄── Text + Voice note ──────────│◄── Send audio reply ─────────┤
    │                                │                              │
```

---

## Part 1: Meta Account Setup

### Step 1: Create Meta Developer Account

1. Go to https://developers.facebook.com
2. Click "Get Started" and log in with your Facebook account
3. Accept the developer terms

### Step 2: Create a Business App

1. Go to https://developers.facebook.com/apps
2. Click "Create App"
3. Select "Other" → Click Next
4. Select "Business" → Click Next
5. Enter app name: "Amina Health Assistant"
6. Select your Business Account (or create one)
7. Click "Create App"

### Step 3: Add WhatsApp Product

1. In your app dashboard, scroll to "Add Products"
2. Find "WhatsApp" and click "Set up"
3. This creates a WhatsApp Business Account (WABA)
4. You get a test phone number and temporary access token

### Step 4: Get Your Credentials

From the App Dashboard → WhatsApp → API Setup, note down:

```
WHATSAPP_PHONE_NUMBER_ID = "1234567890"      # Your phone number ID
WHATSAPP_ACCESS_TOKEN = "EAAxxxxxxx..."       # Temporary token (24h)
WHATSAPP_VERIFY_TOKEN = "amina_health_2026"   # You choose this
WHATSAPP_APP_SECRET = "abcdef123456"          # App Settings → Basic
```

### Step 5: Generate Permanent Token

Temporary tokens expire in 24 hours. For production:

1. Go to Business Settings → Users → System Users
2. Click "Add" → Name: "Amina Bot" → Role: "Employee"
3. Click "Assign Assets" → Select your app → Toggle "Full Control"
4. Click "Generate Token" → Select permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Copy the permanent token — this never expires

### Step 6: Verify Your Business (for production)

1. Go to Business Settings → Security Center → Start Verification
2. Submit business documents (registration, address proof)
3. Wait for approval (1-7 days)
4. Once verified, you can register your own phone number

### Step 7: Add Your Own Phone Number (optional for production)

1. App Dashboard → WhatsApp → Configuration → Add Phone Number
2. Verify via SMS or voice call
3. The number must NOT have WhatsApp or WhatsApp Business installed
4. Once verified, you get a new Phone Number ID

---

## Part 2: Webhook Setup

Meta sends incoming WhatsApp messages to your webhook URL. Your server must be publicly accessible via HTTPS.

### Webhook Endpoint Requirements

- Must be HTTPS (not HTTP)
- Must respond to GET verification with `hub.challenge`
- Must respond to POST with 200 OK within 5 seconds
- Must handle message deduplication

### For Development: Use ngrok

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 8010
# You get: https://abc123.ngrok-free.app
# Use this as your webhook URL
```

### For Production: Use your domain

```
https://api.amina.io/whatsapp/webhook
```

### Register Webhook in Meta

1. App Dashboard → WhatsApp → Configuration
2. Callback URL: `https://your-domain.com/whatsapp/webhook`
3. Verify Token: `amina_health_2026` (same as your .env)
4. Click "Verify and Save"
5. Under Webhook Fields, subscribe to: `messages`

---

## Part 3: Backend Integration

### New File: `app/api/whatsapp.py`

This is the core integration file. Place it at `components/voice-gateway/app/api/whatsapp.py`

```python
# app/api/whatsapp.py

from __future__ import annotations

import hashlib
import hmac
import json
import os
import tempfile
from typing import Optional

import httpx
from fastapi import APIRouter, Request, Response

from app.services.core.config import settings
from app.services.core.logging import get_logger

log = get_logger("whatsapp")

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

# ─── Config ───
def _cfg():
    return {
        "token": getattr(settings, "WHATSAPP_ACCESS_TOKEN", "") or os.environ.get("WHATSAPP_ACCESS_TOKEN", ""),
        "phone_id": getattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "") or os.environ.get("WHATSAPP_PHONE_NUMBER_ID", ""),
        "verify_token": getattr(settings, "WHATSAPP_VERIFY_TOKEN", "") or os.environ.get("WHATSAPP_VERIFY_TOKEN", "amina_health_2026"),
        "app_secret": getattr(settings, "WHATSAPP_APP_SECRET", "") or os.environ.get("WHATSAPP_APP_SECRET", ""),
        "api_version": "v21.0",
    }


# ═══════════════════════════════════════════════════════════
# WEBHOOK VERIFICATION (GET)
# Meta sends a GET request to verify your webhook URL
# ═══════════════════════════════════════════════════════════

@router.get("/webhook")
async def verify_webhook(request: Request):
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")

    cfg = _cfg()

    if mode == "subscribe" and token == cfg["verify_token"]:
        log.info("webhook_verified")
        return Response(content=challenge, media_type="text/plain")

    log.warning("webhook_verify_failed", mode=mode)
    return Response(content="Forbidden", status_code=403)


# ═══════════════════════════════════════════════════════════
# WEBHOOK HANDLER (POST)
# Receives incoming WhatsApp messages
# ═══════════════════════════════════════════════════════════

@router.post("/webhook")
async def handle_webhook(request: Request):
    body = await request.body()

    # Optional: verify signature
    cfg = _cfg()
    if cfg["app_secret"]:
        sig = request.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + hmac.new(
            cfg["app_secret"].encode(), body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(sig, expected):
            log.warning("webhook_invalid_signature")
            return Response(status_code=403)

    data = json.loads(body)

    # Must return 200 immediately — process async
    try:
        entries = data.get("entry", [])
        for entry in entries:
            changes = entry.get("changes", [])
            for change in changes:
                value = change.get("value", {})
                messages = value.get("messages", [])

                for msg in messages:
                    sender = msg.get("from", "")  # phone number
                    msg_type = msg.get("type", "")
                    msg_id = msg.get("id", "")

                    if msg_type == "text":
                        text = msg.get("text", {}).get("body", "")
                        if text:
                            await _handle_text_message(sender, text, msg_id)

                    elif msg_type == "audio":
                        audio_id = msg.get("audio", {}).get("id", "")
                        if audio_id:
                            await _handle_voice_message(sender, audio_id, msg_id)

                    # Mark as read
                    await _mark_read(sender, msg_id)

    except Exception as e:
        log.exception("webhook_processing_error", error=str(e))

    return Response(status_code=200)


# ═══════════════════════════════════════════════════════════
# MESSAGE HANDLERS
# ═══════════════════════════════════════════════════════════

async def _handle_text_message(sender: str, text: str, msg_id: str):
    """User sent a text message → LLM → reply text + voice note."""
    log.info("wa_text_received", sender=sender, text_len=len(text))

    # Get LLM response via your existing text-chat logic
    from app.services.llm_openai import OpenAIClient
    llm = OpenAIClient()

    # TODO: Add session/history storage (Redis) for multi-turn
    answer = await llm.chat(user_text=text, history=[])

    # Send text reply
    await _send_text(sender, answer)

    # Send voice note (optional — remove if not needed)
    try:
        audio_bytes = await _tts_synthesize(answer)
        if audio_bytes and len(audio_bytes) > 100:
            await _send_voice_note(sender, audio_bytes)
    except Exception as e:
        log.warning("wa_voice_note_failed", error=str(e))


async def _handle_voice_message(sender: str, audio_id: str, msg_id: str):
    """User sent a voice message → download → STT → LLM → reply."""
    log.info("wa_voice_received", sender=sender, audio_id=audio_id)

    # Download audio from Meta
    audio_bytes = await _download_media(audio_id)
    if not audio_bytes:
        await _send_text(sender, "Sorry, I couldn't process your voice message. Please try again.")
        return

    # STT: Convert audio to text
    from app.services.stt_whispercpp import WhisperCppClient
    from app.utils.audio import normalize_to_wav_16k_mono

    normalized = normalize_to_wav_16k_mono(audio_bytes, input_suffix=".ogg")
    stt = WhisperCppClient()
    result = await stt.transcribe(
        audio_bytes=normalized.wav_bytes,
        filename="audio.wav",
        content_type="audio/wav",
    )
    transcript = (result.text or "").strip()

    if not transcript:
        await _send_text(sender, "I couldn't understand the audio. Could you try again or type your message?")
        return

    log.info("wa_voice_transcribed", sender=sender, transcript=transcript[:50])

    # LLM response
    from app.services.llm_openai import OpenAIClient
    llm = OpenAIClient()
    answer = await llm.chat(user_text=transcript, history=[])

    # Send text reply
    await _send_text(sender, answer)

    # Send voice note
    try:
        audio_bytes = await _tts_synthesize(answer)
        if audio_bytes and len(audio_bytes) > 100:
            await _send_voice_note(sender, audio_bytes)
    except Exception as e:
        log.warning("wa_voice_note_failed", error=str(e))


# ═══════════════════════════════════════════════════════════
# META GRAPH API CALLS
# ═══════════════════════════════════════════════════════════

async def _send_text(to: str, text: str):
    """Send a text message via WhatsApp Cloud API."""
    cfg = _cfg()
    url = f"https://graph.facebook.com/{cfg['api_version']}/{cfg['phone_id']}/messages"

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {cfg['token']}",
                "Content-Type": "application/json",
            },
            json={
                "messaging_product": "whatsapp",
                "to": to,
                "type": "text",
                "text": {"body": text},
            },
        )

    if resp.status_code != 200:
        log.error("wa_send_text_failed", status=resp.status_code, body=resp.text[:200])
    else:
        log.info("wa_text_sent", to=to, chars=len(text))


async def _send_voice_note(to: str, audio_bytes: bytes):
    """Upload audio to Meta, then send as voice note."""
    cfg = _cfg()

    # Step 1: Upload media
    upload_url = f"https://graph.facebook.com/{cfg['api_version']}/{cfg['phone_id']}/media"

    # Write to temp file (Meta requires multipart upload)
    fd, tmp_path = tempfile.mkstemp(suffix=".ogg")
    try:
        # Convert WAV/MP3 to OGG Opus (WhatsApp requires this for voice notes)
        import subprocess
        fd2, ogg_path = tempfile.mkstemp(suffix=".ogg")
        os.close(fd2)

        with open(tmp_path, "wb") as f:
            f.write(audio_bytes)
        os.close(fd)

        # FFmpeg convert to OGG Opus (required for WhatsApp voice notes)
        subprocess.run(
            ["ffmpeg", "-y", "-i", tmp_path, "-c:a", "libopus", "-b:a", "32k", ogg_path],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15,
        )

        with open(ogg_path, "rb") as f:
            ogg_bytes = f.read()

        os.unlink(ogg_path)

    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            upload_url,
            headers={"Authorization": f"Bearer {cfg['token']}"},
            data={"messaging_product": "whatsapp", "type": "audio/ogg; codecs=opus"},
            files={"file": ("voice.ogg", ogg_bytes, "audio/ogg; codecs=opus")},
        )

    if resp.status_code != 200:
        log.error("wa_media_upload_failed", status=resp.status_code)
        return

    media_id = resp.json().get("id")
    if not media_id:
        log.error("wa_no_media_id")
        return

    # Step 2: Send voice note message
    msg_url = f"https://graph.facebook.com/{cfg['api_version']}/{cfg['phone_id']}/messages"

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            msg_url,
            headers={
                "Authorization": f"Bearer {cfg['token']}",
                "Content-Type": "application/json",
            },
            json={
                "messaging_product": "whatsapp",
                "to": to,
                "type": "audio",
                "audio": {"id": media_id},
            },
        )

    if resp.status_code == 200:
        log.info("wa_voice_sent", to=to)
    else:
        log.error("wa_voice_send_failed", status=resp.status_code, body=resp.text[:200])


async def _download_media(media_id: str) -> Optional[bytes]:
    """Download media file from Meta servers."""
    cfg = _cfg()
    url = f"https://graph.facebook.com/{cfg['api_version']}/{media_id}"

    async with httpx.AsyncClient(timeout=15.0) as client:
        # Step 1: Get download URL
        resp = await client.get(url, headers={"Authorization": f"Bearer {cfg['token']}"})
        if resp.status_code != 200:
            log.error("wa_media_url_failed", media_id=media_id)
            return None

        download_url = resp.json().get("url")
        if not download_url:
            return None

        # Step 2: Download actual file
        resp = await client.get(download_url, headers={"Authorization": f"Bearer {cfg['token']}"})
        if resp.status_code == 200:
            return resp.content

    return None


async def _mark_read(to: str, message_id: str):
    """Mark message as read (blue ticks)."""
    cfg = _cfg()
    url = f"https://graph.facebook.com/{cfg['api_version']}/{cfg['phone_id']}/messages"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {cfg['token']}",
                    "Content-Type": "application/json",
                },
                json={
                    "messaging_product": "whatsapp",
                    "status": "read",
                    "message_id": message_id,
                },
            )
    except Exception:
        pass  # Non-critical


async def _tts_synthesize(text: str) -> Optional[bytes]:
    """Generate TTS audio using your configured TTS engine."""
    try:
        # Uses whichever TTS is active in tts.py (ElevenLabs/Piper/Coqui)
        # Import the active client
        try:
            from app.services.tts_elevenlabs import ElevenLabsTTSClient
            client = ElevenLabsTTSClient()
        except Exception:
            from app.services.tts_piper import PiperTTSClient
            client = PiperTTSClient()

        result = await client.synthesize(text)
        return result.audio_bytes
    except Exception as e:
        log.warning("wa_tts_failed", error=str(e))
        return None
```

### Register the Router

In your `app/main.py` (or wherever the FastAPI app is created), add:

```python
from app.api.whatsapp import router as whatsapp_router

app.include_router(whatsapp_router)
```

---

## Part 4: Environment Variables

Add these to your `.env` file:

```env
# ─── WhatsApp Cloud API ───
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxx
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_VERIFY_TOKEN=amina_health_2026
WHATSAPP_APP_SECRET=abcdef1234567890
```

And update `docker-compose.voice.yml` to pass them:

```yaml
voice-gateway:
  environment:
    WHISPER_URL: http://voice-stt:8080
    PIPER_MODEL_PATH: /models/piper/en_US-lessac-medium.onnx
    WHATSAPP_ACCESS_TOKEN: ${WHATSAPP_ACCESS_TOKEN}
    WHATSAPP_PHONE_NUMBER_ID: ${WHATSAPP_PHONE_NUMBER_ID}
    WHATSAPP_VERIFY_TOKEN: ${WHATSAPP_VERIFY_TOKEN}
    WHATSAPP_APP_SECRET: ${WHATSAPP_APP_SECRET}
```

---

## Part 5: Message Template (Required for first message)

WhatsApp requires you to send a pre-approved template as the first message to a user. After the user replies, you have a 24-hour window to send free-form messages.

### Create a Template

1. Go to WhatsApp Manager → Message Templates
2. Click "Create Template"
3. Category: "Utility"
4. Name: `amina_welcome`
5. Language: English
6. Body: "Hello! I'm Amina, your AI health assistant. How can I help you today? You can ask me about symptoms, medications, chronic conditions, or wellness advice."
7. Submit for approval (usually takes minutes to hours)

### Send Template Programmatically

```python
async def send_welcome_template(to: str):
    cfg = _cfg()
    url = f"https://graph.facebook.com/{cfg['api_version']}/{cfg['phone_id']}/messages"

    async with httpx.AsyncClient(timeout=15.0) as client:
        await client.post(
            url,
            headers={
                "Authorization": f"Bearer {cfg['token']}",
                "Content-Type": "application/json",
            },
            json={
                "messaging_product": "whatsapp",
                "to": to,
                "type": "template",
                "template": {
                    "name": "amina_welcome",
                    "language": {"code": "en"},
                },
            },
        )
```

---

## Part 6: Testing

### Test with Meta's Test Number

1. App Dashboard → WhatsApp → API Setup
2. Add your personal phone number as a test recipient (max 5)
3. Send a test message from the dashboard
4. Verify webhook receives it

### Test Webhook Locally

```bash
# Terminal 1: Start gateway
docker compose -f docker-compose.voice.yml up --build -d

# Terminal 2: Start ngrok
ngrok http 8010

# Copy the HTTPS URL (e.g., https://abc123.ngrok-free.app)
# Register as webhook: https://abc123.ngrok-free.app/whatsapp/webhook
```

### Test via curl

```bash
# Simulate sending a text message (from Meta to your webhook)
curl -X POST http://127.0.0.1:8010/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "from": "1234567890",
            "type": "text",
            "text": {"body": "What is diabetes?"},
            "id": "test_123"
          }]
        }
      }]
    }]
  }'
```

### Verify the Full Flow

```bash
# Check gateway logs
docker logs voice-gateway --tail 30
```

You should see:
```
wa_text_received sender=1234567890 text_len=19
llm_request model=gpt-4o-mini ...
llm_done chars=200
wa_text_sent to=1234567890 chars=200
wa_voice_sent to=1234567890
```

---

## Part 7: Pricing

### WhatsApp Cloud API (Meta)

Meta charges per conversation (not per message):

| Conversation Type | Cost (approx) |
|---|---|
| User-initiated (24h window) | $0.005 - $0.08 depending on country |
| Business-initiated (templates) | $0.03 - $0.15 depending on country |
| Service conversations (from webhooks) | Free for first 1,000/month |

The first 1,000 service conversations per month are free, which is plenty for testing and early production.

### Your Costs

| Service | Cost |
|---|---|
| WhatsApp API | Free (first 1000 convos/month) |
| LLM (GPT-4o-mini) | ~$0.0003 per response |
| TTS (Piper) | Free (local) |
| TTS (ElevenLabs) | $5/month starter |
| Hosting | Your existing Docker setup |

---

## Part 8: Production Checklist

```
[ ] Meta Developer Account created
[ ] Business App created with WhatsApp product
[ ] Business verified in Meta Business Manager
[ ] Own phone number registered and verified
[ ] Permanent system user token generated
[ ] Webhook URL registered (HTTPS, public)
[ ] Message template created and approved
[ ] whatsapp.py added to gateway
[ ] Router registered in main.py
[ ] Environment variables configured
[ ] httpx in requirements.txt (already there)
[ ] Docker rebuilt and tested
[ ] Webhook receiving messages confirmed
[ ] Text replies working
[ ] Voice notes working
[ ] Session/history storage added (Redis — future)
```

---

## Part 9: Future Enhancements

### Conversation History (Redis)

Add Redis to store per-user conversation history:

```python
# In docker-compose.voice.yml, add:
redis:
  image: redis:7-alpine
  container_name: voice-redis
  ports:
    - "6379:6379"
  networks:
    - voice-net
```

```python
# In whatsapp.py, replace history=[] with:
import redis.asyncio as redis

r = redis.from_url("redis://voice-redis:6379")

async def get_history(sender: str) -> list:
    raw = await r.get(f"wa_history:{sender}")
    return json.loads(raw) if raw else []

async def save_history(sender: str, history: list):
    # Keep last 20 messages
    await r.setex(f"wa_history:{sender}", 86400, json.dumps(history[-20:]))
```

### Multi-Channel Router

Once WhatsApp works, add Telegram/Messenger/SMS by creating adapter modules that normalize messages to a common format:

```python
# Common message format
{
    "channel": "whatsapp",      # or "telegram", "messenger", "sms"
    "sender_id": "1234567890",
    "message_type": "text",     # or "audio"
    "content": "What is diabetes?",
    "timestamp": "2026-03-08T12:00:00Z"
}
```

---

## File Structure After Integration

```
components/voice-gateway/
├── app/
│   ├── api/
│   │   ├── voice.py          # Existing: STT, chat endpoints
│   │   ├── tts.py            # Existing: TTS endpoint
│   │   └── whatsapp.py       # NEW: WhatsApp webhook + handlers
│   ├── services/
│   │   ├── llm_openai.py     # Existing: LLM client
│   │   ├── tts_piper.py      # Existing: Piper TTS
│   │   ├── tts_elevenlabs.py # NEW: ElevenLabs TTS (optional)
│   │   └── stt_whispercpp.py # Existing: Whisper STT
│   └── main.py               # Add: whatsapp_router
├── docker-compose.voice.yml   # Add: WhatsApp env vars
└── .env                       # Add: WhatsApp credentials
```

---

## Quick Reference Links

| Resource | URL |
|---|---|
| Meta Developer Dashboard | https://developers.facebook.com/apps |
| WhatsApp Business Manager | https://business.facebook.com |
| Cloud API Documentation | https://developers.facebook.com/docs/whatsapp/cloud-api |
| API Reference | https://developers.facebook.com/docs/whatsapp/cloud-api/reference |
| Webhook Reference | https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks |
| Message Templates | https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates |
| Pricing | https://developers.facebook.com/docs/whatsapp/pricing |
| Postman Collection | https://www.postman.com/meta/whatsapp-business-platform |
| Graph API Explorer | https://developers.facebook.com/tools/explorer |
| ngrok (for dev webhooks) | https://ngrok.com |
