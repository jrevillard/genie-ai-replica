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

## 10. Linked controls

- CONSENT-001 .. CONSENT-008 in [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md).
