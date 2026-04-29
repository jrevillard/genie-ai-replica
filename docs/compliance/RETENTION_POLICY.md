# AMINA — Data Retention Policy

**Audience:** ministry liaison, pilot operator, security reviewer.
**Status:** v1 (defaults proposed; pilot operator must ratify). Implementation gaps explicitly marked.

---

## 1. Default retention by data class

| Data class | Default retention | Mechanism today | Implementation status |
|---|---|---|---|
| **Redis session cache** | 24 hours | Redis TTL set on session keys | ✅ implemented |
| **OTP** | ≤ 10 minutes | Redis TTL | ✅ implemented |
| **Conversation dialogue snapshot** | 7 days (rolling) | `dialogue_state.py` writes to Redis with TTL | ✅ implemented |
| **Patient profile** | active care period; deletable on request | ArcadeDB record; manual deletion today | ⚠️ no scheduled sweeper |
| **Vitals** | 5 years (proposed; clinical-record norm) | ArcadeDB record | ⚠️ no scheduled sweeper |
| **Care plan** | 5 years (proposed) | ArcadeDB record | ⚠️ no scheduled sweeper |
| **Consultation record** | 5 years (proposed) | ArcadeDB record | ⚠️ no scheduled sweeper |
| **Audio uploads (scribe)** | 60 minutes intermediate, then deleted | bind-mounted dir under `scribe_audio/`, pruned by service | ⚠️ relies on caller; pruner script TBD |
| **STT transcript** | merged into the chat transcript; same retention as the chat | n/a | n/a |
| **TTS audio** | streamed only, not stored | n/a | ✅ |
| **Inbox files** (PDFs, education certs) | 24 hours signed-URL TTL; underlying file 7 days | `file_token_service.py` + `inbox_service.py` | ✅ implemented |
| **Education certificates** | duration of caregiver/literacy verification | bind-mounted, manual review | ⚠️ no automated purge |
| **Caregiver uploads** | 30 days (proposed) | bind-mounted | ⚠️ no automated purge |
| **Application logs** | 30 days on host (depends on docker log driver) | docker log rotation | ⚠️ varies by host |
| **AGENT_TRACE lines** (agentic) | inherits the application log retention | stdout → docker logs | inherits log retention |
| **Evidence-layer JSONL traces** | 90 days default (proposed) | local file under `evidence_reports/` | ⚠️ no purger |
| **Evidence-layer eval reports (md)** | 1 year (proposed) | local file | ⚠️ no purger |
| **Backups (ArcadeDB / Redis)** | 30 days incremental, 1 year monthly snapshot (proposed) | `haystack-stack/backups/` (gitignored) | ⚠️ pilot must define scheduler |
| **Channel-provider records** | per provider's policy (Meta / Twilio / Telegram) | external | not under our control |
| **Training-export samples** (only with training consent) | 2 years anonymised | `training_export.py` flow | ⚠️ purger TBD |
| **Consent audit edges** | 7 years (proposed) | ArcadeDB `ConsentAuditVertex` | ⚠️ no purger; legal-hold flag missing |

✅ = implemented and verifiable today
⚠️ = retention is *declared* but not yet *enforced by automated tooling* — manual operator action required

## 2. Backup retention

- **Where**: `haystack-stack/backups/` (gitignored). Pilot operator schedules.
- **Frequency**: nightly incremental + weekly full + monthly archive (proposed).
- **Encryption**: backups MUST be encrypted at rest. Pilot operator owns key management. (Current dev setup does not enforce this — flagged as a gap.)
- **Inheritance**: a backup inherits the *longest* retention class present in the snapshot. A backup containing PHI cannot be retained beyond the patient's clinical-record class.
- **Deletion proof**: a backup deleted as part of a data-rights request must produce a deletion confirmation log line (writer TBD — Phase 4 roadmap).

## 3. Deletion / anonymisation process

### Delete (full erasure)
- Manual: pilot operator runs the documented `consent_routes.py` withdraw + admin-side ArcadeDB deletion.
- Effect:
  - Patient profile + all owned vitals / care plans / consultations marked tombstoned, then physically removed at next sweeper pass (sweeper not yet built).
  - Redis keys for that session deleted.
  - Caregiver-link edges removed.
  - Backup inclusions: see [§2](#2-backup-retention) — backup containing the deleted record continues to exist until the backup itself ages out, then the deleted record vanishes naturally.
  - A `DeletionAuditVertex` edge is written (proposed; not yet a separate vertex type — current implementation reuses `ConsentAuditVertex` with action='deletion').

### Anonymise (de-identify, keep aggregate)
- Used when the user wants their identifiable record removed but consents to keep the de-identified clinical content for research / model training.
- Process: replace PII fields with deterministic hashes (sha256 of `salt || value`); keep clinical fields.
- Implementation: shares `phi_deid.py` patterns; pipeline stub TBD.

## 4. Exceptions / legal holds

If a patient requests deletion but a clinical-record law or ministry directive requires retention:

1. Operator records the legal-hold reason in the data-rights ticket.
2. Operator marks the record `legal_hold=true` in ArcadeDB (proposed flag — not yet on the schema; flagged as a Phase 4 gap).
3. The record is excluded from the deletion sweeper until the hold is lifted.
4. The user is told the request is on hold + the reason + the expected lift date.

## 5. Open implementation gaps

Marked ⚠️ above. Summary list for [COMPLIANCE_ROADMAP_TO_9.md](COMPLIANCE_ROADMAP_TO_9.md):

| Gap | Severity | Owner |
|---|---|---|
| No automated retention sweeper for ArcadeDB record classes | medium | engineering |
| No automated purger for `evidence_reports/` + `caregiver_uploads/` + `education_certs/` | medium | engineering |
| No deletion-proof writer for backups | medium | engineering + ops |
| No `legal_hold` flag on patient record schema | low | engineering |
| No central retention-config file (TTLs are scattered) | medium | engineering |
| Backup encryption-at-rest not enforced in current compose | high | ops |

## 6. Linked controls

- RET-001 .. RET-008 in [COMPLIANCE_CONTROL_MATRIX.md](COMPLIANCE_CONTROL_MATRIX.md).
