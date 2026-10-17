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
repository's frontmatter tag chips, the Routing Lab entry).

Two panels live under the concept list in the left sidebar:

- **Concepts** — the list itself.
- **Access Control** — restriction toggle, grant holders, and the grant
  facility (see [Access control](/docs/knowledge-base/access-control/)).

## Crawl imports

A website crawl converts into a repository: each crawled page becomes one
concept (mode B, streamed in batches for large crawls), with per-page
provenance kept on the concept. The conversion is one-per-repository at a
time; progress is visible on the repository's record.

## The Routing Lab

Every published repository carries a **vectorized head** — the embedding of
its frontmatter tags. At query time the retriever fans out across the
caller's authorized repositories, weighting each by how well the query
matches its head. The **Routing Lab** (from the dashboard card, the editor,
or wizard step 10) tests that routing against the live corpus:

- **One-off tests** — see which repository wins a query and why.
- **Suites** — saved sets of queries (positives and forbidden-domain
  negatives) you can re-run; coverage probes show which concepts a suite
  actually exercises.
- **Teaching loop** — on failures, the Lab suggests tag adjustments
  (including forbidden tags for claim-side losses); apply, rebuild the head,
  and re-test without leaving the loop. Suggestions are guarded: they cannot
  forbid a repository's own entities, and apply is deduplicated and damped.

## Where things are recorded

- Every lifecycle action, access change and import is written to the
  **audit log**.
- Per-concept ingestion progress (chunking, labelling, indexing) is visible
  in the admin **Ingestion Log** — see
  [Ingestion](/docs/knowledge-base/ingestion/).
- Versions are minted at publish; the bundle of each version stays
  inspectable, and publishing a new version supersedes the old one.
