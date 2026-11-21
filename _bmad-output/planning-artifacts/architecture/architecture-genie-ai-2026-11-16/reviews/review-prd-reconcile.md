# Review — PRD ↔ Architecture Spine Reconciliation

- **Role:** input-reconciler, architecture Finalize step
- **Date:** 2026-11-16
- **Inputs:** `_bmad-output/planning-artifacts/prds/prd-genie-ai-2026-11-16/prd.md` (status: final) + `addendum.md`; `_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md` (status: draft)
- **Method:** every FR (1–30), NFR (1–7), §9 staging row, §10 decision (D01–D05) and verification item (V02–V09) classified as **(a)** governed by an AD, **(b)** explicitly deferred in the spine, or **(c)** silent in the spine. (c) is a finding. Reverse direction checked for contradictions and premature/exceeding decisions.

## Verdict

**Findings — reconcile before S2 acceptance.** No outright contradictions between spine and PRD. The spine is strong on FG-1/FG-2/FG-3 structure (port, authorization, budgets, SSE, activation, rollback all genuinely governed). But 5 requirements or verification items are silent (2 high, 3 medium), and one FR is **bound-but-not-governed** — the worst kind of quiet drop, because the binding line (`Binds: … FR-25`) creates the appearance of coverage. Several minor thin-coverages noted.

## Table 1 — Functional requirements

| Req | Status | Where in spine / note |
|---|---|---|
| FR-1 | a | Paradigm §Port (input/result/provenance/error, versioned); AD-3 binds FR-1..FR-8 |
| FR-2 | a | AD-3 (trusted caller context, structured fields, never `search_start`) + AD-4 |
| FR-3 | a | AD-7 + Conventions §Stable source ids (`file_id`; `concept_id`+`repo_id`+`bundle_version` exact join) |
| FR-4 | a | Paradigm §Port ("cancellation + limits per operation"); mechanism in AD-6 |
| FR-5 | a/b | Port versioned (Paradigm, Conventions); versioning detail explicitly deferred to S3/V05 (§Deferred) |
| FR-6 | a | AD-1 |
| FR-7 | a (weak) | Bound only via AD-3's FR-1..FR-8 range; no rule text addresses representation neutrality → **F-10** |
| FR-8 | a | AD-10 (V02 recording + deliberate preservation, incl. query-instruction embedding prefix) |
| FR-9 | a | AD-5 (runtime seam) + `agent/` module in Structural Seed |
| FR-10 | a | AD-7 (mechanism + release-policy enum, iteration-1 `verdict-marked`). Translated-response case of the release policy unaddressed → **F-12** |
| FR-11 | a | AD-6 (everything counts, incl. auxiliary calls; end-to-end wall-clock; cancellation chain) |
| FR-12 | a | AD-4 (intersection, executor enforcement, degraded-mode honesty, no permissive fallback) |
| FR-13 | a | AD-7 last sentence (existing RAG citation components) |
| FR-14 | a | AD-8 (five event types verbatim, terminal order, translation both modes, error frames via Conventions) |
| FR-15 | a | AD-9 (one deployment-level flag, both routes) |
| FR-16 | a | AD-9 (rollout record incl. named responsible operator) + AD-12 (rollback continuity, same-shape `queries` doc) |
| FR-17 | a | AD-11 (versions in `queries` doc metadata + trace attributes, no credentials) |
| FR-18 | a | AD-11 (OTel/VL/VictoriaTraces/Grafana, `tracing.py` pattern without comps) |
| FR-19 | a (partial) | V07a carried (AD-5, Capability Map NFR-2 row); **V07b silent** → **F-5** |
| FR-20 | a | AD-1 (CI gate, config-validator pattern, first delivered stage) |
| FR-21 | a (weak) | AD-1 binds FR-21; the "explicit check at each stage gate's review" half is not carried → **F-9** |
| FR-22 | a | AD-1 ("OPEA-free claims are scoped to validated surface only") |
| FR-23 | a | AD-10 (config B = no-agent mode of same service; B/C share retrieval backend) + Capability Map FG-5 |
| FR-24 | **c** | Silent — evaluation-set composition/versioning governed nowhere, not named as deferred → **F-4** |
| FR-25 | **c** (substantive) | AD-7 *binds* FR-25 but governs only the citation half; the **prompt-injection half has no mechanism in any AD** → **F-1** |
| FR-26 | **c** | Silent → **F-4** (grouped) |
| FR-27 | **c** | Silent → **F-4** (grouped) |
| FR-28 | a (weak) | AD-4 covers retained-data ownership + cross-user/between-turns tests; the **historical-visibility product-policy sub-clause** ("recorded, not defaulted") is parked nowhere → **F-8**; V04 feed unnamed → **F-2** |
| FR-29 | **c** | Silent — no AD carries status/owner/reviewers/reconsideration triggers; no named home for ADR extraction; stray `[ADOPTED]` marker only on AD-2 → **F-3** |
| FR-30 | a | AD-8 (`agent_activity`: additive, versioned, ignored by old clients, no raw reasoning) |

## Table 2 — Non-functional requirements

| Req | Status | Where in spine / note |
|---|---|---|
| NFR-1 | a | AD-4; no-raw-AQL (okf-011) + charset validation in AD-3 |
| NFR-2 | a (weak) | Licensing + swap cost carried (Capability Map, AD-5, V07a); the **"defaults, not capabilities" audit clause** (default telemetry/cloud export before adoption — the field's documented failure mode) is not an adoption rule anywhere → **F-11** |
| NFR-3 | a | AD-6 (lane-cap admission, saturation behavior defined before S4) |
| NFR-4 | a | AD-9 (V08 rehearsal, activation flag) + AD-11 |
| NFR-5 | a | AD-8; V05 detail deferred (§Deferred D04 row) |
| NFR-6 | b | Via V09 named in §Deferred (D05 row); process item, defensible |
| NFR-7 | a | AD-5 (seam, documented boundaries + swap cost, pydantic-ai fallback exit test), AD-3 (no second authz layer); generic-platform rejection mirrored in §Deferred |

## Table 3 — §9 staging and §10 decisions / verification

| Item | Status | Where in spine / note |
|---|---|---|
| §9 S0/S1 | — | Done, evidence in PRD; not spine's concern |
| §9 S2 | — | This review is part of it; UX spec is a parallel artifact, correctly not spine content |
| §9 S3/S4 gates | a | Consistently referenced (Stack "S3 start", AD-5 "S4 entry", AD-6 "before S4"); OPEA-exit deferral mirrored in §Deferred with addendum §E pointer |
| D01 | resolved by spine | AD-2/AD-3 decide placement — legitimate owner (PRD OQ-3 assigns it to the architecture doc). But PRD says D01 is **fed by V02 and V04**; V02 is named (AD-10), **V04 is not** → **F-2** |
| D02 | a | Paradigm + AD-1 + AD-9 |
| D03 | b | Exemplary deferral: AD-5 seam holds, Deferred names the S4-entry close, V06+V07a, 2026-12-01 re-check guard carried verbatim |
| D04 | a/b | SSE half bound by AD-8; port half deferred to S3/V05. AD-8 pre-commits the verbatim five-type list before the V05 inventory → **F-13** (note) |
| D05 | b | §Deferred, fed by baseline + V09 — correctly left to the PRD-level owner |
| V02 | a | AD-10 |
| V03 | **c** | Silent — representative-baseline pinning (versions/digests reconcile) unnamed; the E01/E02 story silently depends on it → **F-7** |
| V04 | **c** | Silent — and load-bearing: AD-3's enforcement-by-construction premise ("authorized graph set already assembled by the BFF"; okf-server per-user read authority) is exactly what V04 must confirm → **F-2** |
| V05 | a/b | AD-8 + §Deferred |
| V06 | a | AD-5 + Stack (vLLM v0.29.0, REC-6 prerequisites bind V06) |
| V07a | a | AD-5 |
| V07b | **c** | Silent → **F-5** |
| V08 | a | AD-9 |
| V09 | b | §Deferred (D05 row) |

## Table 4 — Reverse direction (spine vs PRD)

| Spine element | Assessment |
|---|---|
| AD-7 release-policy enum + iteration-1 `verdict-marked` | In bounds — FR-10 explicitly delegates mechanism and release policy to architecture. But the **verdict/correction event is a second new SSE event type** that AD-8's iteration-1 list ("iteration 1: `agent_activity`") does not enumerate → **F-6** |
| AD-5 "pydantic-ai stays the designated fallback with a ≤1-day swap-in exit test" | Acceptable — quantifies NFR-7's required swap-cost evidence as a test target; does not close the D03 hypothesis |
| AD-10 asserts specific retrieval semantics (RRF k=60, label-filter OR, embedding prefix…) | Acceptable — presented as preservation targets; AD-10 itself gates on V02's formal record |
| AD-9 / Structural Seed "both venues: Swarm compose and k3s chart" | Not a venue decision (correctly left open in §Deferred §13-1); deployment shape only |
| Structural Seed security defaults (`cap_drop`, no-new-privileges, internal-only port) | Exceeds PRD text in the good direction; no conflict |
| No element contradicts a PRD requirement | Confirmed — including the fail-open window note in AD-3, which *strengthens* FR-12 |

## Findings (ranked)

**F-1 (HIGH) — FR-25 prompt-injection half: bound-but-not-governed.** AD-7 lists FR-25 in its `Binds:` line, but its rule text covers citation verification only. The requirement that the agent must not follow instructions originating from retrieved documents/tool outputs, and that a steering document counts as a finding, has **no structural mechanism in any AD** (no instruction-origin/tainted-data treatment in AD-5's tool interface, AD-6's orchestrator, or AD-4's executor) and no deferral entry. The binding line masks the gap. *Fix:* either add the mechanism (e.g., in AD-5: tool outputs and retrieved text enter the model as data, never in a system/instruction position; injection scenarios wired into the eval harness per FR-25), or add an explicit §Deferred row naming the owner. Do not leave FR-25 cited under AD-7.

**F-2 (HIGH) — V04 silent while AD-3/AD-4 stand on it.** PRD feeds D01 and FR-28 from V04 (map effective authorization/provenance/ownership, incl. OKF amendments; required before contract acceptance). The spine names V02, V05, V06, V07a, V08, V09 — never V04. AD-3's core premise ("trusted caller context … already assembled by the BFF"; okf-server as per-user read authority via the servingReads family) and AD-4's executor model are exactly what V04 exists to confirm. If V04 disagrees, AD-3's enforcement-by-construction wobbles and the spine has no named hook to notice. *Fix:* name V04 in AD-3 (and AD-4) as the confirmation gate before contract acceptance, with an explicit "AD-3 revisited if V04 differs" trigger; add V04 to the spine's verification mentions.

**F-3 (MEDIUM) — FR-29 (ADR discipline) ungoverned and unmirrored.** The spine's ADs carry Binds/Prevents/Rule but no status, date, owner, reviewers, or reconsideration triggers; nothing says where/when FR-29's traceability chain and record fields get applied (ADR extraction step? canonical home?). Only AD-2 carries a stray `[ADOPTED]` marker — inconsistent with every other AD and with FR-29's status vocabulary. *Fix:* one spine line committing the ADs to ADR extraction with FR-29's field set (or per-AD frontmatter fields), plus drop or generalize the AD-2 marker.

**F-4 (MEDIUM) — FG-5 protocol requirements FR-24/FR-26/FR-27 neither governed nor deferred.** The spine governs the evaluation *configurations* (AD-10, AD-2 no-agent mode) but says nothing about evaluation-set composition and versioning (FR-24: answerable/unanswerable, citation checks, representative languages, restricted/public, failure/cancellation; tuning-set separation), known-defect recording (FR-26), or separate-dimension reporting with uncontrolled-difference identification (FR-27). No §Deferred entry names an owner or downstream doc. *Fix:* add a §Deferred row ("evaluation-protocol design → evaluation design doc / S3–S4 owner") or extend the Capability Map FG-5 row; currently FR-25's eval half and CM-1/CM-2 also implicitly live there.

**F-5 (MEDIUM) — V07b (FR-19 tier 2) silent.** Pre-release license and redistribution assessment (transitive/optional deps, images, binaries, models, notices, disclosures) is unmentioned; only V07a (pre-adoption, gates D03) is carried. Since the spine pins concrete adoptions (openai SDK, ArangoDB driver, TEI client, FastAPI, and eventually the runtime), the pre-release tier is the one that sweeps them. *Fix:* name V07b alongside V07a in §Deferred or the NFR-2 row.

**F-6 (MEDIUM-LOW) — AD-7/AD-8 disagree on the iteration-1 SSE event surface.** AD-7's `verdict-marked` policy streams "verdict + explicit correction event on failure"; AD-8 enumerates iteration-1 new event types as only `agent_activity`. Either the correction event is a second additive type AD-8 must list (with its versioning + local-run-set pinning per AD-8's own rule), or it rides existing frames — the spine must say which. *Fix:* one sentence in AD-8 reconciling the two.

**F-7 (LOW) — V03 silent.** The representative baseline (deployed versions/digests reconcile with source) anchors E01/E02; the spine's evaluation story never names it. *Fix:* mention V03 in AD-10 or §Deferred (baseline pinned before E01/E02).

**F-8 (LOW) — FR-28 historical-visibility product-policy clause parked nowhere.** "Historical visibility of earlier answers after a source is revoked is an explicit product-policy decision (recorded, not defaulted)" — no spine element records it as an open product-policy item. *Fix:* add to §Deferred as an open product-policy decision.

**F-9 (LOW) — FR-21's stage-gate-review check uncarried.** FR-21 verification = CI audit **plus an explicit check at each stage gate's review**; AD-1 carries only the CI gate. *Fix:* one line in AD-1 or the stage-gate convention.

**F-10 (LOW) — FR-7 representation-neutrality bound only by range.** Covered nominally by AD-3's "FR-1..FR-8" bind, but no rule text says the contract surface must not carry OPEA-derived types/representations. Low risk (contract is fresh code), cheap to make explicit. *Fix:* one clause in AD-3.

**F-11 (LOW) — NFR-2 "defaults, not capabilities" audit clause not an adoption rule.** The spine carries licensing (V07a) and swap-cost (AD-5) but not the default-telemetry/default-cloud-export audit the PRD makes mandatory before adoption — the exact failure mode the PRD cites (runtime exporting traces keyed on the same credential). *Fix:* add to the NFR-2/Capability-Map row or the Stack's adoption note.

**F-12 (LOW) — FR-10 release policy, translated-response case unaddressed.** The PRD names "partial and translated responses" as release-policy cases; AD-7 defines correction semantics for the monolingual stream and AD-8 translation-frame compatibility, but their interplay (correction event vs translated chunks, `done.translationFailed`) is unspecified. *Fix:* one sentence in AD-7 or AD-8.

**F-13 (NOTE) — AD-8 pre-commits the verbatim five-type contract before V05.** The enumeration is asserted from code study; V05 remains the PRD's designated inventory authority. *Fix:* add "confirmed by V05" to AD-8 so a V05 discrepancy has a named reconciliation path.

## Summary counts

- FR-1..FR-30: 23 governed (a, incl. 4 weak), 2 hybrid a/b, **5 silent (c)** (FR-24, FR-25 substantive half, FR-26, FR-27, FR-29)
- NFR-1..7: 5 governed (1 weak), 2 deferred (b)
- §10: D01 resolved (with V04 gap), D02/D03/D04/D05 correctly handled; V-items: 5 governed, 2 deferred, **3 silent (V03, V04, V07b)**
- Reverse direction: 0 contradictions; 1 internal spine inconsistency (F-6); 1 premature-closure note (F-13)

Neither document was modified by this review.
