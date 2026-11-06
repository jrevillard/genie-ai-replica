# Issue Triage Policy — Agent Instructions

Policy layer above `ISSUE-LABELS.md` (the `status::*` lifecycle). That file
owns state transitions; this file owns **classification** (the label axes),
the **backlog→ready-for-dev bridge**, the **staleness/closing rules**, and the
**cluster sweep protocol** used to process legacy mass.

**Measure before each sweep** (see Measurement): open counts, unlabeled
share, per-label census, inactivity percentiles. The label axes below exist
because generations of conventions currently coexist (`bug`/`BUG`/`bugfix`
are three labels for one concept; `area::*` competes with unprefixed
component labels; `P0`–`P3`/`BLOCKER`/`p2-medium` float without a single
home).

## Label axes

Four orthogonal axes, two managed namespaces, one legacy numbered family to
strip. An issue carries **at most one value per axis**. A label outside the
canonical sets below is legacy: the sweep maps it or removes it.

| Axis | Canonical values | Role |
|---|---|---|
| `status::*` | see `ISSUE-LABELS.md` | State — the lifecycle. Workers set `status::backlog` once at creation (plus `status::awaiting-operator` for a live blocker — their one other legal move, see `ISSUE-LABELS.md`); the orchestrator owns every later move. |
| `type::*` | `type::bug`, `type::enhancement`, `type::chore`, `type::task` | What kind of work this is. |
| `area::*` | `area::backend`, `area::frontend`, `area::mobile`, `area::doc-repo`, `area::chatqna`, `area::dataprep`, `area::retriever`, `area::reranker`, `area::embedding`, `area::tei`, `area::deploy`, `area::gateway`, `area::ci`, `area::testing`, `area::docs`, `area::security`, `area::okf`, `area::admin`, `area::i18n` | Which component. One per issue; cross-component issues take the primary one. |
| `priority::` | `priority::high` — that is the whole set | Ordering signal for the ready-for-dev queue. Absence = normal. **Never applied by automation** — the highest-consequence axis stays human: at low confidence, apply no priority and let the state label speak. |
| `prd::*`, `okf-server::epic-*`, `type::story`, `type::epic` | managed by the BMAD issue-tracking flows | Initiative/story bookkeeping — `type::story` and `type::epic` are BMAD artifacts, not triage types. Out of sweep scope — never hand-edited. An issue carrying any BMAD-namespace label is a managed artifact: the sweep skips it entirely — no re-classification, no label moves. |
| `report::*` | `report::triage` — triage-run report artifacts | The durable sink for an unattended sweep's report: the full report lives in an issue **created closed** (a report is not a work item), the coordination board carries the one-line index. Out of sweep scope like the BMAD namespaces — never classified, never labelled. The local `.claude/state/triage/*.md` copy is scratch, not the source of truth. |
| `board::*` | `board::coordination` — coordination surfaces (the board, the work plan) | A coordination surface is **not a work item**: it is never a sweep target, never classified, never closed (the board is titled *do not close*). It carries **no `status::*` label on purpose** — an `in-progress` label would pollute the census the orchestrator scans to detect a worker's active claim. The skip is what protects it: a default sweep selects the open issues that carry no `status::*` label, and a coordination surface without one would be selected. |
| `1.*`–`4.*` numbered | legacy phase-plan labels | Not part of the taxonomy. The sweep strips them from open issues. |

### Legacy mapping (applied by the sweep)

A mapping row means: on every issue carrying the legacy label, replace it
with the target (add canonical + remove legacy in the same request). A legacy
label whose definition is left with zero open issues at the end of a sweep is
deleted from the tracker. If the issue already carries a canonical value on
that axis, the mapping does not add a second — the canonical value wins.
**Namespace labels are never deletion candidates** — `report::triage` in
particular is carried only by closed issues, so "zero OPEN issues" is its
normal state, not a sign of obsolescence.

| Legacy label | Action |
|---|---|
| `BUG`, `bugfix` | → `type::bug` |
| `bug` | → `type::bug` |
| `ENHANCEMENT` | → `type::enhancement` |
| `chore` | → `type::chore` |
| `P0`, `P1`, `BLOCKER`, `P2` | → `priority::high` |
| `P3`, `p2-medium`, `p3-low`, `priority::medium` | remove — absence means normal priority |
| `backend` | → `area::backend` |
| `frontend` | → `area::frontend` |
| `chatqna` | → `area::chatqna` |
| `CI/CD`, `ci` | → `area::ci` |
| `api-gateway` | → `area::gateway` |
| `ansible` | → `area::deploy` |
| `e2e` | → `area::testing` |
| `mobile` | → `area::mobile` |
| `security` | → `area::security` |
| `dataprep` | → `area::dataprep` |
| `doc-repo` | → `area::doc-repo` |
| `docs` | → `area::docs` |
| `admin` | → `area::admin` |
| `i18n` | → `area::i18n` |
| `okf` | → `area::okf` |
| `area::retrieval` | → `area::retriever` |
| `backlog` (bare) | remove — legacy duplicate of `status::backlog` |
| `epic::*`, `Epic::*`, `type::prd`, `type::retrospective` | namespace lookalikes — legacy: neither canonical nor managed; sweep judges per issue |
| Floaters (`campaign`, `branding`, `cleanup`, `dora-rework`, …) | Sweep judges per issue: map to an axis value or remove |

## The backlog→ready-for-dev bridge

`status::backlog` is the intake queue; `status::ready-for-dev` is what the
orchestrator dispatches from. An issue leaves `backlog` only when it has:

1. `status::ready-for-dev` set (removing `status::backlog` in the same
   request, per `ISSUE-LABELS.md` rule 1);
2. one `type::*` and one `area::*`;
3. a **verified premise** — the problem was reproduced against the shipped
   configuration (code, compose, env, ansible) before promotion. An issue
   that fails verification gets `status::deferred` with the reason in a
   comment (revisit or reject later); an already-fixed problem closes with
   the fixing MR referenced. `status::wont-fix` — the judgment close —
   stays with the operator, per `ISSUE-LABELS.md`.

Promotion happens in batch during sweeps. Workers never promote.

## Staleness and closing

- The only auto-close candidate is `status::awaiting-operator` inert past the
  sweep's stated threshold (default 30 days) — the operator never answered.
  **Nothing else closes automatically**: never an issue waiting on the
  project side (`in-progress`, `review`).
- Every close carries a reason and the reopen path in the closing comment.
- The first sweep pass runs dry-run: candidates listed, nothing closed — the
  blast radius is known before anything fires.

## Cluster sweep protocol

Used to process legacy mass (issues without any `status::` label) and to
refresh the queue periodically. Run by the orchestrator. **The budget is
fixed before the sweep starts** — batches of 25–40 issues, batch count set up
front; leftover issues stay for the next sweep. Triage schedules work; it is
not the work. Canonical labels that do not exist on the tracker yet (e.g.
`area::reranker`, `area::embedding`) are created before the first assignment
— the API rejects unknown labels. Issues carrying legacy labels remain valid
until swept; nothing is renamed ahead of the sweep.

1. **Classify** — set `type::*` + `area::*` + `status::*`; strip obsolete
   labels per the mapping table.
2. **Deduplicate** — confirmed duplicates get a cross-link and close as
   duplicate pointing at the surviving issue. Mechanical closes (duplicate,
   shipped-with-evidence) execute **only after adversarial verification**:
   three independent refuter lenses — correctness, completeness, evidence —
   each a fresh-context agent prompted to refute; a close survives only
   unanimously, and any refutation routes the issue to the operator queue
   with the refutation quoted. This is the only close that may happen during
   a classification pass; judgment closes stay with the operator.
3. **Promote** — issues meeting the bridge criteria move to
   `status::ready-for-dev`.
4. **Report** — before/after metrics: unlabeled share, ready-for-dev depth,
   p90 age. Target: unlabeled below 10 % of open issues.

Collision discipline, claim notes and label mechanics remain those of
`ISSUE-LABELS.md`.

## Roles

Unchanged from `ISSUE-LABELS.md`: the orchestrator runs sweeps and owns label
moves; workers only set `status::backlog` at creation (plus
`status::awaiting-operator` for a live blocker — their one other legal move);
the operator makes the close/wont-fix decisions. Security reports never enter
this pipeline — they follow the CVE remediation playbook
(`.claude/rules/CVE-REMEDIATION.md`, `docs/security/`).

## Measurement

Re-run the baseline (issue counts, per-label census, inactivity percentiles)
before each sweep, and monthly for the first quarter. Never read a count
alone: a falling median age with a rising close rate may mean bankruptcy, not
progress — pair it with ready-for-dev depth and promoted-per-sweep.

Reference: the coordination board is #1216; the post-train work plan is
#1367.
