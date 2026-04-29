# AMINA — Compliance Roadmap to 9 / 10

**Audience:** engineering lead, pilot operator, ministry liaison.
**Anchor:** the gap column in [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md). Refresh by re-running `python scripts/compliance_scorecard.py`.

---

## 0. Where we stand after this package

- ~73 controls catalogued; ~40 complete, ~15 partial, ~18 gap (counts may shift slightly as the JSON is updated — re-run the scorecard for the current numbers).
- Per-domain weak spots:
  - **retention** — most gaps; sweepers, purgers, deletion-proof writer, central retention config not built.
  - **audit** — solid trace + ConsentAudit / DHIS2Audit edges, but no general-purpose append-only audit store; admin-route + auth + webhook events scattered in logs.
  - **operations** — no trace dashboard, no backup-verification job, no documented secret rotation cadence.
- Strengths:
  - **clinical_safety** — full safety stack, multi-model consensus, post-generation contract, refusal patterns, write tools denied by policy.
  - **consent** — four-grant model with audit edges; withdraw endpoint live.
  - **privacy** — PHI de-id pipeline + PHI-redacted tracing, both red-team-tested.

## 1. Levers that move us from ~7-8/10 to 9/10

| Lever | What it changes | Domain |
|---|---|---|
| **Append-only audit-event store** + admin/route/webhook wiring | AUDIT-005 / 006 / 008 / 010 → complete; AUDIT-007 → complete | audit |
| **Formal data-rights endpoints** (`/me/data-export`, `/me/profile PATCH`, `/me/forget`) | reduces manual workload; makes CONSENT-004 and §2-§4 of the data-rights runbook automated | consent + data rights |
| **Retention sweepers + purgers** | RET-004 / 005 / 008 → complete | retention |
| **Backup deletion-proof writer** | RET-006 → complete; closes the regulator question "where did the deleted record go in your backups?" | retention |
| **OpenTelemetry spans + trace dashboard** | AUDIT-009 + OPS-004 → complete; observability becomes single-pane | operations + audit |
| **Eval-on-CI gate** | MODEL-007 → complete; future regressions caught at PR time | model_governance |
| **Clinical reviewer signoff workflow** | SAFETY-001, CONSENT-005 → complete; gives ministry a name on the pilot | clinical_safety + consent |
| **DPIA approval record** | DPIA.md §7 / §8 signed off; produces an artefact regulators look for | privacy + accountability |
| **Security review / pen test on staging** | SEC-008 / SEC-009 → complete | security |

Hitting **all** of those takes roughly the work scope below, prioritised.

## 2. Prioritised plan

### This week (low-cost, high-leverage)

- [ ] **Run `python scripts/compliance_scorecard.py` in CI** as a non-blocking informational step. Cost: 5 lines in a workflow file.
- [ ] **Fill `__PILOT_OPERATOR_EMAIL__` and `__CLINICAL_SAFETY_LEAD__` placeholders** in [PRIVACY_NOTICE.md](PRIVACY_NOTICE.md). Cost: 2-line edit.
- [ ] **Run a tabletop incident drill** against [INCIDENT_RESPONSE_PLAN.md §5-6](INCIDENT_RESPONSE_PLAN.md). Cost: 1 hour.
- [ ] **Send the clinical safety case** to the named clinical reviewer for signoff per the [§10 template](CLINICAL_SAFETY_CASE.md#10-clinical-reviewer-signoff-template).
- [ ] **Send DPIA** to the acting DPO for [§8 approval-checklist](DPIA.md#8-approval-checklist) review.
- [ ] **Rotate the GitLab PAT** that's currently embedded in `git remote -v`. Cost: 5 min in GitLab + a credential helper change locally.

### Before pilot launch (~2 weeks)

- [ ] **Append-only audit-event store** built per the schema in [AUDIT_READINESS_CHECKLIST.md §4](AUDIT_READINESS_CHECKLIST.md#proposed-audit-event-schema). Backed by ArcadeDB `AuditEventVertex`. Wire from: admin routes, auth routes, webhook signature failures, retention deletes, data-rights actions.
- [ ] **Formal data-rights endpoints**: `/api/v1/me/data-export`, `/api/v1/me/profile PATCH`, `/api/v1/me/forget`. Wire each through the audit store.
- [ ] **Central retention config** (`src/services/retention.py`) extracting all TTLs to one file; existing services import from there.
- [ ] **Retention sweeper** (one cron loop or APScheduler) that walks ArcadeDB tombstoned vertices + the `evidence_reports` / `caregiver_uploads` / `education_certs` / `inbox_files` directories and deletes per the retention table.
- [ ] **Enable `*_VALIDATE_SIGNATURE=true` for every channel in pilot config** (Twilio, Meta, Telegram). Already a flag — flip it.
- [ ] **Enable backup encryption-at-rest** in the pilot deployment runbook.
- [ ] **TLS in front** with a managed cert (replace Cloudflare quick tunnel).
- [ ] **First live drill** of incident response with synthetic data only.

### Before production (~4-6 weeks)

- [ ] **Backup deletion-proof writer** that emits an `AuditEventVertex(event_type='backup.purge', ...)` per backup that contained tombstoned records.
- [ ] **`legal_hold` flag** on `PatientVertex` + a `legal_hold_audit_edge`.
- [ ] **OpenTelemetry spans** to replace the JSON `AGENT_TRACE` log line; OTel collector + a single dashboard (Grafana / Superset).
- [ ] **Trace dashboard** with: native_fallback_reason rate, denied_reasons distribution, planner_path mix, latency p95, channel-rejection rate.
- [ ] **Eval-on-CI gate** running v1 + v2 + Phase 3 + Phase 4 smoke + 300+ clinical scenarios on every PR.
- [ ] **Pen test** by an independent party.
- [ ] **Dependency vuln scan** (`pip-audit` or equivalent) in CI.
- [ ] **Bias / fairness eval** with a structured Mandinka + region split.
- [ ] **DR runbook** finishing the partial in `AMINA_OPS_MANUAL.md`.
- [ ] **Quarterly DPIA review** scheduled and tracked.

### Before national scale

- [ ] **Per-channel adapter audit** — confirm every adapter (Telegram, Twilio, Meta) writes the right audit edges.
- [ ] **Multi-region deployment plan** + per-region data-residency policy.
- [ ] **Caregiver / clinician training material** + signoff workflow.
- [ ] **Public model card** publishable on a ministry-approved domain.
- [ ] **Independent ethics review** by a body the ministry recognises.
- [ ] **External penetration test** with remediation closure.
- [ ] **Insurance / indemnification** decision for clinical-AI deployment.

## 3. Suggested owner mapping (placeholders)

| Workstream | Suggested owner |
|---|---|
| Audit-event store + endpoints | engineering |
| Retention sweeper + purger | engineering + ops |
| OTel + dashboard | engineering + ops |
| Eval-on-CI | engineering |
| Pen test + dep-vuln scan | ops + external |
| Clinical signoff workflow | clinical safety lead |
| DPIA approval | acting DPO + ministry liaison |
| Backup encryption + DR runbook | ops |
| Channel signature enforcement | ops + engineering |

## 4. Definition of "9/10 reached"

All of the following hold:

1. Scorecard `overall_score_10 >= 8.5`, with no domain below 7.0.
2. Audit-event store live + queried at least weekly.
3. Data-rights endpoints live + a documented request-resolution log over ≥ 30 days.
4. At least one independent security review with all SEV-1/2 findings closed.
5. Clinical safety case signed by named reviewer.
6. DPIA signed by the acting DPO + ministry liaison.
7. Trace dashboard live, monitored by a named on-call rotation.
8. Eval-on-CI gating PRs.

When all 8 are true, refresh this doc + the scorecard and post the resulting score in the Phase 5 report.
