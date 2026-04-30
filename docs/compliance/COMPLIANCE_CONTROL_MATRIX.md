# AMINA — Compliance Control Matrix

**Audience:** auditor, ministry liaison, pilot operator, engineering lead.
**Source of truth:** [compliance_controls.json](compliance_controls.json). Re-render this matrix from the JSON whenever you change a control. The scorecard CLI ([../../scripts/compliance_scorecard.py](../../scripts/compliance_scorecard.py)) aggregates by `status` + `domain`.

---

## Domains

`privacy`, `consent`, `retention`, `audit`, `security`, `clinical_safety`, `incident_response`, `model_governance`, `operations`.

## Status legend

✅ `complete` · 🟡 `partial` · ❌ `gap`

## Controls

(75 total; 6–10 per domain; ids stable. Package version `compliance-v1.2-2026-05-01`.)

| ID | Domain | Requirement | Status | Evidence | Residual gap |
|---|---|---|---|---|---|
| PRIV-001 | privacy | Plain-language privacy notice surfaced to every user class | ✅ | PRIVACY_NOTICE.md (patient/user); CaregiverPrivacyConsentStep.jsx + ReconsentBootstrap + CaregiverPortal Privacy section (caregiver) | pilot operator placeholders |
| PRIV-002 | privacy | End-to-end data flow map maintained | ✅ | DATA_FLOW_MAP.md | — |
| PRIV-003 | privacy | PHI de-identification before LLM round-trip | ✅ | phi_deid.py | extend Mandinka tokens |
| PRIV-004 | privacy | PHI-redacted tracing on every agentic turn | ✅ | tracing.py + Phase 3/4 | — |
| PRIV-005 | privacy | Backups encrypted at rest | ❌ | — | pilot must enforce |
| PRIV-006 | privacy | Subprocessor inventory current | 🟡 | DATA_FLOW_MAP §4 | quarterly refresh |
| PRIV-007 | privacy | TLS in front of all inbound channels in production | 🟡 | dev-only Cloudflare quick tunnel | managed cert |
| PRIV-008 | privacy | Logs redacted at write time across all sites | 🟡 | partial | lint rule |
| CONSENT-001 | consent | Four consent grants modelled | ✅ | CONSENT_MODEL.md | — |
| CONSENT-002 | consent | Consent state transitions write an audit edge | ✅ | ConsentAuditVertex | extend caregiver-link |
| CONSENT-003 | consent | Consent withdrawal endpoint exists | ✅ | consent_routes.py | — |
| CONSENT-004 | consent | Withdrawal cascades to caregiver-link + training queue | 🟡 | partial | sweeper |
| CONSENT-005a | consent | Patient/user consent model implemented and documented | ✅ | CONSENT_MODEL.md (patient) + consent_service.py + consent_routes.py | — |
| CONSENT-005b | consent | Caregiver consent model implemented and documented | ✅ | CONSENT_MODEL.md caregiver section + CaregiverPrivacyConsentStep.jsx + caregiver_privacy_consent.py + caregiver_privacy_routes.py + CaregiverConsentRecord; Phase 5 re-consent modal; Phase 6.7 hard-403 interceptor; Phase 7 dev/staging validation | production rollout gated on production stale-population audit |
| CONSENT-006 | consent | Consent prompt available in Mandinka | 🟡 | partial | finish MA |
| CONSENT-007 | consent | Synthetic / demo bypasses consent prompts safely | ✅ | session-id pattern | — |
| CONSENT-008 | consent | Training-consent default OFF | ✅ | training_consent.py | — |
| CONSENT-009 | consent | Privacy notice acknowledgment captured at caregiver signup | ✅ | CaregiverPrivacyConsentStep.jsx privacy step + privacy_consent payload → POST /api/v1/caregiver/privacy/consent → CaregiverConsentRecord (versioned, immutable) | production rollout gated on stale-population audit |
| RET-001 | retention | Retention policy documented per data class | ✅ | RETENTION_POLICY.md | pilot ratification |
| RET-002 | retention | Redis session cache TTL ≤ 24h | ✅ | service code | — |
| RET-003 | retention | OTP TTL ≤ 10 minutes | ✅ | otp.py | — |
| RET-004 | retention | Automated retention sweeper for ArcadeDB classes | 🟡 | retention_sweeper.py (dry-run default; --apply gated by --i-have-read-the-dryrun + drift check + legal_hold guard) | operator-side cron + ramp |
| RET-005 | retention | Automated purger for evidence_reports etc. | 🟡 | filesystem windows centralised in retention_policy.py; sweeper PREVIEWS but does not delete filesystem classes | filesystem deletion deferred — needs explicit base-path allow-list |
| RET-006 | retention | Backup deletion proof on data-rights deletion | ❌ | — | Phase 4 |
| RET-007 | retention | legal_hold flag on patient record schema | 🟡 | retention_policy.classes_with_legal_hold(); sweeper DELETE always carries legal_hold guard | ArcadeDB column-add still operator-side |
| RET-008 | retention | Central retention-config file | ✅ | retention_policy.py — RETENTION_POLICY dict (17 classes, 10 fields each) | — |
| AUDIT-001 | audit | AGENT_TRACE per agentic turn | ✅ | tracing.py | — |
| AUDIT-002 | audit | Consent state-change edge written | ✅ | ConsentAuditVertex | — |
| AUDIT-003 | audit | DHIS2 push audit edge | ✅ | DHIS2AuditVertex | — |
| AUDIT-004 | audit | Tracker push audit edge | ✅ | TrackerPushAuditVertex | — |
| AUDIT-005 | audit | Append-only general-purpose audit-event store | 🟡 | audit_event_store.py (append-only API, AuditEventVertex, PHI guard, fail-soft); 49/49 tests; wired on 6 caregiver-privacy events | image-build pickup + wider event wiring |
| AUDIT-006 | audit | Admin-route access audit | ❌ | — | Phase 4 |
| AUDIT-007 | audit | Auth event audit (login / OTP success+failure) | 🟡 | log lines | promote to store |
| AUDIT-008 | audit | Channel-webhook signature verification audit | ❌ | — | Phase 4 |
| AUDIT-009 | audit | Trace export process | 🟡 | manual docker logs | Phase 4 |
| AUDIT-010 | audit | Audit-log failure detection + alarm | 🟡 | audit_event_health.py probe + AUDIT_FAILURE_ALERTING.md runbook + synthetic-DB-failure drill 2026-05-01 (INCIDENT_DRILL_LOG.md §3) | external alert sink is operator-side |
| SEC-001 | security | Phone OTP auth with rate limiter | ✅ | otp.py + rate_limiter.py | — |
| SEC-002 | security | Role-based admin gating | ✅ | observatory_*.py + admin_routes.py | — |
| SEC-003 | security | Channel signature verification path available | 🟡 | env vars | enable in pilot |
| SEC-004 | security | Tokens / OTPs never logged | ✅ | code review | lint rule |
| SEC-005 | security | Containers run as non-root user where feasible | 🟡 | varies | document + enforce |
| SEC-006 | security | Bind-mount overrides use ro: where possible | ✅ | override file | — |
| SEC-007 | security | Secrets out of git | ✅ | .env gitignored | rotate embedded GitLab PAT |
| SEC-008 | security | Pen test on staging before pilot | ❌ | — | Phase 4 |
| SEC-009 | security | Dependency vulnerability scan in CI | 🟡 | CI_EVAL_GATE_PLAN.md §2.3 (pip-audit + npm audit recipe). MR-1 of the ramp landed in .gitlab-ci.yml at v1.2 but explicitly excludes dep-scan (those land in MR-4 / MR-5) | MR-4 (pip-audit) + MR-5 (npm audit) + 30-day clean run before promoting to blocking |
| SAFETY-001 | clinical_safety | Clinical safety case documented | ✅ | CLINICAL_SAFETY_CASE.md | clinician signoff |
| SAFETY-002 | clinical_safety | Risk register maintained | ✅ | CLINICAL_SAFETY_CASE §8 | extend |
| SAFETY-003 | clinical_safety | Emergency keyword bypass route | ✅ | planner.py + frontend SOS | extend MA |
| SAFETY-004 | clinical_safety | Multi-model safety consensus | ✅ | safety_consensus.py | — |
| SAFETY-005 | clinical_safety | Post-generation safety contract | ✅ | safety_contract.py | — |
| SAFETY-006 | clinical_safety | Refusal patterns for dose-change / diagnosis / crisis | ✅ | safety stack | — |
| SAFETY-007 | clinical_safety | Write/admin/external tools denied at execution in v1 | ✅ | tool_policy.py | — |
| SAFETY-008 | clinical_safety | Eval / red-team coverage | ✅ | 531/531 + Phase 4 live | extend clinical 300+ |
| IR-001 | incident_response | Incident response plan documented | ✅ | INCIDENT_RESPONSE_PLAN.md | drill |
| IR-002 | incident_response | Severity ladder defined | ✅ | INCIDENT_RESPONSE_PLAN §2 | — |
| IR-003 | incident_response | Notification template + channels documented | ✅ | INCIDENT_RESPONSE_PLAN §5 | localise MA |
| IR-004 | incident_response | Tabletop drill run | ✅ | INCIDENT_DRILL_LOG.md §3 — first CARE-PRIV-LOCKOUT tabletop drill performed 2026-05-01 with documented findings + action items | next quarterly drill 2026-Q3 |
| IR-005 | incident_response | Live drill (synthetic-only) run | ✅ | INCIDENT_DRILL_LOG.md §3 — first STAGING-LOCKOUT-DRILL live-synthetic drill performed 2026-05-01: T-mit 3 min 06 s, 64/64 + 20/20 PASS, 1,275 audit rows captured | next annual drill 2027-Q2 |
| IR-006 | incident_response | Evidence preservation path | ✅ | _recovery/incidents/ | confirm backup |
| MODEL-001 | model_governance | Model card maintained | ✅ | MODEL_CARD_AMINA.md | — |
| MODEL-002 | model_governance | LLM cascade documented + monitored | ✅ | MODEL_CARD §2 + llm_provider_policy | — |
| MODEL-003 | model_governance | Per-provider DPA inventory | 🟡 | partial | pilot complete |
| MODEL-004 | model_governance | Local LoRA training records | ✅ | trainer_state.json | publish data sheet |
| MODEL-005 | model_governance | Tool registry versioned | 🟡 | implicit | explicit version |
| MODEL-006 | model_governance | Policy gate version stamped per trace | ✅ | v1.13 | — |
| MODEL-007 | model_governance | Eval-on-CI gate | 🟡 | .gitlab-ci.yml `gate` stage landed (MR-1 of the ramp): runs privacy + audit + retention suites + scorecard floor check at ≥ 7.50 | first green CI run on a feature branch + first red run on a synthetic regression still pending operator merge |
| MODEL-008 | model_governance | Bias / fairness evaluation | 🟡 | language coverage | structured eval |
| OPS-001 | operations | Readiness CLI exists | ✅ | agent_platform_readiness.py | — |
| OPS-002 | operations | Smoke harness exists | ✅ | agent_platform_phase3_smoke.py | extend channels |
| OPS-003 | operations | Compliance scorecard CLI | ✅ | compliance_scorecard.py | wire into CI |
| OPS-004 | operations | Trace dashboard | ❌ | — | Phase 4 |
| OPS-005 | operations | Metrics endpoint | 🟡 | partial | unify |
| OPS-006 | operations | Backup verification job | 🟡 | backup_verifier.py (read-only freshness/size/kind probe) | zip-integrity + encryption-at-rest checks not implemented |
| OPS-007 | operations | Secret rotation cadence documented | 🟡 | SECRET_ROTATION_CADENCE.md (9 secrets, cadence, procedure, audit-event recording) | first rotation evidence is operator-side |
| OPS-008 | operations | Disaster-recovery runbook | 🟡 | partial | finish |

## How to refresh

```bash
python scripts/compliance_scorecard.py            # human view
python scripts/compliance_scorecard.py --json     # CI parsing
```

The scorecard reads `docs/compliance/compliance_controls.json` only. Update the JSON, regenerate this matrix's status column manually (or extend the script in Phase 4 to render markdown directly).
