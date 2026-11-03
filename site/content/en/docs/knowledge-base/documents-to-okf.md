---
title: "From Documents & Crawls"
description: "How document management and the crawler feed OKF repositories — the crawl dashboard, the Create-OKF entry points, and bundle protection."
weight: 18
---

OKF repositories are born from three kinds of source: **uploaded documents**,
**website crawls**, and **repository bundles** (a repository's zip export).
Document management — the Document Management tab of the Admin Dashboard — is
where the first two live, and it carries the entry points that turn them into
repositories. This page is the map of that border between document management
and the OKF lifecycle.

## Turning a crawl into a repository

A crawl is a document like any other in the list — but its detail dialog has
a live **Dashboard tab** that watches the crawl while it runs:

- **Crawl Rate** (pages/second), **Queue Size**, and **Error Rate** with the
  403 (Forbidden) and 429 (Rate Limit) counts broken out — an error rate
  above 5 % highlights the card in red.
- **Pages Processed** progress against the crawl's page limit, plus depth
  (current/max), internal and external links, and total fetched.
- **Auto-refresh** (every N seconds, toggleable) and **Refresh Now**; a live
  dot on the tab marks a crawl in progress.
- The **Crawl Log** tab lists every fetched, redirected or failed URL while
  the crawl runs, and a **Kill Crawl Task** control stops it.

### Repositories created from this crawl

The Dashboard tab also shows every repository this crawl already produced —
**Repositories created from this crawl**, one status bar per repository
(*Queued… → Downloading crawl… → Splitting into concepts… → Adding concepts
(N pages so far) → Created (N pages)*, or *Failed* with the error). A single
crawl file can be converted more than once; each repository gets a unique
name (an automatic `-2`, `-3` … suffix) so conversions stay traceable.

### The Create-OKF footer

When the crawl has **Succeeded** and is not already sourced by a repository,
the dialog's footer becomes the conversion form:

1. **Concept split** — *One concept per page (recommended)*: each crawled
   page becomes its own concept, so the assistant can cite individual pages.
   *One concept for the whole crawl*: best for small sites. (A third option,
   *Use LLM topic extraction*, is disabled — coming soon.)
2. **Subject area** — required, and **immutable after creation**; the button
   stays disabled until a Knowledge Hierarchy category is picked.
3. **Concept classification** — how the system decides what each concept
   *is* (a topic, an entity, a process…): **Heuristics (default)** is fast
   rule-based classification with no LLM cost; **LLM-assisted** curates every
   concept (type, Knowledge-Hierarchy label, description) — far more
   accurate, but expect added time per concept; **Hybrid** runs heuristics
   first and lets the LLM review uncertain cases and fill gaps.
4. **Create OKF repository from this crawl** starts the conversion. It runs
   **server-side** — the okf-server streams the file, splits it into one
   concept per page, and ingests the batch; the browser never downloads or
   processes it. The conversion is **one per repository at a time**, progress
   is visible on the crawl's record, and the new repository lands in the
   Studio's wizard at **Curate** — the step where labels, frontmatter tags
   and the PII review get resolved.

## Creating a repository from selected documents

In the Document Management list, select documents and press **Create OKF
repository**. The button gates itself:

- **Select at least one document** — nothing selected.
- **Remove documents already in an OKF repository** — a selected row already
  sourced by another repository.
- A warning tooltip appears when some selected documents **still serve the
  free-form corpus** — the new repository cannot be ingested until they are
  retracted. The button stays usable; the prevention moves to the OKF
  lifecycle, which refuses the repository's ingest transition while any of
  its source documents is still serving.

Confirmed, the selection is **preloaded into the wizard** — the Studio opens
at Entry with the documents carried in: name the repository, the workflow
step shows *Documents* preselected, and Produce converts the pick. Ingested
documents are importable; the guard is the lifecycle rule above, not the
document's state.

## Bundle protection (why some zips cannot be deleted)

When a repository is published, a **bundle zip** — that version's full
content — is stored in the document repository. It appears in the document
list, but it is **not ordinary content**: it is the OKF per-version ingestion
artifact, owned by the repository's lifecycle (superseded by minting a new
version, removed when the repository is deleted).

What you see:

- The file's detail dialog titles it with a **"managed by OKF lifecycle"**
  badge, and the **Delete** button is hidden.
- A direct delete through the API is refused with `403 BUNDLE_PROTECTED` —
  only the OKF service account may remove a bundle.

What happens in batch operations:

- **Batch delete with a bundle in the selection** refuses *only the bundle
  row*: the rest of the selection is deleted, and the protected row comes
  back as a per-file refusal the dialog reports — alongside the usual
  skipped-rows accounting for ingested files ("N ingested/ingesting file(s)
  will be SKIPPED — retract them first to delete them").
- **Batch ingest refuses bundle zips** the same way (`BUNDLE_PROTECTED` — a
  bundle has nothing to ingest; it *is* an ingestion artifact).

One useful property: the bundle zip carries its repository's **ingestion
log** — per-concept drain progress (chunking, labelling, indexing) is
mirrored onto it, so the file's Ingestion log tab is the per-concept view of
a repository's drain. See
[Ingestion]({{< relref "ingestion" >}}) for the pipeline itself.

## Related pages

- [OKF Studio](/docs/knowledge-base/okf-studio/) — what happens after a
  repository is created: the wizard and the editor.
- [Access control](/docs/knowledge-base/access-control/) — who can query the
  repository once it serves.
- [OKF variables reference](/docs/configure/okf-variables/) — the crawl
  conversion limits (`OKF_MAX_CRAWL_SOURCE_MB`) and the bundle caps.
