# AMINA Compliance Package

**Phase:** 1-3 (binder + control matrix + data-rights runbook).
**Audience:** ministry liaison, pilot operator, clinical reviewer, engineer.
**Current overall score** (per `python scripts/compliance_scorecard.py`): **6.55 / 10** across **73 controls**.
**Targeted maturity after this package:** ~7.5-8 / 10 once placeholders are filled and clinical signoff lands. Path to 9/10: [COMPLIANCE_ROADMAP_TO_9.md](COMPLIANCE_ROADMAP_TO_9.md).

---

## 0. Read this first

AMINA is a healthcare AI platform for localized NCD support in The Gambia (web / voice / Telegram / WhatsApp / Messenger / SMS, EN + MA, Basic / Beginner / Advanced UX). This compliance package is **audit-ready evidence** — not a marketing claim. Where a control is partial or a gap, this package says so.

The package follows the principles of:
- **Gambia Data Protection and Privacy Policy / Act** — lawful basis / consent, purpose limitation, data minimisation, storage limitation, accuracy, confidentiality / security, accountability, data-subject rights, breach handling.
- **WHO AI ethics + governance** — protect autonomy, promote safety, transparency, responsibility, inclusiveness, sustainability.
- **Healthcare AI safety expectations** — human escalation, clinical risk register, known limitations, red-team / eval evidence, auditability, incident response, model / data governance.

## 1. Scope + non-scope

**In scope of this package**
- All deployed AMINA features as of 2026-04-29: web chat, voice, Telegram, WhatsApp / Messenger via Meta, Twilio SMS, agentic prepass v1+v2+Phase3, evidence layer, consent / training-consent, OTP auth, role-based admin, DHIS2 push, FHIR / SMART direction, caregiver inbox + alerts.
- Data flows, retention, consent, audit trail, clinical safety, incident response, model governance, operations.

**Not in scope**
- Provider-side privacy at OpenAI / Groq / Gemini / Mistral (their DPAs apply; we link the inventory).
- Channel-side privacy at Meta / Twilio / Telegram (their ToS apply).
- Hardware procurement / hosting facility security (operator-defined).

## 2. Document index

### Phase 1 — Compliance binder (10 docs)

1. [PRIVACY_NOTICE.md](PRIVACY_NOTICE.md) — plain-language user-facing notice.
2. [DATA_FLOW_MAP.md](DATA_FLOW_MAP.md) — channels → storage → processors with trust boundaries.
3. [CONSENT_MODEL.md](CONSENT_MODEL.md) — four grants, states, withdraw flow.
4. [RETENTION_POLICY.md](RETENTION_POLICY.md) — TTL by data class + open implementation gaps.
5. [DPIA.md](DPIA.md) — Data Protection Impact Assessment.
6. [CLINICAL_SAFETY_CASE.md](CLINICAL_SAFETY_CASE.md) — intended use, risk register, clinician signoff template.
7. [INCIDENT_RESPONSE_PLAN.md](INCIDENT_RESPONSE_PLAN.md) — classes, severity ladder, playbook, post-mortem template.
8. [MODEL_CARD_AMINA.md](MODEL_CARD_AMINA.md) — system / model description, eval status, monitoring plan.
9. [AUDIT_READINESS_CHECKLIST.md](AUDIT_READINESS_CHECKLIST.md) — 9 sections, status per item, evidence link, owner placeholder, next action.
10. README.md (this file).

### Phase 2 — Control matrix + scorecard

11. [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md) — 73 controls, 9 domains, status + evidence + residual gap.
12. [compliance_controls.json](compliance_controls.json) — machine-readable matrix.
13. [../../scripts/compliance_scorecard.py](../../scripts/compliance_scorecard.py) — scorecard CLI (no network, stdlib only).

### Phase 3 — Operational runbooks

14. [DATA_RIGHTS_RUNBOOK.md](DATA_RIGHTS_RUNBOOK.md) — access / correction / deletion / withdrawal / export.
15. [COMPLIANCE_ROADMAP_TO_9.md](COMPLIANCE_ROADMAP_TO_9.md) — prioritised levers from current score to 9/10.
16. [PHASE_1_3_REPORT.md](PHASE_1_3_REPORT.md) — final summary.

## 3. Evidence index — links from compliance to implementation

| Compliance area | Implementation evidence | Test evidence |
|---|---|---|
| Consent grants + audit | [src/services/consent_service.py](../../haystack-stack/haystack-chatqna/src/services/consent_service.py), [src/services/training_consent.py](../../haystack-stack/haystack-chatqna/src/services/training_consent.py), [src/api/consent_routes.py](../../haystack-stack/haystack-chatqna/src/api/consent_routes.py) | design review |
| Phone OTP auth | [src/services/otp.py](../../haystack-stack/haystack-chatqna/src/services/otp.py), [src/services/auth.py](../../haystack-stack/haystack-chatqna/src/services/auth.py), [src/api/observatory_phone_auth.py](../../haystack-stack/haystack-chatqna/src/api/observatory_phone_auth.py) | code review |
| Admin auth | [src/api/observatory_auth.py](../../haystack-stack/haystack-chatqna/src/api/observatory_auth.py), [src/api/admin_routes.py](../../haystack-stack/haystack-chatqna/src/api/admin_routes.py) | code review |
| PHI de-identification | [src/services/phi_deid.py](../../haystack-stack/haystack-chatqna/src/services/phi_deid.py) | spot check |
| Safety stack | [src/services/safety_consensus.py](../../haystack-stack/haystack-chatqna/src/services/safety_consensus.py), [src/services/safety_contract.py](../../haystack-stack/haystack-chatqna/src/services/safety_contract.py), [src/services/emergency_escalation.py](../../haystack-stack/haystack-chatqna/src/services/emergency_escalation.py) | service-log review |
| Agent platform (read-only assist) | [src/agent_platform/](../../haystack-stack/haystack-chatqna/src/agent_platform/) | 506 / 506 unit + Phase 4 live |
| Tracing (PHI-redacted) | [src/agent_platform/tracing.py](../../haystack-stack/haystack-chatqna/src/agent_platform/tracing.py) + `models.py:to_safe_dict` | Phase 3 test §2 + §19; Phase 4 trace 0 leaks |
| Evidence layer | [src/evidence_layer/](../../haystack-stack/haystack-chatqna/src/evidence_layer/) | per-session opt-in |
| Channels | [src/api/meta_routes.py](../../haystack-stack/haystack-chatqna/src/api/meta_routes.py), [src/api/twilio_whatsapp_routes.py](../../haystack-stack/haystack-chatqna/src/api/twilio_whatsapp_routes.py), telegram-webhook-watcher container | each route's signature-verification flag |
| DHIS2 push | [src/services/dhis2_sync.py](../../haystack-stack/haystack-chatqna/src/services/dhis2_sync.py), [src/api/dhis2_routes.py](../../haystack-stack/haystack-chatqna/src/api/dhis2_routes.py) | `DHIS2AuditVertex` writes |
| Care delivery + caregivers | [src/api/caregiver_routes.py](../../haystack-stack/haystack-chatqna/src/api/caregiver_routes.py), [src/api/care_routes.py](../../haystack-stack/haystack-chatqna/src/api/care_routes.py), [src/services/caregiver_amina_service.py](../../haystack-stack/haystack-chatqna/src/services/caregiver_amina_service.py) | code review |

## 4. How to use this package

### As an auditor
1. Read [PRIVACY_NOTICE.md](PRIVACY_NOTICE.md) + [DPIA.md](DPIA.md) + [CLINICAL_SAFETY_CASE.md](CLINICAL_SAFETY_CASE.md) end to end (~1 hour).
2. Run the scorecard:
    ```bash
    python scripts/compliance_scorecard.py             # human view
    python scripts/compliance_scorecard.py --json      # CI parsing
    ```
   On Windows console, prefix with `PYTHONIOENCODING=utf-8` if you see `�` glyphs.
3. Walk [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md), spot-checking the linked evidence files.
4. Review [INCIDENT_RESPONSE_PLAN.md](INCIDENT_RESPONSE_PLAN.md) and ask for the latest tabletop-drill record.

### As a pilot operator
1. Fill the placeholders in [PRIVACY_NOTICE.md](PRIVACY_NOTICE.md) (`__PILOT_OPERATOR_EMAIL__`, `__CLINICAL_SAFETY_LEAD__`).
2. Walk the [AUDIT_READINESS_CHECKLIST.md](AUDIT_READINESS_CHECKLIST.md) and assign owners.
3. Run the [DATA_RIGHTS_RUNBOOK.md](DATA_RIGHTS_RUNBOOK.md) flows on a synthetic patient end-to-end (no PHI).
4. Schedule the first incident-response tabletop and the first clinical-reviewer signoff per the [CLINICAL_SAFETY_CASE.md §10 template](CLINICAL_SAFETY_CASE.md#10-clinical-reviewer-signoff-template).

### As an engineer
1. Pick a `❌ gap` row in [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md).
2. Implement (additive only — see project conventions).
3. Update the matrix `status` + the JSON entry; re-run the scorecard.
4. Ship through the same MR pattern as Phase 2 / 3 / 4 of the agent platform.

## 5. Versioning

This package is `phase-1-3-2026-04-29` (in `compliance_controls.json:package_version`). Bump on every material change. The scorecard's overall score and the per-domain numbers are NOT versioned in this README — re-run the script for current numbers.

## 6. Linked external context

- [docs/AGENT_PLATFORM_V1.md](../AGENT_PLATFORM_V1.md) / [V2](../AGENT_PLATFORM_V2_READONLY_ASSIST.md) / [Phase 3](../AGENT_PLATFORM_PHASE3_ROLLOUT_AND_EVALS.md) / [Phase 4](../AGENT_PLATFORM_PHASE4_LIVE_VALIDATION_REPORT.md) — agentic platform progression.
- [docs/EVIDENCE_LAYER.md](../EVIDENCE_LAYER.md) — per-turn JSONL trace + eval reports.
- [docs/AMINA_OPS_MANUAL.md](../AMINA_OPS_MANUAL.md) — operations background.
- [docs/PERFORMANCE_AND_RISK_REPORT.md](../PERFORMANCE_AND_RISK_REPORT.md) — earlier risk perspective.
- [docs/META_CHANNELS.md](../META_CHANNELS.md) / [docs/MVP_MULTICHANNEL_RUNBOOK.md](../MVP_MULTICHANNEL_RUNBOOK.md) — channel adapters.
- [docs/DHIS2_INTEGRATION.md](../DHIS2_INTEGRATION.md) — DHIS2 wiring.
