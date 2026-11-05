---
title: "OKF Studio"
weight: 15
description: "Creating and curating OKF repositories — the dashboard, the wizard, the editor, versions, and the PII review."
---

OKF repositories are curated knowledge bases: **concept documents** (Markdown
with YAML frontmatter and typed links between them) organized into a
versioned repository that publishes into the RAG pipeline as its own graph.
The **Studio** — the *OKF Studio* tab in the admin dashboard — is where
stewards create, curate, validate, secure and publish them.

This page is the tour. For what a *repository is* and how ingestion processes
concepts, read [Ingestion](/docs/knowledge-base/ingestion/); for who can
query a repository, read [Access control](/docs/knowledge-base/access-control/).
The Testing Lab and the Models tab have their own pages:
[Testing Lab](/docs/knowledge-base/testing-lab/) and
[Model configurations](/docs/knowledge-base/models/).

## The dashboard

The Studio dashboard is a kanban of every repository in five lanes —
**Import** (drafts), **In review**, **Published**, **Ingested** (serving),
**Retracted**. A subject-area filter (the options follow the Knowledge
Hierarchy) and a search box narrow the board. Each card shows its concept
count, its current stage (*Building…* while a source file converts,
*Ingesting…* / *Re-draining…* / *Ingest failed* during a drain, *Ingested
v{n}* once serving, *Step {n} of 10* for a wizard draft), a health ring, and
its version.

From a card you can resume the wizard, open the editor, and run the
governance actions: **submit for review**, **approve**, **publish** (mints a
version, builds the repository's vectorized head, and starts the ingestion
drain), **unpublish**, and **retract** (removes the repository's chunks and
graph cleanly). The card's *Actions* menu also carries **Testing Lab**,
**Versions**, **Logs**, **Export** (the bundle zip), **Rename**, **Delete**,
and **Re-ingest failed concepts** when a drain left failures behind. Several
repositories can be selected for a **bulk publish**.

**+ New repository** opens the create dialog:

- **Repository name** — a name that already exists is caught *in the dialog*
  ("A repository with this name already exists. Open it, or pick another
  name.") with a one-click **Open existing repository**.
- **Subject area** — required, and immutable after creation; the options come
  from the Knowledge Hierarchy's categories.
- **Bundle (.zip) import** — pick a zip to import as the new repository's
  content. Selecting a file only *stages* it ("Bundle staged — click Create
  Repository to start the import."); the **Create repository** click is the
  action point. The repository card appears immediately and the import runs
  **in the background**, with the card as the progress surface.
- **Concept classification** for the imported bundle — *Heuristics (default)*,
  *LLM-assisted*, or *Hybrid*, with the selected mode's real meaning and
  expected duration spelled out where you choose it.

Publishing never happens inside the wizard — approval and publishing are
governance actions on the dashboard and in the editor, where versions and
serving state live.

## The wizard

Ten steps, each resumable (progress is saved per repository; steps after the
saved one are locked until you reach them, and back-navigation never loses
work). A left rail shows the stepper, a right rail the repository context
(name, subject area, lifecycle state, version, concepts so far, sources, and
a *Cloned from* badge when applicable):

1. **Entry** — repository name and subject area. The repository is created
   here.
2. **Choose workflow** — four cards: **Documents** (lift topics from
   documents you have already uploaded), **Website crawl** (crawl a site and
   propose topics from the pages), **Manual** (author from scratch), or
   **Clone of an existing repository** — a curated fork that copies the
   topics *and* their labels; only repositories that are not yet serving can
   be cloned.
3. **Input** — add source material: concept files, document bundles, or the
   crawl configuration. Oversized documents are split losslessly against the
   deployment's model-window ceiling.
4. **Produce** — *Generate topics*: the system reads the sources and proposes
   topics while you watch.
5. **Label onboard** — the label taxonomy for this subject area.
6. **Curate** — LLM-assisted labels and per-repository frontmatter tags
   (topics and forbidden domains — these drive routing). Publishing requires
   at least three topic tags and one forbidden tag, approved and saved.
7. **Validate** — the **issue list**: a health ring and every issue with its
   severity, what is wrong, and **how to fix** it — frontmatter that misses
   the spec (conformance), pages no other page links to (orphans, with
   *Suggest links* proposals you accept or reject), near-identical pages
   (preview them side by side and delete all but one), citations that are not
   linked (one click creates/wires the Sources page), and pages whose index
   build failed. The **personal-data review** is part of this step (see
   [the PII review](#the-pii-review) below).
8. **Auto-correct** — *Auto-fix*: apply the safe fixes the validator
   suggests.
9. **Review** — the readiness summary, with the editor embedded for a last
   look.
10. **Secure and Finish** — the readiness checklist (name set, topics
    reviewed, labels assigned, frontmatter tags approved), the repository's
    [access control](/docs/knowledge-base/access-control/) (restriction and
    grants — configuration, not a lifecycle action), the read-only head
    status card with the [Testing Lab](/docs/knowledge-base/testing-lab/)
    (view and test only), and two handoffs — **Open the Editor** in the
    footer and **Open the Dashboard** in the step. The wizard stops here by
    design; the ritual lives outside it — on the dashboard, the card's one
    contextual button advances the repository through **Submit for review →
    Approve → Publish → Ingest** (and, once serving, **Retract**).

The wizard and the editor have **functional parity**: anything the wizard can
do, the editor can do too, on a live repository.

## The editor shell

Clicking a repository card opens the **shell**: a header and two sub-tabs,
**Wizard** and **Editor**. The header carries the repository name, its
lifecycle state pill, the version ("A frozen snapshot of a repository at
publish time. Editing continues on the next version — published versions
never change."), and the contextual actions:

- the **lifecycle action button** — the next transition for the current
  state (submit, approve, publish, ingest, retract), with an ⓘ tip when the
  next step is ingestion ("The step where a published version is prepared
  for answering — text is split, embedded and linked. Nothing reaches the
  assistant before this.");
- **Versions** — the version table (version, tag, trigger, curator, concept
  count, minted, ingest status), each version's bundle with **Download zip**,
  and **Create new version**;
- **Testing Lab** (when a head exists or the state allows testing);
- **Logs** — the repository's action log;
- **Export .zip** — the bundle;
- **Delete** (never on a serving repository).

A **serving** repository shows a *Serving* pill, the serving graph's name
chip (`OKF_<name-slug>_v<N>`), and a **CONTENT READ ONLY — head/tags stay
editable** pill: concepts and metadata are locked until retract, but the
frontmatter tag set stays editable — the whole point of the testing loop.
While a source file is still converting, the shell shows a live **build
progress card** instead of the tabs; a failed conversion shows an actionable
error ("Delete this repository and import the source file again.").

## The editor

Three panes, both splitters draggable (double-click resets, arrow keys
nudge):

- **Left** — the **concept list** (filter, add concept, add sources, per-file
  re-split, per-concept label, delete, re-ingest failed) and, under it, the
  **Access Control** panel (restriction toggle and grants — see
  [Access control](/docs/knowledge-base/access-control/)).
- **Center** — **Files** | **Graph** toggle. The concept editor shows source
  and rendered views with debounced save; the graph view draws the
  repository's link structure (clicking a node selects the concept). Any
  editor action that can outlive a gateway timeout renders as a **long-action
  strip** — a non-blocking bar with live elapsed seconds, the panes staying
  interactive.
- **Right** — the metadata rail: the **frontmatter panel** (the repository's
  tag chips — topics, forbidden, entities, keywords — always visible, editable
  even on a serving repository), the **head badge** (*head ready / head
  stale / no head*) which opens the [Testing
  Lab](/docs/knowledge-base/testing-lab/), the **Personal data** control
  (below), the per-concept form (**Type**, **Title**, **Label** — bounded to
  the subject area's Knowledge Hierarchy services), the **Index status** and
  **Trust tier** facts, and the **Autocorrect** button.

## Crawl imports

A website crawl converts into a repository: each crawled page becomes one
concept (mode B, streamed in batches for large crawls), with per-page
provenance kept on the concept. The conversion is one-per-repository at a
time; progress is visible on the repository's record. The editor's **add
sources** dialog keeps accepting more later — additional crawls convert one
by one, other documents as one batch. The full crawl-side walkthrough — the
live crawl dashboard and the Create-OKF footer — is in
[From Documents & Crawls](/docs/knowledge-base/documents-to-okf/).

## The PII review

Every repository is **PII-scanned**: the PII sidecar reads each concept and
flags personal-data occurrences. The review has one rule — **an unread page
is never a clean page** — and every surface that talks about the repository's
PII state renders one of these verdicts:

| Verdict | Meaning |
|---|---|
| *clean* | scanned end to end, nothing found — the only all-clear |
| *reviewed* | N flagged, and an acknowledgement covers exactly those N |
| *unreviewed* | N flagged, nobody has looked at them yet |
| *unscanned* | no completed scan, or concepts the scan never reached |
| *error* | at least one concept's scan failed — blocking |
| *unreadable* / *checking* | the state could not be read / is being read |

**Where you do the review.** The concept editor's **Flagged entities** panel
shows every occurrence in context with per-occurrence actions — **Redact**,
**Replace** (type the replacement), **Remove**, **Accept** — plus whole-file
**Redact file** / **Remove body** / **Accept all**, and a "Processed in this
file" list of what was already resolved. Saving the concept re-scans it.
The concept list header offers the repo-wide bulk decisions — **Redact all
flagged content**, **Remove all flagged content**, **Accept all flagged
entities** — each with a confirmation naming how many concepts are affected.

**Repo-wide re-scan.** The editor's right rail carries a **Personal data** →
**Re-scan all pages** control (and the wizard's Validate step has the same
panel), with a live tally — *{n} page(s) re-scanned: {c} clear, {h} flagged,
{e} scan error, {m} vanished* — and a **Still blocking** list of concepts the
re-scan could not clear. Tracking follows the server run for up to 15
minutes; past that the UI stops following with a readable timeout and the
run itself continues server-side.

**The publish gate.** The Publish dialog shows the *Personal data check*
summary **before** you click — a repository with unreviewed findings is
refused, and the refusal lists the flagged files as **clickable links** that
open each one in the editor. If you *have* reviewed the findings (official
contact details are the classic case), **Acknowledge flagged entities &
publish** records who acknowledged what — and the acknowledgement is
**current-checked**: an acknowledgement recorded against a different flagged
count, or older than the scan that produced the current one, does not count
as a review. Correcting text re-scans automatically; an explicit re-scan
re-arms everything.

## The Testing Lab and RAGAS

Every published repository carries a **vectorized head** — the embedding of
its frontmatter tags. At query time the retriever fans out across the
caller's authorized repositories, weighting each by how well the query
matches its head. The **Testing Lab** tests that routing against the live
corpus — one-off queries, saved suites with pass rates and steal pairs, a
guarded teaching loop with an advisor, and full **RAGAS** answer-quality
benchmarks whose suites interchange with the offline
`tests/rag-benchmarks` harness.

The complete walkthrough — the Head/Test/Suites tabs, what pass rates,
margins and steals mean, the RAGAS generate/run/results flow, and how
long-running jobs behave on timeouts — lives in
[Testing Lab](/docs/knowledge-base/testing-lab/).

## Model configurations

The Admin Dashboard's **Models** tab manages **named remote-model
configurations** — any OpenAI-compatible endpoint or Anthropic's native API —
and decides which features each serves: benchmark judging, benchmark answers,
concept curation, topics & tags. Exactly one configuration is active at a
time; with none, the deployment's env-configured default model applies. The
Lab's model pickers resolve against these configurations.

The full walkthrough — creating, the live model dropdown, Test connection,
the URL rules and the lifecycle — lives in
[Model configurations](/docs/knowledge-base/models/).

## Where things are recorded

- Every lifecycle action, access change and import is written to the
  **audit log** — visible through the editor's **Logs** dialog.
- Per-concept ingestion progress (chunking, labelling, indexing) is visible
  in the admin **Ingestion Log** — see
  [Ingestion](/docs/knowledge-base/ingestion/).
- Versions are minted at publish; the bundle of each version stays
  inspectable (**Versions** → **Download zip**), and publishing a new
  version supersedes the old one.
