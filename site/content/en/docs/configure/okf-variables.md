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
- **Set both halves to the same value.** Higher `OKF_INGEST_CONCURRENCY` than
  `DATAPREP_INGEST_CONCURRENCY` just produces `429` backoffs; the reverse
  under-uses the worker. Start at half your cores (`12`/`12` on a 24-vCPU
  workstation) and raise it while the model services have headroom — this pair
  is limited by the **GPU/model services**, not by the host, so more slots stop
  helping once the models saturate.
- Indexing progress per repository is visible on the repository card and in the
  editor; the pending count is a **shared queue across repositories** — with
  lanes draining first-in-first-out across all repos, one repository's pending
  count can sit still while another's clears.

### Why the two pairs are limited by different things

The four settings form **two pairs**, and the pairs are bounded by different
resources. This is the part that matters when sizing:

- **Import** is bounded by the host's own CPU **and RAM**. The dominant cost is
  the PII sidecar's language-model scan, which runs on the machine and scales
  with cores.
- **Indexing** is bounded by the **model services**, not by the host. Each concept
  calls the language model for labelling and the embedding service — both shared,
  and often backed by a single GPU. Adding slots there does not use more of the
  machine; it queues on the model, and on a shared GPU it takes capacity away
  from chat answering.

So a higher index default would not be "faster by default" — it would be a
default that slows down the assistant. Raise that pair deliberately, against the
model services' headroom, not against the core count.

## Sizing all four settings for your host

The shipped defaults are conservative and safe, not a recommendation for a
machine of your size. On a 24-core host the import pair of `4`/`4` uses roughly
a fifth of the available processing power — set it deliberately.

All four are **configuration, not hard-coded behaviour**. Set them in your `.env`
(the Docker Compose deployment) or in the Ansible `group_vars`; nothing needs to
be rebuilt. Changing them requires recreating the affected containers, because
the values are read once at process start:

```bash
docker compose up -d --force-recreate okf-server pii-service dataprep-arango-service
```

| Cores | RAM | `OKF_IMPORT_CONCURRENCY` = `PII_WEB_CONCURRENCY` | `OKF_INGEST_CONCURRENCY` = `DATAPREP_INGEST_CONCURRENCY` |
|---:|---:|---:|---:|
| 4 | 8 GB | `2` | `2` |
| 8 | 16 GB | `4` | `4` |
| 16 | 32 GB | `8` | `8` |
| 24 | 64 GB | `12` | `12` |
| 32+ | 64 GB+ | `16` (the clamp ceiling) | `16`, then follow the model services |

The import pair's ceiling is `16`. `PII_WEB_CONCURRENCY` is a **memory** setting
before it is a CPU setting: each worker process loads its own copy of the
detection model, measured at roughly **640 MB per worker** on the current image.
Multiply by the value you choose and leave headroom for everything else on the
host — at `12` that is about 7.7 GB. A host that cannot afford that should
lower the import pair, not raise it into swap.

The index pair has no hard ceiling but a real one: it is whatever the model
services will absorb. If a labelling or embedding call starts failing, or chat
answers get slower during a large drain, this pair is set too high.

### Confirm what a host actually got

Do not infer the setting from timing. Every import writes the capacity it really
started with to the okf-server log, under `OKF import lane capacity`:

```
OKF import lane capacity  repo_id=… concepts=… import_concurrency=12
  pii_web_concurrency=12 paired=true cores=24
```

`paired` is a **configuration** check, not a contention gauge. It is `true` when
this import's lanes do not exceed the sidecar's worker count; `false` means the
extra lanes are queueing at the PII sidecar, which costs latency without adding
throughput. If `pii_web_concurrency` reads `unset`, the two settings were not
applied to the same deployment.

It cannot tell you whether *other* imports are running. Nothing stops a second
import while one is in flight, and each import takes its own lanes — so two
concurrent imports demand twice the scan capacity and both still report
`paired: true`. If you run imports back to back, set the pair for the number you
might run at once, not the number you are running now.

## Import capacity (creating a repository)

Importing a repository — from a bundle, from documents, or from a crawl — is a
different pipeline from indexing one, and has its own pair of settings. They
follow the same rule as the drain pair above: **set both halves to the same
value**, because lanes above the worker's capacity queue instead of adding
throughput.

| Variable | Default | Purpose |
|---|---|---|
| `OKF_IMPORT_CONCURRENCY` | `4` | Number of concepts the okf-server importer drives through the pipeline at once. Clamped to `1`–`16`. |
| `PII_WEB_CONCURRENCY` | `4` | Number of worker **processes** in the PII sidecar — how many text scans it can absorb at once. Each holds its own language model (~640 MB measured), so this is the sidecar's memory knob. |

Size both from the **cores and RAM of the host you are deploying to**, not from
the default. `min(16, cores / 2)` is the rule of thumb — `12`/`12` on a 24-core
host, `8`/`8` on 16 cores, `4`/`4` on 8. Check the memory budget first (see
[Sizing all four settings](#sizing-all-four-settings-for-your-host)), then set
**both halves to the same value**: import lanes above the sidecar's worker count
queue instead of adding throughput, so an unpaired setting costs latency and buys
nothing.

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

## Access control mode (`OKF_SCOPE_MODE`)

Controls which repositories a user's chat queries can reach. Full capability
reference: [Access control](/docs/knowledge-base/access-control/).

| Variable | Default | Values | Purpose |
|---|---|---|---|
| `OKF_SCOPE_MODE` | `open` | `open` \| `closed` | `open` — a user whose JWT carries no `okf:*` scopes is authorized for **all** serving repositories (the intended behavior: every ingested, published repo is queryable by every regular user). `closed` — the historical default-deny: no OKF repository reachable without a granted scope. |

In both modes: a granted scope still restricts its holder to exactly the scoped
repositories (scopes restrict — their absence no longer disables), and the
write side (repo CRUD, ingest, lifecycle, governance) always requires an
`admin` scope or the super-role. Flipping the value needs an okf-server
container recreate, not a rebuild.

The grant facility behind per-repo restriction has its own credentials:

| Variable | Default | Purpose |
|---|---|---|
| `KC_OKF_ACCESS_CLIENT_ID` | `genie-proxy-client` | Service account okf-server uses for grant/revoke and group-role Admin-API writes. The realm template provisions its `realm-management` grants (`manage-users`, `manage-realm`). |
| `KC_OKF_ACCESS_CLIENT_SECRET` | unset | The client's secret. Unset = grants answer `503 ACCESS_CONTROL_UNCONFIGURED`; restriction enforcement is unaffected. |

## RAGAS benchmarking (the Lab's Benchmarks tab)

Backs the RAGAS evaluation feature (see [OKF Studio](/docs/knowledge-base/okf-studio/)).
**No feature is indexed on a specific model** — the judge/embedder variables point at
the deployment's chosen OpenAI-compatible endpoints and default to the deployment's
LLM configuration; per-task model minimums (strict JSON output, window sizes, no
reasoning-token leak into judge completions) are part of the feature's spec.

| Variable | Default | Purpose |
|---|---|---|
| `OKF_RAGAS_URL` | `http://ragas-service:8090` | The ragas-service sidecar's URL as okf-server resolves it. Unreachable = honest `503 RAGAS_UNAVAILABLE` per Lab route — never a hang. |
| `RAGAS_INTERNAL_SECRET` | = `OKF_INTERNAL_SECRET` | Shared secret authenticating okf-server to the sidecar (fail-closed when unset). |
| `RAGAS_JUDGE_BASE_URL` | = vLLM endpoint `/v1` | Judge + testset-generator endpoint (any OpenAI-compatible local server: vLLM, LiteLLM, …). |
| `RAGAS_JUDGE_MODEL` | = `VLLM_LLM_MODEL_ID` | The judge/generator model — must meet the minimums above. |
| `RAGAS_JUDGE_API_KEY` | = `VLLM_API_KEY` | Bearer token for the judge endpoint. |
| `RAGAS_EMBED_BASE_URL` | TEI embedding service | Embedder endpoint (answer relevancy + testset generation). |
| `RAGAS_EMBED_MODEL` | = `EMBED_MODEL_ID` | Embedding model — must be consistent within a run. |
| `OKF_RAGAS_TESTSET_SIZE_DEFAULT` | `20` | The generate form's initial suite size; the user sets the actual dimensions per generation. The suite ships exactly the requested question count. |
| `OKF_RAGAS_MAX_ENTRIES` | `200` | Hard cap per suite (generation + import). |
| `OKF_RAGAS_RUN_CONCURRENCY` | `2` | Per-run question concurrency — bounds LLM load on the shared GPU so benchmarking does not starve chat answering. |
| `OKF_RAGAS_LONG_TIMEOUT_MS` | `3600000` | **Liveness horizon, not a job deadline.** A reachable, running job is never timed out — this bounds only how long an *unreachable* sidecar is retried before the job record fails honestly. A healthy long generation ends only by completing or by the user's Cancel. |
| `OKF_RAGAS_JOB_POLL_MS` | `3000` | How often okf-server polls the sidecar's job registry. |
| `RAGAS_LLM_CACHE` | `1` | Disk judge cache — responses keyed by model+prompt+params persist under `RAGAS_LLM_CACHE_DIR`, so repeat generations of the same repositories skip the whole knowledge-graph phase (minutes to seconds) and suite re-runs re-judge only what changed. `0` disables. |
| `RAGAS_LLM_CACHE_DIR` | `/tmp/ragas-llm-cache` | Where the judge cache lives (inside the container — cleared when the container is recreated; cache IO is best-effort and can never fail a job). |

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