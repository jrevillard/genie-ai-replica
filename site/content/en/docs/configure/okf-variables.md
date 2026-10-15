---
title: "OKF Configuration Variables"
description: "Environment variables for the OKF knowledge repositories — crawl conversion limits, parallel indexing, and stuck-drain protection."
weight: 3
---

These variables control the OKF subsystem: creating knowledge repositories from
website crawls, and the indexing pipeline that makes repository content
retrievable. They are set in the deployment environment file (`env` template →
`.env`, or the Ansible vault/group vars on Swarm deployments) and consumed by
the **okf-server** and **dataprep** services.

All defaults are safe for small deployments — every feature works out of the
box with no variables set. Tune them when your sources get large or your
machine has spare capacity.

## Creating repositories from crawls

A crawled website (a single large Markdown file produced by the crawler) is
converted into an OKF repository **server-side**: the okf-server streams the
file, splits it into one concept per page, and ingests the batch — the browser
is never asked to download or process the file. Conversion runs asynchronously:
the create request returns immediately and progress is shown per repository on
the file's Dashboard tab.

| Variable | Default | Purpose |
|---|---|---|
| `OKF_MAX_CRAWL_SOURCE_MB` | `10240` (10 GB) | Maximum crawled-source file size (MB) okf-server will convert into a repository. The limit is enforced against the file size before any processing; a larger file is refused with a clear error telling you which variable to raise. |
| `OKF_CONVERSION_DEBUG` | *(empty)* | Set to `1` to emit fine-grained per-page/per-batch debug lines from the conversion job to the okf-server logs (`[conv:debug]` prefix). Leave unset in normal operation. |

Notes:

- Files up to the cap stream through the server a page at a time — the whole
  source is never held in memory, so the 10 GB default is a policy limit, not a
  memory limit. Raise it only if your storage and crawler genuinely produce
  larger files.
- The same crawl file can be converted multiple times; each repository gets a
  unique name (an automatic `-2`, `-3` … suffix) so conversions stay traceable.

## Parallel indexing

After a repository's concepts are created, each one is *indexed* (chunked,
labelled, embedded) by the dataprep service. Historically this ran strictly one
concept at a time — one global pipeline — so large crawls took hours to index.
Repositories are independent units of work and now index **in parallel**, capped
by two variables that should be raised together:

| Variable | Default | Purpose |
|---|---|---|
| `OKF_INGEST_CONCURRENCY` | `1` | Number of independent drain lanes in the okf-server worker. Each lane claims a different pending concept and drives it through dataprep concurrently. `1` reproduces the historical sequential behavior. |
| `DATAPREP_INGEST_CONCURRENCY` | `1` | Number of concurrent ingest slots per dataprep container. A request is rejected (`429`) only when *all* slots are busy; the worker backs off and retries. `1` reproduces the historical single-flight behavior. |

Sizing guidance:

- The heavy work inside dataprep is calling the LLM (labelling) and the
  embedding service — both are HTTP calls to services that handle concurrency
  natively, so throughput scales close to linearly with the slot count until
  document chunking (CPU) becomes the bottleneck.
- Start with equal values on both variables (for example `6`/`6` on a 24-vCPU
  workstation) and watch dataprep and the model services' headroom. Higher
  `OKF_INGEST_CONCURRENCY` than `DATAPREP_INGEST_CONCURRENCY` just produces
  `429` backoffs; the reverse under-uses the worker.
- Indexing progress per repository is visible on the repository card and in the
  editor; the pending count is a **shared queue across repositories** — with
  lanes draining first-in-first-out across all repos, one repository's pending
  count can sit still while another's clears.

### Why these default to 1 while the import pair defaults to 4

The two pairs look inconsistent on purpose, because **they are limited by
different things**:

- **Import** is bounded by the host's own CPU. The dominant cost is the PII
  sidecar's language-model scan, which runs on the machine and scales with cores.
  A default of 4/4 uses that capacity on a typical host.
- **Indexing** is bounded by the **model services**, not by the host. Each concept
  calls the language model for labelling and the embedding service — both shared,
  and often backed by a single GPU. Adding slots there does not use more of the
  machine; it queues on the model, and on a shared GPU it takes capacity away
  from chat answering.

So a higher index default would not be "faster by default" — it would be a
default that slows down the assistant. Raise this pair deliberately, against the
model services' headroom, not against the core count.

## Import capacity (creating a repository)

Importing a repository — from a bundle, from documents, or from a crawl — is a
different pipeline from indexing one, and has its own pair of settings. They
follow the same rule as the drain pair above: **set both halves to the same
value**, because lanes above the worker's capacity queue instead of adding
throughput.

| Variable | Default | Purpose |
|---|---|---|
| `OKF_IMPORT_CONCURRENCY` | `4` | Number of concepts the okf-server importer drives through the pipeline at once. Clamped to `1`–`16`. |
| `PII_WEB_CONCURRENCY` | `4` | Number of worker **processes** in the PII sidecar — how many text scans it can absorb at once. Each holds its own language model (~400 MB), so this is the sidecar's memory knob. |

A rule of thumb for both is **`min(16, cores / 2)`**. It is a starting point, not
a constant: the right value depends on the machine. On a 24-core host, `4`/`4`
uses roughly a fifth of the available processing power.

Every import writes the capacity it actually started with to the service log
under `OKF import lane capacity`, including whether the two settings match — so
an under-provisioned host can be seen in the logs rather than inferred from how
long the import took.

### Import caps

| Variable | Default | Purpose |
|---|---|---|
| `OKF_INGEST_MAX_CONCEPTS` | `1000` | Maximum concepts in one import. A **capacity** setting, not a safety limit. |
| `OKF_INGEST_MAX_ZIP_BYTES` | `268435456` (256 MiB) | Decompressed size of an imported bundle. A **zip-bomb guard** — not a capacity knob. |

`OKF_INGEST_MAX_CONCEPTS` is applied **after** oversized documents are split, so
the number of documents you selected is not the number the cap sees. A single
999-document crawl was measured expanding to 1112 concepts across 89 split
families — an import that looks comfortably within any reasonable limit. If a
large import is rejected, raise the variable rather than splitting the work up;
the limits that genuinely bound the work are the maximum concept length and the
lane settings above.

Suggested values:

| Kind of repository | `OKF_INGEST_MAX_CONCEPTS` |
|---|---|
| Pilot or demonstration | a few hundred |
| Departmental knowledge base | ~1000 (the default) |
| National or crawl-scale base | 10,000 or more — set it deliberately |

## Stuck-drain protection (the reaper)

A concept whose indexing never completes would block its repository from ever
publishing (the publish gate waits for all pending concepts). The worker's
*reaper* dead-letters such concepts to a visible `failed` state so the
repository can be recovered by re-ingesting. Two properties make it safe for
deep crawl backlogs:

| Variable | Default | Purpose |
|---|---|---|
| `OKF_INGEST_WORKER_REAP_GRACE_MS` | `3600000` (1 h) | A concept that has been *claimed* by a worker lane but not completed after this long is assumed lost (worker restart or a callback that never arrived) and is dead-lettered. |
| `OKF_INGEST_WORKER_MAX_CLAIMS` | `8` | A concept claimed more than this many times without ever completing is treated as poison and dead-lettered instead of looping forever. |

Waiting concepts — the normal case in a large backlog — are **never** reaped,
no matter how old they are or how deep the queue. Only claim state (a stale
claim or too many attempts) triggers a dead-letter.

## Related variables

These are set once per deployment and rarely touched; they are listed in the
environment template with the rest of the secrets:

- `OKF_INTERNAL_SECRET` — shared secret authenticating dataprep's
  completion callbacks to okf-server (fail-closed: must be set on both sides).
- `KC_OKF_SERVER_CLIENT_SECRET` — okf-server's service-account secret for
  service-to-service calls.
- `OKF_INGEST_WORKER_ENABLED`, `OKF_INGEST_WORKER_INTERVAL_MS`,
  `OKF_INGEST_WORKER_SWEEP_INTERVAL_MS` — worker on/off switch, drain poll
  cadence, and housekeeping sweep interval.