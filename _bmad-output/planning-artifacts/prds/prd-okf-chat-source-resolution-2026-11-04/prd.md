# Product Requirements Document: OKF chat-source resolution & Document Management integration

**Date:** 2026-11-04
**Author:** David Forden (with Claude Code agent)
**Version:** 1.0
**Project Type:** Framework feature initiative (GENIE.AI)
**Project Level:** 2 (8 FRs, 9 epics, ~22 stories)
**Status:** Draft

---

## Document Overview

This PRD turns the canonical spec at `_bmad-output/specs/spec-okf-chat-source-resolution/`
(kernel CAP-1..8, companions `evidence-map.md` + `remediation-plan.md`, decision memlog
D1..D6) into prioritized, testable requirements. It serves as the source of truth for
what will be built and traces every requirement back to a review-verified hot-spot.

**Related Documents:**
- Spec (canonical, memlog is the decision-of-record): `_bmad-output/specs/spec-okf-chat-source-resolution/`
- Evidence map (file:line hot-spots): same folder, `evidence-map.md`
- Remediation plan (MR waves W1-W9): same folder, `remediation-plan.md`
- Trackers: #1409 (umbrella), #1410 + #1411 (deferred-work)

---

## Executive Summary

Every chat citation backed by an OKF concept is a dead link: the frontend stamps
`source: 'okf-concept'` rows with a doc-repo URL family that cannot resolve, because
content-only chunking (ADR okf-008) means no per-concept `files` doc exists on ANY of
the four creation origins. The same integration gap shows up as unlabeled bundle zips
accumulating in the Document Management list, retract silently destroying every
Versions download, and concept-keyed ingestion-log rows growing unbounded. This
initiative closes the gap end-to-end: working citations (open + download) for
citizens, concept tree browsing from any citation, an honest OKF artifacts view for
stewards, retract-as-unpublish retention, and zero garbage — without regressing any
shipped OKF feature.

---

## Product Goals

### Business Objectives

1. **Citizen trust in OKF-served answers** — a citation that 404s undermines the
   entire OKF pillar's credibility; every citation must land on its content.
2. **Steward honesty** — the Document Management inventory and the retraction verb
   must not lie about what exists, what is downloadable, or what gets deleted.
3. **No-regression** — the shipped OKF feature set (wizard, editor, Studio,
   scope authz, versions) keeps behaving identically.

### Success Metrics

- Zero 404s / error banners on OKF citations across all four creation origins
  (Playwright-asserted, all origins covered).
- `okf_repo_id` stamp success rate 100% on a live documents-origin ingest
  (from the observed 41/41 failure).
- VersionsDialog downloads still work for a retracted repo (every published version).
- Zero unlabeled bundle rows in the default document list; zero concept-keyed
  ingestion-log rows surviving a repo delete/retract.
- Coverage % never decreases (baselines: 88.21% overall post-!622); all suites green
  (backend + frontend + okf-server Jest, overlay pytest, Playwright, `localeConsistency`).

---

## User Personas

- **Citizen** — chats in the web/mobile app; clicks citations; never sees steward
  surfaces. Needs: working open/download, readable concept content, tree browsing.
- **Steward** — curates OKF repositories in Studio; owns the Document Management
  workflow. Needs: truthful artifact inventory, working version downloads, honest
  delete/retract semantics.
- **Deployer/operator** — runs the stack. Needs: no new mandatory env vars, no new
  cache/infrastructure to operate.

---

## Functional Requirements

FRs map 1:1 to the spec kernel's capabilities (CAP-1..8). Priorities are honest
MoSCoW, not everything-Must: the dead-link fix chain (FR-1/2/3) and the data-loss
fix (FR-6) are Must; the provenance, artifacts-view and tree-browse capabilities
are Should per decisions D1/D2/D6.

---

### FR-001: Retrieval identity end-to-end (CAP-1)

**Priority:** Must Have

**Description:**
Every OKF chunk citation carries `repo_id` and `bundle_version` from the retriever
enrichment through chatqna metadata to the frontend payload. Downstream resolvers
never parse graph-name strings.

**Acceptance Criteria:**
- [ ] Retriever enrichment returns both fields for OKF graphs (pytest)
- [ ] Fields ride provenance into chatqna metadata and the frontend payload
- [ ] Legacy (non-OKF) graph results byte-identical; enrichment purely additive
- [ ] Zero graph-name parsing downstream

**Dependencies:** none

---

### FR-002: Scope-authorized concept content serving (CAP-2)

**Priority:** Must Have

**Description:**
okf-server exposes a chat-user-accessible route serving a concept's markdown
(title, labels, body) from `okf_concepts_meta`. Authorization = the user bearer
through `scope-authz-service` (6-1c, `OKF_SCOPE_MODE`, `acl.restricted`), enforced
per request.

**Acceptance Criteria:**
- [ ] RESTRICTED concept body refused to an ungranted user (dedicated test)
- [ ] `x-okf-internal-secret` appears nowhere on the path (grep/test enforced)
- [ ] No authz caching on the route (the retrieval last-known-good pattern is NOT imported)
- [ ] open/closed scope modes both exercised in tests

**Dependencies:** FR-001 (for end-to-end demo; the route itself is independent)

---

### FR-003: Dead-link elimination on chat cards (CAP-3)

**Priority:** Must Have

**Description:**
The frontend renders OKF citations title-first with working open/download targets
(open → FR-002 route; download → the markdown). Unresolvable sources degrade to
plain text. Persisted pre-fix history resolves best-effort — never a dead link.

**Acceptance Criteria:**
- [ ] `source === 'okf-concept'` branch keyed in the store; legacy document cards untouched
- [ ] Zero 404s / error banners on citations across all four origins (Playwright)
- [ ] A persisted pre-fix conversation renders plain text, never a dead link
- [ ] Card titles resolve asynchronously (id → title swap) without blocking render

**Dependencies:** FR-001 + FR-002

---

### FR-004: Source-document links (CAP-4)

**Priority:** Should Have

**Description:**
Cards expose the originating doc-repo document when `sources[]` carries one
(documents/crawl origins), honestly rendering "source unavailable" otherwise
(bundle-import/scratch origins). Gated on the `okf_repo_id` stamp fix (observed
41/41 failure) and on doc-repo refusing restricted sources on serve paths (D4).

**Acceptance Criteria:**
- [ ] Stamp success rate 100% on a live documents-origin ingest
- [ ] Restricted-source download returns the refusal envelope; unrestricted unchanged
- [ ] Documents/crawl origins show working source links; others show unavailable
- [ ] Failed resolution renders unavailable — never a wrong document

**Dependencies:** FR-003 (card surface) + stamp fix + doc-repo refusal (W4)

---

### FR-005: OKF artifacts view in Document Management (CAP-5)

**Priority:** Should Have

**Description:**
Bundle zips leave the default document list into a labeled view with `repo@version`
provenance, Studio deep links, and truthful per-state actions (including fixing the
Pending-bundle deletable-in-UI-but-403 lie).

**Acceptance Criteria:**
- [ ] Zero unlabeled bundle rows in the default document list
- [ ] Artifact ↔ repo navigation works both directions
- [ ] Pending bundles get a truthful action (no affordance that 403s)
- [ ] DS primitives only (`DsTable`/`DsDialog`/`DsPill`); `?tab=…&file=` deep-link pattern reused

**Dependencies:** none (independent, UI-heavy)

---

### FR-006: Retract-retention contract (CAP-6)

**Priority:** Must Have

**Description:**
Retract preserves every version bundle zip (retract = unpublish, D3); repo delete
keeps its intentional hard purge (2026-10-12 directive). The two verbs are named
and explained in the UI.

**Acceptance Criteria:**
- [ ] Backing-file sweep exempts `is_bundle` docs (raw + zips) from retract
- [ ] VersionsDialog still downloads every version of a retracted repo
- [ ] Repo delete still purges everything (unchanged)
- [ ] Sweep tests red→green; UI copy distinguishes the verbs

**Dependencies:** none

---

### FR-007: Garbage elimination (CAP-7)

**Priority:** Must Have

**Description:**
Concept-keyed ingestion-log rows are purged with their repo under the 1:1 keying
safety rule; the SOURCES_NOT_RETRACTED gate downgrades deletion-aware (a
hand-deleted source no longer dead-locks ingest).

**Acceptance Criteria:**
- [ ] Zero concept-keyed log rows survive a repo delete/retract
- [ ] 1:1 safety test proves no cross-repo rows die
- [ ] Deletion-aware gate downgrade tested (missing source = skip + log, not block)

**Dependencies:** none

---

### FR-008: Concept tree browsing from a citation (CAP-8)

**Priority:** Should Have

**Description:**
From a cited concept the citizen walks the repo's within-repo concept graph
(`_LINKS_TO`, author + parser edges) starting at that concept (D6). Read-only,
same scope authority as retrieval, no steward UI. Serves the repo's CURRENT
indexed state; `bundle_version` stays provenance identity, not a time machine
(logged assumption).

**Acceptance Criteria:**
- [ ] Every hop loads through the scope-authorized concept path (per-request authz)
- [ ] Concepts the user could not retrieve are unreachable (dedicated test)
- [ ] Entry affordance renders only on working cards (no dead affordance)
- [ ] No zip extraction; DS primitives only

**Dependencies:** FR-002 + FR-003

---

## Non-Functional Requirements

### NFR-001: Security — authorization isolation

**Priority:** Must Have

**Description:** The user-facing chat-card path uses ONLY the user bearer through
`scope-authz-service`; the internal shared secret never appears on it; no authz
caching on any serve route.

**Acceptance Criteria:**
- [ ] Grep/test asserts no `x-okf-internal-secret` on user paths
- [ ] Authz evaluated per request from token claims; dedicated RESTRICTED-refusal tests
- [ ] FR-002's review pass treats this like 6-1c's security review

### NFR-002: Performance — no new cache layer

**Priority:** Must Have

**Description:** No redis or new cache (D5, unanimous panel). Concept content is a
single indexed ArangoDB fetch.

**Acceptance Criteria:**
- [ ] No new cache client/dependency introduced
- [ ] Revisit conditions live in #1411 (measured p95 evidence AND a maxmemory+LRU posture change)

### NFR-003: i18n parity

**Priority:** Must Have

**Description:** Every new UI string ships in all 14 locales, key-identical.

**Acceptance Criteria:**
- [ ] `localeConsistency` green; real translations, not English placeholders
- [ ] `{n}`-style keys consumed via `translate().replace()` registered where required

### NFR-004: No-regression / compatibility

**Priority:** Must Have

**Description:** (David, 2026-11-04: this initiative must NOT interfere with or
displace the legacy query pipeline or legacy document handling.) chatqna citation
mint verbatim; retriever enrichment additive, legacy results byte-identical;
legacy document chat path, doc-repo upload/download/view flows, wizard hand-off,
VersionsDialog for live repos, and repo-delete purge all unchanged.

**Acceptance Criteria:**
- [ ] No-regression inventory (remediation plan) re-checked per wave
- [ ] Playwright suite green; renamed locators swept
- [ ] Legacy document handling: zero behavior change outside `is_bundle` rows and
      RESTRICTED-source refusals

### NFR-005: Maintainability

**Priority:** Must Have

**Description:** Coverage never decreases; every story extends the smoke harness and
re-runs it live; verbose structured logging on all new/changed paths.

**Acceptance Criteria:**
- [ ] jest --coverage ≥ 88.21% overall baseline on merged result
- [ ] Smoke harness extension per story, live-verified

### NFR-006: Config neutrality

**Priority:** Must Have

**Description:** No new mandatory env vars; existing `OKF_SCOPE_MODE` /
`acl.restricted` semantics unchanged.

**Acceptance Criteria:**
- [ ] config-validator untouched or green; env/ansible in lock-step if anything IS added

---

## Epics

Epics map 1:1 to the remediation plan's waves (each wave = one MR slice). Full
epic detail, story slices and verification anchors live in
[epics.md](./epics.md).

| Epic | Wave / MR | FRs | Stories (est.) | Priority |
|---|---|---|---|---|
| EPIC-1 Retriever enrichment | W1 / MR-1 | FR-001 | 2 | Must |
| EPIC-2 Concept content route | W2 / MR-2 | FR-002 | 3 | Must |
| EPIC-3 Citation card branch | W3 / MR-3 | FR-003 | 3 | Must |
| EPIC-4 Stamp fix + serve refusal | W4 / MR-4 | FR-004 (gate) | 2 | Should |
| EPIC-5 Original-source links | W5 / MR-5 | FR-004 | 2 | Should |
| EPIC-6 OKF artifacts view | W6 / MR-6 | FR-005 | 3 | Should |
| EPIC-7 Retract-retention | W7 / MR-7 | FR-006 | 2 | Must |
| EPIC-8 Log purge + gate downgrade | W8 / MR-8 | FR-007 | 2 | Must |
| EPIC-9 Concept tree browse | W9 / MR-9 | FR-008 | 3 | Should |

---

## User Flows

1. **Citation → content (citizen):** chat answer cites an OKF concept → card shows
   title first → Open loads the concept markdown (scope-checked) → Download saves
   the markdown. No 404 anywhere; persisted old conversations degrade to plain text.
2. **Citation → tree walk (citizen, EPIC-9):** from the same card, enter the repo's
   concept graph at the cited concept; each hop is scope-checked; exit anywhere.
3. **Steward retraction (EPIC-7):** steward retracts a repo → concepts unpublish →
   every published version zip remains downloadable from Versions; delete (a
   different, named verb) purges everything.
4. **Document Management inventory (EPIC-6):** stewards see documents in the
   default list and OKF artifacts in their own labeled view (`repo@version`,
   Studio deep links, truthful actions).

---

## Dependencies

### Internal

- Epic chain: EPIC-1 → EPIC-3; EPIC-2 → EPIC-3 → EPIC-5; EPIC-2 + EPIC-3 → EPIC-9.
  EPIC-4/5/6/7/8 interleave freely (plan's ordering rationale).
- Reuses: `scope-authz-service` + `access-control-service` (6-1c), `okf_concepts_meta`,
  `_LINKS_TO` edges, doc-repo WS2 bundle protection, DS primitives, `okf` Vuex store.

### External

- None new. No new model, service, or infrastructure dependency (NFR-002/006).

---

## Assumptions

- Tree browse serves the repo's CURRENT indexed state; `bundle_version` is
  provenance identity, not a time machine (memlog assumption; PRD may revisit for
  steward-facing versioned browsing).
- No migration/backfill of persisted history rows — best-effort resolution at
  render time only.
- The wizard hand-off mechanics stay untouched (documented fragile but working).

---

## Out of Scope

(Spec non-goals — all on the record with trackers.)

- Zip-member extraction from bundles — deferred with guardrails (#1410).
- Any redis/cache layer — deferred with revisit conditions (#1411).
- Legacy document chat-path changes; repo-delete hard-purge changes.
- Version-pinned content views; history backfill.
- Steward-facing tree browsing in Studio (citizen tree only; steward tooling unchanged).

---

## Open Questions

- Route + URL shape for concept content/tree (Kong path naming, content-type
  headers for open-vs-download) — for the architecture step (Phase 3), not the PRD.
- Whether the tree view is a dialog, a route, or a split pane in the chat surface —
  UX decision at EPIC-9 story time (DS primitives either way).

---

## Approval & Sign-off

### Stakeholders

- David Forden (product owner, GENIE.AI)
- Engineering: Claude Code agent (autonomous dev workflow)
- Review: party panel decisions D1-D6 recorded in the spec memlog

### Approval Status

- [ ] Product Owner (David — approve to start EPIC-1)

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-11-04 | David Forden / Claude Code | Initial PRD from spec CAP-1..8 + waves W1-W9 |

---

## Appendix A: Requirements Traceability Matrix

| Epic ID | Epic Name | Functional Requirements | Story Count (Est.) |
|---------|-----------|-------------------------|-------------------|
| EPIC-1 | Retriever enrichment | FR-001 | 2 |
| EPIC-2 | Concept content route | FR-002 | 3 |
| EPIC-3 | Citation card branch | FR-003 | 3 |
| EPIC-4 | Stamp fix + serve refusal | FR-004 (gate) | 2 |
| EPIC-5 | Original-source links | FR-004 | 2 |
| EPIC-6 | OKF artifacts view | FR-005 | 3 |
| EPIC-7 | Retract-retention | FR-006 | 2 |
| EPIC-8 | Log purge + gate downgrade | FR-007 | 2 |
| EPIC-9 | Concept tree browse | FR-008 | 3 |

## Appendix B: Prioritization Details

- Must Have: FR-001, FR-002, FR-003, FR-006, FR-007 (5) — the dead-link fix chain
  and the data-loss/hygiene fixes.
- Should Have: FR-004, FR-005, FR-008 (3) — provenance fast-follow (D1), artifacts
  view (D2), tree browse (D6).
- Could Have: none. Won't Have: the out-of-scope list above.
- All 6 NFRs Must Have (security, no-cache, i18n, no-regression, maintainability,
  config neutrality are non-negotiable in this repo).
