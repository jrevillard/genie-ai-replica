# Reconciliation — issue #1729 framing vs PRD + addendum

Source: GitLab issue #1729 (framing, rescoped 2026-11-16), fetched 2026-11-16.
Compared against: `prd.md` and `addendum.md` in this folder.

## Verdict

**Substantively faithful, with five gaps.** All twelve requirements (R01–R12),
all decisions (D01–D05), the full verification backlog (V02–V09, V07
deliberately split into V07a/V07b), staging S0–S4, the E01/E02 protocol core,
the OPEA-component definition and the deferred-exit carry-over are present,
several strengthened (FR-11 counting semantics, FR-19 two-tier licensing,
FR-28 retained-data authorization, FR-25 prompt-injection scenarios). What the
PRD structure silently dropped is (a) the framing's §12 documentation and
decision-tracking discipline — dropped entirely, not weakened — and (b) four
qualitative or composition directives: evaluation-set composition, the
"fallback must not conceal inadequate evidence" half of a must-never, rollout
record accountability fields, and the retrieval-strategy guard on removing
embeddings/vector indexes.

## Gaps

### 1. §12 "Documentation and decision tracking" — dropped entirely (largest gap)

Framing: "Use this traceability chain: `Use case → requirement → decision →
investigation/story → merge request → validation evidence → released
version`"; every structural decision record must contain status/date/owner/
reviewers, problem/constraints/alternatives, decision + evidence,
consequences and replacement costs, reconsideration triggers, links; use
`Proposed/Accepted/Rejected/Superseded` and "Preserve superseded decisions
with links to their successors"; "Review existing ADRs and amendments before
relying on them. For example, the inspected `okf-034` file is still marked
`Proposed`; it must not be silently treated as accepted"; "Maintain one
canonical home for each document. Link rather than duplicate specifications";
"actual tracking configuration must be checked before applying it to this
initiative"; "Internal Intel evidence may be referenced with appropriate
access controls."

Also carries §2's operator direction "Record decisions and their supporting
evidence" — the only §2 direction with no PRD trace (verified: no
occurrence of "traceability", "decision record", "okf-034" or "canonical
home" in prd.md or addendum.md).

Where it should live: a short governance requirement in the PRD (FG-4 or an
NFR row: "structural decisions are recorded as ADRs with the framing §12
fields; the traceability chain is maintained; existing ADRs are
status-checked before reliance") — or, if judged repo process rather than
product requirement, an explicit "deliberately dropped: owned by the repo's
ADR/process conventions" line in the addendum. Either is acceptable; silence
is not.

### 2. Evaluation-set composition list — weakened

Framing §10: "Include answerable and unanswerable questions, citation checks,
representative languages, restricted/public access, failures and
cancellation."

PRD FR-24/FR-25/FR-27 keep versioning, tuning/assessment separation,
authorization scenarios and prompt injection, but never state the composition
of the set: **unanswerable questions** (implied only via the abstention
counter-metric), **citation checks** (reference-validity criteria live inside
FR-10 for the product, not as evaluation cases), **representative languages**
(verified absent — despite GENIE being multilingual and FR-14 making
translation an explicit compatibility surface), and **failure and
cancellation cases** as evaluation material.

Where it should live: one sentence added to FR-24 (or a new FR under FG-5)
restating the composition list, languages included.

### 3. "Availability fallback … must not … silently conceal inadequate evidence" — half a must-never dropped

Framing §11: "Availability fallback must not bypass authorization or silently
conceal inadequate evidence."

PRD FR-12 preserves the first half (authorization errors never trigger a more
permissive fallback). The second half — a degraded/fallback path must not
mask insufficiency as a confident answer — appears nowhere (verified). This
is exactly the kind of qualitative posture the FR structure loses: it governs
degradation behaviour under outage, not the happy-path authorization model.

Where it should live: FG-2 or FG-3 (extend FR-10's insufficiency handling to
degraded modes), or an NFR row.

### 4. Rollout-record accountability fields — partially dropped

Framing §11: each rollout record must identify "Selected consumers and
capabilities", "Artifact/configuration versions", activation and rollback
procedures, in-flight treatment, "**Rollback triggers and the responsible
operator**", and rehearsal evidence.

PRD FR-16 covers the mechanics thoroughly (in-flight requests, partial
responses, persisted conversations, rehearsal, acceptance scenario) and FR-17
covers versions — but the named **rollback triggers**, the **responsible
operator** and the rollout-record artifact itself are gone. On a shared
deployment this is the difference between "rollback is possible" and
"someone specific pulls the trigger when X happens".

Where it should live: extend FR-16 (or NFR-4) with the rollout-record field
list, triggers and named operator included.

### 5. Retrieval-strategy note — future-decision guard dropped

Framing NOTE: "Removing embeddings or vector indexes is not an accepted
decision. It requires evidence on answer quality, retrieval coverage,
citations, latency, resource consumption and operational complexity." Also:
"a subsequent controlled experiment may compare lexical, vector, structural
and hybrid retrieval … using the same GENIE corpus, authorization rules and
evaluation protocol."

Iteration-1 preservation is covered (non-goal §4.2, FR-23 held-fixed corpus,
V02). But the **guard against a future removal decision** (not accepted
without six-dimension evidence — a direct firewall against the Medium
article's thesis leaking into iteration 2+) and the **follow-up retrieval
experiment option** are recorded nowhere (verified). The PRD's query-class
note keeps only the agentic-benefit half of the hypothesis framing.

Where it should live: addendum — a short "retrieval-strategy guard" entry
beside §E, mirroring how the deferred OPEA-exit carry-over was preserved. The
Medium-article caution ("published results must not be assumed to transfer")
is adequately generalized by the PRD's hypotheses-pending-E02 posture.

## Verified covered (checked and present)

- **R01→FR-20** (strengthened: enforced from first delivered stage, CI
  verification); **R02→FR-7**; **R03→FR-12**; **R04→FR-12** (public/restricted
  + no more-permissive fallback); **R05→FR-3/FR-13**; **R06→FR-14** (incl.
  translation, SSE, versioning); **R07→FR-11** (strengthened: counting
  semantics, end-to-end deadline, tested cancellation); **R08→FR-17**;
  **R09→FR-15**; **R10→FR-16 + V08** (data-changing recovery clause kept);
  **R11→FR-19** (V07 split into pre-adoption/pre-release tiers — documented
  strengthening); **R12→FR-22**.
- **"Absence of thresholds blocks promotion, not hidden behind defaults"** →
  PRD §8 posture, operator-confirmed.
- **V02–V09** all present in §10 backlog with roles and required-before
  gates; V09 carries the ADR-0001 suspended-E2E caveat (also NFR-6, §11).
- **D01–D05** present in §10; the framing §8 tail (no generic multi-engine
  platform, transparent cross-engine migration not an established capability)
  → NFR-7 + addendum §A.
- **E01/E02** → FR-23 (sharpened to three configurations A/B/C — documented
  research-driven change, not a drop); versioning FR-24; separate
  tuning/assessment sets FR-24; authorization scenarios FR-25; known-defects
  rule FR-26; separate reporting + uncontrolled differences FR-27;
  thresholds post-baseline §8; "evaluation may justify retaining a fixed path
  for some requests" → §4.1 query-class note.
- **Staging S0–S4** → §9; deferred OPEA-exit carry-over (E03, V01, inventory,
  data-transition, ingestion-writer) → addendum §E; "must not add new OPEA
  coupling" → FR-21.
- **OPEA-component definition + F05 basis** → PRD §5 + addendum §B; F03
  (ChatQnA not reusable) embodied in FR-6; F09 developer-preview posture →
  NFR-2 + §11 risk; F10 (journaling ≠ resumable workflows) → addendum §A;
  F01 Apache-2.0 → NFR-2; F07 no-raw-AQL → NFR-1.
- **SC-01 inclusions/exclusions** → §4.1/§4.2, including the "scope review,
  not permanent limits" sentence; session/audit persistence in scope;
  boundary-not-microservice + reuse-existing-authorities → FG-1 preamble and
  NFR-7.
- **Evidence categories (§1)** → addendum §C; operator directions (§2)
  otherwise all placed (DSH plugin-architecture motivation → D03 + addendum
  §D; reversibility → NFR-7; BMAD process → followed).

Minor observations, below gap threshold (recorded, no action demanded):
F06 (OPEA contract-test suite as a V02 input) is not named as a source for
V02; F08 (MRs 279/280 closed unmerged) is historical context not carried;
F02's internal-vs-published documentation distinction is enforced by repo
CLAUDE.md rather than the PRD.
