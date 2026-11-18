# ROCm Venue Runbook — OKF Stack, Auth, and Operations

Dev-internal runbook (audience: agents + operators) for the **live
single-server ROCm venue** (Strix Halo, compose project
`genieai-rocm`). Covers everything the first live bring-up surfaced
(2026-11-18) that the deployment docs do not: OKF enablement, the
split-URL auth trio, service-account seeding, the OKF lifecycle, the
import contract, tuning knobs, and the four failure classes we hit with
their signatures and fixes.

NVIDIA venues are unaffected by every item here — the ROCm overlay
(`docker-compose.rocm.yaml`) is only loaded on this path, and the local
`.env` is per-venue and never committed.

---

## 1. Venue invocation (the only compose line that matters)

```bash
docker compose -p genieai-rocm \
  --env-file .env --env-file env.strixhalo \
  -f docker-compose.yaml -f docker-compose.rocm.yaml \
  --profile opea --profile gpu-models [--profile okf] \
  up -d [<service>...]
```

- `--profile okf` is needed whenever a command names okf-server,
  pii-service, or kong-config with OKF intent (the two OKF services are
  profile-gated; kong-config re-applies the declarative Kong config and
  reads `OKF_ENABLED` from the environment).
- `.env` (local, gitignored) carries the venue-only flags:
  `OKF_ENABLED=1`, `VLLM_ENDPOINT=http://vllm:8000`, plus the usual
  secrets. Never commit it.

## 2. Enabling OKF on the venue

OKF ships **off** (`OKF_ENABLED=0` default): no okf-server container, no
pii-service, and the kong-config init **strips the `/api/okf` route from
Kong** at apply time. Enable = all of:

1. `.env`: `OKF_ENABLED=1`.
2. Bring-up with `--profile okf` (starts okf-server + pii-service + ragas-service).
3. Re-run the kong-config init so Kong gains the route:
   `... up -d kong-config` (recreates the one-shot container, which
   re-applies the declarative config honoring the flag).
4. Recreate **every flag consumer** — compose reads `OKF_ENABLED` in
   SIX services (kong-config is step 3's one-shot; backend + frontend
   are step 4's) and a container only picks up the new value when
   recreated (live miss 2026-11-18: backend left at `OKF_ENABLED=0`
   after the other four were recreated → retrieval-config client
   short-circuited to `parked` → 0 serving graphs → every chat query
   answered zero chunks, the runbook's §9 table had no row for it):
   `... up -d backend frontend` (`VUE_APP_OKF_ENABLED` mirrors the same
   var into the frontend's runtime config; the Admin Dashboard hides
   the OKF surfaces without it).

Verify: `GET /api/okf/repos` through the edge answers 401/200 (not
Kong's `{"message":"Resource not found"} 404`), `docker exec
<backend> sh -c 'echo $OKF_ENABLED'` prints `1`, and the backend log
line `QueryService.fanout_config_resolved` reports
`serving_graph_count >= 1` once a serving repo exists.

## 3. Split-URL auth — now THREE services

The venue's edge TLS cert is self-signed. Any service that verifies
tokens by fetching OIDC discovery from the **public edge URL** times out
(TLS) and/or rejects tokens minted through the browser edge (issuer
mismatch: discovery sees the in-network `http://keycloak:8080` issuer,
browser tokens carry `https://<domain>:<port>/auth`). The fix is the
same trio on every token-verifying service, in the ROCm overlay:

```yaml
KEYCLOAK_DISCOVERY_URL: http://keycloak:8080                 # fetch-host BASE
KEYCLOAK_JWKS_URL: http://keycloak:8080/realms/genie/protocol/openid-connect/certs
KEYCLOAK_PUBLIC_URL: https://<NGINX_PUBLIC_DOMAIN>:<NGINX_HTTPS_PORT>/auth  # trusted issuer alias
```

Now applied to **backend**, **okf-server**, AND **document-repository**
(all three blocks live in `docker-compose.rocm.yaml`). The doc-repo one
is load-bearing for OKF: without it, doc-repo's OIDC discovery times out
against the self-signed edge and its auth layer answers **503**, which
surfaces as `EXPORT_FAILED: bundle store failed (doc-repo status 503)`
when publishing an OKF repo. NVIDIA venues never load the overlay — no
behavior change there.

> **Remote-ROCm TLS:** Section 18's `rocm_gpu_node_remote` trio does NOT
> render the TLS skip — a remote node serving its default self-signed cert
> fails TLS verification on every model call unless the operator sets
> Section 20's `opea_ssl_skip_verify: 1` in the APP host's group_vars (or
> fronts the node with a real cert via the letsencrypt profile).
>
> **TLS-verify note (security round-2, 2026-11-18):** the co-located 18B
> render sets `OPEA_SSL_SKIP_VERIFY=1` unconditionally (self-signed node
> cert by design). The knob is **process-global** with no per-endpoint CA
> pinning: a future deployment that fronts Keycloak or ArangoDB with a
> publicly-signed cert would silently lose that verification. Revisit
> before mixing signed and self-signed endpoints on one host.

## 4. The TLS certificate — generator, failure class, fix

### The failure class (what it looked like)

The compose dev path generates the nginx edge cert at **container
start** when no volume certs exist. The old generator stamped
`CN=localhost` with **no subjectAltName**. Browsers then:

- render the page after a click-through interstitial, but reject every
  XHR/subresource fetch with `net::ERR_CERT_AUTHORITY_INVALID`;
- the frontend's `/runtime/config.js` is one of those fetches →
  `window.APP_CONFIG` never loads → [httpService.js](../components/gov-chat-frontend/src/services/httpService.js)
  falls back to the baked `http://localhost:3000/api` →
  `ERR_CONNECTION_REFUSED` on every API call;
- the user-visible symptoms were a phantom **"lost session"**, **"Network
  error" toasts**, and admin pages half-loading. **None of it was
  session expiry.**

### The fix (shipped)

[api-gateway-solution/nginx/entrypoint.sh](../api-gateway-solution/nginx/entrypoint.sh)
`generate_self_signed_cert()` now adds
`-addext subjectAltName=IP:<NGINX_PUBLIC_DOMAIN>|DNS:<NGINX_PUBLIC_DOMAIN>,DNS:localhost,IP:127.0.0.1`
(IP literal → `IP:` entry, hostname → `DNS:`). Applied by rebuilding the
nginx image and recreating the container — the generator runs at boot.

### Operator unblock (browser side)

After ANY cert change, the exception must be re-established once. Two
routes:

- Interstitial: hard-refresh → type `thisisunsafe` (blind-typed) or
  click "Accept the Risk and Continue".
- **Permanent (recommended)**: trust the cert in the OS store, then
  fully restart the browser:

```bash
sudo cp <cert>.crt /usr/local/share/ca-certificates/genieai-rocm.crt
sudo update-ca-certificates
```

Note: replacing the cert inside a running container (docker cp +
`nginx -s reload`) works but does NOT survive a recreate; the generator
fix is the durable path.

### Stale OIDC state after outages

After TLS churn, the SPA may replay a used/expired auth code — Keycloak
answers with its themed *"We are sorry… An error occurred, please login
again through your application."* page on every reload. Fix: F12 →
Application → **Clear site data** (wipes the app token AND the Keycloak
SSO cookie — same origin), close the tab, log in fresh. Keycloak itself
was healthy the whole time.

## 5. Kong stale DNS after recreating a target container

Recreating okf-server (or any Kong upstream) leaves Kong serving
`502 An invalid response was received from the upstream server` for
**~1–2 minutes** (`KONG_DNS_STALE_TTL=5s` + resolver refresh). It
self-heals — do not restart anything. Signature: 502s through the edge
while the target container is healthy and its direct `/health` passes.

## 6. OKF seeding via API (no Studio)

For scripted hierarchy/repo setup without the Studio wizard:

### 6.1 Grant `tools-admin` to the dataprep service account

okf-server gates `POST /repos` on the **realm role `tools-admin`**. The
dataprep client's `client_credentials` token is the automation identity;
give its service account the role once (cache-safe admin REST, no ROPC
dance):

```bash
# master admin token (grep|cut, never `source .env` — special chars)
# role id: GET /auth/admin/realms/genie/roles/tools-admin (exists: Story 2.2)
# user id: GET /auth/admin/realms/genie/users?username=service-account-dataprep-service-client&exact=true
# assign:  POST /auth/admin/realms/genie/users/<uid>/role-mappings/realm
#          body: [{"id":"<role-id>","name":"tools-admin"}]   → 204
# token:   POST /auth/realms/genie/protocol/openid-connect/token
#          grant_type=client_credentials client_id=dataprep-service-client
```

Client-credential tokens are **short-lived** (minutes) — mint fresh per
operation, never cache across sessions.

### 6.2 Create repo + import concepts

```bash
POST /api/okf/repos
{"name":"The Solar System","domain":"The Solar System","acl":{"required_scopes":[]}}
# → 201, repo_id; creator's admin scope auto-added (okf:t:<slug>:admin)

POST /api/okf/repos/<repo_id>/import
{"concepts":[{"path":"X.md","frontmatter":{"title":"X","type":"topic"},"body":"..."}]}
# → 202 {parsed, created, updated, rejected, pii, enqueued}
```

Import contract facts (all live-verified):

- `concepts[].path` ending `.md` keeps the basename **verbatim** as the
  concept id — case and spaces survive ("The Solar System", not
  "the-solar-system"). Without `.md`, the name is slugified.
- **`frontmatter.type` is REQUIRED** — absence is the hard error
  `MISSING_TYPE` (conformance), the concept gets `index_status='rejected'`
  and is never chunked. Any non-empty string passes (`type: topic` is
  conventional). Import shows `created: N, rejected: N` when this bites.
- Bodies carry **wiki-links** `[[Target.md|label]]` — they become
  `okf_concepts_meta.links[]` (the editor/Studio tree source, live from
  first import, case-sensitive concept-id match) and drain into the
  ArangoDB `_LINKS_TO` graph at publish/ingest.
- Import is **path-keyed upsert**: re-import with the same paths
  `updated` instead of `created`.
- `pii.hit` counts do not block ingest — they gate **publish** (see
  lifecycle).

### 6.3 Lifecycle: register → review → approve → publish → serving

```bash
POST /api/okf/repos/<id>/pii-acknowledge  {"acknowledge":true}   # waive NER 'hit' gate (audited)
POST /api/okf/repos/<id>/lifecycle        {"action":"submit"}    # → review
POST /api/okf/repos/<id>/lifecycle        {"action":"approve"}   # → approve
POST /api/okf/repos/<id>/lifecycle        {"action":"publish"}   # mints version + bundle zip → doc-repo
POST /api/okf/repos/<id>/lifecycle        {"action":"ingest"}    # → serving + RAG drain
```

- **publish** stores the bundle zip in doc-repo — requires the
  `KC_OKF_SERVER_CLIENT_SECRET` wired (empty = doc-repo rejects) and
  doc-repo's auth layer alive (split-URL trio, §3).
- **ingest** starts the RAG drain (`metrics.rag_ingestion.status:
  draining → drained`; `metrics.indexing.indexed` counts it — it stays
  0 until ingest, by design).
- A serving repo is **read-only**: retract before further mutation.
- The PII scanner flags person-name-like strings (astronomy names such
  as "Kepler", mission names) as `hit` — public content waives the gate
  via the audited `pii-acknowledge`; a scanner `error` (not `hit`)
  blocks regardless.
- **Delete**: `DELETE /api/okf/repos/<id>` → soft-delete (168 h grace)
  + immediate per-repo graph teardown (`OKF_<repo_id>*` collections
  dropped, meta removed). Concepts, links, chunks all go with it.

## 7. OKF LLM legs — opt-in + knobs

The OKF auxiliary LLM legs (curation split, topic links, manifest
summary) are **opt-in**: okf-server's `VLLM_ENDPOINT` ships EMPTY
("a deployment opts IN by setting VLLM_ENDPOINT + VLLM_API_KEY" —
`services/vllm-model-cache.js`). Unset ⇒ curation calls throw
`llmNotConfiguredError` and the Studio **LLM-Assisted** flow stalls
after storing the raw import (UI keeps polling; "not moving"). Venue
fix: `.env` `VLLM_ENDPOINT=http://vllm:8000` + recreate okf-server.
Other compose consumers of the var already default to the same URL, so
the line moves only okf-server.

Topic-link tuning (all env, read at process start — recreate to apply):

| Variable | Default | Measured on granite-3.1-2b (144-concept repo) |
|---|---|---|
| `OKF_TOPIC_LINK_TIMEOUT_MS` | 60000 | **7 of 19 batches exceeded 60 s** (batch prompts of 8 concepts) |
| `OKF_TOPIC_LINK_BATCH` | 8 | smaller batch = shorter prompts per call |
| `OKF_TOPIC_LINK_LANES` | 4 | parallel batches |
| `OKF_TOPIC_LINK_MAX_PER_CONCEPT` | 6 | 113 proposals dropped over-cap in the measured run |

Measured run: 206 proposals → **85 links written, 39/143 concepts
linked**, 228 s elapsed. Failures are **fail-soft** (batches skipped,
import continues) — a re-run on the same repo densifies links without
re-importing.

## 8. Studio import modes (operator-facing summary)

- Plain zip import: stores concepts as-is (paths verbatim).
- **LLM-Assisted**: stores the raw doc(s) first, then the LLM curation
  leg splits/structures them into the concept tree (requires §7 opt-in),
  then the topic-link leg proposes cross-links (§7 knobs).
- Lifecycle through the wizard writes the same audit rows as §6.3.

## 9. Failure-class cheat sheet

| Symptom | Root cause | Fix |
|---|---|---|
| `net::ERR_CERT_AUTHORITY_INVALID` on XHR/chunks, page renders | cert without SAN / unaccepted exception | §4 generator fix + OS trust |
| APIs hit `localhost:3000` (`ERR_CONNECTION_REFUSED`) | `APP_CONFIG` missing because `/runtime/config.js` was cert-blocked | same as above |
| "We are sorry… login again" loop | stale OIDC state (used auth code replay) | Clear site data, fresh login |
| 502 through edge, target healthy | Kong stale DNS after recreate | wait ~2 min, retry |
| `EXPORT_FAILED … doc-repo status 503` on publish | doc-repo OIDC discovery timeout | split-URL trio on document-repository |
| `404 {"message":"Resource not found"}` on `/api/okf/*` | `OKF_ENABLED=0` — Kong route stripped | §2 enablement |
| `created: N, rejected: N` after import | `MISSING_TYPE` — frontmatter has no `type` | add `type`, re-import (upsert) |
| import `202` then Studio "not moving" (LLM-Assisted) | `VLLM_ENDPOINT` unset in okf-server — LLM legs off | §7 opt-in |
| publish blocked, `pii_hit_count > 0` | NER hits (names) | `pii-acknowledge` (audited) |
| token 401 `TOKEN_EXPIRED` mid-flow | client-credential tokens are minutes-lived | mint fresh |
| chat queries return zero chunks; retriever logs `Graph 'GRAPH' does not exist` | backend container predates `OKF_ENABLED=1` — retrieval-config client short-circuits to `parked`, 0 serving graphs | §2 step 4: recreate backend, verify `fanout_config_resolved` `serving_graph_count >= 1` |

## 10. ArangoDB coexistence

The venue's data lives in `genieai-rocm_*` volumes/projects ONLY.
Other stacks on the same host (e.g. `genie-ai-naat_*`) own their own
volumes — never chown, drop, or "repair" a volume outside this
project's name prefix. The one repair this venue needed (fresh volume
root-owned → arango FATAL): `docker run --rm -v
genieai-rocm_arango_data:/d alpine chown -R 999:999 /d`, **after**
verifying the uid the arango image runs as — never against another
stack's volume.
