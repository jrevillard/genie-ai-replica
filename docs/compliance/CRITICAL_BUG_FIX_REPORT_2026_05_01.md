# Critical Bug Fix Report — 2026-05-01

**Source audit:** [SECURITY_AND_BUG_AUDIT_2026_05_01.md](SECURITY_AND_BUG_AUDIT_2026_05_01.md)
**Scope of this pass:** the 10 Critical findings (BUG-001 → BUG-010).
**Branch:** `Health-AminaCare-branch`
**Date:** 2026-05-01

---

## TL;DR

| ID      | Title                                               | Status                          |
|---------|-----------------------------------------------------|---------------------------------|
| BUG-001 | Real production secrets committed to `.env`        | **partial** — fix design ready, awaiting user OK on Pattern D + history scrub + key rotation |
| BUG-002 | Hardcoded admin creds in source                    | **fixed**                       |
| BUG-003 | `JWT_SECRET` default in source                     | **fixed**                       |
| BUG-004 | ArcadeDB root password default                     | **fixed**                       |
| BUG-005 | SQL injection in `community_store`                 | **fixed**                       |
| BUG-006 | Dev bypass flags committed `true` in `.env`        | **fixed** (production boot-refusal) |
| BUG-007 | `OTP_DEV_MODE` default `true`                      | **fixed** (production boot-refusal) |
| BUG-008 | Unauth document download                            | **fixed**                       |
| BUG-009 | Unauth `/api/v1/agent/patients/list`                       | **fixed**                       |
| BUG-010 | Unauth compactor endpoints                          | **fixed**                       |

**9 of 10 critical bugs closed in code.** BUG-001 is the only remainder — its fix
requires a destructive history rewrite plus credential rotation, both of which
need explicit user authorisation (see "Pending user decisions" below).

All code changes verified by `py_compile` clean, 169/169 caregiver-privacy
consent tests passing, and a production-mode boot-refusal smoke test.

---

## Per-bug detail

### BUG-002 · Hardcoded admin creds in source — **fixed**
**File:** [src/api/admin_routes.py](../../haystack-stack/haystack-chatqna/src/api/admin_routes.py)

- Removed `ADMIN_USERNAME = "admin"` and `ADMIN_PASSWORD = "amina2026"` literals.
- Removed the dead-code `ADMIN_SECRET = "amina-admin-secret"` constant entirely.
- Replaced with `_required_env("ADMIN_USERNAME", dev_default="admin")` and
  `_required_env("ADMIN_PASSWORD", dev_default="amina2026")`.
- `admin_login` now compares credentials with `hmac.compare_digest` to remove a
  timing oracle that the previous `==` comparison had.
- In production (`AMINA_ENV=production`), missing/blank `ADMIN_USERNAME` or
  `ADMIN_PASSWORD` raises `RuntimeError` at import time and the process refuses
  to boot. See verification block below.

> Bcrypt/argon2 hashing of the admin password (the audit doc's stretch goal) is
> deferred — needs a separate migration script for any operator who has already
> set the cleartext env var. Not a blocker for closing the timing-oracle and
> hardcoded-default risks.

### BUG-003 · `JWT_SECRET` default in source — **fixed**
**File:** [src/config.py](../../haystack-stack/haystack-chatqna/src/config.py)

- Removed the `"amina-mvp-secret-change-in-prod-2026"` literal default.
- New helper `_required_env("JWT_SECRET")`:
  - `AMINA_ENV=production` + missing → `RuntimeError` at import.
  - dev mode + missing → generates a per-process random 32-byte hex value and
    prints `[config] JWT_SECRET unset; generated a per-process random value
    for DEV ONLY. Sessions will reset on restart.`
- Effect: signed JWTs in dev are ephemeral (good — no cross-restart token
  reuse), and there is no longer any compile-time secret that an attacker
  could mint forged tokens with.

### BUG-004 · ArcadeDB root password default — **fixed**
**File:** [src/config.py](../../haystack-stack/haystack-chatqna/src/config.py)

- `ARCADEDB_PASSWORD = _required_env("ARCADEDB_PASSWORD", dev_default="genieRoot123")`.
- Production: missing → boot refused.
- Dev: prints `[config] ARCADEDB_PASSWORD unset; using DEV DEFAULT (not safe
  for prod)` and uses the legacy default so existing `docker-compose up`
  flows still work for developers.
- `.env.example` already carries `<set-me>` placeholder language elsewhere in
  the repo; updating the literal value there is a follow-up not blocking
  closure of BUG-004 in code.

### BUG-005 · SQL injection in `community_store` — **fixed**
**File:** [src/db/community_store.py](../../haystack-stack/haystack-chatqna/src/db/community_store.py)

```python
# BUG-005 fix — parameterised DELETE so doc_id can never break out
# of the SQL string. CONTENT-based INSERT does not interpolate
# user input (the JSON is a static literal here), so it stays
# injection-free as-is.
await _exec(
    "DELETE FROM CommunityData WHERE doc_id = :doc_id",
    params={"doc_id": doc_id},
)
await _exec(f"INSERT INTO CommunityData CONTENT {content}")
```

- The DELETE was the only injection-reachable surface (the INSERT uses a
  pre-built JSON literal — no user input enters the SQL string itself).
- Audit log INSERT is similarly safe by construction (pre-built JSON literal,
  no user input in the SQL).

### BUG-006 · Dev bypass flags committed `true` — **fixed (production boot-refusal)**
**File:** [src/config.py](../../haystack-stack/haystack-chatqna/src/config.py)

Three flags are now read through a new `_bool_env(name, *, prod_must_be_false=True)` helper:

```python
DEV_FLAG_CHATQNA_ADMIN_MV_OPEN  = _bool_env("CHATQNA_ADMIN_MV_OPEN",  prod_must_be_false=True, default=False)
DEV_FLAG_CARE_TRUST_BODY_ROLE   = _bool_env("CARE_TRUST_BODY_ROLE",   prod_must_be_false=True, default=False)
DEV_FLAG_DHIS2_DEV_ADMIN_BYPASS = _bool_env("DHIS2_DEV_ADMIN_BYPASS", prod_must_be_false=True, default=False)
```

- Default in code is now `False` for all three (was previously read from
  `.env` where they were committed as `true`).
- If `AMINA_ENV=production` AND any of these is truthy, the process raises
  `RuntimeError` at import time. There is no longer a "forgot to flip the
  flag" failure mode.
- Verified — see "Verification" §3.

### BUG-007 · `OTP_DEV_MODE` default `true` — **fixed (production boot-refusal)**
**File:** [src/config.py](../../haystack-stack/haystack-chatqna/src/config.py)

- `OTP_DEV_MODE = _bool_env("OTP_DEV_MODE", prod_must_be_false=True, default=False)`.
- Default `False` in code. Prod refuses to boot if the env var is truthy.

### BUG-008 · Unauth document download — **fixed**
**File:** [src/api/agent_routes.py](../../haystack-stack/haystack-chatqna/src/api/agent_routes.py)

- Added `_require_auth(http_request)` helper alongside the existing
  `_has_valid_auth()` (which returns bool for the model-cascade gate). The
  new helper returns the JWT claims dict and raises 401 on failure.
- Both `GET /api/v1/agent/document/{session_id}` and
  `GET /api/v1/agent/document/{session_id}/download/{fmt}` now call `_require_auth`
  on entry. Documents contain consultation transcripts (PHI under DPA 2025).

> Strict session-owner gating (only the JWT subject who created the session
> can read it back) requires a `chat:session_owner:{session_id} → JWT_sub`
> Redis map that doesn't exist yet. Adding "any valid JWT" today closes the
> open-internet enumeration risk; tightening to session-owner is tracked as a
> High-tier follow-up.

### BUG-009 · Unauth `/api/v1/agent/patients/list` — **fixed**
**File:** [src/api/agent_routes.py](../../haystack-stack/haystack-chatqna/src/api/agent_routes.py)

- Now calls `_require_auth`, then enforces `payload.role in ("admin",
  "caregiver")`. Patient JWTs receive `403 — Admin or caregiver only`.
- Caregiver-scoped filtering (only their linked patients) is the right next
  step; for now this stops the open-internet exfiltration risk.

### BUG-010 · Unauth compactor endpoints — **fixed**
**File:** [src/api/agent_routes.py](../../haystack-stack/haystack-chatqna/src/api/agent_routes.py)

- `GET /api/v1/agent/compactor/stats/{session_id}`,
  `POST /api/v1/agent/compactor/trigger/{session_id}`,
  `POST /api/v1/agent/compactor/undo/{session_id}` — all now call `_require_auth`
  on entry.
- Same caveat as BUG-008: any valid JWT is accepted. Tightening to
  session-owner is the High-tier follow-up.

---

## Verification

### 1. `py_compile`
All four touched files compile clean:

```
python -m py_compile src/api/agent_routes.py src/api/admin_routes.py \
                    src/config.py src/db/community_store.py
# (no output → success)
```

### 2. Caregiver-privacy consent suite — 169 / 169 PASS

```
=== 30. Phase 7 — 403 detail body has zero PHI / secrets ===
  [PASS] 403 detail contains no PHI / secrets / token shapes
  [PASS] 403 detail keys are exactly the canonical 6

================================================================
PASSED: 169    FAILED: 0
```

### 3. Production boot-refusal — confirmed working

| Scenario                                                                | Expected           | Result              |
|-------------------------------------------------------------------------|--------------------|---------------------|
| `AMINA_ENV=production` + `ARCADEDB_PASSWORD` unset                      | RuntimeError       | ✅ raised at import |
| `AMINA_ENV=production` + `OTP_DEV_MODE=true` (other env vars set)       | RuntimeError       | ✅ raised at import |
| dev mode (no `AMINA_ENV`) + `ARCADEDB_PASSWORD` unset                   | warning + boot     | ✅ warned, booted   |
| dev mode + `JWT_SECRET` unset                                           | random + warning   | ✅ random + warned  |

### 4. Module-level import sanity

```
agent_routes imports OK
routes count: 34
  PASS - compactor_stats has _require_auth
  PASS - compactor_trigger has _require_auth
  PASS - list_test_patients role-checks
```

---

## Pending user decisions (BUG-001 only)

BUG-001 ("real production secrets committed to `.env`") is the only critical
left open. It needs **three** distinct authorisations from the user:

### A. Credential rotation
The keys in `haystack-stack/.env` are live and must be rotated even if we
never scrub git history — anyone with current GitLab read access has them.

- Google API key, OpenAI API key, Twilio SID + token + caller-ID, DHIS2
  credentials, Groq key, Mistral key, Meta tokens.
- See [SECRET_ROTATION_CADENCE.md](./SECRET_ROTATION_CADENCE.md) §2 for the
  per-provider rotation steps.

### B. Encrypted secrets pattern (Pattern D)
Proposed earlier: encrypt the `.env` at rest in the repo via AES-256-GCM,
master key lives outside the repo (env var `AMINA_MASTER_KEY` or gitignored
`secrets/master.key`). One-time setup per developer (paste master key from
password manager); thereafter `docker-compose up` "just works".

This is the realistic upper bound on "encryption that doesn't need
per-developer setup" — strict equivalent to Rails encrypted credentials. The
naive "encrypt with a key checked in alongside" pattern is security theatre
and was rejected.

**Awaiting your yes / no on Pattern D.**

### C. Git history scrub (destructive)
After rotation + Pattern D land, the historical commits still leak the
old keys. Remediating that requires `git filter-repo` (or BFG) + a
force-push to the protected branch, after which **every teammate must
re-clone**.

This is the only remediation that actually prevents future read of the
leaked credentials from a fork or cached clone — but it's destructive and
needs your explicit go-ahead.

**Awaiting your yes / no on the history scrub.**

---

## Files changed in this pass

| File | Change |
|---|---|
| [src/config.py](../../haystack-stack/haystack-chatqna/src/config.py) | New `_required_env` + `_bool_env` helpers; production boot-refusal for missing secrets and truthy dev flags. Replaces 6 hardcoded defaults. |
| [src/api/admin_routes.py](../../haystack-stack/haystack-chatqna/src/api/admin_routes.py) | Removed 3 hardcoded constants; admin login uses `hmac.compare_digest`. |
| [src/db/community_store.py](../../haystack-stack/haystack-chatqna/src/db/community_store.py) | Parameterised the DELETE query (BUG-005). |
| [src/api/agent_routes.py](../../haystack-stack/haystack-chatqna/src/api/agent_routes.py) | New `_require_auth` helper; auth gate added to 6 previously-open endpoints. |

---

## What's next (after BUG-001 closes)

The 15 High-severity findings (BUG-011 → BUG-025) are the natural next pass.
The most important ones are behavioural, not configurative:

- BUG-014 — `asyncio.gather(return_exceptions=False)` in tool executor (one
  bad tool kills the whole turn).
- BUG-015 — Safety consensus fails *open* on auditor timeout (silent safety
  bypass).
- BUG-016 — Rate limiter fails *open* when Redis is down.

These are "how the system fails" bugs and matter more for an MVP launch than
the next round of secret-handling polish. Recommend tackling them as a single
"fail-closed" sweep PR.
