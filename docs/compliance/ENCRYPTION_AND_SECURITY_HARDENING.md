# AMINA — Encryption and Security Hardening

**Domain:** `amina-design.com`
**Backend host:** A40 VM at `164.52.196.198` (Delhi region)
**Status as of writing:** all layers below are live in production.

---

## 1. Architecture overview

```
+---------+    HTTPS / TLS 1.3    +-------------------+
|         |  CF-issued cert (ECC) |  Cloudflare edge  |  ← amina-design.com (Pages)
| Browser |---------------------->|     POPs (300+)   |     api.amina-design.com (Tunnel)
+---------+                       +---------+---------+
                                            |
                                  QUIC + TLS (cloudflared protocol)
                                  4 redundant connections — del04, del05, bom03, bom06
                                            |
                                            v
                                   +-----------------+
                                   |   A40 VM        |   164.52.196.198
                                   |  (host firewall: ufw — only port 22 open)
                                   |                 |
                                   |  Docker bridge: haystack-stack_chatqna_default
                                   |  +-------------+
                                   |  | cloudflared |
                                   |  +------+------+
                                   |         | (docker-internal HTTP)
                                   |  +------v---------+   +------------------+
                                   |  | amina-gateway  |-->| haystack-chatqna |
                                   |  |  :8443         |   |  :8000           |
                                   |  +----------------+   +------------------+
                                   |        ^                       ^
                                   |        |                       |
                                   |  +-----+----- arcadedb / amina-redis / voice-tts /
                                   |  |             voice-stt / nllb-translate /
                                   |  |             multichannel-access / ...
                                   +-----------------+
```

Every external hop is encrypted. The only HTTP-in-the-clear is between containers on the same docker bridge on a single host — that traffic never crosses any network.

---

## 2. TLS layers

### 2.1 Browser → Cloudflare edge

- **Protocol:** TLS 1.3 (TLS 1.2 minimum enforced at CF dashboard).
- **Cert:** Cloudflare Universal SSL, auto-issued and auto-rotated. ECDSA P-256 + RSA 2048.
- **HTTP/2 + HTTP/3 (QUIC)** offered to the client.
- **HSTS preload** declared by both origin and edge.

### 2.2 Cloudflare edge → A40 (cloudflared tunnel)

- **Tunnel name:** `Amina-prod`
- **Tunnel ID:** `48319e30-7c30-4c38-921e-9ad8459de359`
- **Connector container:** `amina-cloudflared` (image `cloudflare/cloudflared:latest`)
- **Transport:** QUIC. cloudflared dials Cloudflare's edge from inside the VM; no inbound port is opened.
- **Connections:** 4 redundant tunnel connections registered to `del04`, `del05`, `bom03`, `bom06`.
- **Public hostname:** `api.amina-design.com` → `http://amina-gateway:8443` (docker service-name routing).
- **Token storage:** `/root/amina/.env.cloudflared`, `chmod 600`, gitignored.

### 2.3 cloudflared → containers

- Plain HTTP on the docker bridge `haystack-stack_chatqna_default`. Containers reachable only by service name within that namespace.
- Host-level firewall (`ufw`) blocks every published docker port from outside the host (see §4).

---

## 3. Domain and DNS

| Hostname | Type | Target | Purpose |
|---|---|---|---|
| `amina-design.com` | Cloudflare Pages | project `amina` | Frontend (static React build) |
| `www.amina-design.com` | Cloudflare Pages | project `amina` | www mirror |
| `api.amina-design.com` | CNAME → Cloudflare Tunnel | tunnel `Amina-prod` | API (gateway → haystack) |
| `*.amina-design.pages.dev` | Cloudflare auto-managed | per-deployment previews | PR previews |

DNS is managed end-to-end by Cloudflare; there is no third-party nameserver in the chain.

---

## 4. Host-level hardening on the A40

### 4.1 ufw firewall

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp        # SSH (operator + amina-tester restricted user)
ufw deny 8000/tcp       # haystack-chatqna   — reach via tunnel only
ufw deny 8020/tcp       # multichannel-access
ufw deny 8443/tcp       # amina-gateway
ufw deny 5174/tcp       # vite dev server (not for prod, blocked anyway)
ufw deny 7860/tcp       # nllb-translate
ufw deny 5500/tcp       # voice-tts
ufw deny 2480/tcp       # arcadedb
ufw enable
```

External probe to any blocked port now times out. Docker bridge networking is unaffected; containers reach each other via the `haystack-stack_chatqna_default` namespace.

### 4.2 SSH access controls

- `root` over password — operator only.
- `amina-tester` user — restricted SSH (`Match User amina-tester` block in `sshd_config`):
  - `PermitOpen` only to ports `5174` and `8000` (tunnel forwards for UNICC reviewers).
  - `ForceCommand`, no PTY, no shell.

---

## 5. Origin gateway — security response headers

Source: `components/api-gateway/app/main.py` (`add_security_headers` middleware).

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options:    nosniff
X-Frame-Options:           DENY
Referrer-Policy:           strict-origin-when-cross-origin
Permissions-Policy:        geolocation=(self), microphone=(self), camera=(), payment=()
Cross-Origin-Resource-Policy: cross-origin
```

These ride on every response from the gateway, including transparently-proxied responses from `haystack-chatqna`.

---

## 6. CORS allowlist

Both `amina-gateway` and `haystack-chatqna` enforce identical CORS rules:

```python
allow_origins = [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:5174", "http://127.0.0.1:5174",
    "http://localhost:5175", "http://127.0.0.1:5175",
    "https://amina-design.com",
    "https://www.amina-design.com",
]
allow_origin_regex   = r"https://[a-z0-9-]+\.amina-design\.pages\.dev"
allow_credentials    = True
allow_methods        = ["*"]
allow_headers        = ["*"]
```

Production browser requests carry `Origin: https://amina-design.com`. Cookie-backed sessions work cross-origin because `allow_credentials=True` is paired with explicit-origin allowlisting (never `"*"`).

---

## 7. Application-layer authentication

### 7.1 JWT

- Algorithm: HS256
- Secret: 64-char value in `JWT_SECRET` (sourced from `/root/amina/haystack-stack/.env`; never in defaults / git).
- TTL: patient and caregiver tokens 7 days; admin 1 hour; gateway-issued tokens 1 hour default, max 8h.
- Stale-token recovery on the SPA: `staleToken401Interceptor.js` clears localStorage + reloads on 401 from any `Bearer`-bearing fetch (debounced 60 s).

### 7.2 Jailbreak detection

Two layers:

1. **Gateway-side** — `jailbreak_detector.py` runs on every public/* path through `amina-gateway` (chat, translate). Pattern catalog visible at `https://api.amina-design.com/api/v1/public/security/status`.
2. **App-side** — same detector wired into `agent_chat` and `streaming_routes` so chat through any path (including the transparent proxy) is screened.

A blocked request returns the safety template, not the LLM response.

### 7.3 PHI redaction

Outbound and inbound PHI redactor active on `amina-gateway` (`phi_redactor` module). Status visible in `/security/status` payload.

---

## 8. Cloudflare edge settings

| Setting | Value | Effect |
|---|---|---|
| SSL/TLS encryption mode | Full (strict) | Reject any plain-HTTP origin response |
| Minimum TLS Version | TLS 1.2 | Reject TLS 1.0 / 1.1 clients |
| TLS 1.3 | ON | Modern handshake when the client supports it |
| Always Use HTTPS | ON | Auto 301 from `http://...` to `https://...` |
| Automatic HTTPS Rewrites | ON | Inline `http://` → `https://` rewrite where safe |
| HSTS | 12 months · subdomains · preload · no-sniff | Belt-and-braces with origin HSTS |
| Bot Fight Mode | ON | Free-tier challenge for known bot signatures |
| Security Level | High | Auto-challenge from CF threat intel |
| Browser Integrity Check | ON | Reject malformed headers |
| Privacy Pass | ON | Returning legit users skip repeat captchas |
| DDoS protection | Active (always-on, free tier) | Volumetric L3/L4 absorption |

---

## 9. WAF rules (custom rules tab)

Order matters — Cloudflare evaluates top-down, first match wins.

### 9.1 `block-bare-host-attacks` (#1 — first)

```
(http.host ne "amina-design.com")
and (http.host ne "www.amina-design.com")
and (http.host ne "api.amina-design.com")
and (not http.host wildcard r"*.amina-design.pages.dev")
```

**Action:** Block. Drops bots scanning Cloudflare with `Host: 164.52.196.198` or other unrelated values.

### 9.2 `block-bad-bots-api` (#2)

```
(http.host eq "api.amina-design.com")
and (cf.threat_score gt 14)
and (not cf.client.bot)
```

**Action:** Block. Free-tier rule using `cf.threat_score` (Bot Management's `cf.bot_management.score` is paid-only). Threshold 14 = CF's "Medium" security default. Verified search engines bypass via `cf.client.bot`.

### 9.3 `challenge-no-ua` (#3 — last)

```
(http.host eq "api.amina-design.com")
and (
  (http.user_agent eq "")
  or (lower(http.user_agent) contains "curl")
  or (lower(http.user_agent) contains "wget")
  or (lower(http.user_agent) contains "python-requests")
  or (lower(http.user_agent) contains "scraping")
  or (lower(http.user_agent) contains "scrapy")
)
and (http.request.method in {"POST" "PUT" "DELETE" "PATCH"})
```

**Action:** Managed Challenge. Catches lazy automation on write-methods; legitimate users (including researchers using curl in dev) can solve the challenge.

---

## 10. Rate limiting (separate tab)

### 10.1 `ratelimit-auth-endpoints`

```
(http.host eq "api.amina-design.com")
and (
  http.request.uri.path contains "/api/v1/auth/"
  or http.request.uri.path contains "/api/v1/caregiver/login"
  or http.request.uri.path contains "/oauth/callback"
)
```

| Setting | Value |
|---|---|
| Counter | IP address |
| Period | 10 seconds |
| Threshold | 10 requests |
| Action | Block for 1 hour |

Trips credential-stuffing / OTP-brute-force within the first 100 attempts.

---

## 11. Frontend hardening

### 11.1 Cloudflare Pages deployment

- Project: `amina`
- Build artifact: `components/frontend/dist/` (Vite production build)
- Domain attached: `amina-design.com` + `www.amina-design.com`
- Auto-issued cert per domain.

### 11.2 Build-time URL pinning

`components/frontend/.env.production` pins the API origin so production fetches always go through Cloudflare:

```env
VITE_API_URL=https://api.amina-design.com
```

`index.html` injects three globals so every code path in the SPA finds the right origin:

```html
window.AMINA_API           = "https://api.amina-design.com";
window.__AMINA_API_BASE__  = "https://api.amina-design.com";
window.__AMINA_GATEWAY_URL = "https://api.amina-design.com";
```

If the placeholder survives (dev mode without the env var) it's stripped to empty so the dev fallback path takes over.

### 11.3 Boot-time error trap

`index.html` includes a small uncaught-error handler that surfaces any boot-time failure on screen instead of leaving a blank page. After React mounts, runtime errors go to the console only. ResizeObserver loop notifications (benign browser noise) are filtered.

### 11.4 Stale-token interceptor

`auth/staleToken401Interceptor.js` wraps `window.fetch` once on import. On any 401 response to a Bearer-bearing request, it clears all token keys, surfaces a banner, and reloads to `#/login`. Debounced max 1×/min so a route storm doesn't trigger a redirect storm.

---

## 12. Verification commands

### 12.1 External direct-IP access blocked

```bash
for p in 8000 8020 8443 5174 7860 5500 2480; do
  printf '  164.52.196.198:%-5s ' "$p"
  curl -s -m 5 "http://164.52.196.198:$p/health" -o /dev/null -w 'HTTP=%{http_code} time=%{time_total}s\n'
done
```

Expected: every line shows `HTTP=000 time=5.0s` (timeout).

### 12.2 Tunnel path works

```bash
curl -s https://api.amina-design.com/health -m 10 -w '\nHTTP=%{http_code}\n'
# {"status":"ok","service":"amina-gateway","phase":"0+1"} HTTP=200
```

### 12.3 Security headers present

```bash
curl -sI https://api.amina-design.com/health -m 10 \
  | grep -iE 'strict-transport|x-content-type|x-frame|referrer-policy|permissions-policy|cross-origin-resource'
```

Expected: all six headers from §5.

### 12.4 CORS preflight from prod origin

```bash
curl -s -m 5 -X OPTIONS \
  -H 'Origin: https://amina-design.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: Authorization,Content-Type' \
  https://api.amina-design.com/api/v1/auth/login \
  -D - -o /dev/null
```

Expected: `200 OK`, `access-control-allow-origin: https://amina-design.com`, `access-control-allow-credentials: true`.

### 12.5 Tunnel connector health

```bash
ssh root@164.52.196.198 'docker logs amina-cloudflared --tail 5 | grep -i "registered tunnel connection"'
```

Expected: 4 `Registered tunnel connection` lines, locations across `del0*` / `bom0*`.

---

## 13. Operational notes and outstanding items

### 13.1 Token rotation

- `JWT_SECRET` rotation: change in `/root/amina/haystack-stack/.env`, restart `haystack-chatqna` and `amina-gateway`. All existing JWTs invalidate; the stale-token interceptor handles the user-side fallout cleanly.
- `CLOUDFLARED_TUNNEL_TOKEN`: rotate via Cloudflare → Networks → Connectors → Amina-prod → "Refresh token", then update `/root/amina/.env.cloudflared` and `docker restart amina-cloudflared`.

### 13.2 Bind mounts to keep gateway changes alive

`patient_alert_service.py` and `haystack-chatqna/src/main.py` are explicitly bind-mounted via `docker-compose.override.yml` so a `docker compose up --force-recreate` doesn't revert them to the baked image. Gateway code (`api-gateway/app/main.py`, `proxy.py`) is currently kept in sync via `docker cp` — adding the same bind-mount pattern is a small followup.

### 13.3 Future hardening (not yet shipped)

- **Bot Management tier** ($20/mo Pro plan) — enables `cf.bot_management.score` and verified-bot fields, gives finer detection than Free's threat-score-only model.
- **Service Auth** between cloudflared and amina-gateway (mTLS) — irrelevant on a single VM but worth doing if the topology splits.
- **WAF Managed Rulesets** (Pro+) — Cloudflare-curated OWASP ruleset.
- **Argo Smart Routing** (Pro+) — improves latency for users far from India.
- **Geographic mirror** — second cloudflared on a Lagos or Frankfurt VM to halve African / European latency.

---

## 14. Operations runbooks

### 14.1 Env-file precedence (avoid the `.env.defaults` time-bomb)

`docker compose` merges env files in this order, **last wins**:

1. `env_file:` directives in `docker-compose.yml` (e.g., `.env.defaults`)
2. `env_file:` directives in subsequent overlays
3. `environment:` blocks in compose YAML (always wins over env_file)
4. The shell environment when `docker compose up` runs

**Trap we hit twice (JWT_SECRET in 2026-04, DHIS2_BASE_URL in 2026-05):** a key that lives in BOTH `.env.defaults` and `.env` will resolve to the **defaults** value, because compose loads `.env.defaults` last in our setup. The auditor at `_tmp_dhis2_v12.py` step [3] now keeps these in sync — re-run it any time you suspect drift:

```bash
ssh root@164.52.196.198 'python3 /tmp/_env_audit.py'
```

`.env.defaults` carries a policy header (added 2026-05-09) reinforcing the rule:
- defaults are FALLBACKS, not OVERRIDES
- never put a key in defaults that `.env` actually sets

### 14.2 DHIS2 recovery runbook

If the live health probe (`GET /api/v1/dhis2/health`) returns `overall: "fail"` or you see `❌ DHIS2 health FAIL` in haystack-chatqna's startup banner, follow this:

**Symptom A — `base_reachable: fail`**
- DHIS2 server unreachable. Most likely the upstream `play.im.dhis2.org/dev` is down or `DHIS2_BASE_URL` got reset to `disabled` (defaults overlay collision).
- Verify env: `docker exec haystack-chatqna env | grep DHIS2_BASE_URL`. Should be a real URL, not `disabled`.
- Verify network: from inside the container, `curl -I https://play.im.dhis2.org/dev/api/system/info`.
- If env shows `disabled`, run the audit (§14.1) and recreate haystack-chatqna with `docker compose up -d --force-recreate haystack-chatqna`.

**Symptom B — `dataset_exists: fail` with E1005 / 404**
- The configured dataset was deleted or renamed on the upstream DHIS2 server, OR the AMINA service-account lost READ access.
- Pick a replacement from the live discovery:
  ```bash
  curl -H "Authorization: Bearer <admin_token>" \
       https://api.amina-design.com/api/v1/dhis2/discover | jq '.datasets[]|.id+"  "+.name'
  ```
- Update `DHIS2_DATASET_ID` in `/root/amina/haystack-stack/.env`.
- Recreate haystack-chatqna: `docker compose up -d --no-deps --force-recreate haystack-chatqna`.
- Re-run health probe; should flip `dataset_exists` to ok.

**Symptom C — `element_map_resolves: fail` (0/N resolve)**
- Element IDs in `DHIS2_DATA_ELEMENT_MAP` don't exist in the current dataset. Sync will silently no-op.
- List the new dataset's elements:
  ```bash
  curl -H "Authorization: Bearer <admin_token>" \
       https://api.amina-design.com/api/v1/dhis2/discover/dataset/<dataset_id> | jq '.data_elements[]|.id+"  "+.name'
  ```
- For each AMINA metric (`AMINA_CONS_TOTAL`, `AMINA_NCD_HTN`, etc.) pick the closest matching element ID by name.
- Build a JSON dict: `{"AMINA_CONS_TOTAL":"<new_id>", "AMINA_NCD_HTN":"<new_id>", ...}`
- Set `DHIS2_DATA_ELEMENT_MAP=<json>` in `.env` (single-line JSON, no newlines).
- Recreate haystack-chatqna; re-run health probe.

**Symptom D — `dataset_detail: warn` (0 org units)**
- Dataset exists but no org-unit assignments. AMINA needs at least one org unit to push aggregate values to.
- Check on DHIS2 admin UI that the configured user has access to the org-unit hierarchy linked to the dataset.

### 14.3 Validating env-file precedence after any change

```bash
# What .env.defaults claims
grep -E "^[A-Z][A-Z_]*=" /root/amina/haystack-stack/.env.defaults | wc -l

# How many of those .env actually overrides
join -t= -j1 \
    <(grep -E "^[A-Z][A-Z_]*=" .env.defaults | sort -u | cut -d= -f1) \
    <(grep -E "^[A-Z][A-Z_]*=" .env | sort -u | cut -d= -f1)
```

A non-empty join output is the bug. Comment them out in `.env.defaults`.

---

## 15. Source-of-truth files

| Concern | File |
|---|---|
| Cloudflare tunnel token | `/root/amina/.env.cloudflared` (A40, chmod 600) |
| JWT secret | `/root/amina/haystack-stack/.env` (A40) |
| Gateway code | `components/api-gateway/app/main.py`, `components/api-gateway/app/proxy.py` |
| CORS lists | `haystack-stack/haystack-chatqna/src/main.py:71-92`, `components/api-gateway/app/main.py:102-122` |
| Frontend prod env | `components/frontend/.env.production` |
| Frontend bootstrap | `components/frontend/index.html` |
| Stale-token interceptor | `components/frontend/src/auth/staleToken401Interceptor.js` (A40 deploy) |
| ufw rules | `/etc/ufw/user.rules` on A40 |
| sshd restrictions | `/etc/ssh/sshd_config` `Match User amina-tester` block |
