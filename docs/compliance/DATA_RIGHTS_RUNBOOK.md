# AMINA — Data Rights Runbook

**Audience:** pilot operator, on-call engineer.
**Status:** v1 (manual workarounds documented; automated tooling lands in Phase 4).

When a user exercises a data right under [PRIVACY_NOTICE.md §7](PRIVACY_NOTICE.md#7-your-rights), follow the runbook for that right.

---

## 1. Generic intake (every request)

1. Verify identity: phone OTP via `observatory_phone_auth.py` flow OR an in-channel re-auth if the request came over WhatsApp / Messenger / SMS.
2. Open a data-rights ticket: `DR-YYYY-MM-DD-NNN`. Ticket fields: requester hash, request type, channel, received-at, due-by (≤ 30 days from receipt), assigned operator.
3. Confirm receipt to the requester within 72 hours (template below).
4. Record the request and the resolution in the ticket. Tickets are kept ≥ 7 years.

### Confirmation template

```
Subject: AMINA data-rights request received — DR-id

We received your request to <access | correct | delete | export | withdraw consent>
on <date>. We will respond by <due-by, ≤ 30 days>.

If you did not make this request, please reply STOP.

— AMINA pilot operator (<__PILOT_OPERATOR_EMAIL__>)
```

## 2. Access request

**What the user is asking for:** "show me what you hold about me."

| Step | Manual (today) | Automated (Phase 4 target) |
|---|---|---|
| 1. Identify | OTP re-auth | OTP re-auth |
| 2. Pull patient record | ArcadeDB query against `PatientVertex(id=hash(phone, salt))` and connected vitals / care plans / consultations | `GET /api/v1/me/data-export` |
| 3. Pull consent state | ArcadeDB query against `ConsentAuditVertex` for the patient | `GET /api/v1/me/consent` |
| 4. Pull active sessions | Redis `KEYS pattern` + filter by patient hash | reuse session admin endpoint |
| 5. Compile JSON | manual zip with: profile.json, vitals.jsonl, care_plans.jsonl, consultations.jsonl, consent_history.jsonl | endpoint streams pre-built bundle |
| 6. Deliver | secure email or in-channel attachment | signed-URL download (24h TTL via `file_token_service.py`) |
| 7. Audit | write `DataRightsAuditVertex` (proposed) | same |

**Operator checklist:**
- [ ] Identity verified
- [ ] Bundle generated
- [ ] PHI scrubbed of OTHER patients (no caregiver / family records leaked into this bundle)
- [ ] Delivery signed-URL TTL ≤ 24h
- [ ] Bundle deleted from server within 7 days
- [ ] Audit edge written

## 3. Correction request

**What the user is asking for:** "change my age / region / condition / medication list."

| Step | Manual | Automated |
|---|---|---|
| 1. Identify | OTP re-auth | OTP |
| 2. Validate the change | confirm the new value with the user; note source (patient self-report vs clinician update) | client-form with validation |
| 3. Update record | clinician-side ArcadeDB update via `admin_routes.py`; patient-side via the in-chat profile edit if exposed | `PATCH /api/v1/me/profile` |
| 4. Audit | write `DataRightsAuditVertex` with `before` / `after` (both PHI-redacted in the audit edge) | same |

**Operator checklist:**
- [ ] Identity verified
- [ ] Source noted (self vs clinician)
- [ ] Update applied
- [ ] Audit edge written

## 4. Deletion / anonymisation request

**What the user is asking for:** "delete me from AMINA" or "anonymise my record."

This is the highest-blast-radius right. **Coordinate with the clinical safety lead before any irreversible action.** Per the no-data-deletion rule, prefer rename-aside / tombstone over physical delete unless the user explicitly insists and the clinical team approves.

| Step | Manual | Automated |
|---|---|---|
| 1. Identify | OTP re-auth | OTP |
| 2. Determine scope | full deletion, or anonymisation (keep de-identified clinical content) — confirm with user in writing | UI radio choice |
| 3. Check legal hold | review `legal_hold` flag (when implemented; Phase 4) | gate in endpoint |
| 4. Withdraw consent | `POST /api/v1/consent/withdraw` for every grant the user holds | same |
| 5. Tombstone the patient record | mark `PatientVertex.tombstoned=true` + timestamp | sweeper picks up at next pass |
| 6. Tombstone owned vitals / care plans / consultations | same | sweeper |
| 7. Drop active sessions | Redis FLUSH keys matching this patient's session pattern (NEVER FLUSHALL) | endpoint |
| 8. Remove caregiver-link edges | ArcadeDB delete `CaregiverPatientEdge` where `patient_id=...` | same |
| 9. Backup-deletion request | open BACKUP-DR-id ticket per backup retention class | Phase 4 deletion-proof writer |
| 10. Confirm to user | template below | same |
| 11. Audit | write `DataRightsAuditVertex` with action=`delete`/`anonymise` | same |

**Operator checklist:**
- [ ] Identity verified
- [ ] Scope confirmed in writing
- [ ] Legal hold checked
- [ ] All consent grants withdrawn
- [ ] Patient + owned records tombstoned
- [ ] Caregiver edges removed
- [ ] Backup-deletion ticket opened
- [ ] Confirmation sent
- [ ] Audit edge written

### Confirmation template

```
Your AMINA record has been <deleted | anonymised> as of <ISO timestamp>.

Backups containing your record will be purged on the normal backup-retention
schedule (no later than <ISO date based on RETENTION_POLICY.md>).

If you used AMINA via WhatsApp / Messenger / Telegram / SMS, the channel
provider also holds a copy under their own terms — you may need to ask them
separately.

— AMINA pilot operator
```

## 5. Consent withdrawal

**What the user is asking for:** "stop using my data for X."

X is one of: clinical-support, caregiver-link, training. Channel-processing cannot be retroactively withdrawn for past messages.

| Step | Action |
|---|---|
| 1. Identify | OTP / in-channel re-auth |
| 2. Apply | `POST /api/v1/consent/withdraw` with the grant label |
| 3. Confirm | reply with the new state and effective time |
| 4. Audit | written automatically by `consent_service.py` to `ConsentAuditVertex` |

**Operator checklist:**
- [ ] Withdrawal applied
- [ ] User confirmed
- [ ] Caregiver (if affected) notified that they have lost access
- [ ] Training-export queue purged of any pending samples for this user (if grant=training)

## 6. Export request

**What the user is asking for:** "give me my data in a machine-readable format."

Same flow as access (§2) but the deliverable is JSON + JSONL (machine-readable) rather than a human-readable summary.

## 7. Combined-request shortcuts

| Combo | Rule |
|---|---|
| Delete + export | Run export first, deliver the bundle, **then** delete. The export gives the user a copy before AMINA loses theirs. |
| Correction + access | Apply correction first, then re-issue access bundle reflecting new state. |
| Withdraw + delete | Withdrawal is a strict prerequisite — withdraw all grants, **then** delete. |

## 8. SLAs (proposed pilot defaults; ratify with ministry)

| Right | Acknowledgement | Resolution |
|---|---|---|
| Access | within 72h | within 30 days |
| Correction | within 72h | within 14 days |
| Deletion | within 72h | within 30 days |
| Withdrawal | immediate | within 24h |
| Export | within 72h | within 30 days |

## 9. Ticket template

```
Ticket: DR-YYYY-MM-DD-NNN
Requester hash: ___ (sha256(phone || salt))
Request type:    access | correction | delete | anonymise | withdraw | export
Channel:         web | voice | whatsapp | messenger | telegram | sms | email
Received:        ISO timestamp
Due by:          ISO timestamp
Operator:        ___

Identity verification:    [ ] OTP   [ ] in-channel reauth   [ ] other (note)
Action(s) taken:          ...
PHI-scrub check:          [ ] only requester's data in deliverable
Audit edge written:       [ ] yes   id ___
Confirmation sent:        [ ] yes   timestamp ___
Closed:                   ISO timestamp
```

## 10. Linked controls

- CONSENT-003, CONSENT-004 (withdrawal)
- RET-006 (backup deletion proof)
- AUDIT-005 (audit-event store)
- AUDIT-009 (trace export)
