# AMINA — Consent Model

**Audience:** clinical reviewer, ministry liaison, pilot operator.
**Implementation anchors:** [consent_service.py](../../haystack-stack/haystack-chatqna/src/services/consent_service.py), [consent_routes.py](../../haystack-stack/haystack-chatqna/src/api/consent_routes.py), [training_consent.py](../../haystack-stack/haystack-chatqna/src/services/training_consent.py).

---

## 1. Consent surfaces

AMINA recognises **four distinct consent grants**. Each is independent.

| Consent | What it covers | Default |
|---|---|---|
| **Clinical-support consent** | Using AMINA as decision support / education / triage assistance | required for personalised features |
| **Channel-processing consent** | The fact that the user sent a message via a third-party channel (WhatsApp / Messenger / Telegram / SMS) means their message body crossed that provider's network | implicit-on-message; documented in [PRIVACY_NOTICE.md](PRIVACY_NOTICE.md) |
| **Caregiver-link consent** | Allows a named community health worker / clinician to view the user's record | **opt-in only**, two-way (caregiver also accepts) |
| **Training consent** | Permits AMINA to keep an anonymised copy of the conversation for AI model improvement | **opt-in only, OFF by default** ([training_consent.py](../../haystack-stack/haystack-chatqna/src/services/training_consent.py)) |

## 2. Consent states (per grant)

```
NOT_ASKED    →  user has never been prompted
PROMPTED     →  user saw the prompt but has not answered
GRANTED      →  user accepted (timestamped)
DENIED       →  user explicitly declined
WITHDRAWN    →  previously granted, then revoked (timestamped)
EXPIRED      →  granted with TTL; the TTL has passed
```

Each state transition writes a `ConsentAuditVertex` edge to ArcadeDB (see existing schema; the edge captures actor, timestamp, before/after state, channel).

## 3. Grant flow

### Web (Advanced / Basic / Beginner)
1. First message in a session → AMINA emits a clinical-support consent prompt within the chat itself (not a modal).
2. User must respond (yes / no) before any tool that touches their record fires. Generic education answers do not require consent.
3. Caregiver link is a separate explicit affirmation.
4. Training consent is a separate explicit affirmation, with a clear "you can revoke this later" line.

### Voice
- Clinical-support consent is captured the same way (verbal "yes" → STT → consent service).
- Voice audio is not retained beyond STT (see [RETENTION_POLICY.md](RETENTION_POLICY.md)), so audio retention is not a separate consent.

### Telegram / WhatsApp / Messenger / SMS
- Channel-processing is implicit-on-message (the user chose to message AMINA on that channel).
- Clinical-support consent prompt is sent as the very first reply to a new conversation.
- Caregiver-link / training consent: caregiver-link disabled on third-party channels in v1; training consent prompt sent as the second reply if not already on file.

## 4. Withdrawal flow

- Free-form intent: user says "withdraw consent", "stop", "I want to be deleted", etc. → handled by intent router → consent service writes WITHDRAWN.
- Explicit endpoint: `POST /api/v1/consent/withdraw` ([consent_routes.py](../../haystack-stack/haystack-chatqna/src/api/consent_routes.py)).
- Effect of withdrawal:
  - Clinical-support → AMINA reverts to generic education answers; no record reads.
  - Caregiver-link → caregiver loses access immediately; previous caregiver replies remain in their inbox unless the user also requests deletion.
  - Training consent → no further conversation samples enter the training-export queue; previously-exported anonymised samples are kept per the training data retention rule (subject to the data-rights process).
  - Channel-processing → cannot be withdrawn for past messages on third-party channels; for future messages, user must stop messaging on that channel.

## 5. Phone auth / role auth relationship

- **Phone auth** (`observatory_phone_auth.py`, `otp.py`) establishes that the person controlling the phone number is the same one consenting. OTP TTL ≤ 10 min, never logged.
- **Role auth** (`auth_routes.py`) maps a verified identity to one of: `patient | family | vhw | chn | admin | guest`. Caregiver-link consent only meaningful when both ends have role auth.
- Consent applies to the phone-verified identity, not just the session. Re-authenticating on a new device inherits the existing consent state.

## 6. Synthetic / demo mode

- Any session ID matching the synthetic pattern (e.g. starts with `agentic_phase4_synth_`, `smoke_test_`, `demo_`) is treated as non-PHI by the agentic prepass and the evidence layer.
- Synthetic / demo mode does NOT bypass safety guardrails — it only relaxes consent prompts and skips real DHIS2 / channel side effects.

## 7. Channel-specific notes

| Channel | Consent surface | Special note |
|---|---|---|
| Web | In-chat | Easiest to revoke (single click) |
| Voice | Verbal in-chat | STT delay means consent lands a turn later than text |
| WhatsApp | First reply | Meta DPA also applies |
| Messenger | First reply | Meta DPA also applies |
| Telegram | First reply | Telegram ToS also applies |
| Twilio SMS | First reply | Carrier-of-record terms also apply |

## 8. Evidence-layer + agentic-trace boundary

- **Evidence layer** (`evidence_layer/`): collects per-turn JSONL traces + markdown reports. Default OFF (`AMINA_EVIDENCE_LAYER_DEFAULT=off`). Operators may enable for clinical review. Even when enabled, content is PHI-redacted by construction and stored locally on the AMINA server only.
- **Agentic trace** (`agent_platform/tracing.py`): per-turn JSON line on the standard logger, default ON when `AMINA_AGENTIC_MODE != off`. Designed PHI-safe.
- Neither requires a separate user consent in v1 because both are PHI-redacted at construction time. If either ever becomes PHI-bearing, a new consent grant must be added.

## 9. Operator responsibilities

The pilot operator must:

1. Confirm `__PILOT_OPERATOR_EMAIL__` and `__CLINICAL_SAFETY_LEAD__` placeholders in [PRIVACY_NOTICE.md](PRIVACY_NOTICE.md).
2. Audit the consent-prompt copy in `consent_service.py` for plain-language readability in their target literacy band.
3. Run a quarterly review of the `ConsentAuditVertex` edges to confirm no anomalous state transitions.
4. Document any local legal additions (e.g. Gambia DPA-specific consent language) in this file (additive only).

## 10. Caregiver consent (separate flow from §1's caregiver-link)

§1's "caregiver-link consent" is the *patient's* affirmation that a
named caregiver may view their record. **This section is the
caregiver-side counterpart**: a versioned, immutable privacy-notice
acknowledgment captured from each caregiver before they may use the
caregiver portal.

The two are independent and both must hold for a caregiver to read
patient data: the patient must have granted caregiver-link consent
*and* the caregiver must have an accepted current notice version on
file.

### 10.1 Phased build-out

| Phase | Surface |
|---|---|
| **Phase 1** | Caregiver privacy notice content module — text and structured checkboxes for the caregiver-facing notice |
| **Phase 3** | Standalone `CaregiverPrivacyConsentStep` React component covering plain-language notice, scroll-to-bottom, 5 acknowledgement checkboxes, optional Mandinka view, digital signature line, and (for the scout role) guardian-consent fields |
| **Phase 4** | The same component wired into the caregiver signup flow privacy step |
| **Phase 5** | Dismissible re-consent modal for *existing* caregivers when their on-file notice version is stale, plus a warn-only middleware that emits `event_type=caregiver_privacy_consent_stale` log lines and an `X-Caregiver-Privacy-Stale` response header without blocking |
| **Phase 6** | Caregiver portal "Privacy & Data Responsibility" section with a downloadable JSON consent receipt enumerating only the safe fields |
| **Phase 6.7** | Hard-403 fetch interceptor + bootstrap event listener that auto-opens the existing soft re-consent modal when any caregiver request returns the canonical `caregiver_privacy_consent_required` 403 |
| **Phase 7** | Dev/staging enforcement validation: 8 patient-data caregiver routes wired with `Depends(require_caregiver_privacy_consent)`, gate-matrix harness verified end-to-end with synthetic JWTs (64/64 PASS under flag-on, 20/20 under rollback), one-command rollback proven |
| **Phase 9 v3 / v4** | (v3) Popup-behaviour fix — bootstrap auto-pops only on canonical enforcement-403; dismissal key scoped to `(tokenHash, noticeVersion)`. (v4) Notice version bumped 1.0 → 1.1 to record the explicit **no-sale / no-unauthorised-disclosure** clause + 6th acknowledgement (`acknowledge_no_unauthorized_disclosure`) — see §10.6 |
| **Phase 10 v1** | Pending/stale caregivers see a primary "Accept the privacy policy" CTA on the warn-only banner that dispatches `amina:caregiver-consent-required` to open the SIGNING stepper (read-only review remains available as a secondary action). New backend admin endpoint `GET /api/v1/admin/caregivers/privacy-consent-status` exposes safe acceptance status (counts + per-caregiver row, no PHI). New admin console card on the Governance tab consumes it. See §10.7 |

### 10.2 `CaregiverConsentRecord` schema (high level)

Stored as an ArcadeDB vertex of type `CaregiverConsentRecord`. Each
record is **immutable** — a new notice version produces a new row;
the previous row is preserved.

| Field | Notes |
|---|---|
| `caregiver_id` | Identity FK to `CaregiverVertex` |
| `notice_version` | The notice version the caregiver accepted (current: `1.1` as of Phase 9 v4; `1.0` retained in immutable history for older records) |
| `policy_version` | The acceptable-use / safety policy version in force at acceptance time |
| `role` | Caregiver taxonomy: `vhw`, `cbc`, `scout`, `tba`, `alkalo`, etc. (sourced from the JWT `caregiver_role` claim) |
| `checkboxes_accepted` | Boolean — `true` iff every required checkbox was ticked |
| `checkbox_count` | Integer count of acknowledged checkboxes (current expected: **6** as of v1.1 — was 5 in v1.0) |
| `digital_signature_hash` | SHA-256 of `caregiver_id || raw_signature` — never the raw value |
| `guardian_consent` | Boolean — only set for the scout role (under-18 flow) |
| `guardian_signature_hash` | SHA-256 of guardian signature where applicable; never the raw value |
| `mandinka_viewed` | Whether the caregiver toggled the Mandinka rendering before signing |
| `scroll_completed` | Whether the caregiver scrolled the notice to the bottom before signing |
| `method` | Channel of acceptance: `app` / `sms` / `voice` / `operator` |
| `accepted_at` | UTC timestamp from the request body (caregiver's clock) |
| `created_at` | UTC timestamp from server insert (audit anchor) |

### 10.3 Fields explicitly NOT stored

The caregiver consent record stores **only** the fields above. The
following are deliberately not persisted and are verified absent by
test 8 (`test_record_consent_persists_safe_fields_only`) and test 30
(Phase 7 `test_phase7_403_body_contains_no_phi`):

- Raw digital signatures (only the hash; verified by test 6)
- Raw guardian signatures (only the hash)
- Caregiver phone numbers
- Client IP addresses
- User-agent strings
- JWT tokens or token fragments
- Checkbox prose (only the structured ids and counts)

The same exclusions apply to the audit log line emitted by
`emit_audit_log` (test 10).

### 10.4 Re-consent / recovery flow (existing caregivers)

1. Caregiver logs in (legacy `/caregiver/login` or v2 wizard mint).
   The JWT carries `caregiver_role` for downstream `role` denormalisation.
2. The frontend bootstrap calls `GET /api/v1/caregiver/privacy/status`.
   If `has_current_consent=false` (or version drift detected), the
   soft re-consent modal opens.
3. Caregiver re-signs; `POST /api/v1/caregiver/privacy/consent` writes
   a new immutable `CaregiverConsentRecord` for the current
   `notice_version`. Old rows are preserved.
4. If the caregiver tries a gated patient-data route while still
   stale and `AMINA_CAREGIVER_PRIVACY_REQUIRED=true`, the route
   returns the canonical 403 (`code: caregiver_privacy_consent_required`,
   `message: "Privacy notice consent required"`); the
   `caregiverConsent403Interceptor.js` listener forces the same soft
   modal open and re-fetches `/privacy/status` after acceptance.

### 10.5 Production enforcement gate

`AMINA_CAREGIVER_PRIVACY_REQUIRED` remains **false in production**
as of Phase 8. The flag was flipped only on the local dev container
during Phase 7 validation and rolled back. The remaining gate before
production enforcement is the production stale-population audit:

```bash
docker exec haystack-chatqna python /app/scripts/caregiver_privacy_stale_audit.py
```

Verdict thresholds: GREEN < 5 % → flip after a 24 h banner; YELLOW
5–20 % → 14-day warn-only soak + soft re-consent campaign first; RED
> 20 % → coordinated comms / re-consent campaign before any flip
date. See [CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md §5](CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md).

### 10.6 Phase 9 v4 — Confidentiality / no-sale obligation (notice v1.1)

Phase 9 v4 added an explicit caregiver-facing prohibition on selling
or otherwise disclosing patient data outside authorised care.
Notice version bumped from `1.0` to `1.1` to record the change
durably; existing `1.0` records remain in the immutable history.

**Clause text (verbatim, in both `CAREGIVER_PRIVACY_NOTICE.js` and
`CaregiverPrivacyStepper.jsx`):**

> Caregivers must not sell, trade, publish, screenshot, export, copy,
> retain, or share patient information from AMINA except for the
> patient's care and only when authorised. Unauthorised use or
> disclosure may result in immediate removal from AMINA caregiver
> access, notification to the patient or their guardian, reporting
> to the relevant health authority or data-protection authority,
> and disciplinary, civil, or criminal consequences under applicable
> Gambian law.

**Matching acknowledgement (`acknowledge_no_unauthorized_disclosure`):**

> I understand that I must not sell, trade, publish, screenshot,
> export, copy, retain, or share patient information for any
> unauthorised purpose, and that misuse may lead to removal of
> AMINA access, reporting to the relevant authority, and legal or
> disciplinary consequences under applicable Gambian law.

**Legal framing.** The clause is grounded in:
- The Gambia's **Personal Data Protection and Privacy Act, 2025**;
- the **Constitution of The Republic of The Gambia, Section 23**
  (privacy protection); and
- applicable **ECOWAS personal-data protection** principles.

Specific Article numbers are deliberately not inlined.
**TODO: confirm exact Article references with MOH legal counsel
before pilot.** No "found guilty" or other adjudicative wording is
used — enforcement language stays in "may result in" / "may be
reported" / "under applicable Gambian law" form until counsel
approves stronger phrasing.

**Backend / frontend contract.** The id `acknowledge_no_unauthorized_disclosure`
is the 6th entry in:
- `caregiver_privacy_consent.py` `EXPECTED_CHECKBOX_IDS` (validation source of truth);
- `CAREGIVER_PRIVACY_NOTICE.consent_checkboxes` (legacy wizard);
- `CaregiverPrivacyStepper.jsx` `NOTICE.acks` (new stepper).

All three keep the same id and the same wording. A v1.1 acceptance
that omits the 6th id fails validation with `checkboxes_incomplete`
(test 14b).

**Production rollout impact.** All existing v1.0 records are now
"stale relative to current". Production enforcement remains gated
on the production stale-population audit per
[CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md §5](CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md).
The audit's `--notice-version 1.1` mode reflects the new gate.

### 10.7 Phase 10 v1 — acceptance + admin visibility

Phase 10 v1 turns the privacy notice into an **accepted policy** —
not just a read-only document — and adds a safe admin surface for
seeing who has accepted what. Three changes:

**1. Pending/stale CTA opens signing mode.** The warn-only banner in
the caregiver portal's Privacy & Data section now offers two
actions:

| Action | Mode | Mounts |
|---|---|---|
| **Accept the privacy policy** (primary) | signing | Dispatches `amina:caregiver-consent-required` → `CaregiverPrivacyReconsentBootstrap` opens `<CaregiverPrivacyStepper readOnly={false}>` → POST to `/privacy/consent` |
| **Review only (read-only)** (secondary) | read-only | `<CaregiverPrivacyStepper readOnly={true}>` — never POSTs |

The same canonical event also fires on enforcement-403 (Phase 6.7
interceptor). Both paths use the same bootstrap and the same scoped
dismissal key `amina:caregiver_privacy:dismissed:<tokenHash>:<noticeVersion>`
from Phase 9 v3.

**2. Manual review stays read-only everywhere else.** Avatar
dropdown → Privacy & Data, the inline "AMINA caregiver privacy
notice" hyperlink, and the (now-removed) View Privacy Notice button
all still mount `readOnly={true}`. None of them POST. Verified by
grep on the touched files.

**3. New admin endpoint + console card.**

- `GET /api/v1/admin/caregivers/privacy-consent-status` — auth-gated
  by `_verify_admin` (admin JWT). Returns:
  ```json
  {
    "notice_version_required": "1.1",
    "required_flag":           false,
    "total_caregivers":        N,
    "accepted_current":        M,
    "pending_or_stale":        N - M,
    "acceptance_rate_pct":     (M / N) * 100,
    "last_checked_at":         "<ISO-8601 UTC>",
    "caregivers": [
      { "caregiver_id", "name", "role", "has_current_consent",
        "notice_version", "accepted_at", "record_id", "method",
        "stale_or_pending" },
      …
    ]
  }
  ```
  Implementation lives in
  `caregiver_privacy_consent.admin_acceptance_status(query_runner=…)`
  with the same injectable runner the audit script uses, so unit
  tests stub it without ArcadeDB.

- **Forbidden in this response** (verified by test 14c):
  `digital_signature`, `digital_signature_hash`,
  `guardian_signature_hash`, `phone`, `ip`, `user_agent`, `token`,
  `jwt`, `bearer`, checkbox prose, patient data, free clinical text.
  Caregiver name is included only because the existing
  `/admin/caregivers-directory` route already exposes names in the
  same admin context.

- **Admin console UI** — `components/frontend/src/admin/CaregiverPrivacyAcceptanceCard.jsx`
  renders aggregate counts (total / accepted / pending / rate) +
  per-caregiver table on the Governance tab, above the legacy audit
  viewer. Uses the existing admin-tokens.css palette; does not
  display signatures, hashes, tokens, IPs, user agents, or patient
  data.

**Production rollout posture.** The same gate stays — production
enforcement (`AMINA_CAREGIVER_PRIVACY_REQUIRED=true`) requires the
production stale-population audit to land GREEN (or YELLOW with the
14-day soak running) at `--notice-version 1.1`. The new admin card
surfaces the same data the audit script measures so admins can
watch the v1.1 acceptance ramp without leaving the console.

## 11. Linked controls

- CONSENT-001 .. CONSENT-004, CONSENT-005a, CONSENT-005b, CONSENT-006 .. CONSENT-009 in [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md).
- CONSENT-005a anchors the patient/user side of this document; CONSENT-005b and CONSENT-009 anchor §10 (caregiver side).
