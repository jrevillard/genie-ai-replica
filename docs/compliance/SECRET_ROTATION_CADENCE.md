# AMINA — Secret Rotation Cadence (OPS-007)

**Audience:** ops / pilot operator / security reviewer.
**Status:** ✅ documented (this file). Actual rotation execution is
the operator's job — this document defines the cadence + the
mechanism. It is the contract the operator signs against.

---

## 1. Why this exists

OPS-007 was a 🔴 gap in Phase 1–7: there was no documented cadence for
rotating the secrets the AMINA stack relies on. Without a stated
cadence, any compromise window is open-ended. This document closes
the **documentation** half of OPS-007. The **execution** half
(actually rotating on the cadence below) remains an ops responsibility
and is tracked in the operator's runbook.

## 2. Secret inventory (what gets rotated)

| Secret | Where stored | Cadence | Trigger for off-cycle rotation |
|---|---|---|---|
| `JWT_SECRET` (caregiver / patient JWT signing) | `haystack-stack/.env` | **90 days** | Any of: token leak, suspected lateral movement, departure of an admin/operator |
| `ARCADEDB_ROOT_PASSWORD` | `haystack-stack/.env` | **180 days** | Operator turnover, suspected DB-level compromise |
| `MISTRAL_API_KEY`, `AMINA_MISTRAL_API_KEY` | `haystack-stack/.env` | **180 days** | Provider-side advisory, key in logs, stack repository accidentally pushed |
| `MESSENGER_PAGE_ACCESS_TOKEN`, `MESSENGER_APP_SECRET` | `haystack-stack/.env` | **per Meta policy** (≤ 60 days for the Page Access Token) | Webhook mismatch, suspected MitM, Meta security advisory |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` | `haystack-stack/.env` | **per Meta policy** | as above |
| `TWILIO_AUTH_TOKEN`, `TWILIO_ACCOUNT_SID` (account-paired) | `haystack-stack/.env` | **180 days** | Twilio security advisory, suspected SMS pumping abuse |
| `AMINA_AUDIT_HASH_SALT` (Phase 9 audit-event-store hash salt) | `haystack-stack/.env` | **never (intentional)** | Rotating the salt rebases all actor/subject hashes, breaking historical audit-trail correlation. Treat the salt as a stable identifier; if it must be rotated (e.g. confirmed leak), follow the **forensic rotation** procedure in §5 |
| Cloudflare quick-tunnel URL | runtime | **per-session** (regenerated on container restart) | n/a — short-lived |
| GitLab PAT (committed historically) | git history | **rotate immediately + revoke** | already flagged in `SEC-007`; track separately |

The cadence column is the *maximum* time a secret may live without
rotation. The operator may rotate more often.

## 3. Rotation procedure (canonical)

Each rotation should follow these five steps in order:

1. **Generate the new secret.** Use a secure RNG (e.g. `openssl rand
   -hex 32` for `JWT_SECRET`, the provider's dashboard for
   third-party API keys). Never paste an existing secret as the new
   value.
2. **Stage the new secret in `.env`.** Add a new line; do not yet
   replace the old one. Example for `JWT_SECRET`:
   ```bash
   JWT_SECRET_NEW=<freshly-generated>
   ```
3. **Switch the runtime to the new secret.** For `JWT_SECRET`, this
   means rolling the relevant container with the new value. Tokens
   already in flight will fail signature validation; that is the
   expected forced-relog behaviour for a rotation.
4. **Validate.** Confirm the new value is in effect via:
   ```bash
   docker exec haystack-chatqna python -c "from src.config import settings; print(settings.JWT_SECRET[:8])"
   ```
5. **Remove the old value** from `.env` and commit the env file
   change (`.env` is gitignored — record the cadence in the operator
   ticket, not in git).

For provider tokens (Mistral / Meta / Twilio), step 3 is the
provider's dashboard toggle, not a container restart.

## 4. Rotation evidence

Each rotation must produce a single audit-event-store row:

```python
from src.services.audit_event_store import append_event
append_event(
    event_type="ops.secret.rotated",
    actor_type="operator",
    actor_id="<operator-handle-or-id>",
    action="rotate",
    resource="<secret-name>",   # e.g. "JWT_SECRET" — never the value
    outcome="success",
    reason_code="scheduled_cadence",  # or "incident", "off_cycle"
    metadata={
        "previous_age_days": <int>,
        "next_rotation_due": "<ISO-8601 date>",
    },
)
```

The audit row contains **only the secret's name and metadata** —
never the secret value, never a hash of the secret value. Test 8
(`test_stored_row_phi_free`) in `_audit_event_store_test.py`
guarantees the store rejects forbidden value patterns.

## 5. Forensic rotation (audit hash salt)

If `AMINA_AUDIT_HASH_SALT` must be rotated (confirmed leak / forensic
necessity), the historical audit trail's actor/subject hashes can no
longer be correlated to new events. The procedure:

1. Snapshot the existing `AuditEventVertex` rows to a sealed
   forensic export.
2. Rotate the salt + restart the container.
3. Record the rotation event with:
   ```
   event_type:  "ops.audit_salt.rotated"
   reason_code: "forensic"
   metadata.snapshot_ref: "<opaque ref to the sealed export>"
   ```
4. From that point forward, hashes use the new salt; do not attempt
   to backfill the old rows.

## 6. Closing OPS-007

OPS-007 in [`compliance_controls.json`](compliance_controls.json)
was previously `gap`. With this document in place it moves to
🟡 **partial** — cadence is documented, execution evidence is the
operator's responsibility. It will move to ✅ **complete** when the
operator can show:

- one `ops.secret.rotated` row in the audit store from a real
  rotation, AND
- a calendar reminder / ticket cadence in their runbook.
