# AMINA — Privacy Notice (plain language)

**For:** patients, caregivers, community health workers using AMINA via web, voice, Telegram, WhatsApp, or SMS.
**Last updated:** 2026-04-29.
**Status:** pilot. AMINA is in active development. Some controls described here are partially implemented — see the maturity column in [AUDIT_READINESS_CHECKLIST.md](AUDIT_READINESS_CHECKLIST.md).

---

## 1. What AMINA is — and what it is not

AMINA is a community health support assistant for non-communicable diseases (NCDs) in The Gambia. It speaks English and Mandinka, and routes through Basic / Beginner / Advanced UI modes.

- **AMINA is** education, triage assistance, and clinical-decision support for community health workers, caregivers, and patients.
- **AMINA is NOT** a replacement for a clinician, a pharmacist, or emergency services. Always call your local emergency number or visit the nearest health facility for urgent symptoms.

---

## 2. What we collect

| Data | When | Purpose |
|---|---|---|
| Your message text (typed or transcribed) | Every chat turn | Generate a response |
| Voice audio | If you use voice / scribe | Transcribed into text, then deleted from intermediate storage on a short timer |
| Phone number | If you authenticate via OTP, or message a Meta / Twilio channel | Identify you across turns; receive scheduled care reminders if you opt in |
| Patient profile (age, gender, region, conditions, medications) | When a clinician or you enter it | Personalised care guidance |
| Vitals (BP, glucose, weight) | When entered manually | Trend analysis, care-plan tailoring |
| Care plan, consultation record | When generated | Continuity of care |
| Session id, channel id | Always | Continuity within a single conversation |

## 3. What we do NOT collect

- We do not collect your real-time location.
- We do not collect contact lists, photos, or files unless you upload them (e.g. prescription photo, education certificate).
- We do not sell or share your data with advertisers.
- We do not use your conversation content for AI model training **unless you explicitly grant training consent** through the consent flow ([consent_routes.py](../../haystack-stack/haystack-chatqna/src/api/consent_routes.py)).

## 4. Who can access your data

- **You** — any time, via the chat itself.
- **Your assigned caregiver / community health worker** — only after a consent flow links them to your record (see [CONSENT_MODEL.md](CONSENT_MODEL.md)).
- **AMINA system administrators** — only for incident response, auditable; never for marketing.
- **Ministry of Health partners** — only via aggregated, de-identified DHIS2 data (no individual messages).
- **Channel providers** (Meta / WhatsApp / Twilio / Telegram) — they hold their own copy under their own terms; AMINA never sees their backups.

## 5. Where your data lives

- Active conversation state: **Redis** (in-memory cache, time-bounded — default 24h).
- Patient profile, care plan, consultation record, vitals: **ArcadeDB** (graph database) on the AMINA server.
- Voice audio: temporary disk on the AMINA server, deleted after transcription (see [RETENTION_POLICY.md](RETENTION_POLICY.md)).
- Logs: AMINA server, redacted to remove PHI before retention. See [phi_deid.py](../../haystack-stack/haystack-chatqna/src/services/phi_deid.py).
- Evidence-layer eval reports: local filesystem, opt-in only ([EVIDENCE_LAYER.md](../EVIDENCE_LAYER.md)).
- Backups: encrypted snapshots, retained per [RETENTION_POLICY.md](RETENTION_POLICY.md).

Full map: [DATA_FLOW_MAP.md](DATA_FLOW_MAP.md).

## 6. How long we keep it

Default retention summary (full schedule in [RETENTION_POLICY.md](RETENTION_POLICY.md)):

- Conversation cache: **24 hours**, then dropped from Redis.
- Patient profile: **as long as you have an active care relationship** (you can request deletion).
- Vitals + consultation records: **clinical-record retention per Gambia health-records norm** (proposed 5 years; awaiting pilot operator confirmation).
- Voice audio: **minutes** (deleted after STT + safety check).
- Eval / agentic traces: **PHI-redacted by construction** ([AGENT_PLATFORM_PHASE3_ROLLOUT_AND_EVALS.md](../AGENT_PLATFORM_PHASE3_ROLLOUT_AND_EVALS.md)).

## 7. Your rights

You can ask us to:

1. **Show you what we hold about you** (access).
2. **Correct anything wrong** (rectification).
3. **Delete your record** (erasure) — subject to clinical-record laws.
4. **Withdraw consent** for AI training, channel processing, or caregiver linking — at any time.
5. **Export your record** in a machine-readable format.

How to exercise these: see [DATA_RIGHTS_RUNBOOK.md](DATA_RIGHTS_RUNBOOK.md). Until automated tooling lands (Phase 4 roadmap), requests are handled manually by the AMINA pilot operator.

## 8. Children

AMINA is not designed for children under 13. If a parent or guardian uses AMINA on behalf of a child, the parent/guardian is responsible for the child's data and must consent on their behalf.

## 9. Channel-provider notes

If you reach AMINA via WhatsApp, Messenger, Telegram, or SMS, the channel provider's privacy notice ALSO applies to messages while they are in the provider's network. We have no control over those copies.

## 10. Contact / escalation

- AMINA pilot operator (placeholder — pilot must fill in before launch): `__PILOT_OPERATOR_EMAIL__`
- Clinical safety concerns: `__CLINICAL_SAFETY_LEAD__`
- Suspected data breach: see [INCIDENT_RESPONSE_PLAN.md](INCIDENT_RESPONSE_PLAN.md).

This notice is a living document. Material changes will be re-issued through the same channel you reached AMINA on.
