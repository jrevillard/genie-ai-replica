# AMINA — Incident Response Plan

**Audience:** AMINA pilot operator, on-call engineer, clinical safety lead, ministry liaison.
**Status:** v1 (this document defines the process; tooling to enforce it is partially manual — flagged in [AUDIT_READINESS_CHECKLIST.md](AUDIT_READINESS_CHECKLIST.md)).

---

## 1. Incident classes

| Class | Examples | Default severity |
|---|---|---|
| **Data leak** | Logs containing raw PHI, channel webhook leaking phone numbers, unauthorised export | SEV-1 |
| **Wrong medical advice** | AMINA tells a patient to stop a medication, recommends an unsafe dose, misses a clear emergency | SEV-1 |
| **Emergency-escalation failure** | Emergency keywords detected but no escalation card surfaced; SOS button silently fails | SEV-1 |
| **Auth bypass** | Patient sees another patient's data; admin route reachable without auth | SEV-1 |
| **Channel spoofing** | Inbound webhook accepted with a forged signature (Meta / Twilio / Telegram) | SEV-2 |
| **Model / provider outage** | All LLM providers in the cascade time out; AMINA returns generic fallback for >5 min | SEV-2 |
| **Audit-log failure** | AGENT_TRACE log writer crashes or stops emitting; consent_audit edge writes silently fail | SEV-2 |
| **Retention breach** | Data retained beyond its declared TTL; backup not purged on schedule | SEV-3 |
| **Bias / fairness regression** | Mandinka responses degrade vs English baseline; specific region under-served | SEV-3 |

## 2. Severity levels + response timeline

| Severity | Definition | Response start | Containment target | Notification target |
|---|---|---|---|---|
| **SEV-1** | Active patient-safety risk OR confirmed PHI exposure | within 1 hour | within 4 hours | within 24 hours to data subjects + ministry liaison |
| **SEV-2** | Material control failure with no immediate patient harm | within 4 hours | within 24 hours | within 72 hours |
| **SEV-3** | Process gap, no immediate exposure | within 1 business day | within 1 week | next monthly compliance review |

These targets are pilot-scale. Production targets MUST be re-set with the pilot operator and ministry; this document is an internal default.

## 3. Standard playbook (applies to every class)

### 3a. Detect
- Source: monitoring alert, user report, internal review of `AGENT_TRACE` logs, channel-provider report, partner notification.
- First responder records: detection time, source, observed symptom, suspected class.

### 3b. Triage (≤ 15 min for SEV-1)
- Confirm class + severity.
- Assign Incident Commander (IC) — by default, the on-call engineer.
- Open incident channel (private chat / ticket).
- Snapshot relevant logs, traces, and DB state (READ ONLY — do not mutate yet).

### 3c. Contain
- For PHI exposure: rotate the leaking surface (e.g. revoke a token, take the route offline, scrub the log file). Per memory rule: **never delete data without explicit ministry / clinical lead approval.** Use rename-aside for forensic preservation.
- For wrong advice: take the impacted intent path / model offline. The AMINA fallback chain (`mistral → groq → gemini → base`) plus `LLM_FALLBACK_MODE=warn` allows isolating one provider.
- For auth bypass: rotate any tokens in scope, force re-OTP for affected users.
- For channel spoofing: enable strict signature verification (`*_VALIDATE_SIGNATURE=true`), block the offending number/page.
- For audit-log failure: restart the writer; if persistent, halt agentic prepass via `AMINA_AGENTIC_MODE=off` until traces resume.
- For retention breach: initiate deletion / anonymisation per [DATA_RIGHTS_RUNBOOK.md](DATA_RIGHTS_RUNBOOK.md) once approved.

### 3d. Eradicate / fix
- Patch the underlying defect on a fresh branch (`fix/incident-<id>`).
- Add a regression test BEFORE the patch (TDD).
- Verify the test fails on `main` and passes on the fix.

### 3e. Recover
- Re-deploy the fix.
- Re-enable any disabled paths.
- Confirm with monitoring that the symptom is gone.

### 3f. Notify
- SEV-1: notify pilot operator + ministry liaison + clinical safety lead within 24h. Notify affected data subjects via the channel they used.
- SEV-2/3: per the table above.
- Notification template: see [§5](#5-notification-template).

### 3g. Evidence preservation
- All logs, traces, DB snapshots, and channel-provider screenshots taken during triage must be preserved for ≥ 1 year (or longer if required by ministry / legal).
- Store under `_recovery/incidents/INC-<id>/` (gitignored — never commit raw evidence).

### 3h. Post-incident review
- Within 7 days of recovery: write a post-mortem covering trigger, contributing factors, what worked, what did not, action items with owners.
- Template: see [§6](#6-post-mortem-template).
- Action items added to the compliance backlog and tracked in [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md).

## 4. Roles

| Role | Default holder | Duties |
|---|---|---|
| **Incident Commander (IC)** | On-call engineer | Owns the incident end-to-end; calls roles in/out; writes the post-mortem |
| **Comms Lead** | Pilot operator | Drafts and sends external notifications |
| **Clinical Safety Reviewer** | Clinical safety lead | Approves clinical-content fixes; signs off the post-mortem for clinical-class incidents |
| **Data Protection Reviewer** | Pilot operator (acting DPO) | Approves PHI-touch decisions; signs off the post-mortem for privacy-class incidents |
| **Scribe** | Anyone not in IC | Captures running timeline in the incident channel |

## 5. Notification template

```
Subject: AMINA incident notice — INC-YYYY-MM-DD-NNN — SEV-X — <class>

What happened: <2-3 sentences, no PHI>
When detected: <ISO timestamp>
Affected scope: <approximate count of users / channels / data classes>
Containment status: <contained | in progress | not contained>
Patient action required: <yes/no — if yes, what>
Next update: <ISO timestamp, ≤ 24h out>
Contact: <pilot operator email>
```

Send through the same channels patients used (WhatsApp / SMS / Telegram / web banner). Use the localised Mandinka template for Mandinka-only sessions.

## 6. Post-mortem template

```
INC-id: ...                     IC: ...        Severity: ...
Detection time:                 Notification time:
Containment time:               Recovery time:
Class: ...

Trigger:
  - <root-cause description, no blame>

Timeline (UTC):
  - HH:MM detect → ...
  - HH:MM contain → ...
  - HH:MM patch → ...
  - HH:MM recover → ...

What worked:
What did not:

Action items (with owner + ETA):
  - [ ] ...
  - [ ] ...

Compliance-control IDs touched: e.g. AUDIT-002, PRIV-005

Sign-off:
  IC: ___________   Clinical: ___________   Data Protection: ___________
```

## 7. Drills

- Run a tabletop exercise quarterly.
- Run one live drill (synthetic-data only) annually.
- Drill outputs feed into [COMPLIANCE_ROADMAP_TO_9.md](COMPLIANCE_ROADMAP_TO_9.md).

## 8. Linked controls

- IR-001 .. IR-008 in [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md).
