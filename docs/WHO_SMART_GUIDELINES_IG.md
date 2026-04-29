# AMINA Care — WHO SMART Guidelines FHIR Implementation Guide

**Document version:** 1.0
**Published:** April 2026
**Status:** Draft — aligned with WHO SMART Guidelines and HL7 FHIR R4
**Canonical URL:** `http://aminacare.health/fhir/ImplementationGuide/amina-care`
**Publisher:** AMINA Care Programme, Ministry of Health, Republic of The Gambia

---

## 1. Purpose

This Implementation Guide (IG) defines how **AMINA Care** publishes FHIR R4 resources that comply with the **WHO SMART Guidelines** framework. It establishes the profiles, terminology bindings, and extensions that third-party systems (DHIS2 Tracker, research repositories, MoH reporting pipelines) must use when consuming AMINA data.

**Why this IG exists:**

1. WHO SMART Guidelines require *machine-executable* clinical guidance. AMINA Care implements WHO PEN (Package of Essential NCD Interventions) protocols, and this IG makes AMINA's adherence to those protocols *programmatically verifiable*.
2. Ministry of Health systems need a contract: "when I call `/fhir/Patient/$everything`, what will I get back?" This IG is that contract.
3. Regulatory review (ITU, WHO, PAHO) requires a written statement of terminology bindings, security posture, and conformance level.

---

## 2. Scope

### 2.1 In scope

| Resource | Profile name | Bindings |
|----------|--------------|----------|
| `Patient` | `AminaPatient` | ISO-3166 country, ISO-639-2 language |
| `Encounter` | `AminaEncounter` | v3-ActPriority, v3-ActCode |
| `Observation` (blood pressure) | `AminaBPPanel` | LOINC 85354-9, 8480-6, 8462-4 |
| `Observation` (glucose) | `AminaGlucose` | LOINC 15074-8, UCUM mmol/L |
| `Condition` | `AminaCondition` | ICD-10 + SNOMED CT (dual-coded) |
| `CarePlan` | `AminaCarePlan` | SNOMED CT activity codes |
| `Consent` | `AminaConsent` | v3-ActReason (DHIS2 scopes) |

### 2.2 Out of scope

- Writeback (third parties writing *to* AMINA) — Phase 3+
- FHIR Bulk Data `$export` (`NDJSON` streams) — Phase 3+
- Questionnaires / QuestionnaireResponse — future work

---

## 3. Conformance

This IG declares **conformance level: FHIR R4 (4.0.1)** with the following capability:

| Capability | Level |
|------------|:-----:|
| Read (`GET /fhir/{type}/{id}`) | SHALL |
| `$everything` operation (`GET /fhir/Patient/{id}/$everything`) | SHALL |
| `/fhir/metadata` (CapabilityStatement) | SHALL |
| Search (`GET /fhir/{type}?param=...`) | SHOULD |
| Create / Update / Delete | NOT IMPLEMENTED (read-only server) |
| Bulk Data Access | ROADMAP |

All resources emitted by AMINA Care carry the verification status `provisional` unless an AMINA-authorized clinician has explicitly confirmed the diagnosis. This is a deliberate safety mechanism: AMINA Care is *not* a licensed diagnostic tool.

---

## 4. Profiles

### 4.1 AminaPatient

**Canonical URL:** `http://aminacare.health/fhir/StructureDefinition/AminaPatient`
**Base:** `Patient`
**Cardinality constraints:**

| Element | Cardinality | Constraint |
|---------|:-----------:|------------|
| `Patient.identifier` | 1..* | SHALL include one identifier with `system=urn:aminacare:patient-id` |
| `Patient.active` | 1..1 | |
| `Patient.name` | 0..* | MAY be absent if anonymized |
| `Patient.telecom.system = phone` | 0..1 | |
| `Patient.gender` | 1..1 | From `male \| female \| other \| unknown` |
| `Patient.birthDate` | 0..1 | AMINA stores age; birthDate is estimated as year only |
| `Patient.address.country` | 1..1 | MUST be `"GM"` (ISO-3166 alpha-2 for The Gambia) |
| `Patient.communication.language` | 0..* | AMINA language preference |

**Extensions:**
- `http://aminacare.health/fhir/StructureDefinition/amina-age-band` — coarsened age for de-identified exports (e.g., `"40-49"`)

### 4.2 AminaEncounter

**Canonical URL:** `http://aminacare.health/fhir/StructureDefinition/AminaEncounter`
**Base:** `Encounter`

| Element | Cardinality | Constraint |
|---------|:-----------:|------------|
| `Encounter.status` | 1..1 | `finished \| in-progress` |
| `Encounter.class` | 1..1 | SHALL be `VR` (Virtual) from `v3-ActCode` |
| `Encounter.priority` | 1..1 | SHALL be `E \| UR \| R` from `v3-ActPriority`, mapped from AMINA triage |
| `Encounter.subject` | 1..1 | Reference to AminaPatient |
| `Encounter.period.start` | 1..1 | |
| `Encounter.serviceProvider.display` | 0..1 | SHOULD be "AMINA Care — Community Health Programme" |

**Triage mapping:**

| AMINA triage_level | FHIR priority code |
|--------------------|:------------------:|
| `EMERGENCY` | `E` |
| `URGENT` | `UR` |
| `ROUTINE` | `R` |

### 4.3 AminaBPPanel

**Canonical URL:** `http://aminacare.health/fhir/StructureDefinition/AminaBPPanel`
**Base:** `Observation`
**Category:** `vital-signs`
**Code:** LOINC `85354-9` "Blood pressure panel with all children optional"

**Components:**
- Systolic: LOINC `8480-6`, unit `mm[Hg]`
- Diastolic: LOINC `8462-4`, unit `mm[Hg]`

### 4.4 AminaGlucose

**Canonical URL:** `http://aminacare.health/fhir/StructureDefinition/AminaGlucose`
**Base:** `Observation`
**Category:** `laboratory`
**Code:** LOINC `15074-8` "Glucose [Moles/volume] in Blood"
**Unit:** UCUM `mmol/L`

### 4.5 AminaCondition

**Canonical URL:** `http://aminacare.health/fhir/StructureDefinition/AminaCondition`
**Base:** `Condition`

**Dual-coding requirement** (WHO SMART Guidelines core principle):

Every `AminaCondition.code.coding` array MUST include at minimum an ICD-10 coding. When an ICD-10 → SNOMED CT cross-walk exists in the AMINA cross-walk table, the Condition SHALL also include a SNOMED CT coding. Example:

```json
{
  "resourceType": "Condition",
  "code": {
    "coding": [
      {
        "system":  "http://hl7.org/fhir/sid/icd-10",
        "code":    "E11.9",
        "display": "Type 2 diabetes mellitus without complications"
      },
      {
        "system":  "http://snomed.info/sct",
        "code":    "44054006",
        "display": "Type 2 diabetes mellitus"
      }
    ],
    "text": "Type 2 diabetes mellitus without complications"
  },
  "verificationStatus": {
    "coding": [{
      "system": "http://terminology.hl7.org/CodeSystem/condition-ver-status",
      "code":   "provisional"
    }]
  }
}
```

**Extensions:**
- `http://aminacare.health/fhir/StructureDefinition/coding-confidence` — decimal (0.0–1.0), confidence score from the AMINA ICD-10 coder
- `http://aminacare.health/fhir/StructureDefinition/coded-by` — string, identifies the coder (`"amina-rule-coder-v1"`)

### 4.6 AminaCarePlan

**Canonical URL:** `http://aminacare.health/fhir/StructureDefinition/AminaCarePlan`
**Base:** `CarePlan`

| Element | Cardinality | Constraint |
|---------|:-----------:|------------|
| `CarePlan.status` | 1..1 | `active` for current plans |
| `CarePlan.intent` | 1..1 | SHALL be `plan` |
| `CarePlan.subject` | 1..1 | Reference to AminaPatient |
| `CarePlan.addresses` | 0..* | References / displays of AminaCondition |
| `CarePlan.activity.detail.description` | 0..* | Human-readable care activities from `key_facts` |

### 4.7 AminaConsent

**Canonical URL:** `http://aminacare.health/fhir/StructureDefinition/AminaConsent`
**Base:** `Consent`

Reflects the AMINA consent_service state. One Consent resource per patient scope.

| Scope key | Consent purpose code |
|-----------|---------------------|
| `dhis2_aggregate` | `POPHLTH` (population health) |
| `dhis2_tracker` | `TREAT` (treatment) |
| `fhir_export` | `HRESCH` (healthcare research) |
| `research` | `HRESCH` |

**Required fields:**
- `Consent.status` — `active \| inactive`
- `Consent.patient` — Reference to AminaPatient
- `Consent.dateTime` — last updated timestamp
- `Consent.provision.type` — `permit \| deny`

---

## 5. Terminology

### 5.1 Code systems used

| System | Canonical URL | Used for |
|--------|---------------|----------|
| ICD-10 CM | `http://hl7.org/fhir/sid/icd-10` | Primary condition coding |
| SNOMED CT | `http://snomed.info/sct` | Dual-coded condition details (WHO SMART compliance) |
| LOINC | `http://loinc.org` | Observation / lab codes |
| UCUM | `http://unitsofmeasure.org` | Observation units |
| v3-ActCode | `http://terminology.hl7.org/CodeSystem/v3-ActCode` | Encounter class |
| v3-ActPriority | `http://terminology.hl7.org/CodeSystem/v3-ActPriority` | Encounter priority |
| condition-ver-status | `http://terminology.hl7.org/CodeSystem/condition-ver-status` | Diagnosis verification (always `provisional`) |

### 5.2 Cross-walk authority

The ICD-10 → SNOMED CT + LOINC cross-walk is implemented in [src/services/icd10_coder.py](../haystack-stack/haystack-chatqna/src/services/icd10_coder.py) (see the `_CROSSWALK` table).

**Source material:**
- UMLS RxNorm/SNOMED mappings
- WHO ICD-10 to SNOMED CT cross-map (v2023)
- LOINC Common Lab Panels release 2.74

**Coverage:** ~60 ICD-10 codes covering WHO PEN NCDs, maternal & child health, Gambia-priority infectious diseases, and common symptoms. Additional mappings can be added by extending `_CROSSWALK` and re-running the sanity test.

### 5.3 Specific clinical bindings

**WHO PEN Protocol 1 — Prevention of heart attacks and strokes**
- Hypertension: `I10` ↔ SNOMED `38341003`
- Diabetes (T2): `E11.9` ↔ SNOMED `44054006`

**WHO PEN Protocol 4 — Respiratory disease**
- Asthma: `J45.9` ↔ SNOMED `195967001`
- COPD: `J44.9` ↔ SNOMED `13645005`

**Gambia-priority infectious diseases** (Ministry of Health priorities)
- Malaria: `B54` ↔ SNOMED `61462000`
- Tuberculosis: `A15.9` ↔ SNOMED `154283005`
- HIV: `B24` ↔ SNOMED `86406008`

---

## 6. Security & privacy

### 6.1 Authentication

All endpoints in this IG require a bearer token in the `Authorization` header. Two token types are accepted:

1. **Admin JWT** — issued by `POST /api/v1/admin/login`
2. **Patient JWT** — issued by `POST /api/v1/auth/otp/verify`

A patient can only retrieve their own `Patient/$everything`. Admins can retrieve any patient's data.

### 6.2 Consent (IG-level)

Before AMINA Care emits any `AminaCondition`, `AminaCarePlan`, or `AminaEncounter` to a third party, it SHALL verify the patient has an active `AminaConsent` for the requesting scope:

| Endpoint | Required consent scope |
|----------|-----------------------|
| `GET /fhir/Patient/{id}` (admin) | None (admin authority) |
| `GET /fhir/Patient/{id}/$everything` (admin) | None (admin authority) |
| `GET /fhir/Patient/{id}/$everything` (patient self) | Own record always accessible |
| `POST /dhis2/tracker/push` | `dhis2_tracker` |
| `POST /dhis2/android/export/*` | `dhis2_tracker` |
| Research cohort export (Phase 3) | `research` |

### 6.3 De-identification

For non-admin exports, AMINA Care SHALL run its PHI de-identification pipeline ([src/services/phi_deid.py](../haystack-stack/haystack-chatqna/src/services/phi_deid.py)) before emitting FHIR resources. The de-identifier removes:

- Names (full + family member names)
- Phone numbers (international formats)
- Email addresses + URLs
- Dates (ISO, DMY, MDY, month-name formats)
- National IDs / MRNs
- GPS coordinates
- Gambia village names (30+ locality list)
- Ages over 89 (HIPAA Safe Harbor rule)

The pipeline produces both the redacted text AND a per-entry redaction report (`type`, `offset`, `replacement`) for auditability.

### 6.4 Audit

Every FHIR read at the Patient/$everything level, every DHIS2 Tracker push, and every consent change is written to an append-only vertex in ArcadeDB:

| Event | Vertex |
|-------|--------|
| Aggregate push | `DHIS2AuditVertex` |
| Tracker patient push | `TrackerPushAuditVertex` |
| Consent change | `ConsentAuditVertex` |

Audit records include: timestamp, actor, patient/resource reference, consent version at the time of the event, and any error messages.

---

## 7. Capability statement

```bash
curl http://localhost:8000/api/v1/fhir/metadata
```

Returns a FHIR R4 `CapabilityStatement` with:
- `fhirVersion: "4.0.1"`
- `status: "active"`
- `publisher: "AMINA Care — Community Health Programme, Republic of The Gambia"`
- REST resources: `Patient`, `Encounter`, `Observation`, `Condition`, `CarePlan`

---

## 8. Examples

### 8.1 Full Patient Bundle

```json
{
  "resourceType": "Bundle",
  "type":         "collection",
  "timestamp":    "2026-04-14T09:00:00Z",
  "entry": [
    {
      "fullUrl": "urn:aminacare:patient:p_demo_001",
      "resource": {
        "resourceType": "Patient",
        "id":           "p_demo_001",
        "identifier":   [{ "system": "urn:aminacare:patient-id", "value": "p_demo_001" }],
        "active":       true,
        "name":         [{ "use": "official", "family": "Ceesay", "given": ["Fatou"] }],
        "gender":       "female",
        "birthDate":    "1981-01-01",
        "address":      [{ "use": "home", "country": "GM", "state": "kanifing" }]
      }
    },
    {
      "fullUrl": "urn:aminacare:encounter:c_001",
      "resource": {
        "resourceType": "Encounter",
        "id":           "c_001",
        "status":       "finished",
        "class":        { "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "VR" },
        "priority":     { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/v3-ActPriority", "code": "UR" }] },
        "subject":      { "reference": "urn:aminacare:patient:p_demo_001" },
        "period":       { "start": "2026-04-14T08:30:00Z", "end": "2026-04-14T08:45:00Z" }
      }
    },
    {
      "fullUrl": "urn:aminacare:condition:c_001:E11.9",
      "resource": {
        "resourceType": "Condition",
        "clinicalStatus":     { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",  "code": "active" }]},
        "verificationStatus": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/condition-ver-status","code": "provisional" }]},
        "code": {
          "coding": [
            { "system": "http://hl7.org/fhir/sid/icd-10", "code": "E11.9",    "display": "Type 2 diabetes mellitus without complications" },
            { "system": "http://snomed.info/sct",         "code": "44054006", "display": "Type 2 diabetes mellitus" }
          ],
          "text": "Type 2 diabetes mellitus without complications"
        },
        "subject":    { "reference": "urn:aminacare:patient:p_demo_001" },
        "encounter":  { "reference": "urn:aminacare:encounter:c_001" },
        "extension":  [{ "url": "http://aminacare.health/fhir/StructureDefinition/coding-confidence", "valueDecimal": 1.0 }]
      }
    }
  ]
}
```

### 8.2 Consent toggle (patient self-service)

```bash
curl -X POST http://localhost:8000/api/v1/consent/me \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scope":"dhis2_tracker","value":true,"reason":"agreed during CHW visit"}'
```

Response:
```json
{
  "ok":          true,
  "patient_id":  "p_demo_001",
  "scope":       "dhis2_tracker",
  "old_value":   false,
  "new_value":   true,
  "new_version": 3
}
```

### 8.3 Ad-hoc ICD-10 → FHIR coding

```bash
curl -X POST http://localhost:8000/api/v1/fhir/code \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Known HIV positive patient with pulmonary TB."}'
```

Response includes ICD-10 codes `B24` and `A15.9`, which will dual-code to SNOMED when wrapped in a Condition resource.

---

## 9. Conformance tests

All conformance claims in this IG are verified by the AMINA Care sanity test suite at [haystack-stack/haystack-chatqna/scripts/sanity_test_dhis2_fhir.py](../haystack-stack/haystack-chatqna/scripts/sanity_test_dhis2_fhir.py).

Run with:
```bash
docker exec haystack-chatqna sh -c 'cd /app && python3 scripts/sanity_test_dhis2_fhir.py'
```

The sanity test verifies:
- All required FHIR routes respond with HTTP 200
- `CapabilityStatement` declares FHIR R4 and the 5 required resource types
- ICD-10 coder produces correct codes for 9 WHO PEN clinical scenarios
- Negation detection works ("denies chest pain" does not code R07.4)
- FHIR mapper emits dual-coded Condition resources (ICD-10 + SNOMED CT)
- BP Observation uses LOINC 85354-9 with systolic/diastolic components
- Tracker payload builders safely return `None` when not configured

---

## 10. Change log

| Version | Date | Summary |
|:-------:|:----:|---------|
| 1.0 | 2026-04-14 | Initial publication — AminaPatient, AminaEncounter, AminaBPPanel, AminaGlucose, AminaCondition, AminaCarePlan, AminaConsent profiles with ICD-10 + SNOMED CT dual-coding |

---

## 11. Contact

**AMINA Care Programme**
Ministry of Health, Republic of The Gambia
Technical: AMINA Engineering
Clinical: MoH NCD Unit
Documentation issues: file against this repository

---

*AMINA Care Programme · Ministry of Health, Republic of The Gambia · April 2026*
