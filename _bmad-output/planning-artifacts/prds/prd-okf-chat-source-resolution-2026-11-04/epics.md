# Epics — OKF chat-source resolution & Document Management integration

Companion of [prd.md](./prd.md). Each epic = one remediation wave = one MR slice
(forward workflow per story: create-story → checklist → dev-story → code-review).
Anchors cite `evidence-map.md` findings; every claim there is file:line-verified.

Ordering (from the remediation plan, architect rationale):
- EPIC-1 before EPIC-3 — no graph-name string parsing downstream (banned pattern).
- EPIC-2 before EPIC-3 — no affordance before its target exists.
- EPIC-2 carries its own security review (user-facing authz — treat like 6-1c's).
- **EPIC-4 → EPIC-5 is an ORDERED PAIR** (source links lie if the stamp is
  unproven) — dispatch them as a unit; EPIC-6/7/8 interleave freely.
- EPIC-9 after EPIC-2 + EPIC-3; mobile disposition tracked separately (#1441).

Standing per-MR gates: every touched component ≥ its existing `coverageThreshold`
floor (backend 35 / frontend 65 / doc-repo 55; okf-server: no regression of the
CI-reported Statements%) and no CI Statements% regression anywhere, all suites
green, i18n × 14 locales key-identical for any new string (never author
`okf.labErrors.*` keys — exact-21 producer pin), Playwright locators swept
(chat/admin surfaces: `data-testid`; admin: `data-test-id` — read the component),
smoke harness extended + live-run, no Co-Authored-By, no main merges without David.
Tracing: W2/W9's new routes and W8's purge path get OTel spans per
`.claude/rules/OBSERVABILITY.md` (okf-server is instrumented; Kong's OTel plugin
is global; W1 needs no new span attribute).

---

## EPIC-1: Retriever enrichment (W1 / MR-1) — Must

**Delivers FR-001.** Every OKF chunk citation carries `repo_id` + `bundle_version`.

**Anchors:** retriever `genieai_retriever_arangodb.py:1813-1834` (enrichment join),
`:2203-2232` (provenance assembly).

**Story slices:**
1. Additive enrichment: extend the AQL join to return both fields for OKF graphs;
   pytest covers the join (mocked per `tests/conftest.py` conventions).
2. Provenance ride-along: fields through chatqna metadata into the frontend
   payload; contract test pins the payload shape; legacy results byte-identical.

**Verification:** enrichment returns both fields; legacy paths byte-identical;
zero graph-name parsing downstream (grep).

---

## EPIC-2: Concept content route (W2 / MR-2) — Must

**Delivers FR-002.** okf-server serves concept markdown under user-bearer scope
authz. **Security-sensitive: own review pass.**

**Anchors:** authority `scope-authz-service.js` + `access-control-service.js`
(6-1c, `OKF_SCOPE_MODE`, `acl.restricted`); source `okf_concepts_meta` rows;
forbidden `x-okf-internal-secret` (`internal-controller.js:159` is internal-only);
authz-caching hazard: `getAuthorizedGraphs` last-known-good-on-5xx must NOT be
imported.

**Story slices:**
1. Route + controller: serve title/labels/body for one concept; user bearer only;
   per-request authz; Kong-fronted (ADR okf-003, no gateway change).
2. RESTRICTED refusal tests: ungranted user refused in BOTH scope modes; granted
   user served; audit row written per existing patterns.
3. Hardening tests: secret-absent grep test; no-caching assertion; open/closed
   parity; review pass folded (findings fixed same MR).

**Verification:** dedicated refusal test green; internal secret absent from the
path (enforced by test); no cache client introduced.

---

## EPIC-3: Citation card branch (W3 / MR-3) — Must

**Delivers FR-003.** Kills all citation 404s.

**Anchors:** `conversation.js:219-237` (`translateSources` URL fallback — the 404
generator); chatqna mint `genieai_chatqna.py:3524-3595` stays VERBATIM; `_getFileAndPath`
404 seam `fileController.js:469-516` becomes irrelevant for concepts.

**Story slices:**
1. Store branch: `source === 'okf-concept'` keys open/download to the EPIC-2
   route (+ `.md` download); legacy document cards byte-identical behavior.
2. Title-first cards: async id → title resolution (from enrichment fields /
   EPIC-2 route), never blocking render; unresolvable → plain text, no affordance.
3. Degradation: persisted pre-fix rows resolve best-effort via EPIC-2 route by
   concept_id; unresolvable rows render plain text — never a dead link; Playwright
   specs cover all four creation origins; i18n keys × 14 locales.

**Verification:** zero 404s / error banners across origins (Playwright); old
conversation renders gracefully; legacy cards untouched.

---

## EPIC-4: Stamp re-measure + restricted-source serve refusal (W4 / MR-4) — Should

**Gates FR-004.**

**Anchors:** the `okf_repo_id` stamp's 41/41 failure was the 2026-10-11 incident;
its two root causes ALREADY SHIPPED on main in `3d3f4c484` (2026-10-30 —
`rolePolicy.js:15` DOCUMENT_LIFECYCLE + `fileController.js:191` schema). The
stamp is written by okf-server's `producer-service.js:104-108` (PATCH to
doc-repo). doc-repo serve paths (`downloadFile` :653-681, `viewFileInBrowser`
:778-806) get the D4 refusal.

**Story slices:**
1. Re-measure the stamp on a live documents-origin ingest (expect ~100%; the
   loud 100%-failure error from `3d3f4c484` stays as the tripwire). Nothing to
   fix unless the re-measure surprises.
2. D4 refusal via a **stamped restricted snapshot on the files doc** —
   mechanism: okf-server's Access-panel toggle + the import stamp propagate
   `acl.restricted` onto the stamped files docs (okf-server→doc-repo PATCH is
   a shipped precedent — producer-service). Doc-repo gains LOCAL restricted
   knowledge: no new runtime dependency, no okf-server-outage semantics on the
   download path. Refusal = the D4 envelope; unrestricted unchanged;
   bundle-protection tests extended. Toggle-propagation failures audited on
   both sides (stale-snapshot risk named and mitigated by the audit).

**Verification:** stamp ~100% live; refusal envelope tested; toggle propagates;
no unrestricted change.

---

## EPIC-5: Original-source links (W5 / MR-5) — Should

**Delivers FR-004** (gated on EPIC-4).

**Story slices:**
1. Card source row: when `sources[]` carries a doc-repo id (documents/crawl
   origins), render a working link; bundle-import/scratch render "source
   unavailable" honestly.
2. Degradation + tests: retracted/deleted source renders unavailable (never a
   wrong document); Playwright per-origin; i18n × 14.

**Verification:** working links on documents/crawl origins; honest unavailable
elsewhere; no wrong document ever.

---

## EPIC-6: OKF artifacts view (W6 / MR-6) — Should

**Delivers FR-005.**

**Anchors:** bundle mint `fileController.js:1441-1608` (`is_bundle`, `repo_id`,
`bundle_version` — one zip per publish version); WS2 guard :92-131 (explains the
Pending-bundle deletable-but-403 lie); WS3 exports live-forever; deep-link pattern
`?tab=…&file=`; DS primitives + `okf` Vuex store + `okfRepoOps`.

**Story slices:**
1. Filter + view: bundles out of the default document list; labeled artifacts
   view (`repo@version` pills, state pills); zero unlabeled rows remain.
2. Truthful actions: per-state actions only (Pending/Ingesting/Ingested/Error);
   fix the Pending-bundle 403 lie (either make it deletable via okf-service or
   drop the affordance); Studio deep links.
3. Navigation + i18n: artifact ↔ repo both directions; i18n × 14; Playwright
   handles (`data-test-id` spelling per the admin surface convention).

**Verification:** zero unlabeled bundle rows in the default list; no affordance
403s; navigation works; DS primitives only.

---

## EPIC-7: Retract-retention (W7 / MR-7) — Must

**Delivers FR-006 — a DELIBERATE REVERSAL of the recorded 2026-10-12 rule.**

**Anchors:** `backing-file-service.js` (header, David 2026-10-12): retract MARKS
source documents `Retracted` (never deleted — already correct, untouched) and
hard-deletes ONLY bundle zips as regenerable-by-next-publish. D3 reverses that
bundle rule: retract = unpublish, versions stay downloadable. Repo delete =
intentional hard purge (unchanged); VersionsDialog in `editor/VersionsDialog.vue`.

**Story slices:**
1. The reversal: retract's sweep stops deleting `is_bundle` zips (its only
   deletion today); the file-header directive updated to record D3's reversal
   (a worker reading the header must not conclude the code is wrong);
   red→green sweep tests; repo delete path untouched and asserted.
2. UI verb honesty: retract vs delete named/explained in the UI (dialog copy +
   i18n × 14); VersionsDialog downloads verified post-retract.

**Verification:** retracted repo keeps every version download; delete still
purges; UI copy truthful; the header records the reversal.

---

## EPIC-8: Log purge + gate downgrade (W8 / MR-8) — Must

**Delivers FR-007.**

**Anchors:** `ingestion_log` rows keyed `concept_id`/`repo_id`, never purged;
SOURCES_NOT_RETRACTED fail-closes on hand-deleted sources.

**Story slices:**
1. Purge with 1:1 safety: on repo delete/retract, purge concept-keyed rows only
   where the key resolves 1:1 to the repo's own concepts; safety test proves no
   cross-repo rows die (clone/same-concept-id cases from
   `getConceptMetaFromAnyRepo` ambiguity).
2. Deletion-aware gate: missing source → skip + visible log line, not a
   permanent block; re-drive still works after a hand-deleted source.
3. `deletion_reason` capture (#925 split ruling, 2026-11-05): the repo delete
   flow records WHY it is being deleted (steward-provided reason, persisted on
   the tombstone/audit row); the TTL-sweep half of #925 stays parked pending
   the D3 revisit — out of scope.

**Verification:** zero concept-keyed rows survive delete/retract; gate downgrade
tested; no cross-repo deletion; a delete carries its reason (audited).

---

## EPIC-9: Concept tree browse (W9 / MR-9) — Should

**Delivers FR-008.** After EPIC-2 + EPIC-3.

**Anchors:** `_LINKS_TO` within-repo edges (source='author' + source='parser'
both walkable — `edge-service`); current-state semantics (memlog assumption);
no zip extraction (#1410 guardrails).

**Story slices:**
1. Tree-index route: lightweight, paginated concept index (id + title + tree
   shape) for the WHOLE repo — a 6k-concept repo never ships its full corpus in
   one payload (bound pinned by test); same user-bearer authz; unauthorized
   concepts excluded from the index itself.
2. UX design + modal viewer: create-ux-design pass first (D8: the viewer is a
   modal dialog — chat real estate is tight), then the citizen-facing modal
   tree/browse view from the card, rendered markdown per concept via the CAP-2
   route on demand; DS primitives only; entry affordance only on working cards.
3. Efficiency + i18n + tests: large-repo payload bounds; per-hop authz tests
   (unauthorized concepts unreachable); i18n × 14; Playwright handles swept;
   smoke harness extended; live run.

**Verification:** walk works from any working citation; EVERY concept's markdown
reachable; per-hop authz enforced; tree payload bounded at scale; current-state
semantics documented in the UI copy.

---

## Story estimate total: 22 (2+3+3+2+2+3+2+2+3)

Sequencing recommendation for the first train: EPIC-1 → EPIC-2 → EPIC-3 (the
dead-link fix chain ships end-to-end value first), then EPIC-7 + EPIC-8 (data
safety), then EPIC-4 → EPIC-5, EPIC-6 and EPIC-9 as capacity allows.
