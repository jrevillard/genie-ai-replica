# AMINA — Breach Risk Assessment Framework

**Audience:** pilot operator, acting DPO, incident commander.
**Regulatory anchor:** 45 CFR §164.402 (HIPAA Breach Notification Rule) + Gambia Data Protection and Privacy Act 2025.
**Status:** v1.

---

## 1. Purpose

This document provides the four-factor risk assessment framework required by 45 CFR §164.402 to determine whether an impermissible use or disclosure of PHI constitutes a "breach" that triggers notification obligations.

## 2. Definitions

- **Breach**: the acquisition, access, use, or disclosure of PHI in a manner not permitted by the Privacy Rule, which compromises the security or privacy of the PHI.
- **Exception**: unintentional access by workforce member in good faith; inadvertent disclosure to another covered entity; recipient unable to retain the information.

## 3. Four-factor risk assessment

For every suspected incident, evaluate:

### Factor 1: Nature and extent of PHI involved
- What types of identifiers were present? (name, phone, patient ID, conditions, medications, vitals)
- Was the PHI in electronic, paper, or oral form?
- How sensitive is the data? (HIV status, mental health, substance abuse = highest sensitivity)

### Factor 2: Unauthorized person who used or received the PHI
- Was the recipient another covered entity, a business associate, or a completely unrelated third party?
- What is the likelihood the recipient can re-identify patients?

### Factor 3: Whether PHI was actually acquired or viewed
- Was there evidence the data was accessed (log entries, user actions)?
- Or was the opportunity present but no evidence of actual access?
- For digital data: were there read operations, downloads, or screenshots?

### Factor 4: Extent of risk mitigation
- Was the data encrypted (rendered unusable, unreadable, indecipherable)?
- Was it returned or destroyed promptly?
- Are there binding agreements with the recipient?

## 4. Assessment worksheet

Complete one worksheet per suspected breach incident:

```
Incident ID: INC-_________
Date of discovery: ___________
Date of incident: ___________
Assessor: ___________

FACTOR 1 — Nature of PHI
  Data types present: ☐ name  ☐ phone  ☐ patient ID  ☐ conditions  ☐ medications  ☐ vitals  ☐ care plan  ☐ audio
  Sensitivity level: ☐ low  ☐ medium  ☐ high  ☐ critical
  Form: ☐ electronic  ☐ oral  ☐ paper
  Notes: _________________________

FACTOR 2 — Unauthorized recipient
  Identity: _________________________
  Relationship to AMINA: ☐ none  ☐ business associate  ☐ workforce member  ☐ other covered entity
  Re-identification risk: ☐ none  ☐ low  ☐ medium  ☐ high
  Notes: _________________________

FACTOR 3 — Actual acquisition or viewing
  Evidence of access: ☐ confirmed  ☐ probable  ☐ possible  ☐ unlikely  ☐ none
  Log evidence: _________________________
  Notes: _________________________

FACTOR 4 — Mitigation
  Data encrypted at rest: ☐ yes  ☐ no  ☐ partially
  Data encrypted in transit: ☐ yes  ☐ no  ☐ partially
  Data returned or destroyed: ☐ yes (date: ___)  ☐ no  ☐ in progress
  Binding agreements in place: ☐ yes  ☐ no
  Notes: _________________________

OVERALL DETERMINATION
  Risk level: ☐ low  ☐ medium  ☐ high
  Breach determination: ☐ breach (notification required)  ☐ no breach (risk acceptably low)
  Rationale: _________________________

  Assessor signature: ___________  Date: ___________
  DPO review: ___________  Date: ___________
```

## 5. Decision tree

```
Suspected unauthorized access to PHI
    │
    ├─ Does an exception apply (good faith, inadvertent to CE, recipient unable to retain)?
    │   YES → Document and close. No notification required.
    │
    ├─ Was PHI encrypted (rendered unusable) at time of breach?
    │   YES → Document as security incident. No breach notification per 164.402(2).
    │
    ├─ Four-factor assessment: Is there >low risk of compromise?
    │   NO → Document reasoning. No notification required.
    │   YES → BREACH CONFIRMED. Proceed to notification.
    │
    └─ Notification timeline:
        • Individual notice: within 60 days of discovery
        • HHS/authority notice: within 60 days (<500 breaches) or annually (≥500)
        • Media notice: if ≥500 individuals in a single state/jurisdiction
```

## 6. AMINA-specific breach scenarios

| Scenario | Factor 1 | Factor 2 | Factor 3 | Factor 4 | Likely determination |
|---|---|---|---|---|---|
| ArcadeDB bind-mount exposed via unpatched host | HIGH (full patient profiles) | External attacker | Likely accessed | Not encrypted at rest | **Breach** |
| Redis AOF file leaked from backup | MEDIUM (session state, may include phone) | Depends on recipient | Unknown | Session data has 24h TTL | **Breach** if PHI present |
| Unencrypted backup tape lost | HIGH (full DB snapshot) | Unknown third party | Unknown | Not encrypted | **Breach** |
| JWT token stolen from browser localStorage | MEDIUM (scoped to one patient) | External | Active use detected | Token TTL limits window | **Breach** — notify affected patient |
| PHI leak through LLM provider (redaction failure) | MEDIUM (partial PHI) | LLM provider (BA with DPA) | Stored in provider logs | DPA covers data handling | **Security incident** — DPA notification |
| Admin accesses patient record without audit trail | LOW (single record, authorized role) | Internal workforce | Confirmed access | Role-based access held | **Policy violation** — not a breach per se |

## 7. Documentation retention

All breach risk assessment worksheets must be retained for **6 years** from the date of assessment, per 45 CFR §164.530(j).

Store completed worksheets under `_recovery/incidents/INC-<id>/breach_assessment.md` (gitignored — never commit raw assessment details).

## 8. Reporting timeline

| Notification target | Timeline | Method |
|---|---|---|
| Affected individuals | ≤ 60 days from discovery | Channel they used (WhatsApp/SMS/Telegram/web banner) |
| HHS / Gambian DPA | ≤ 60 days (or annually if <500) | Written report via the relevant authority portal |
| Media (if ≥500 in single jurisdiction) | ≤ 60 days | Press release to local media outlets |

## 9. Linked controls

- IR-001 .. IR-008 in [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md).
