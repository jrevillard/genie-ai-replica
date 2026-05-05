# ArcadeDB datasets in AMINA

**Database name:** `genie`
**Server:** `arcadedb` container · `http://arcadedb:2480` from inside the docker network · `http://localhost:2480` from the host
**Studio UI:** http://localhost:2480 → log in `root / genieRoot123` → pick database **genie**
**Driver path used by chatqna:** `requests.post(${ARCADEDB_URL}/api/v1/command/genie, …)` with HTTP Basic auth from `ARCADEDB_USER` + `ARCADEDB_PASSWORD`.

ArcadeDB is a multi-model store; AMINA uses three of those models inside the same `genie` database:

| Model | Used for |
|---|---|
| **vertex** | entities you traverse from (patients, consultations, memories, audit) |
| **edge** | typed relationships between vertices (`HasConsultation`, `HasMemory`, `CaregiverPatientEdge`) |
| **document** | flat tables — community data, audit logs, observatory accounts |

The "schema" is defined by `CREATE VERTEX TYPE … IF NOT EXISTS` statements scattered across the codebase. Each subsystem owns its own types and creates them on first import — there is no central migration file.

The inventory below was generated against the live `genie` database on **2026-05-06**. Snapshot via `scripts/arcade_inventory.py`; row counts may have grown since.

---

## 1. Identity & login

These types hold the credentials and profile data that drive auth + display name.

### `PatientVertex` *(vertex · 1,053 rows)*
**The single source of truth for patient login + clinical profile.**

| Field | What it is |
|---|---|
| `id` | Primary key, e.g. `P_7E454858`. Used as `patient_id` everywhere else in the codebase + as the abuse-defense cool-down key. |
| `name`, `phone`, `email`, `age`, `gender`, `region`, `preferred_language` | Profile / display. `phone` is the login identifier. |
| **`pin_hash`, `pin_salt`** | **Login secret.** 4-digit PIN, stored as PBKDF2/bcrypt hash + per-row salt — never plaintext. Verified in [src/services/auth.py:38](../haystack-stack/haystack-chatqna/src/services/auth.py). |
| `conditions`, `medications`, `allergies`, `key_facts` | Clinical profile (JSON-serialised arrays). |
| `bp_readings`, `glucose_readings` | Vitals time-series (JSON). |
| `consultation_count`, `last_consultation` | Roll-ups updated when a consultation closes. |
| `created_at`, `updated_at` | ISO-8601 timestamps. |

**Created in** [src/db/setup_schema.py:16](../haystack-stack/haystack-chatqna/src/db/setup_schema.py) and [scripts/ingest_patients.py:44](../haystack-stack/haystack-chatqna/scripts/ingest_patients.py). Read by every patient-facing endpoint plus `/api/v1/admin/patients`.

### `CaregiverVertex` *(vertex · 17 rows)*
Login + profile for CHWs, nurses, doctors, and family caregivers.

`caregiver_id`, `name`, `phone`, **`pin_hash` + `pin_salt`** (same auth pattern as patients), `relationship`, `specialization`, `specialty_tags`, `languages`, `region`, `years_experience`, `bio`, `accepting_patients`, `is_directory_visible`, `max_patients`, `patient_limit`, `last_login`, `created_at`.

**Created in** [src/repositories/caregiver_repo.py:62](../haystack-stack/haystack-chatqna/src/repositories/caregiver_repo.py).

### `ObservatoryStaff` *(document · 13 rows)*
MoH staff accounts for the Government Observatory portal (separate from patient / caregiver auth).

`staff_id`, `full_name`, `email`, `phone`, `nin`, **`password_hash`**, `must_change_password`, `role` (admin / clinician / auditor), `facility`, `region`, `professional_reg`, `date_of_birth`, `start_date`, `status`, `created_at`, `updated_at`.

**Created in** [src/api/observatory_auth.py:102](../haystack-stack/haystack-chatqna/src/api/observatory_auth.py).

### `Patient` *(document · 10 rows — legacy)*
Older flat-document patient table. **Not used for login** — kept around for the 10 seed patients and the cohort/learning prototypes.

`patient_id`, `name`, `phone`, `age`, `gender`, `region`, `conditions`, `medications`, `allergies`, `last_bp`, `last_glucose`, `emergency_contact`.

Created via [src/repositories/patient_repo.py:18](../haystack-stack/haystack-chatqna/src/repositories/patient_repo.py) and [scripts/seed_10_patients.py:196](../haystack-stack/haystack-chatqna/scripts/seed_10_patients.py).

### `users` *(document · 0 rows)*
Empty leftover from an earlier auth experiment. **Do not write here.**

---

## 2. Clinical records & memory

### `ConsultationRecord` *(vertex · 3,902 rows — the largest table)*
Every chat session that produced a clinical interaction lands here.

`id`, `patient_id`, `session_id`, `started_at`, `ended_at`, `summary`, `triage_level`, `symptoms_reported` (JSON), `recommendations` (JSON), `tools_used` (JSON), `messages` (full transcript JSON), `followup_scheduled`.

**Created in** [src/db/setup_schema.py:17](../haystack-stack/haystack-chatqna/src/db/setup_schema.py). Linked to a patient via the `HasConsultation` edge.

### `MemoryVertex` *(vertex · 401 rows)*
Long-term memory the agent maintains per patient — embeddings + extracted facts that survive between sessions.

`id`, `patient_id`, `type` (e.g. `clinical_fact`, `preference`, `relationship`), `content`, `importance`, `embedding` (vector), `metadata` (JSON), `created_at`.

**Created in** [src/db/setup_schema.py:18](../haystack-stack/haystack-chatqna/src/db/setup_schema.py). Linked to its patient via `HasMemory`.

### `CompactionSummary` *(vertex · 4 rows)*
When a session's history gets too long, it's compacted into a summary so the agent can keep context without exploding the prompt budget. One row per compaction event.

`id`, `session_id`, `version`, `range_count`, `chars_before`, `chars_after`, `tokens_before`, `tokens_after`, `summary_text`, `summarizer_model`, `trigger_type`, `created_at`.

**Created in** [src/db/compaction_schema.py:19](../haystack-stack/haystack-chatqna/src/db/compaction_schema.py). Linked via `HasCompaction` edge.

### Empty / scaffolded clinical types (0 rows each)
Defined in code, never populated yet. Reserve names for future features.
- `ClinicalStateSnapshot`, `DialogueStateSnapshot` — point-in-time state captures ([src/db/clinical_state_schema.py](../haystack-stack/haystack-chatqna/src/db/clinical_state_schema.py), [src/db/dialogue_state_schema.py](../haystack-stack/haystack-chatqna/src/db/dialogue_state_schema.py))
- `Protocol` — clinical protocol library ([src/repositories/protocol_repo.py:59](../haystack-stack/haystack-chatqna/src/repositories/protocol_repo.py))
- `ClinicalInsight`, `OutcomeRecord`, `CohortInsight`, `InteractionEvent` — population-learning pipeline placeholders ([src/services/learning.py](../haystack-stack/haystack-chatqna/src/services/learning.py))
- `Consultation` — older flat table superseded by `ConsultationRecord`

---

## 3. Knowledge base / RAG

### `chunks` *(vertex · 721 rows)*
The Haystack chatqna RAG corpus — every embedded passage Amina retrieves over.

`chunk_id`, `doc_id`, `source`, `title`, `text`, `embedding` (vector), `category_labels` (JSON), `graph_enriched` (bool).

**Created in** [scripts/bulk_ingest_chunks_haystack.py:60](../haystack-stack/haystack-chatqna/scripts/bulk_ingest_chunks_haystack.py).

### Empty knowledge-graph scaffolding
- `documents`, `entities`, `categories`, `Chunk` — alternate KB shape, not currently populated
- `document_chunks`, `chunk_entities`, `relationships` — edges for the same scaffolding

---

## 4. Care relationships (graph edges)

| Edge | Rows | Purpose |
|---|---|---|
| **`HasMemory`** | 397 | `PatientVertex` → `MemoryVertex`. Every patient memory points back to its patient. |
| **`HasConsultation`** | 207 | `PatientVertex` → `ConsultationRecord`. Note: only a subset of the 3,902 consultations are edge-linked; the rest are joined by `patient_id` field instead. |
| **`CaregiverPatientEdge`** | 34 | `CaregiverVertex` → `PatientVertex`. Includes `permissions` (JSON), `consent_date`, `granted_by`, `is_revoked`, `revoked_at`, `note`. The relationship audit lives on the edge itself. |
| `HasCompaction` | 0 | `ConsultationRecord` → `CompactionSummary`. Defined, not yet wired. |
| `HasConsent` | 0 | Reserved for future per-consent edges. |

---

## 5. Consent, privacy & training opt-in

### `CaregiverConsentRecord` *(vertex · 7 rows)*
Phase 10 caregiver privacy-policy acceptance. One row per caregiver per notice version.

`record_id`, `caregiver_id`, `role`, `consent_type`, `notice_version`, `policy_version`, `accepted_at`, `created_at`, `method` (`web` / `voice`), `digital_signature_hash`, `guardian_consent`, `guardian_signature_hash`, `mandinka_viewed`, `scroll_completed`, `checkbox_count`, `checkboxes_accepted`.

**Created in** [src/services/caregiver_privacy_consent.py:248](../haystack-stack/haystack-chatqna/src/services/caregiver_privacy_consent.py).

### `TrainingConsentVertex` *(vertex · 15 rows)* + `TrainingConsentAuditVertex` *(vertex · 21 rows)*
Two-table pair tracking each user's consent to have their conversations used for model training.
- **`TrainingConsentVertex`** — current state per actor: `consent_id`, `actor_id`, `actor_role`, `value`, `decided` (bool), `version`, `updated_at`.
- **`TrainingConsentAuditVertex`** — append-only history of every consent change: `audit_id`, `actor`, `actor_id`, `actor_role`, `consent_version`, `old_value`, `new_value`, `reason`, `logged_at`.

**Created in** [src/services/training_consent.py:49](../haystack-stack/haystack-chatqna/src/services/training_consent.py).

### `ConsentAuditVertex` *(vertex · 11 rows)*
Generic consent audit (DHIS2 sharing, data export, etc.) — separate from training consent.

`audit_id`, `patient_id`, `scope`, `consent_version`, `old_value`, `new_value`, `actor`, `reason`, `logged_at`.

**Created in** [src/services/consent_service.py:63](../haystack-stack/haystack-chatqna/src/services/consent_service.py).

### Empty consent placeholders
- `PolicyAcceptanceVertex` — reserved by [src/services/policy_acceptance_repo.py](../haystack-stack/haystack-chatqna/src/services/policy_acceptance_repo.py)
- `CaregiverSuspensionVertex` — caregiver suspension records, not yet used

---

## 6. Inbox & community data

### `InboxItemVertex` *(vertex · 120 rows)*
The patient-facing notification inbox — referrals, lab results, broadcast nudges, follow-ups.

`inbox_id`, `patient_id`, `kind`, `severity`, `title`, `body`, `action_url`, `attachment_token`, `attachment_name`, `attachment_mime`, `attachment_size`, `metadata` (JSON), `read` (bool), `read_at`, `expires_at`, `created_at`, `source`, `source_id`.

**Created in** [src/services/inbox_service.py:99](../haystack-stack/haystack-chatqna/src/services/inbox_service.py).

### `CommunityData` *(document · 263 rows)* + `CommunityAuditLog` *(document · 965 rows)*
Free-form community facts AMINA references during community-health conversations (water sources, market hours, school holidays, etc.). The audit log records every edit.

- **`CommunityData`**: `doc_id`, `category`, `data` (JSON), `updated_by`, `updated_at`.
- **`CommunityAuditLog`**: `audit_id`, `category`, `action`, `data_snapshot` (JSON), `updated_by`, `updated_at`.

**Created in** [src/db/community_store.py:48](../haystack-stack/haystack-chatqna/src/db/community_store.py).

---

## 7. Literacy verification

### `LiteracyProfileVertex` *(vertex · 23 rows)*
Per-patient literacy assessment — drives whether AMINA defaults to text, voice, or facility-only mode.

`patient_id`, `declared_level`, `verified_level`, `current_mode`, `status` (`pending` / `verified` / `rejected`), `verified_by`, `verified_at`, `reviewer_note`, `created_at`, `updated_at`.

### `EducationCertificateVertex` *(vertex · 3 rows)*
Education certificates uploaded as evidence for literacy claims.

`cert_id`, `patient_id`, `declared_level`, `filename`, `mime_type`, `size_bytes`, `storage_path`, `status`, `reviewer`, `reviewer_note`, `reviewed_at`, `uploaded_at`.

Both **created in** [src/services/literacy_service.py](../haystack-stack/haystack-chatqna/src/services/literacy_service.py).

---

## 8. DHIS2 integration

| Type | Rows | What it logs |
|---|---|---|
| `DHIS2AuditVertex` | 92 | Aggregate-data pushes from AMINA → DHIS2 (`push_action`, `period`, `value_count`, `dhis2_response`, `success`, `warnings`, `triggered_by`). [src/services/dhis2_sync.py:511](../haystack-stack/haystack-chatqna/src/services/dhis2_sync.py) |
| `TrackerPushAuditVertex` | 24 | Tracker-program enrollments + events (`tei_uid`, `enrollment_uid`, `events_count`, `consent_version`, `dry_run`, `forced`, `error_message`). [src/services/dhis2_tracker.py:477](../haystack-stack/haystack-chatqna/src/services/dhis2_tracker.py) |
| `DHIS2ReferralVertex` | 0 | Reserved for inbound referrals from DHIS2. [src/services/dhis2_pull.py:47](../haystack-stack/haystack-chatqna/src/services/dhis2_pull.py) |

---

## 9. Audit, observability & safety

### `AuditEventVertex` *(vertex · 1,289 rows)*
The unified safety/governance audit feed. Every privacy-sensitive action writes one row. Powers Governance → Audit log.

`event_id`, `event_type`, `action`, `actor_type`, `actor_id_hash` (hashed for k-anonymity), `subject_type`, `subject_id_hash`, `resource`, `outcome`, `reason_code`, `request_id`, `trace_id`, `session_hash`, `metadata_safe` (JSON; redacted shape only — no PHI), `created_at`.

**Created in** [src/services/audit_event_store.py:125](../haystack-stack/haystack-chatqna/src/services/audit_event_store.py).

### `ObservatoryAudit` *(document · 780 rows)*
Login + admin actions inside the Government Observatory portal (separate from `AuditEventVertex` because the actor identity model is different).

`event_type`, `staff_id`, `session_id`, `ip_address`, `user_agent`, `success` (bool), `failure_reason`, `timestamp`.

**Created in** [src/services/observatory_security.py:432](../haystack-stack/haystack-chatqna/src/services/observatory_security.py).

### `ApiAuditLog` *(vertex · 59 rows)*
Tamper-evident chained audit log written by the API gateway perimeter for every gateway-routed request, including jailbreak detector verdicts.

`log_id`, `timestamp`, `caller_id`, `ip_hash`, `endpoint`, `method`, `status_code`, `request_size`, `response_size`, `latency_ms`, `blocked` (bool), `jailbreak_pattern`, `jailbreak_severity`, `security_flags` (JSON), `prev_chain_hash`, `chain_hash`.

**Created in** [components/api-gateway/app/audit.py:38](../components/api-gateway/app/audit.py).

### Intent-classifier learning loop

| Type | Rows | What it captures |
|---|---|---|
| `IntentClassificationLog` | 359 | Every intent classification AMINA makes — original message, stripped form, classified intent, miss-signals, override link, turn type, was_overridden flag. |
| `IntentSuspectedMiss` | 36 | Subset of classifications the system itself marks as a likely miss based on user-correction signals. Reviewer reviews → fixes the classifier. |
| `IntentCorrection` | 1 | Human-curated correction patterns: `pattern`, `pattern_hash`, `classified_intent`, `corrected_intent`, `weight`, `count`, `source`, `status`, `expires_at`. |
| `IntentOverrideAudit` | 1 | Append-only record of every classification an `IntentCorrection` rewrote in production. |

All four **created in** [src/services/intent_learner.py:120](../haystack-stack/haystack-chatqna/src/services/intent_learner.py).

### `TranslationMetric` *(vertex · 0 rows)*
Translation-pipeline telemetry; defined in [src/translation_v4/stage8_telemetry.py:37](../haystack-stack/haystack-chatqna/src/translation_v4/stage8_telemetry.py) — populated only when stage-8 telemetry is enabled.

---

## 10. Where the abuse-defense cool-down state lives

**Not in ArcadeDB** — abuse-defense ladder + cool-down records are in **Redis** (sticky `had_session_terminate`, `cooldown_until_ts`, `lifetime_terminations`), with an in-memory fallback. ArcadeDB is the patient identity source; Redis is the per-user real-time guardrail state. The audit trail of admin actions on those records lives in JSONL files at `/app/var/abuse_defense/` inside the chatqna container, not in ArcadeDB.

See [src/abuse_defense/cooldown.py](../haystack-stack/haystack-chatqna/src/abuse_defense/cooldown.py) and [src/abuse_defense/state.py](../haystack-stack/haystack-chatqna/src/abuse_defense/state.py).

---

## 11. Quick reference — find data by question

| Question | Where to look |
|---|---|
| "How many patients are registered?" | `SELECT count(*) FROM PatientVertex` (current: 1,053) |
| "Did Lamin Jallow log in recently?" | `SELECT phone, last_consultation FROM PatientVertex WHERE name.toLowerCase() LIKE '%lamin%'` (case-insensitive) |
| "What's the patient's PIN?" | You can't read it back — only verify a candidate against `pin_hash`/`pin_salt` via [src/services/auth.py](../haystack-stack/haystack-chatqna/src/services/auth.py). |
| "How many consultations did patient X have?" | `PatientVertex.consultation_count` for the cached count, or `SELECT count(*) FROM ConsultationRecord WHERE patient_id = 'P_XXX'` for the authoritative one. |
| "What did the agent remember about patient X?" | `SELECT FROM MemoryVertex WHERE patient_id = 'P_XXX' ORDER BY importance DESC` |
| "Which caregivers can see patient X?" | `SELECT FROM CaregiverPatientEdge WHERE patient_id = 'P_XXX' AND is_revoked = false` |
| "Show every privacy-sensitive action in the last 7 days" | `SELECT FROM AuditEventVertex WHERE created_at > '<iso>' ORDER BY created_at DESC` |
| "Did Lamin's caregiver accept the latest privacy notice?" | `SELECT FROM CaregiverConsentRecord WHERE caregiver_id = '<id>' ORDER BY accepted_at DESC LIMIT 1` |
| "Has the API gateway blocked any jailbreak attempts?" | `SELECT FROM ApiAuditLog WHERE blocked = true ORDER BY timestamp DESC` |
| "Which patient is currently in abuse cool-down?" | **Not ArcadeDB** — query Redis (`KEYS amina:abuse_defense:cooldown:*`) or use `GET /api/v1/admin/abuse/user/{patient_id}` |

---

## 12. How to refresh this inventory

```
# from the host, one-shot dump:
cat scripts/arcade_inventory.py | docker exec -i haystack-chatqna python > scripts/_arcade_inventory.json
```

The script lives at [scripts/arcade_inventory.py](../scripts/arcade_inventory.py) and emits a JSON list of `{name, kind, records, fields}` for every type the database exposes (sorted by row count, descending). Re-run when types are added or counts shift materially.

---

*Last verified live: 2026-05-06 against the running `arcadedb` container, database `genie`. Counts will drift; the schema stays stable across restarts because every owning service runs `CREATE … IF NOT EXISTS` at import time.*
