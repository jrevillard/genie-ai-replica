---
title: "Testing Lab"
description: "Testing an OKF repository's routing before it serves — the vectorized head, one-off queries, suites and analytics, the advisor, and RAGAS benchmarks."
weight: 16
---

Publishing mints a version and builds the repository's **vectorized head** — the
embedding of its frontmatter tags. At query time the retriever fans out across
the caller's authorized repositories, weighting each by how well the query
matches its head. The **Testing Lab** is where you test that routing *before*
the repository serves, and cycle until it routes the way you intend: test,
adjust tags, rebuild the head, re-test — without ever leaving the dialog.

You open the Lab from a dashboard card (**Testing Lab**), the editor's action
row, the editor's right-rail head badge, or wizard step 10 (**Secure and
Finish** — view and test only there; the wizard never mutates a repository).

The dialog has four tabs: **Head**, **Test**, **Suites & analytics**, and
**RAGAS Benchmarks**. A badge in the header states the head's status at a
glance — *head ready*, *head stale*, or *no head*.

## The Head tab

The head is stored per tag field and shown as chips — topics, forbidden tags,
entities, keywords — with its dimensions, embedding model, head version and
computation time. If tags changed after the head was built, the badge flips to
*head stale* with the note: "Tags changed after this head was built — rebuild
before trusting the tests." **Rebuild head** re-embeds the stored tags into a
fresh head vector (one embed call per tag field).

## The Test tab

Type a query a user would ask and run it. The Lab scores every published
repository head exactly as the real fan-out would, and shows:

- the **score table** — each repository with its state, head score, rank, and
  whether its head *claims* the query or is *suppressed*;
- a **verdict banner** — PASS when the repository under test wins the routing
  (or, in adversarial mode, correctly loses it); FAIL names the repository
  that won instead;
- the **gate breakdown** for the repository under test — the three gates a
  query passes through, each marked pass/fail/n-a:
  - **Floor** — the domain floor. A query below the floor is unrelated to the
    repository's subject matter; suppression here is *correct*, and no tag
    change fixes it.
  - **Forbidden tags** (veto) — the query strongly matches a tag the
    repository explicitly excludes. If the query *should* belong to the
    repository, remove that tag from the frontmatter and republish.
  - **Margin** — the head won, but not by enough to beat the nearest
    competitor.

Mark a query **Adversarial** when it should *not* select this repository (a
forbidden or adjacent topic): the verdict then celebrates a correct
non-selection instead of flagging a failure.

### The teaching loop

When the head **claims** a query it should suppress, **Explain & suggest**
asks the model to propose forbidden tags that exclude the query's subject.
You review the proposals, add the ones that make sense (*Add to forbidden
tags*), and one click — **Rebuild head & re-run** — applies them and re-runs
the same query. Suggestions are **guarded**: a proposal that would forbid one
of the repository's own subjects (its own topic, entity or keyword tags) or
that duplicates an existing forbidden tag is rejected and shown as a muted
chip with the reason, so a teaching cycle cannot poison the repository into
suppressing its own content.

## The Suites & analytics tab

Suites turn one-off probing into a regression harness: saved sets of queries
you generate, extend, re-run and compare over time.

### Generating a suite

**Generate test suite** asks the LLM to write the queries — in batches of 30
per class, so a large ask (100+) takes a few minutes. You control the
per-class counts:

- **Positives** — queries that should select this repository.
- **Confusable** — should NOT select (adjacent topics a competitor should win).
- **Off-domain** — should NOT select (unrelated noise).
- **Meta** — queries about the repository itself, not its subject.
- **Near miss** — almost-rights that should still be suppressed.

Forbidden-derived rows are added automatically and **scale with the
repository's forbidden-tag count** — they cannot be set here. The suite lands
in the current view and in **Saved suites** when done. If the repository has
no head tags yet, the Lab says so and points at the Frontmatter panel first.

### Running a suite and reading the numbers

**Run all queries** executes every row through the same head simulation,
with progress per query (*"7 of 40 queries (17%)"*) and two phases —
*Scoring routes*, then *Checking the corpus*. The analytics read:

| Metric | Meaning |
|---|---|
| **Pass rate** | share of the suite that routed correctly this run |
| **Positives / Negatives** | how many should-select and should-NOT-select rows the suite carries |
| **Avg margin** | how far ahead the winner was, on average — a low margin means routing is one near-miss away from flipping |
| **Steal pairs** | "*kenya stole 3 of 8*" — a named competitor keeps winning another repository's rows, so you know exactly which pair of heads to tune |
| **not evaluatable** | rows with no competing head to lose to — there is nothing to pass against yet |

**Run history** keeps every run with its pass rate and the head version it
ran against, so you can see whether a tag change helped. A note flags a suite
whose stored tags have drifted since it was generated (*"Tags changed since
this suite was generated — regenerate for fresh forbidden rows"*).

### Probing a single query against the corpus

Every suite row can be probed against the **live ingested corpus** (this is
separate from head routing — the repository must be ingested first). The
probe reports *answerable* (the expected passage came back), *weak match*
(contexts came back but not the expected passage), or *not in corpus*
(nothing retrieved) — with a summary showing the head verdict, corpus
coverage, and the reference files with rerank scores.

### Explain failures — the guarded batch fix

After a run with failing negatives, **Explain failures** makes one model call
for every failing negative and returns:

- **forbidden tags to add** — with an **Add all** shortcut and a
  **Rebuild head & re-run suite** offer (the anti-treadmill: one cycle instead
  of query-by-query teaching);
- **tags to remove** — a forbidden tag that vetoes the repository's *own*
  positives is proposed for removal, with the count of positives it broke
  named on the chip;
- **rejected proposals** — the guardrail's self-forbidding or duplicate
  suggestions, shown muted with their reasons.

Safety nets around the loop:

- **The tripwire.** If a cycle *broke* positive tests — the added tags
  over-suppress — a red strip says so and points at the revert panel
  ("This cycle broke {n} positive tests — the added tags over-suppress.
  Revert?").
- **Revert tags.** Every frontmatter save is revertible in place: the panel
  lists the recorded saves with their forbidden-tag counts and restores one.
- **Positives gate the explain too.** A run that fails positives (not just
  negatives) opens the same advisory — *"Why positives stopped passing"*
  names the vetoing tags and the margin losses.

### The advisor

**Advisor: recommend tag changes** goes one step further than explain: it
**simulates** tag changes across the recent runs (scope is stated —
"across {q} queries from the last {r} runs") and proposes a tag set with a
predicted scorecard ("positives 7/8 claimed · negatives 20/20 suppressed",
now vs predicted). It also proposes:

- **blocked removals** — broad tags whose removal recovers positives, to
  confirm before including in the apply;
- **narrower replacements** — swap a broad tag for a narrow one to recover
  positives without re-admitting negatives;
- **corpus-grounded flips** — failing "negatives" the corpus itself answers:
  flip them to positives in one click;
- and it says plainly how many failing negatives have **no corpus grounding
  and no safe tag lever** — the competing repository must win those.

**Apply changes & rebuild & re-run suite** saves the tags, rebuilds the head
and re-runs the suite in one action. Removals flagged *you declared this tag
originally* or *the edit history has rotated past the baseline* ask for
confirmation before they are included — the advisor does not silently undo a
curator's decision.

## The RAGAS Benchmarks tab

The fourth tab measures what routing tests cannot: *answer quality*. It runs
[RAGAS](https://ragas.io) evaluation (the same framework as the offline
`tests/rag-benchmarks` harness) inside the Studio, with suites interchangeable
with that harness's xlsx formats.

**Two model pickers, because two operations.** *Generating* a suite
synthesizes questions; *scoring* a run judges answers. They are separate
operations with separate models, so the Lab offers a **generation model**
selector in the Generate section and a **judge model** selector in the Run
section (and a third in the Re-score dialog, which is a judge). Each picker
lists the deployment's **active model configuration** (marked ★), the
**deployment default from `.env`**, and every named configuration — see
[Model configurations](/docs/knowledge-base/models/) for how those are
defined. Picking one (and optionally a specific model from its live dropdown)
overrides it for that operation only. The empty choice is the *active
configuration*; the *.env deployment default* is the deployment's own
configured model, chosen explicitly and bypassing the active configuration.

**Each selection is remembered per suite**: reopening the Lab restores the
generation pick of the suite and the judge of its latest run (so repeat runs
stay comparable), and viewing a run restores *that* run's judge. The suite
records the model it was generated with, and each run records both the pick
as made and the resolved judge that scored it; a configuration deleted in the
meantime falls back to the default, since the dropdown cannot offer what no
longer exists.

- **Generate** a benchmark suite from one or more repositories (the current
  one alone, or with any number of related repositories — multi-hop
  questions cross repo boundaries when they are combined). You set the
  dimensions: question count (default 20), the query-type distribution
  (single-hop, multi-hop abstract, multi-hop specific — the three shares
  should total 100), and the number of personas. Each entry carries the
  question, its expected answer, and the reference passages the answer should
  be grounded in — the reference is the **published corpus chunk** the
  question was synthesized from, so reference-based metrics compare chunk to
  chunk. Repositories that have not published (no drained graph) contribute
  nothing. Generation is a background job: you can close the dialog and come
  back, and a **Cancel** button stops it at any time. The progress display
  streams the pipeline's own steps live — during the knowledge-graph build
  (the longest phase on a fresh judge cache) the active transform is shown by
  name with counts, estimated time remaining and the elapsed clock; question
  synthesis reports i/n as scenarios complete. Refreshing or reopening the
  Lab re-attaches to a running generation — it appears in the suite list
  while it generates, and pressing Generate while one is already running
  attaches to it rather than failing. A disk cache of judge responses makes
  **repeat** generations of the same repositories nearly instant (disable
  with `RAGAS_LLM_CACHE=0`). The generation corpus is bounded by a chunk
  budget (`OKF_RAGAS_MAX_CORPUS_CHUNKS`, default 1600 — the knowledge-graph
  build is per-node model work, so an unbounded corpus means an unbounded
  bill). Over the budget the selection is an **even spread across the whole
  corpus**, not a first-come prefix, and the suite records what it is
  grounded in: a capped suite shows *"grounded in 1600 of 5590 chunks"* on
  its header — the benchmark's coverage is a visible property of the suite,
  never a silent slice.
- **Manage** entries with full parity to the routing suites: edit the
  question or expected answer, flip an entry in-scope/out-of-scope (kept for
  contrast, excluded from scoring), remove it, add your own, rename the
  suite, delete it, and probe a single entry against the live corpus. A probe
  reports *answerable*, *weak match*, *not in corpus*, or *error* (the probe
  itself failed — the reason is shown inline).
- **Run** the suite: each question is answered through the retrieval
  pipeline (the same corpora, embedding, and reranker the chat uses) and
  answered with the chat's own serving prompt — a pinned
  `CHATQNA_SYSTEM_PROMPT` shapes the chat and the benchmark identically, so
  the scores describe the answerer users actually get — then scored by the
  selected RAGAS metrics: faithfulness, context precision, context recall,
  and answer relevancy by default, with the full single-turn catalog
  selectable (factual and answer correctness, semantic similarity, entity
  recall, noise sensitivity, and more). A progress bar reports each phase —
  with counts where the engine reports them (retrieving i/n, scoring i/n) and
  an animated working bar where it cannot — and a **Cancel run** control
  stops a benchmark that is taking too long. Progress tracking survives
  transient gateway hiccups: a brief proxy restart does not detach the panel
  from a job that is still running.
- **Results** render per-question in a table with metric bars, as aggregate
  gauges, as a run-over-run trend, and as a status breakdown — every chart
  carries an **ⓘ** whose popup explains, in plain language, what that RAGAS
  metric actually measures (and what it cannot see: answer relevancy never
  checks correctness; noise sensitivity is inverted — lower is better). The
  results table's columns are drag-resizable (double-click a header to
  reset), each answer sits in its own selectable, copyable cell (one-click
  copy button), and the Lab dialog sizes itself to the content — selecting
  every metric widens the dialog instead of pushing the table off the side.
  Export as a **PDF report** that includes the same per-metric notes and
  parallels the offline harness export's information — outcome counts
  (questions / evaluable / abstained / failing), all selected gauge charts,
  the trend chart, a compare-across-runs table with delta-vs-first-run, and
  per-question rows with abstention/error/failure flags — or as an xlsx
  workbook using the offline harness's column vocabulary.
- **Explain failures** attributes each failing row to the stage that broke
  (routing, corpus, reranker, LLM, abstention, or judge) and proposes guarded
  advice — including *repository-level* changes: frontmatter tag adjustments
  through the same guarded machinery as the routing teaching loop, and
  concept-content curation suggestions that name the concept and the gap.
  Two further stages cover the rows that carry **no score**: *answer* (the
  row produced no answer, so it was never handed to the judge) and
  *unmeasured* (the judge returned nothing measurable for the row). Neither
  is a threshold breach, and neither is counted as a zero.
- **Interchange**: import a benchmark suite authored in the harness's
  `Test Dataset` xlsx format; export your suite so the harness's
  `xlsx_to_gold.py` consumes it unmodified. Results flow one way (export).

Benchmark suites appear in the same **Saved suites** list as the routing
suites, marked with a RAGAS badge. No feature is tied to a specific model:
the judge and embedder point at the deployment's own OpenAI-compatible
endpoints (defaults inherit the LLM configuration); the per-task model
minimums are documented in the deployment guide.

## Long-running jobs and what happens on timeouts

Benchmark generation, runs, re-scores, explains and the advisor are all
**server-side jobs** the Lab follows by polling. The failure sentences are
deliberate — they tell you the work is not lost:

- *"Tracking stopped — the job keeps running server-side."* — the Lab lost
  its polling connection; reopen it to re-attach.
- *"The run is still executing on the server — reopen the Lab later to see
  its result."* (and the generation/advisor/explain equivalents) — the job
  outlived the dialog; nothing is lost.
- *"The suite is taking unusually long — it may still land in Saved suites;
  check there in a minute."* — a generation that has not finished inside its
  tracking window; check Saved suites before restarting.
- *"Re-score cancelled by user" / "Run cancelled by user"* — the only ways a
  healthy job ends besides completing.

Nothing is ever discarded on a timer: a healthy long job ends only when it
completes or when you cancel it.

## Related pages

- [OKF Studio](/docs/knowledge-base/okf-studio/) — the dashboard, wizard and
  editor the Lab is opened from.
- [Model configurations](/docs/knowledge-base/models/) — the named model
  endpoints the benchmark pickers resolve to.
- [Ingestion]({{< relref "ingestion" >}}) — publishing, the drain, and how a
  repository becomes serving.
- [OKF variables reference](/docs/configure/okf-variables/) — the RAGAS and
  routing-test settings behind this page.
