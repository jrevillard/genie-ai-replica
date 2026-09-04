---
key: 5-7-frontend-logsearchdialog-vue-computed-banner-from-response-d
title: "frontend: `LogSearchDialog.vue` `computed.banner` from `response.degraded` + i18n keys"
epic: epic-5
status: ready-for-dev
effort: 0.25
depends_on: [5.3]
files: components/gov-chat-frontend/src/components/LogSearchDialog.vue; components/gov-chat-frontend/src/i18n/locales/{ar,bn,de,en,es,fr,id,man,pt,ru,st,sw,th,zh}.js (add `admin.logSearch.degraded` key to ALL 14 locale files; canonical EN string: "Showing partial results due to VictoriaLogs outage. Some recent log entries may be missing.")
---

# Story 5.7 — frontend: `LogSearchDialog.vue` `computed.banner` from `response.degraded` + i18n keys

**Epic**: epic-5 (0.25 SP)
**Files**: `components/gov-chat-frontend/src/components/`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#5` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 5 review):**
- `computed.banner` reads `response.data.degraded` (axios envelope; NOT `response.degraded`) — spec wording imprecise.
- Add `admin.logSearch.degraded` i18n key to ALL 14 locale files: `ar.js`, `bn.js`, `de.js`, `en.js`, `es.js`, `fr.js`, `id.js`, `man.js`, `pt.js`, `ru.js`, `st.js`, `sw.js`, `th.js`, `zh.js`. Canonical EN string: "Showing partial results due to VictoriaLogs outage. Some recent log entries may be missing."
- Per CLAUDE.md Language Policy + `.claude/custom_instructions.md` i18n audit rules: NO English-only shipping.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
