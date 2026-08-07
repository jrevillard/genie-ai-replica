# PRD Quality Review — OPEA 1.3 → 1.5 Upgrade

## Overall verdict

This is a strong, decision-ready PRD: a single, well-argued thesis ("same GENIE, current foundation," §1), honestly-drawn trade-offs, and unusually concrete done-ness — behavioral assertions for monkeypatches, red-green contract tests against real `comps`, a baseline-diff CVE gate, and a rehearsed rollback. The risks are at the margins, not the core: a cluster of acceptance *values* deliberately deferred to execution (parity tolerance, canary thresholds, FR-19's enumerated list), one internal inconsistency a reader cannot resolve (does the translation service ride the 1.5 bump?), and downstream traceability gaps (10 of 19 FRs without a validating SM; FR-14..18 stranded under a missing §4.5 heading). None of these block approval; the translation question should be resolved before build and the deferred values + traceability before story creation.

## Decision-readiness — strong

The PRD states decisions as decisions and names what was given up. The `schedule()` kwargs-forwarding check is a blocking pre-rebase gate with a named contingency ("if it fails, the chatqna rebase approach is re-planned," FR-6, §6.1-b); the CVE gate is a defined policy, not a raw count — "a **diff against the v1.3 baseline advisory** — same scanner version, same severity taxonomy, with an accept-list," gate "no net-new high/critical" (FR-12); rollback is "proven, not asserted" with a backward-read rehearsal on the same ArangoDB (FR-17); and the addendum records four rejected alternatives with reasons (wait for v1.6 — verified nonexistent; adopt agentic — directive; refactor the monolith — rebase≠refactor; migrate to pip-install — incompatible with the clone+overlay mechanism). The Open Questions are genuinely open — OQ-2 (langchain-arangodb version), OQ-3 (pinned corpus), OQ-4 (canary threshold values), OQ-6 (the uncomfortable `RERANKER_TOP_N` docs-vs-code drift, surfaced rather than smoothed) — and the ones that *were* real decision forks have been converted into milestones rather than left open (OQ-1 → the §6.1-b spike). Trade-offs name what was given up: FR-2 explicitly declines "bit-identical" as the contract and admits the `langchain-arangodb` bump "may **improve**" the label-filter defect; FR-4 retires the local lock machinery in exchange for OPEA's compiled lock.

What is missing at approval time: there is no consolidated risk register and no rough effort/size estimate. OQ-5 defers "ownership and sprint allocation to be confirmed," so a decision-maker greenlighting this at launch level cannot size the program or see the top risks in one place.

### Findings
- **[medium]** No consolidated risk register or rough size at launch approval (§10 OQ-5) — risk is distributed across FR consequences and Open Questions; the reader cannot see the top-5 risk surface or the rough effort in one view. *Fix:* add a short risk + sizing subsection (top risks with probability/impact; a rough effort/sequencing estimate), or explicitly state the PRD defers sizing to epics.

## Substance over theater — strong

No persona theater: exactly two UJs (UJ-1 Jerome, UJ-2 deployer), both load-bearing — UJ-1 drives FR-1..13/19, UJ-2 drives FR-14..18 — and each of the four JTBD roles is realized by an FR (security → FR-12; deployer/ops → FR-14..18). No innovation theater: the Vision is explicit that this is "not 'new features'" and the goal is "same GENIE, current foundation"; §1 is specific to the point of un-swappability (pin v1.3 dated 2025-05-14, drift of "7.5 months," "~2,560-line chatqna orchestrator," slot-24 `ServiceType` re-append). NFRs are largely earned: SBOM + signed images per ADR-0001 (NFR-S1), no `:latest` (NFR-C2), no net-new high/critical (NFR-S2), zero-config rollback (NFR-R2), compose changes limited (NFR-C3) — all concrete or cross-referenced to concrete FRs.

One residue of boilerplate: NFR-R1's "under load" is the only threshold-free claim in the NFR set, and NFR-P1/P2 lean on "within documented tolerance" where the documentation (the FR-11 baseline variance) does not exist yet.

### Findings
- **[low]** NFR-R1 "under load" unanchored (§8) — "retrieval/ingest must not regress under load" has no load model or concurrency figure anywhere in the PRD, unlike every other NFR which carries a bound or a cross-ref. *Fix:* pin a load reference (e.g., the RAG-benchmarks harness concurrency) or fold the load check explicitly into FR-11's evaluation.

## Strategic coherence — strong

The PRD has a thesis and every feature serves it. The thesis — upgrade to stop the drift/CVE accrual and become the base for the agentic roadmap — is protected by the counter-metrics: SM-C4 caps the coupling surface "so the *next* upgrade is cheaper, not harder," SM-C1 rejects drift beyond v1.5 ("the target is 1.5, not latest-everything"), SM-C2 refuses to trade quality proof for green CI, SM-C3 refuses to game the scanner. Features form one arc: rebase (FR-1..9) → quality gates (FR-10..13, FR-19) → rollout safety (FR-14..18). Success metrics validate the thesis rather than measuring activity — SM-2 (parity), SM-3 (CVE posture), SM-4 (zero silent breaks) are each the *opposite* of vanity metrics. MVP scope kind is platform and the scope logic matches: §6.1 sequences baseline capture → spike → independent cleanup commit → green-on-v1.3 tests → incremental per-module rebase ("retriever → reranker → dataprep → chatqna last, not an atomic 4-way bump"). The only wrinkle is FR-15, admitted to be "independent of the OPEA bump (per review)" yet carried in-scope — defensible (split-brain rationale) and honestly disclosed, but it is adjacent scope riding this PRD.

No findings needed here; the FR-15 point is covered under Scope honesty.

## Done-ness clarity — strong

This is where the PRD is at its best, and where I was asked to be unforgiving. Nearly every FR carries at least one testable consequence; the highest-risk ones are specified to the point of executability. FR-6 demands a "**behavioral assertion**" per monkeypatch ("silent no-op patches are the failure class to catch") and enumerates 10 named coupling surfaces; FR-10 defines four concrete contract tests (orchestrator wire, one-doc ingest, focused label-filter, telemetry) run against real `comps@v1.5` with HTTP-mocked endpoints, with red-green validation ("written green against v1.3, then re-run against a bare v1.5 bump *before* re-grafting to prove they go red on the real break"); FR-11 specifies the parity method ("tolerance is **derived from the baseline's own run-to-run variance**, not a guess," validated "against existing stored embeddings and existing graph data"); FR-17 makes rollback falsifiable (v1.3 must backward-read v1.5-written data on the same ArangoDB). I found no "system handles X gracefully," "reasonable performance," or "user-friendly" anywhere.

The one honest gap is a cluster of *values* deliberately deferred: FR-11's tolerance number (correctly deferred to the baseline milestone), FR-16's canary exit "error-rate/latency thresholds" (shape fixed, no values), FR-19's enumerated improvements (the named list is "finalized there" during execution, OQ-8), and OQ-2's exact `langchain-arangodb` version. Each is method-defined but value-open at approval time.

### Findings
- **[medium]** Deferred acceptance values cluster (FR-11, FR-16, FR-19, OQ-2) — three FRs' definition of done depends on numbers/lists that do not yet exist: FR-16's "error-rate/latency thresholds" appear nowhere; FR-19's "a named fix is confirmed shipped" requires a list only finalized during execution; OQ-2's version is open. *Fix:* for FR-16 and FR-19, commit to concrete values/lists (or a date by which they are fixed) before green-light, so story creation is not blocked; keep FR-11 as-is since the baseline milestone legitimately produces the number.

## Scope honesty — strong

Non-goals do real work (§5): not agentic, not OKF/SST, not 1.6+ (verified nonexistent), not a K8s migration, not a feature backport, and the explicit "no per-CVE acceptance is tracked." The addendum records four rejected alternatives with reasons. `[ASSUMPTION]` tags sit on the genuinely-inferred items and all round-trip to §11. The awkward truth is surfaced: OQ-6 admits the `RERANKER_TOP_N` docs-vs-code drift (docs 3 vs code 2/1) "doubles as a parity-baseline ambiguity (deployed vs documented v1.3 behavior)." FR-15's independence is disclosed, not hidden.

The real problem is an inconsistency the reader cannot resolve: FR-6's kwargs contract delivers to "the retriever/reranker/**translator** alignment," yet translation appears nowhere in the rebase surface (§9 lists only chatqna/dataprep/retriever/reranker/core/build-patches) nor among UJ-2's six image tags (chatqna/dataprep/retriever/reranker/embedding/textgen), while ENVIRONMENT.md records a separate "Translation | 9031" OPEA/AI internal service. A reader cannot tell whether translation rides the 1.5 bump (and if so, why it is excluded from §9) or intentionally stays on v1.3 (which would reintroduce exactly the split-brain FR-15 exists to prevent).

### Findings
- **[high]** Translation-service surface ambiguous and internally inconsistent (FR-6 vs §9 vs UJ-2) — FR-6 names the translator as a recipient of the six forwarded custom kwargs, but §9 excludes translation from the rebase surface and UJ-2 lists six rollout images with no translation image, while the deployment reference (ENVIRONMENT.md) records a separate OPEA/AI "Translation | 9031" service. If translation is an OPEA-overlay service, the upgrade scope silently omits a seventh fleet service; if it is not, the PRD should say so. *Fix:* state translation's OPEA/overlay status explicitly in §9 and UJ-2, and reconcile with FR-6's "translator alignment" wording.

## Downstream usability — adequate

The raw material is there: Glossary present and used; FR/SM IDs contiguous and unique (FR-1..19 all appear, SM-1..7, SM-C1..4); the Assumptions Index round-trips cleanly (all 5 inline `[ASSUMPTION]` tags indexed, all index entries appear inline). But the traceability to stories is weaker than the rest of the PRD. Ten of 19 FRs have no validating SM — SM-1..7 map only {FR-1,4,6,10,11,12,16,17,19} — leaving FR-2,3,5,7,8,9,13,14,15,18 unmapped; several are implicitly covered (FR-3 by SM-1's build, FR-14/15/18 by SM-5's canary/rollback) but the mapping never says so. Structurally, the fifth feature (latent bugs/rollout, FR-14..18) has no `### 4.5` heading — it is introduced by a bare bold "**Description:**" line after FR-19, and FR-19 sits inside §4.4 ahead of FR-14..18. Terminology drifts in a few places (details in Mechanical notes).

### Findings
- **[medium]** 10 of 19 FRs lack a validating SM (FR-2,3,5,7,8,9,13,14,15,18) — SM-1..7 validate only {1,4,6,10,11,12,16,17,19}; downstream story traceability cannot link the verification FRs (FR-7,8,9), the latent-bug FR-14, or FR-15/18 to any success measure. *Fix:* extend the SM table's "Validates FR-x" column (or add a coverage note) so every FR maps to a gate, even a shared one.
- **[medium]** Missing §4.5 heading; FR-19 out of sequence — the fifth feature (FR-14..18) is introduced by a bare "**Description:**" with no `### 4.5` header, and FR-19 appears inside §4.4 (Quality gates) before FR-14..18. *Fix:* add the `### 4.5` header with a feature title and move FR-19 to its natural numeric slot (or renumber).

## Shape fit — strong

The capability-spec shape fits this internal platform upgrade correctly. Two lightweight UJs (not six), both driving FRs — right for a single-operator-role platform; SMs are operational (build, parity, CVE, canary) rather than user-facing, which is the correct shape. Brownfield discipline is strong: existing-code references are precise and checkable (`genieai_dataprep_microservice.py:292`, `genieai_dataprep_arangodb.py:1287`, `chatqna:1240`, `_parent_mod.ARANGO_DB_NAME`, `fix_dependencies.sh`/`REQ_PATH`), new vs existing work is distinguished (UJ-1's pre-rebase cleanup is an "independently-tested v1.3 commit" so "a post-rebase regression has one variable, not two"), and the addendum correctly pushes mechanism context (rejected alternatives, the overlay vector map) downstream to architecture. The PRD is a chain node feeding architecture → epics/stories, which is exactly why dimension 6's traceability gaps matter and why the §4.5 heading sloppiness is worth fixing before that handoff.

No findings needed — the shape is right; the follow-through is covered in dimension 6.

## Mechanical notes

- **Broken cross-ref in §0:** "assumptions are tagged inline ... and indexed in **§10**" — the Assumptions Index is **§11** (Open Questions is §10).
- **Broken cross-ref in §0:** the verification research is said to be "referenced in §9," but §9 (Integration and Dependencies) does not mention `opear15-upgrade-verification-review-2026-08-07.md`; it appears only in §0's Key inputs and the addendum.
- **Attributed-but-unstated gate:** §6.2 and §11 point to a "re-check v1.5 is still latest" gate as "(FR-1 gate)", but FR-1's body does not state that gate — the re-check lives only in the assumption and §6.2.
- **Glossary drift — "smoke test":** Glossary defines it as "import-only test," while FR-10/§6.1 use it alongside real-`comps` contract tests ("Contract + smoke tests written green on v1.3"); the Glossary's narrow definition will mislead a story-creation reader.
- **Glossary drift — "8-kwargs":** FR-6 consequence says "The **8-kwargs** `schedule()` contract delivers all six custom kwargs" — reconcilable as 2 positional + 6 custom, but the Glossary never defines "8-kwargs" and the phrase reads as a contradiction.
- **UJ protagonist naming:** UJ-1 has "Jerome"; UJ-2's protagonist is an unnamed "deployment engineer" (covered as a low finding in dimension 6).
- **Front-matter vs UJ-1 branch mismatch (trivial):** front matter `branch: feat/opea-1.5-upgrade/prd` vs UJ-1 entry state "on `feat/opea-1.5-upgrade`".
- **Assumptions Index roundtrip:** clean — all 5 inline `[ASSUMPTION]` tags appear in §11 and every §11 entry appears inline.
