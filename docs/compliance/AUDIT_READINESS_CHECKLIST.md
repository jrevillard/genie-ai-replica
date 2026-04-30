# AMINA — Audit Readiness Checklist

**Audience:** auditor (internal or external), pilot operator, ministry liaison.
**Status legend:** ✅ complete · 🟡 partial · ❌ gap

For each item: status · evidence · owner placeholder · next action.

---

## 1. Privacy

| Item | Status | Evidence | Owner | Next action |
|---|---|---|---|---|
| Plain-language privacy notice exists for every user class | ✅ | [PRIVACY_NOTICE.md](PRIVACY_NOTICE.md) (patient/user); caregiver surfaces: `CaregiverPrivacyConsentStep.jsx`, `CaregiverPrivacyReconsentBootstrap.jsx`, CaregiverPortal Privacy section | pilot op | fill operator-name placeholders in PRIVACY_NOTICE.md |
| Data flow map exists end-to-end | ✅ | [DATA_FLOW_MAP.md](DATA_FLOW_MAP.md) | engineering | annual refresh |
| PHI de-identification before LLM call | ✅ | `src/services/phi_deid.py` | engineering | extend Mandinka token coverage |
| PHI-redacted tracing | ✅ | `agent_platform/tracing.py` + Phase-3 tests §2/§19 | engineering | none |
| Backup encryption-at-rest enforced | ❌ | none in current compose | ops | add to deployment runbook |
| Subprocessor inventory current | 🟡 | [DATA_FLOW_MAP.md §4](DATA_FLOW_MAP.md#4-provider--processor-inventory) | pilot op | quarterly refresh |
| TLS in front for production | 🟡 | dev uses Cloudflare quick tunnel | ops | managed cert before pilot |
| Logs redacted at write time | 🟡 | `phi_deid.py` exists; not all log sites audited | engineering | add lint rule |

## 2. Consent

| Item | Status | Evidence | Owner | Next action |
|---|---|---|---|---|
| Four consent grants modelled (clinical / channel / caregiver / training) | ✅ | [CONSENT_MODEL.md](CONSENT_MODEL.md), `consent_service.py`, `training_consent.py` | engineering | none |
| Consent-audit edge written on state change | ✅ | ArcadeDB `ConsentAuditVertex` | engineering | extend to caregiver-link withdrawal |
| Withdrawal endpoint exists | ✅ | `consent_routes.py::POST /withdraw` | engineering | document in [DATA_RIGHTS_RUNBOOK.md](DATA_RIGHTS_RUNBOOK.md) |
| Withdrawal cascades to caregiver link, training queue | 🟡 | partial | engineering | sweeper TBD |
| Consent prompt copy in plain language | 🟡 | reviewed by engineering only | clinical | clinical reviewer signoff |
| Consent prompt available in Mandinka | 🟡 | partial localisation | engineering | finish MA strings |
| Synthetic / demo mode bypasses consent prompts safely | ✅ | session-id pattern | engineering | none |
| Caregiver consent capture (versioned, immutable) | ✅ | `CaregiverPrivacyConsentStep.jsx` → POST `/api/v1/caregiver/privacy/consent` → ArcadeDB `CaregiverConsentRecord`; structured checkboxes + sha256 signature hash; never stores raw signature, phone, IP, UA | engineering | none |
| New `notice_version` produces a new immutable record (history preserved) | ✅ | `record_consent` writes a new vertex per `(caregiver_id, notice_version, signature_hash)`; covered by Phase 7 test 26 (`test_phase7_new_notice_version_creates_new_immutable_record`) | engineering | none |
| Phase 5 warn-only stale-consent instrumentation | ✅ | `caregiver_privacy_warn.py` middleware emits `event_type=caregiver_privacy_consent_stale` log lines and `X-Caregiver-Privacy-Stale` response header (always on; flag-independent) | engineering | wire to ops dashboard |
| Phase 6.7 hard-403 recovery wiring | ✅ | `caregiverConsent403Interceptor.js` + `CaregiverPrivacyReconsentBootstrap.jsx` listen for the canonical 403 and force the soft re-consent modal open without losing the user's session | engineering | none |
| Phase 7 enforcement validated in dev/staging | ✅ | `_phase7_live_gate_matrix.py` 64/64; `_phase7_rollback_proof.py` 20/20; 8 patient-data routes wired with `Depends(require_caregiver_privacy_consent)`; one-command rollback proven | engineering | run production stale-population audit before flipping `AMINA_CAREGIVER_PRIVACY_REQUIRED=true` |
| Production caregiver-privacy enforcement | 🟡 | Wired and validated; flag remains `false` in production. Gated on production stale-population audit per [CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md §5](CAREGIVER_PRIVACY_ENFORCEMENT_READINESS.md) | ops + engineering | run audit on prod ArcadeDB; if GREEN flip after 24 h banner; if YELLOW run 14-day soak; if RED do not flip |
| Safe structured caregiver consent audit log | ✅ | `caregiver_privacy_consent.py::emit_audit_log` emits 7 safe keys only (`caregiver_id`, `consent_version`, `policy_version`, `role`, `accepted_at`, `method`, `required_flag`); covered by test 10 (`test_audit_log_safe_fields_only`) | engineering | promote into the proposed central audit-event store (§4) when AUDIT-005 lands |
| Admin visibility into caregiver privacy acceptance (Phase 10 v1) | ✅ | `GET /api/v1/admin/caregivers/privacy-consent-status` exposes safe aggregate + per-caregiver acceptance status to admin-console users. Surfaced on the Governance tab via `CaregiverPrivacyAcceptanceCard.jsx`. Test 14c pins the safe-fields contract (no signatures, hashes, tokens, IPs, user agents, or patient data in the response) | engineering | none |

## 3. Retention

| Item | Status | Evidence | Owner | Next action |
|---|---|---|---|---|
| Retention policy documented per data class | ✅ | [RETENTION_POLICY.md](RETENTION_POLICY.md) | pilot op | ratify defaults |
| Redis TTL on session cache | ✅ | service code | engineering | none |
| OTP TTL ≤ 10 minutes | ✅ | `otp.py` | engineering | none |
| Automated retention sweeper for ArcadeDB record classes | ❌ | none | engineering | Phase 4 |
| Automated purger for `evidence_reports/` etc. | ❌ | none | engineering | Phase 4 |
| Backup deletion-proof writer | ❌ | none | engineering + ops | Phase 4 |
| `legal_hold` flag on patient record schema | ❌ | none | engineering | Phase 4 |
| Central retention-config file | ❌ | TTLs scattered | engineering | Phase 4 |

## 4. Audit trail

| Item | Status | Evidence | Owner | Next action |
|---|---|---|---|---|
| `AGENT_TRACE` per agentic turn | ✅ | `agent_platform/tracing.py` | engineering | none |
| Consent-state-transition edge | ✅ | ArcadeDB `ConsentAuditVertex` | engineering | none |
| DHIS2 push audit edge | ✅ | ArcadeDB `DHIS2AuditVertex` (per audit findings) | engineering | none |
| Tracker-push audit edge | ✅ | ArcadeDB `TrackerPushAuditVertex` | engineering | none |
| Append-only audit-event store (general-purpose) | ❌ | no dedicated audit logger; events scattered | engineering | Phase 4 — see [§Proposed audit-event schema below](#proposed-audit-event-schema) |
| Admin-route access audit | ❌ | no event today | engineering | Phase 4 |
| Auth event audit (login / OTP success+failure) | 🟡 | log lines only | engineering | Phase 4 |
| Channel-webhook signature verification audit | ❌ | rejection logged but not in an audit store | engineering | Phase 4 |
| Trace export process | 🟡 | manual `docker logs` today | engineering | OTel spans (Phase 4) |
| Audit-log failure detection | ❌ | none | engineering | Phase 4 |

### Proposed audit-event schema

A central audit logger does NOT exist today. Proposed minimal schema for Phase 4 (append-only, ArcadeDB-backed, sha256-hashed actor ids):

```json
{
  "event_id":      "uuid4",
  "event_type":    "consent.granted | consent.withdrawn | auth.login | auth.failure | channel.webhook.rejected | dhis2.push | admin.route.access | retention.delete | data_rights.export | ...",
  "actor_hash":    "sha256(actor_id || salt)",
  "subject_hash":  "sha256(subject_patient_id || salt)",
  "channel":       "web|voice|telegram|whatsapp|messenger|sms|admin|system",
  "outcome":       "success|failure|denied",
  "reason_code":   "stable token (e.g. ok | invalid_signature | rate_limited | unauthorized)",
  "trace_id":      "if linked to an AGENT_TRACE turn",
  "policy_gate_version": "v1.13",
  "timestamp":     "ISO-8601 UTC"
}
```

PHI minimisation: subject id is hashed; no raw message body; no phone in plaintext. Retention proposed at 7 years per `ConsentAuditVertex` rule. Export: a `/api/v1/admin/audit/export` endpoint streaming JSONL (admin auth + audit edge for the export itself).

## 5. Security

| Item | Status | Evidence | Owner | Next action |
|---|---|---|---|---|
| Phone OTP auth (rate-limited) | ✅ | `otp.py` + `rate_limiter.py` | engineering | none |
| Role-based admin gating | ✅ | `observatory_*.py` + `admin_routes.py` | engineering | none |
| Channel signature verification path | ✅ | `*_VALIDATE_SIGNATURE` env vars | engineering | enable in pilot config |
| Token / OTP never logged | ✅ | code review | engineering | add lint rule |
| Container runs as non-root user | 🟡 | per service; varies | ops | document |
| Compose bind-mounts use ro: where possible | ✅ | per override file | engineering | none |
| Secrets out of git | ✅ | `.env` gitignored, `*Zone.Identifier` filtered | engineering | rotate the embedded GitLab PAT |
| Pen test on staging before pilot | ❌ | none | ops | Phase 4 |
| Dependency vuln scan in CI | ❌ | none | engineering | Phase 4 |

## 6. Clinical safety

| Item | Status | Evidence | Owner | Next action |
|---|---|---|---|---|
| Clinical safety case documented | ✅ | [CLINICAL_SAFETY_CASE.md](CLINICAL_SAFETY_CASE.md) | clinical | clinician signoff |
| Risk register exists | ✅ | same | clinical | extend with operator-specific risks |
| Emergency-keyword bypass | ✅ | planner heuristic + frontend SOS | engineering | extend MA dialect coverage |
| Multi-model safety consensus | ✅ | `safety_consensus.py` | engineering | none |
| Post-generation safety contract | ✅ | `safety_contract.py` | engineering | none |
| Refusal patterns for dose-change / diagnosis / crisis | ✅ | safety stack | engineering | none |
| Medication safety: write tools denied | ✅ | policy gate (13 checks) | engineering | none |
| Eval evidence: red-team / regression | ✅ | 506/506 unit, 25/25 smoke, Phase 4 live | engineering | extend clinical-content evals |
| Clinician signoff template | ✅ | [CLINICAL_SAFETY_CASE.md §10](CLINICAL_SAFETY_CASE.md#10-clinical-reviewer-signoff-template) | clinical | run it |

## 7. Incident response

| Item | Status | Evidence | Owner | Next action |
|---|---|---|---|---|
| Incident-response plan exists | ✅ | [INCIDENT_RESPONSE_PLAN.md](INCIDENT_RESPONSE_PLAN.md) | ops | drill once |
| Severity ladder defined | ✅ | same | ops | none |
| Notification template exists | ✅ | same | ops | localise to MA |
| Tabletop drill performed | ❌ | none | ops | quarterly |
| Live drill performed (synthetic only) | ❌ | none | ops | annual |
| Incident evidence preservation path | ✅ | `_recovery/incidents/INC-<id>/` (gitignored) | ops | confirm backup of this dir |

## 8. Model governance

| Item | Status | Evidence | Owner | Next action |
|---|---|---|---|---|
| Model card exists | ✅ | [MODEL_CARD_AMINA.md](MODEL_CARD_AMINA.md) | engineering | none |
| LLM cascade documented + monitored | ✅ | model card + `llm_provider_policy.py` | engineering | none |
| Per-provider DPA inventory | 🟡 | partial | pilot op | finish |
| Local LoRA training records | ✅ | training run logs (149 → 414 step) | engineering | publish data sheet |
| Tool registry versioned | 🟡 | implicit | engineering | add explicit version |
| Policy gate version stamped on every trace | ✅ | `policy_gate_version: v1.13` | engineering | none |
| Eval-on-CI gate | ❌ | tests are manual | engineering | Phase 4 |
| Bias / fairness evaluation | 🟡 | language-coverage notes | engineering + clinical | structured eval |

## 9. Operations

| Item | Status | Evidence | Owner | Next action |
|---|---|---|---|---|
| Readiness CLI exists | ✅ | `scripts/agent_platform_readiness.py` | engineering | none |
| Smoke harness exists | ✅ | `scripts/agent_platform_phase3_smoke.py` | engineering | extend channels |
| Compliance scorecard CLI | ✅ | `scripts/compliance_scorecard.py` (this Phase) | engineering | run in CI |
| Trace dashboard | ❌ | docker logs only today | ops | Phase 4 |
| Metrics endpoint (Prometheus) | 🟡 | per service partial | ops | unify |
| Backup verification job | ❌ | none | ops | Phase 4 |
| Secret rotation cadence | ❌ | none | ops | document |
| Disaster-recovery runbook | 🟡 | partial in `AMINA_OPS_MANUAL.md` | ops | Phase 4 |

## 10. Status summary

(Counts will be refreshed from [compliance_controls.json](compliance_controls.json) by `scripts/compliance_scorecard.py`.)

## 11. Phase 8 audit-readiness notes

- **Caregiver consent records are durable, versioned, immutable.** Each
  acceptance writes a new `CaregiverConsentRecord` vertex; old rows
  are preserved when a new `notice_version` is rolled out. Verified by
  test 26.
- **Caregiver consent audit lines are PHI-safe.** The structured log
  emitted at acceptance time contains only the 7 safe keys listed in
  §2 above; no signature, hash, phone, IP, UA, or checkbox prose
  appears. Verified by test 10 (existing) and tests 24/30 (Phase 6.7
  + Phase 7).
- **AUDIT-005 (append-only general-purpose audit-event store) remains
  ❌ a gap.** The caregiver-privacy structured log lines and the
  existing per-domain audit edges (`ConsentAuditVertex`,
  `DHIS2AuditVertex`, `TrackerPushAuditVertex`) are working stop-gaps
  but do not constitute the central, query-friendly audit store
  described in §4 of this document. Closing AUDIT-005 is independent
  of caregiver privacy enforcement and remains scheduled for a later
  phase.
- **Production enforcement of caregiver privacy has not happened.**
  Phase 7 promoted the flag in dev for the duration of the validation
  run only and rolled it back. Production remains
  `AMINA_CAREGIVER_PRIVACY_REQUIRED=false` and is gated on the
  production stale-population audit.
- **Retention sweepers / backup-deletion proof / OTel dashboard /
  metrics unification** remain open per RET-004..008, OPS-004..007,
  AUDIT-009/010. None of these were addressed by Phase 8.
