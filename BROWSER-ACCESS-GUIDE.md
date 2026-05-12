# Browser Access Guide — Genie AI on 164.52.194.143

## The Self-Signed Certificate Problem

Nginx terminates SSL using a self-signed certificate located at:
```
api-gateway-solution/nginx/certs/server.crt
api-gateway-solution/nginx/certs/server.key
```

Because this certificate is not issued by a trusted Certificate Authority (CA), browsers
will block requests to `https://164.52.194.143` with a security warning or silently fail
on cross-origin requests (which surfaces misleadingly as a CORS error with `status: null`).

### Option A — Accept the browser warning (quickest for dev/testing)

1. Navigate to `https://164.52.194.143` in your browser.
2. You will see a "Your connection is not private" / "SEC_ERROR_UNKNOWN_ISSUER" warning.
3. Click **Advanced** → **Accept the Risk and Continue** (Firefox) or **Proceed to... (unsafe)** (Chrome).
4. The browser now trusts the cert for this session. All API calls from the frontend will work.

> You must do this once per browser profile. If you open a new private/incognito window you will need to do it again.

### Option B — Import the certificate as a trusted CA (persistent)

This removes the warning permanently for your machine.

**Linux (Chrome/Chromium):**
```bash
certutil -d sql:$HOME/.pki/nssdb -A -t "CT,," -n "genie-ai-local" \
  -i api-gateway-solution/nginx/certs/server.crt
```

**Linux (Firefox):** Go to `about:preferences#privacy` → Certificates → View Certificates
→ Authorities tab → Import → select `server.crt` → trust for websites.

**Windows:** Double-click `server.crt` → Install Certificate → Local Machine
→ Place in "Trusted Root Certification Authorities".

### Option C — Replace with a real certificate (production)

Replace the self-signed files with a certificate from Let's Encrypt or your organisation's CA:
```
api-gateway-solution/nginx/certs/server.crt  ← replace with your fullchain.pem
api-gateway-solution/nginx/certs/server.key  ← replace with your privkey.pem
```
Then restart Nginx: `docker compose restart nginx`

---

## Port Map — What Runs Where

| Service | URL from your browser | Protocol | Notes |
|---|---|---|---|
| **Main App (via Nginx)** | `https://164.52.194.143` | HTTPS | **Use this. Self-signed cert warning on first visit.** |
| ArangoDB Web UI | `http://164.52.194.143:8529` | HTTP | No cert issue — plain HTTP. See below. |
| Kong Admin API | `http://164.52.194.143:8001` | HTTP | No cert issue — plain HTTP. |
| Kong Proxy | `http://164.52.194.143:8010` | HTTP | No cert issue — plain HTTP. |
| Frontend (direct, no Nginx) | `http://164.52.194.143:8090` | HTTP | Bypasses Nginx. API calls will CORS-fail — do not use for chatbot. |
| OPEA ChatQnA UI | `http://164.52.194.143:5173` | HTTP | Separate OPEA UI, not the main Genie AI interface. |
| Backend API (direct) | `http://164.52.194.143:3000` | HTTP | Accessible directly for debugging/Postman. |
| Document Repository (direct) | `http://164.52.194.143:3001` | HTTP | Accessible directly for debugging/Postman. |

---

## ArangoDB Web UI

ArangoDB exposes its own built-in web interface. Because it runs on plain HTTP (not HTTPS),
there is **no certificate issue** — you can access it directly from your browser:

```
http://164.52.194.143:8529
```

Login credentials (from your `.env`):
- **Username:** `root`
- **Password:** `test`
- **Database:** `genie-ai`

> The ArangoDB UI is useful for inspecting collections, running AQL queries, and
> checking vector indexes. Do not expose port 8529 publicly in production.

---

## Key Rule

Only **`https://164.52.194.143`** (port 443, via Nginx) is the intended browser entry point
for the Genie AI application. All other ports are either internal service ports for
container-to-container communication, or direct debug access. Accessing the frontend
directly on port 8090 will break the chatbot because the browser's `Origin` header will
be `http://164.52.194.143:8090`, which is not in the `CORS_ALLOWED_ORIGINS` list and will
cause all API requests to be rejected by the backend.
