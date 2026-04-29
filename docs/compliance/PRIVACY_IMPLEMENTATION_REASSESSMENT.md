# AMINA Privacy / Compliance Implementation Reassessment

**Date:** 2026-04-29  
**Scope:** caregiver, patient, admin, channel, and observatory privacy/security evidence found after the Phase 1-3 compliance binder.

## Summary

The original compliance scorecard was intentionally conservative. A follow-up code review found stronger implemented controls for caregiver policy acceptance, patient consent, admin/observatory authentication, PHI redaction, and channel-signature handling than the headline table reflected.

This does **not** make AMINA fully compliant yet. The main remaining weaknesses are still retention enforcement, generic audit middleware, data-rights automation, backup deletion proof, CI gates, and operational dashboards. But the privacy/security/audit scores should be raised modestly because several controls are implemented, not just documented.

## Implemented Evidence Found

| Area | Evidence | Status |
|---|---|---|
| Patient consent flags | `src/services/consent_service.py` defines per-scope consent flags with defaults: aggregate allowed, Tracker/FHIR/research opt-in only | Implemented |
| Patient consent audit | `ConsentAuditVertex` is written for every consent change, including no-op changes | Implemented |
| Patient self-service consent | `src/api/consent_routes.py` exposes `/consent/me`, update, and history routes gated by patient JWT | Implemented |
| Admin consent override | Admin-only consent view/update/history routes exist and write actor strings such as `admin:<sub>` | Implemented |
| Caregiver privacy policy acceptance | `PolicyAcceptanceVertex` records caregiver policy type/version, signature, checkboxes, IP, user-agent, method, and inbox linkage | Implemented |
| Caregiver acceptance binding | `policy_review_routes.py` binds acceptance to JWT subject and stored inbox metadata, never request-supplied caregiver or policy IDs | Implemented |
| Caregiver PIN reverification | Policy acceptance requires caregiver PIN verification via stored hash/salt | Implemented |
| Caregiver suspension records | `CaregiverSuspensionVertex` supports active suspension/restoration without deletion | Implemented |
| PHI de-identification | `phi_deid.py` redacts phone, email, URL, dates, IDs, coordinates, credit cards, villages, names, patient fields, and consultation text | Implemented |
| Agentic trace redaction | Agentic trace model emits safe fields and excludes raw message/session/patient identifiers | Implemented and live-smoked |
| Observatory auth audit | `observatory_auth.py` calls `log_audit_event` for login attempts, OTP send/verify, and successful login | Implemented |
| Observatory phone audit | `observatory_phone_auth.py` logs phone OTP/PIN attempts and login success via phone-audit helpers | Implemented |
| Observatory admin audit | `observatory_admin.py` logs staff creation and related admin actions through `log_audit_event` | Partial |
| Observatory RBAC | `observatory_rbac.py` restricts government surfaces to aggregate-safe data, denies PII fields, and applies k-anonymity helper | Implemented |
| Meta signatures | `meta_routes.py` verifies `X-Hub-Signature-256` for WhatsApp/Messenger when app secrets are present | Implemented |
| Twilio privacy logging | `twilio_whatsapp_routes.py` hashes sender IDs for log correlation and supports optional signature validation | Implemented for sandbox/pilot path |

## Important Weakness Found

`src/api/patient_routes.py` appears to expose legacy CRUD endpoints without visible auth dependencies in that file:

- `POST /patients/`
- `GET /patients/{patient_id}`
- `PUT /patients/{patient_id}/vitals`
- `GET /patients/{patient_id}/consultations`
- `GET /patients/`

Follow-up route scan found `src/main.py` imports and mounts `patient_routes` under `/api/v1`, so this should be treated as a real remediation item unless the deployed entrypoint is known to bypass `src/main.py` or an upstream gateway blocks these paths. Patient-route access control remains a compliance risk.

## Score Update

| Domain | Previous | Updated | Reason |
|---|---:|---:|---|
| Privacy | 6.88 measured | 7.0 working read | PHI de-id, consent self-service, caregiver policy acceptance, and trace redaction are real implementation evidence; mounted legacy patient CRUD routes keep the measured score conservative |
| Model governance | 6.88 | 6.88 | No change; still needs CI eval gate and formal data sheet |
| Security | 6.67 | 7.10 | Observatory auth/RBAC/rate limiting/OTP and channel-signature paths are stronger than the first pass showed |
| Incident response | 6.67 | 6.67 | No drill evidence yet |
| Audit | 5.00 | 6.25 | Observatory auth/admin and consent audits exist; still lacks unified append-only audit store |
| Operations | 5.00 | 5.00 | No dashboard/backup/DR upgrade yet |
| Retention | 3.75 | 3.75 | Still weakest domain; docs exist but sweepers/purgers are not implemented |

## Updated Overall Read

The measured scorecard improves after updating three audit controls:

- `AUDIT-006`: gap -> partial
- `AUDIT-007`: partial -> complete
- `AUDIT-008`: gap -> partial

The compliance package now measures **6.72/10** in the scorecard and should be treated as approximately **6.9/10** in a qualitative review because several privacy controls are implemented even though the privacy domain still has unresolved backup/logging/patient-route risks.

## Next Actions

1. Confirm whether `patient_routes.py` is mounted in production. If yes, add auth/role checks immediately.
2. Build a shared append-only audit-event service and migrate consent, observatory, channel, admin, and patient-access events into one schema.
3. Add generic admin/patient-access audit middleware.
4. Implement retention sweepers and deletion-proof records.
5. Add CI compliance scorecard and eval gates.
