# AMINA — Data Protection Impact Assessment (DPIA)

**Audience:** ministry liaison, pilot operator, acting DPO.
**Anchors:** Gambia Data Protection and Privacy Policy / Act principles + WHO AI ethics.
**Status:** v1 working draft. Pilot operator must ratify before national rollout.

---

## 1. Processing purposes

1. NCD education + triage assistance for community health workers, caregivers, patients.
2. Personalised care-plan tailoring against held patient profile + vitals.
3. Caregiver / clinician handoff via inbox + alert flow.
4. De-identified DHIS2 push of clinical events for ministry reporting.
5. (Opt-in) anonymised conversation samples for AMINA model improvement.
6. (Opt-in) evidence-layer eval traces for clinical reviewer audit.

## 2. Data subjects

- Patients with NCD diagnoses (primary).
- Family caregivers acting on behalf of a patient.
- Community health workers / nurses / clinicians using AMINA professionally.
- Synthetic / demo accounts (no real subject; pattern-matched session IDs).

## 3. Data categories (mapped to retention class — see [RETENTION_POLICY.md](RETENTION_POLICY.md))

| Category | Sensitivity |
|---|---|
| Free-text message body | high (may contain PHI) |
| Voice audio (intermediate) | high |
| Phone number / channel id | high |
| Patient profile (name, age, gender, conditions, medications, region) | high |
| Vitals (BP, glucose, weight) | high |
| Care plan, consultation record | high |
| Session id | medium (correlation key) |
| OTP | critical (short-lived secret) |
| Auth token | critical |
| Trace metadata (PHI-redacted by construction) | low |

## 4. Lawful basis / consent

| Processing | Lawful basis (proposed) |
|---|---|
| NCD education for an authenticated user | consent + legitimate interest in public-health support |
| Personalised care-plan tailoring | explicit consent (clinical-support consent grant) |
| Caregiver-link sharing | explicit consent (caregiver-link grant), two-way |
| DHIS2 aggregated push | public-task / ministry mandate (operator confirms with HMIS lead) |
| Training-export anonymised samples | explicit, separate, opt-in consent (training-consent grant) |
| Evidence-layer trace capture | operator-controlled, off by default; PHI-redacted by construction |

Detailed grant/withdraw model: [CONSENT_MODEL.md](CONSENT_MODEL.md).

## 5. Necessity + proportionality

- **Data minimisation**: only fields needed for each tool call are passed; injected fields (`patient_id`, `phone`) are stripped before LLM exposure.
- **Purpose limitation**: each consent grant is narrowly scoped (clinical-support, caregiver-link, training, channel-processing).
- **Storage limitation**: see retention table.
- **Accuracy**: vitals + profile editable by patient + clinician; correction workflow in [DATA_RIGHTS_RUNBOOK.md](DATA_RIGHTS_RUNBOOK.md).
- **Integrity / confidentiality**: TLS in transit, role-based admin auth, PHI-redacted logs/traces.
- **Accountability**: this DPIA + the control matrix + the audit-readiness checklist.

## 6. Risks + mitigations (summary; full register in [CLINICAL_SAFETY_CASE.md §8](CLINICAL_SAFETY_CASE.md#8-risk-register-initial-pilot-must-extend))

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| PHI leak via log line / trace | low | high | `phi_deid.py`, `to_safe_dict()`, red-team tests | low |
| PHI leak via LLM provider (subprocessor) | low | high | redaction before send, per-provider DPA | low |
| Channel spoofing | medium (default config) | high | enable signature verification | low after enable |
| Wrong medical advice | low | severe | safety contract + refusal patterns + cascade | low |
| Emergency missed | low | severe | bilingual keyword list + frontend SOS | medium-low |
| Consent withdrawn but data still processed | low | medium | consent-audit edge writes; sweep at next request | medium (sweeper not automated) |
| Backup retains deleted PHI past TTL | medium (current state) | medium | document deletion-proof + automated purger (Phase 4) | medium until purger lands |
| Ministry liaison sees identifiable record via observatory | low | high | observatory PHI-redacted views; admin auth gates | low |
| Caregiver impersonates patient | low | high | OTP + role auth + caregiver-link-consent edge | low |
| Bias against rural / low-literacy users | medium | medium | Beginner UX, eval set diversity, Mandinka coverage | medium |

## 7. Residual risks accepted by the operator

The pilot operator must explicitly accept (in writing) the residual risks above before pilot launch. The signoff template:

```
Pilot operator: ________________________
Date: __________
Residual risks reviewed: yes / no
Risks explicitly accepted (list IDs): ___________________________
Conditional acceptance (list ID + condition + ETA): ___________________________
Signature: ____________________________
```

## 8. Approval checklist

- [ ] Privacy notice content reviewed by acting DPO.
- [ ] Consent model reviewed by clinical safety lead.
- [ ] Retention table ratified by ministry liaison.
- [ ] Risk register reviewed and residuals accepted.
- [ ] Incident-response plan rehearsed at least once (tabletop).
- [ ] Subprocessor list reviewed (LLM providers + channels).
- [ ] DHIS2 / FHIR push restricted to de-identified, aggregated events for v1.
- [ ] No real PHI is used in any test, eval, or smoke harness.
- [ ] AMINA pilot operator + clinical safety lead contact placeholders filled.

## 9. Review cadence

- Quarterly during pilot.
- After every SEV-1 / SEV-2 incident.
- Before any of the following: enabling assist-mode for any UI mode, expanding `MODES_ALLOWED` from `advanced` to wider, adding a new channel, adding a new LLM provider, promoting a tool from "registered, denied" to "executable".
- Annually after national rollout.

## 10. Linked controls

- Cross-cuts the entire matrix; primary anchors PRIV-001 .. PRIV-008, SAFETY-001 .. SAFETY-008.
