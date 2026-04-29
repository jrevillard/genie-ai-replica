# AMINA — Clinical Safety Case

**Audience:** clinical safety lead, ministry liaison, pilot operator.
**Implementation anchors:** [safety_consensus.py](../../haystack-stack/haystack-chatqna/src/services/safety_consensus.py), [safety_contract.py](../../haystack-stack/haystack-chatqna/src/services/safety_contract.py), [emergency_escalation.py](../../haystack-stack/haystack-chatqna/src/services/emergency_escalation.py), [phi_deid.py](../../haystack-stack/haystack-chatqna/src/services/phi_deid.py).

---

## 1. Intended use

AMINA provides:
- NCD education in English and Mandinka.
- Triage assistance (`SELF_CARE` / `CHW_VISIT` / `FACILITY` / `EMERGENCY`).
- Care-plan tailoring for diagnosed NCDs (hypertension, diabetes, asthma, COPD, CVD risk).
- Medication-safety advisories (read-only; never dosing changes).
- Read-only retrieval of WHO-PEN protocol summaries.
- Caregiver / community-health-worker handoff via inbox + alert flow.

Intended users:
- Patients with chronic NCD diagnoses, supported by a community health worker.
- Community health workers (`vhw` / `chn` roles) using AMINA in the field.
- Family caregivers helping a patient.
- Clinicians (admin role) reviewing patient progress.

## 2. Out-of-scope use

AMINA must NOT be used as:
- Sole source of diagnosis.
- Authoritative medication-dose source (always confirm with a prescriber).
- Emergency dispatch service (always direct users to local emergency number).
- Mental-health crisis line (handoff template exists; live crisis intervention is not implemented).
- Substitute for in-person clinical examination, lab tests, or imaging.

The privacy notice explicitly tells users this ([PRIVACY_NOTICE.md §1](PRIVACY_NOTICE.md#1-what-amina-is--and-what-it-is-not)).

## 3. Clinical safety boundaries

| Boundary | Mechanism | File |
|---|---|---|
| Emergency keywords detected → bypass agentic prepass | `emergency_bypass` route in planner | [agent_platform/planner.py](../../haystack-stack/haystack-chatqna/src/agent_platform/planner.py) |
| Emergency intent → emergency card surfaced before LLM round-trip | frontend SOS detection + backend `emergency_routes.py` | frontend `BeginnerChat.jsx` / `App.jsx` + `src/api/emergency_routes.py` |
| Medication safety: no write tools registered as executable | policy gate denies `record_vitals`, `create_referral`, `send_sms`, `admin_lookup_patient` | `agent_platform/tool_policy.py` (13 deterministic checks) |
| Multi-model safety consensus on ambiguous cases | `safety_consensus.py` runs N models, requires agreement | `src/services/safety_consensus.py` |
| Post-generation safety contract check | `safety_contract.py` validates the final answer against rules | `src/services/safety_contract.py` |
| PHI de-identification before LLM call | `phi_deid.py` strips obvious PHI markers | `src/services/phi_deid.py` |
| Topic anchor (prevents drift on safety-critical topics) | safety pipeline | `src/services/safety_consensus_patch.py` |

## 4. Emergency escalation

Trigger words (English + Mandinka): chest pain, can't breathe, stroke, severe bleeding, passed out, unconscious, seizure, suicide, self-harm, etc.

When triggered:
1. Heuristic planner short-circuits to `emergency_bypass` route (zero agentic tool calls).
2. Frontend immediately surfaces an SOS card with the local emergency number.
3. Caregiver-alert flow is offered (patient may opt to alert their linked caregiver).
4. The LLM-generated reply remains, but the SOS card sits *above* it visually.
5. AGENT_TRACE records `safety_flags=["emergency_bypass"]` for audit.

## 5. Medication safety

- AMINA never proposes a dose change autonomously.
- Drug-drug interaction checks are read-only (`ddi_checker.py`); a flag becomes an advisory, not an instruction.
- Ramadan-medication advisories (`check_ramadan` tool) are bounded to general guidance, never patient-specific dose timing without clinician input.

## 6. Human-in-the-loop role

| Scenario | Human role |
|---|---|
| Triage `EMERGENCY` | User goes to facility / calls emergency number; AMINA alerts caregiver |
| Triage `FACILITY` | Caregiver follow-up within 24h |
| Triage `CHW_VISIT` | CHW visit during next routine round |
| Triage `SELF_CARE` | AMINA continues guidance; no human required |
| Care plan generation | Generated, but care plan is marked "draft" until clinician signs off |
| Medication change suggestion (e.g. patient asks "should I stop my BP pill?") | AMINA refuses to advise; routes to clinician |
| New diagnosis suggestion | AMINA refuses; routes to clinician |
| DHIS2 push of any clinical event | Read-only flow today; mutations require admin approval |

## 7. Known failure modes

| Failure | Mitigation today | Residual risk |
|---|---|---|
| LLM hallucinates a dose | safety contract + explicit refusal patterns | low if `LLM_FALLBACK_MODE=warn` and a cascade is configured |
| Mandinka response degrades over time | quarterly eval against held-out Mandinka set | medium — eval frequency must be enforced |
| Channel spoofing | `*_VALIDATE_SIGNATURE=true` once secrets are configured | medium — defaults are demo-mode permissive |
| Provider outage cascade | 4-provider fallback chain | low |
| Emergency keyword in Mandinka not detected | bilingual keyword list in planner | medium — list must be kept up to date |
| Low-literacy user misreads triage | "Beginner" UX mode + simpler vocabulary | medium — depends on operator's literacy band |
| Caregiver impersonation | OTP + role auth + caregiver-link consent | low |
| Trace exposes PHI | PHI-redacted by construction; red-team tested (Phase-3 test 19 sections) | low |
| Agentic prepass takes > timeout, user-visible delay | `AMINA_AGENTIC_FAIL_OPEN=true` falls through silently | low |
| Wrong language detected → English answer to Mandinka query | language detector + override prompt | medium |

## 8. Risk register (initial; pilot must extend)

| ID | Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|---|
| CR-01 | Wrong dose advised | low | severe | safety contract, refusal patterns, fallback chain | low |
| CR-02 | Emergency missed | low | severe | bilingual keyword list, frontend SOS, caregiver alert | medium-low |
| CR-03 | PHI leaked in trace / log | low | high | `phi_deid.py`, `to_safe_dict()`, red-team tests | low |
| CR-04 | Channel spoofed | medium (in default config) | high | enable signature verification | low after enable |
| CR-05 | Admin route bypass | low | high | `observatory_*` separate auth surface | low |
| CR-06 | DHIS2 push of identifiable record | low | high | de-identification pipeline + read-only default | low |
| CR-07 | Bias against rural / low-literacy users | medium | medium | Beginner mode, eval set diversity | medium |
| CR-08 | Caregiver-link consent reused after withdrawal | low | medium | edge write on withdrawal, sweep at next request | low |
| CR-09 | Care plan persisted before clinician signoff | low | medium | "draft" marker until signoff (TBD UI) | medium |
| CR-10 | Native function-calling regresses safety | low | high | shadow-mode rollout with eval trace evidence | low |

## 9. Eval / red-team evidence

- v1 unit tests: 149 / 149 passing (`_agent_platform_v1_test.py`).
- v2 native-tool tests: 200 / 200 passing (`_agent_platform_v2_native_tools_test.py`).
- Phase 3 red-team safety tests: 157 / 157 passing (`_agent_platform_phase3_safety_test.py`) — covers misuse of write/admin/external tools, ID override, PHI in args, malformed payloads, etc.
- Phase 3 smoke harness: 25 / 25 passing.
- Live shadow-mode validation: 2 turns, 0 PHI leaked ([AGENT_PLATFORM_PHASE4_LIVE_VALIDATION_REPORT.md](../AGENT_PLATFORM_PHASE4_LIVE_VALIDATION_REPORT.md)).
- Evidence layer (when enabled): per-turn JSONL traces + markdown reports for clinical reviewer ([EVIDENCE_LAYER.md](../EVIDENCE_LAYER.md)).

## 10. Clinical reviewer signoff template

```
Reviewer: ____________________________
Affiliation: __________________________
Review scope: AMINA <version>, modes <basic | beginner | advanced>, channels <list>
Date: ____________

I have reviewed:
  [ ] Intended use + out-of-scope statements
  [ ] Risk register
  [ ] Eval evidence
  [ ] Sample of <N> de-identified transcripts (synthetic only): ______ / ______ acceptable

Clinical concerns raised:
  1. ...
  2. ...

Action items required before pilot:
  [ ] ...
  [ ] ...

Signoff:
  [ ] Approved for pilot   [ ] Approved with conditions   [ ] Not approved

Signature: ____________________________
```

## 11. Linked controls

- SAFETY-001 .. SAFETY-008 in [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md).
