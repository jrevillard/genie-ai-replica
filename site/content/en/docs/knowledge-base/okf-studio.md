---
title: "OKF Studio"
weight: 15
description: "Creating and curating OKF repositories — the wizard, the dashboard, and the editor."
---

OKF repositories are curated knowledge bases: **concept documents** (Markdown
with YAML frontmatter and typed links between them) organized into a
versioned repository that publishes into the RAG pipeline as its own graph.
The **Studio** — the *OKF Studio* tab in the admin dashboard — is where
stewards create, curate, validate, secure and publish them.

This page is the tour. For what a *repository is* and how ingestion processes
concepts, read [Ingestion](/docs/knowledge-base/ingestion/); for who can
query a repository, read [Access control](/docs/knowledge-base/access-control/).

## The dashboard

The Studio dashboard is a kanban of every repository, by lifecycle state —
draft, in review, approved, serving (published), retracted. From a card you
can resume the wizard, open the editor, or run the governance actions:
**submit for approval**, **approve**, **publish** (mints a version, builds
the repository's vectorized head, and starts the ingestion drain), and
**retract** (removes the repository's chunks and graph cleanly).

Publishing never happens inside the wizard — approval and publishing are
governance actions on the dashboard and in the editor, where versions and
serving state live.

## The wizard

Ten steps, each resumable (progress is saved per repository):

1. **Entry** — name and subject area. The repository is created here.
2. **Choose workflow** — start empty, clone an existing repository (a
   curated fork), or import from a website crawl.
3. **Input** — add source material: concept files, document bundles, or the
   crawl configuration. Oversized documents are split losslessly against the
   deployment's model-window ceiling.
4. **Produce** — draft concepts from the sources.
5. **Label onboard** — the label taxonomy for this subject area.
6. **Curate** — LLM-assisted labels and per-repository frontmatter tags
   (topics and forbidden domains — these drive routing).
7. **Validate** — conformance checks (links resolve, frontmatter present,
   body non-empty).
8. **Auto-correct** — apply safe fixes the validator suggests.
9. **Review** — the readiness summary.
10. **Secure and Finish** — the readiness checklist, the repository's
    [access control](/docs/knowledge-base/access-control/) (restriction and
    grants — configuration, not a lifecycle action), and the handoff to the
    dashboard's approval flow.

The wizard and the editor have **functional parity**: anything the wizard can
do, the editor can do too, on a live repository.

## The editor

Three panes: the **concept list** (filter, add, per-concept actions —
re-split, re-ingest, PII review, delete), the **concept editor** (source and
rendered view with debounced save; the graph view shows the repository's
link structure), and the metadata rail (per-concept type/title/label, the
repository's frontmatter tag chips, the Testing Lab entry).

Two panels live under the concept list in the left sidebar:

- **Concepts** — the list itself.
- **Access Control** — restriction toggle, grant holders, and the grant
  facility (see [Access control](/docs/knowledge-base/access-control/)).

## Crawl imports

A website crawl converts into a repository: each crawled page becomes one
concept (mode B, streamed in batches for large crawls), with per-page
provenance kept on the concept. The conversion is one-per-repository at a
time; progress is visible on the repository's record.

## The Testing Lab

Every published repository carries a **vectorized head** — the embedding of
its frontmatter tags. At query time the retriever fans out across the
caller's authorized repositories, weighting each by how well the query
matches its head. The **Testing Lab** (from the dashboard card, the editor,
or wizard step 10) tests that routing against the live corpus:

- **One-off tests** — see which repository wins a query and why.
- **Suites** — saved sets of queries (positives and forbidden-domain
  negatives) you can re-run; coverage probes show which concepts a suite
  actually exercises.
- **Teaching loop** — on failures, the Lab suggests tag adjustments
  (including forbidden tags for claim-side losses); apply, rebuild the head,
  and re-test without leaving the loop. Suggestions are guarded: they cannot
  forbid a repository's own entities, and apply is deduplicated and damped.

## RAGAS Benchmarks

The Lab's fourth tab — **Benchmarks** — measures what routing tests cannot:
*answer quality*. It runs [RAGAS](https://ragas.io) evaluation (the same
framework as the offline `tests/rag-benchmarks` harness) inside the Studio,
with suites interchangeable with that harness's xlsx formats.

**Two model pickers, because two operations.** *Generating* a suite
synthesizes questions; *scoring* a run judges answers. They are separate
operations with separate models, so the Lab offers a **generation model**
selector in the Generate section and a **judge model** selector in the Run
section (and a third in the Re-score dialog, which is a judge). Each
picker lists the deployment's **active model configuration** (marked ★),
the **deployment default from `.env`**, and every named configuration — and
picking one (and optionally a specific model from its live dropdown)
overrides it for that operation only.

The two options are named for what they actually resolve to: the empty
choice is the **active configuration**, and the **`.env` deployment
default** is the deployment's own configured model, chosen explicitly and
bypassing the active configuration. While a job runs, the picker adopts
that job's pick and the panel names the model it is really using, so the
two can never disagree.

**Each selection is remembered per suite**: reopening the Lab restores the
generation pick of the suite and the judge of its latest run (so repeat runs
stay comparable), and viewing a run restores *that* run's judge — instead
of falling back to the deployment default. The suite records the model it
was generated with, and each run records both the pick as made and the
resolved judge that scored it; a configuration deleted in the meantime
falls back to the default, since the dropdown cannot offer what no longer
exists.

- **Generate** a benchmark suite from one or more repositories (the current
  one alone, or with any number of related repositories — multi-hop
  questions cross repo boundaries when they are combined). You set the
  dimensions: question count (default 20), the query-type distribution, and
  the number of personas — the suite ships exactly the requested number of
  questions. Each entry carries the question, its expected answer, and the
  reference passages the answer should be grounded in — the reference is the
  **published corpus chunk** the question was synthesized from (the same
  unit retrieval returns), so reference-based metrics compare chunk to
  chunk. Repositories that have not published (no drained graph) contribute
  nothing: their content is not retrievable yet. Generation is a
  background job: you can close the dialog and come back, and a **Cancel**
  button stops it at any time (the shared GPU drains within one in-flight
  model call). A per-phase progress bar tracks it — the knowledge-graph
  build runs as an animated working bar (it has no intermediate counts;
  on a fresh judge cache it is the longest phase), then question synthesis
  reports i/n as scenarios complete. Refreshing or reopening the Lab
  re-attaches to a running generation — it appears in the suite list while
  it generates, and pressing Generate while one is already running attaches
  to it rather than failing. Nothing is ever discarded on a timer —
  a healthy long run
  ends only when it completes or when you cancel it. The progress display
  streams the pipeline's own steps live: during the knowledge-graph build
  (the longest phase on a fresh judge cache) the active transform is shown
  by name with its counts, estimated time remaining, and the run's elapsed
  clock — extraction, summaries, node filtering, themes, relationships —
  and question synthesis reports i/n as scenarios complete. A disk cache of
  judge responses makes **repeat** generations of the same repositories
  nearly instant (the knowledge-graph phase is skipped; disable with
  `RAGAS_LLM_CACHE=0`). The generation corpus is bounded by a chunk budget
  (`OKF_RAGAS_MAX_CORPUS_CHUNKS`, default 1600 — the knowledge-graph build
  is per-node model work, so an unbounded corpus means an unbounded bill).
  Over the budget the selection is an **even spread across the whole
  corpus**, not a first-come prefix, and the suite records what it is
  grounded in: a capped suite shows *"grounded in 1600 of 5590 chunks"* on
  its header — the benchmark's coverage is a visible property of the suite,
  never a silent slice.
- **Manage** entries with full parity to the other suites: edit the question
  or expected answer, flip an entry in-scope/out-of-scope, remove it, add
  your own, rename the suite, delete it, and probe a single entry against
  the live corpus. A probe reports *answerable* (the expected passage is in
  the retrieved contexts), *weak* (contexts came back but not the expected
  passage), *unanswerable* (nothing retrieved / no ingested graphs), or
  *error* (the probe itself failed — the reason is shown inline).
- **Run** the suite: each question is answered through the retrieval
  pipeline (the same corpora, embedding, and reranker the chat uses) and
  answered with the chat's own serving prompt — a pinned
  `CHATQNA_SYSTEM_PROMPT` shapes the chat and the benchmark identically, so
  the scores describe the answerer users actually get — then scored by the
  selected RAGAS metrics — faithfulness, context precision,
  context recall, and answer relevancy by default, with the full
  single-turn catalog selectable (factual and answer correctness, semantic
  similarity, entity recall, noise sensitivity, and more). A progress bar
  reports each phase — with counts where the engine reports them
  (retrieving i/n, scoring i/n) and an animated working bar where it cannot
  — and a **Cancel run** control stops a benchmark that is taking too long.
  Progress tracking survives transient gateway hiccups: a brief proxy
  restart does not detach the panel from a job that is still running.
- **Results** render per-question in a table with metric bars, as aggregate
  gauges, as a run-over-run trend, and as a status breakdown — every chart
  carries an **ⓘ** whose popup explains, in plain language, what that RAGAS
  metric actually measures (and what it cannot see: answer relevancy never
  checks correctness; noise sensitivity is inverted — lower is better). The
  results table's columns are drag-resizable (double-click a header to
  reset), each answer sits in its own selectable, copyable cell (one-click
  copy button), and the Lab dialog sizes itself to the content — selecting
  every metric widens the dialog instead of pushing the table off the side.
  When questions fail their thresholds, the **advisor** appears with the
  results: any previously saved failure attribution loads automatically, and
  until one exists a banner points at *Explain failures*.
  Export as a **PDF report** that includes the same per-metric notes and
  parallels the offline harness export's information — outcome counts
  (questions / evaluable / abstained / failing), all selected gauge charts,
  the trend chart, a compare-across-runs table with delta-vs-first-run, and
  per-question rows with abstention/error/failure flags — or as an xlsx
  workbook using the offline harness's column vocabulary.
- **Explain failures** attributes each failing row to the stage that broke
  (routing, corpus, reranker, LLM, abstention, or judge) and proposes
  guarded advice — including *repository-level* changes: frontmatter tag
  adjustments through the same guarded machinery as the routing teaching
  loop, and concept-content curation suggestions that name the concept and
  the gap.
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

## Model configurations

The Admin Dashboard's **Models** tab — the last tab, platform admins —
manages **named remote-model configurations**: any OpenAI-compatible
endpoint (OpenAI direct, a LiteLLM gateway, vLLM, Gemini's compat
surface, Ollama) or Anthropic's native API. Each carries a name,
provider, base URL, API key and a default model; as soon as a URL and
key are configured — **even before the configuration is saved** — the
model field becomes a **dropdown combo populated live from the
endpoint** (the server performs the listing; for a saved configuration
it uses the stored key, for an unsaved form the typed key makes one
server-side round trip and is never stored). Keys are held server-side,
shown only as a masked hint, and never reach the browser.

A **Test connection** action (in the form and on every table row) probes
the configuration before you rely on it: it sends a **one-token
generation to the selected model** over the provider's native wire —
the truest end-to-end proof (credentials, base URL and model in a
single call), reporting latency and the raw error if anything fails.
It deliberately does **not** depend on the model listing: some
providers serve generation but no list (DeepSeek's Anthropic surface,
for example, answers `/v1/messages` but has no `/v1/models`) — there
the dropdown falls back to free text while the test still passes. With
no model selected there is nothing to test. Testing is always
available; activating is a separate, explicit act. The Provider and
Base URL fields carry **ⓘ info tips** with live-verified example
endpoints (OpenAI, Anthropic, MiniMax, z.ai, LiteLLM) and the exact
paths the server appends for listing and generation.

The configuration works within reason for **any** selected model:
config-routed internal tasks ask reasoning-capable models not to think
(the wire convention for it, dropped automatically if the endpoint
doesn't know the parameter), and a call whose answer was starved by
reasoning — the model spent its whole budget thinking and wrote nothing
— is retried on a climbing ladder: each retry gets four times the token
budget (to a ceiling) **and** twice the wall clock, so strict-JSON
tasks (tags, curation, advice, benchmark answers) survive frontier
reasoning models.

**Frontmatter tag suggestion runs as a background job.** The request
returns immediately and the panel polls until the suggestion lands —
there is no gateway timeout in the path, and the model is given a
five-minute clock per attempt (plus the ladder above) to think. With a
reasoning model configured, a suggestion taking a couple of minutes is
normal, not a failure.

Each configuration declares **which features use it**, grouped by
pipeline. The **Test Lab Pipelines** group is live: **benchmarks** (the
RAGAS judge and advisor), **benchmark answers** (by default benchmarks
answer with the deployment's chat — check this to make the benchmark
measure the configured model instead; the run's fidelity block records
which), **concept curation** and **topics & tags**. The active
configuration only serves the features on its list — an unchecked
configuration is dormant even while active. Everything except benchmark
judging speaks the OpenAI wire format, so those boxes require an
OpenAI-compatible provider; an Anthropic-provider configuration can
serve benchmark judging only. The **Data Prep Pipeline** (contextual
retrieval, chunk labeling, knowledge-graph extraction) and **Inference
Pipeline** (chat answering, chat translation) groups are shown as
planned — those endpoints are not yet configurable, and embeddings and
reranking stay deployment-local by design.

Configurations can be **named, renamed, copied, modified, activated,
deactivated and deleted**. Exactly **one** can be active at a time; the
active configuration applies unless an operation picks another
explicitly. With **none** active, the deployment's env-configured
default model (`RAGAS_JUDGE_*`) applies — the behavior before any
configuration exists. Every lifecycle action is
written to the audit log.

## Where things are recorded

- Every lifecycle action, access change and import is written to the
  **audit log**.
- Per-concept ingestion progress (chunking, labelling, indexing) is visible
  in the admin **Ingestion Log** — see
  [Ingestion](/docs/knowledge-base/ingestion/).
- Versions are minted at publish; the bundle of each version stays
  inspectable, and publishing a new version supersedes the old one.
