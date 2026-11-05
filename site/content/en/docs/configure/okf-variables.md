---
title: "OKF Configuration Variables"
description: "Environment variables for the OKF knowledge repositories — the master switch, crawl conversion and import limits, parallel indexing, the drain worker, access-control mode, the LLM curation engine, and RAGAS benchmarking."
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

## The OKF master switch (`OKF_ENABLED`)

| Variable | Default | Purpose |
|---|---|---|
| `OKF_ENABLED` | `0` (parked) | `1` runs the full OKF stack; `0` parks every OKF surface. Must be `0` or `1`. |

With the flag **parked** (`0`):

- The three OKF containers — **okf-server**, **pii-service**, **ragas-service** —
  run at **zero replicas** (nothing OKF executes anywhere).
- The `/api/okf` gateway route is **not created** — the API surface does not
  exist from outside.
- The Admin Dashboard hides the **OKF Studio** and **Models** tabs. The
  Query Inspector tab is not gated and stays visible.
- The chat backend answers with the **legacy retrieval posture** — no OKF
  connection is attempted, so a parked deployment never burns timeouts
  against a service that is not running.

With the flag **on** (`1`) everything described on this page and in the
[OKF Studio docs](/docs/knowledge-base/okf-studio/) works as documented.

{{% alert title="Deployments that use OKF must set the flag" color="warning" %}}
The default is parked. If your deployment uses OKF Studio, set
`OKF_ENABLED=1` in `.env` (Compose) or `okf_enabled: "1"` in your Ansible
`group_vars` — otherwise the stack comes up parked after an upgrade and the
OKF tabs and containers will be absent. On plain Compose the containers also
sit behind the `okf` profile (`docker compose --profile okf up -d` — the same
convention as the observability stack); Docker Swarm ignores profiles and
scales on the variable instead. Changing the value requires recreating the
affected containers (and re-applying the gateway config), not just a restart.
{{% /alert %}}

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
| `OKF_MAX_IMPORT_FILES` | `100` | Maximum documents in one documents-import. The Studio refuses a larger selection with "too many documents selected — raise `OKF_MAX_IMPORT_FILES`". |
| `OKF_MAX_CONCURRENT_CONVERSIONS` | `2` | How many crawl-to-OKF conversion jobs may run at once across the deployment. |
| `OKF_XLSX_ROWS_PER_CONCEPT` | `200` (clamped 10–500) | Rows per concept when importing an xlsx workbook (FR-42 dictionary import). |
| `OKF_CSV_ROWS_PER_CONCEPT` | `200` (clamped 10–500) | Row-group size when importing a CSV. |

`OKF_INGEST_MAX_CONCEPTS` is applied **after** oversized documents are split, so
the number of documents you selected is not the number the cap sees. A single
999-document crawl was measured expanding to 1112 concepts across 89 split
families — an import that looks comfortably within any reasonable limit. If a
large import is rejected, raise the variable rather than splitting the work up;
the limits that genuinely bound the work are the maximum concept length and the
lane settings above.

### The per-concept document ceiling (`OKF_MAX_CONCEPT_DOC_CHARS`)

| Variable | Default | Purpose |
|---|---|---|
| `OKF_MAX_CONCEPT_DOC_CHARS` | `250000` | Maximum characters in ONE concept document. An oversized source page is split losslessly against this ceiling at import (the "split families" the concept cap counts above). |

This is the bound that actually protects the machine when
`OKF_INGEST_MAX_CONCEPTS` is raised — keep it at the default unless you have
measured that your model window tolerates larger concepts.

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

### Drain worker internals (rarely touched)

The worker's cadence and job windows. Defaults are safe everywhere; these are
listed for completeness because they are real, wired variables.

| Variable | Default | Purpose |
|---|---|---|
| `OKF_INGEST_WORKER_INTERVAL_MS` | `15000` | How often the worker polls for pending concepts. |
| `OKF_INGEST_WORKER_JOB_POLL_MS` | `5000` | How often an in-flight job is polled for completion. |
| `OKF_INGEST_WORKER_JOB_TIMEOUT_MS` | `1800000` | Flat 30-minute window for one concept's drain job. |
| `OKF_INGEST_WORKER_CYCLE_TIMEOUT_MS` | `1800000` | Window for one worker cycle. |
| `OKF_JOB_WINDOW_ADAPTIVE` | `false` | Size-adaptive job windows (per-chunk sizing) instead of the flat window. |
| `OKF_JOB_WINDOW_FLOOR_MS` / `OKF_JOB_WINDOW_MAX_MS` | `1800000` / `21600000` | The adaptive window's floor and 6-hour cap. |
| `OKF_JOB_WINDOW_SEC_PER_CHUNK_MS` | `5000` | Adaptive sizing: milliseconds budgeted per chunk. |
| `OKF_INGEST_WORKER_SWEEP_INTERVAL_MS` | `3600000` | Housekeeping sweep cadence (stale-claim reap runs here). |
| `OKF_INGEST_WORKER_SWEEP_GRACE_MS` | `3600000` | Grace before the sweep acts on stale state. |
| `OKF_CLAIM_STRATEGY` | `fifo` | Lane claim order; `fair` = least in-flight repository first. |
| `OKF_REPO_INGEST_CAP` | `0` (unlimited) | With the fair strategy, a per-repository cap on concurrently claimed concepts. |
| `OKF_KICK_429_COOLDOWN_MS` | `15000` | Cooldown after dataprep answers `429` (all slots busy). |
| `OKF_KICK_BACKOFF_BASE_MS` / `OKF_KICK_BACKOFF_MAX_MS` | `0` / `900000` | Exponential backoff on dataprep `5xx`; base `0` = off. |

## Lifecycle, bundles and studio drafts

| Variable | Default | Purpose |
|---|---|---|
| `OKF_DELETE_GRACE_HOURS` | `168` (7 days) | Soft-delete window before a deleted repository is purged. |
| `OKF_BUNDLE_MAX_MB` | `100` | Request-body cap (MB) the document repository accepts for the OKF bundle-ingest route — 10× the ordinary upload limit. |
| `OKF_BUNDLE_STORE_TIMEOUT_MS` | `300000` | Timeout for storing a bundle (base64-in-JSON can be tens of MB; the receipt + ClamAV scan can outrun a short timeout). |
| `OKF_SETTLE_LEASE_MS` | `600000` | Lease window serializing concurrent drain "settlers" for one repository. |
| `OKF_STUDIO_DRAFT_TTL_DAYS` | `30` | Wizard drafts older than this are swept (a draft always outlives a repository deletion). |
| `OKF_STUDIO_DRAFT_SWEEP_INTERVAL_MS` | `3600000` | Draft sweep cadence. |
| `OKF_STUDIO_DRAFT_MAX_BYTES` | `262144` (256 KiB) | Maximum stored size of one wizard draft. |

## The LLM curation engine

The curation calls (labels, frontmatter drafting, topic-link authoring) run
inside okf-server against the deployment's model endpoint (`VLLM_ENDPOINT`,
`VLLM_LLM_MODEL_ID`, `VLLM_API_KEY` — unset endpoint = the engine fail-softs
to heuristics).

| Variable | Default | Purpose |
|---|---|---|
| `OKF_CURATION_TIMEOUT_MS` | `30000` | Per-call timeout for a curation LLM call. |
| `OKF_CURATION_LANES` | `4` | Parallel curation calls. Lower on a shared GPU. |

### A closed opt-in is reported, not hidden

With `VLLM_ENDPOINT` unset, the legs that follow the deployment opt-in are
OFF: topic links, CSV topics and the manifest summary. A **named model
configuration** (the Admin Dashboard's *Models* tab) does not enable them —
it serves the services its own checkboxes name — so the tab warns when a
configuration is active while the opt-in is closed, and `VLLM_ENDPOINT` is
what turns those legs on.

An import whose CSV topics leg degraded is recorded rather than silent: the
conversion report's per-file entry carries the topic source and a warning,
and the source document's ingestion log carries the reason (see
[Ingestion log](/docs/operate/ingestion-log/)). The file still imports — the
concepts carry the filename slug as their topic.

### Whole-corpus topic-link authoring

The import pass (and the editor's Step 7 *Cross-link topics*) authors the
cross-links a corpus that never cites itself is born without. It is generic —
candidate pairs come from token overlap plus an assistant pass, no domain
assumption — and re-running is safe (existing links are kept, only new ones
are added).

| Variable | Default | Purpose |
|---|---|---|
| `OKF_TOPIC_LINK_ENABLED` | `true` | Run the cross-link pass at import time. `0` skips it — the assistant calls are the only cost worth avoiding. |
| `OKF_TOPIC_LINK_TIMEOUT_MS` | `60000` | Per assistant call (a large batch prompt takes ~25 s). |
| `OKF_TOPIC_LINK_LANES` | `4` | Concurrent assistant calls. |
| `OKF_TOPIC_LINK_BATCH` | `8` | Concepts per assistant call (prompt size vs call count). |
| `OKF_TOPIC_LINK_MAX_PER_CONCEPT` | `6` | Links written per page (graph density). |

### Frontmatter suggestion internals

| Variable | Default | Purpose |
|---|---|---|
| `OKF_FRONTMATTER_VALIDATE_BATCH_SIZE` | `4` | Chunks per tag-validation LLM call. |
| `OKF_FRONTMATTER_PER_LABEL_ROWS` | `4` | Sample rows shown per label when drafting suggestions. |
| `OKF_FRONTMATTER_SAMPLE_N` | `400` | Maximum concepts sampled into the suggestion prompt. |
| `OKF_FRONTMATTER_PROMPT_CHARS` | `20000` | Character budget of the suggestion prompt. |
| `OKF_FRONTMATTER_INCONSISTENCY_THRESHOLD` | `0.3` | Match-ratio slack before a suggested tag is flagged inconsistent with the corpus. |

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
| `OKF_AUDIENCE` | unset | Optional RFC 8707 audience binding: set to `okf-server` to make okf-server reject bearer tokens that do not carry the audience. Unset = no audience check. |

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
| `OKF_RAGAS_TIMEOUT_MS` | `600000` | Per-call timeout okf-server applies to a sidecar request. |
| `OKF_RAGAS_MAX_CORPUS_CHUNKS` | `1600` | Generation-corpus budget. Over the budget the selection is an **even spread across the whole corpus** (never a first-come prefix), and the suite records its coverage ("grounded in 1600 of 5590 chunks"). The knowledge-graph build is per-node model work — an unbounded corpus means an unbounded bill. |
| `OKF_RAGAS_RERANK_CONCURRENCY` | `3` | Benchmark rerank batch calls (32 texts each) in flight at once. Scores are identical at any concurrency — transport, not computation. Global in-flight ceiling is `OKF_RAGAS_RUN_CONCURRENCY` × this value. |
| `OKF_RAGAS_SERVE_URL` | compose chatqna service | SERVE mode (the benchmark default) posts each question to this URL — the same pipeline a citizen question takes — and measures the served answer and contexts. Only a "whatif" run ignores it. |
| `OKF_RAGAS_ANSWER_MAX_TOKENS` | `5000` | The answer leg's INITIAL token budget. A cap, not a reservation — a model that needs less never pays for it; the adaptive ladder still climbs for reasoning models that do. |
| `OKF_RAGAS_CANDIDATE_K` | `24` | Candidate pool of the Lab's own retrieval replay — what failure attribution probes when explaining a miss ("the expected passage is in the corpus but the dense top-24 never surfaced it — raise OKF_RAGAS_CANDIDATE_K"). |
| `OKF_RAGAS_TOP_N` | `3` (falls back to `RERANKER_TOP_N`) | Reranker cut of the replay leg — raise alongside `RERANKER_TOP_N` when attribution blames the reranker. |
| `OKF_RAGAS_SUBMIT_RETRY_DELAYS_MS` | internal default | Retry delays (ms list) when submitting a job to the sidecar; read per call. |

### RAGAS sidecar tuning (rarely touched)

Defaults below were set from live measurements on a shared GPU; change them
only when you have measured the same symptom.

| Variable | Default | Purpose |
|---|---|---|
| `RAGAS_JUDGE_CONTEXT_TOKENS` | `VLLM_MAX_MODEL_LEN` | The judge model's context window; the knowledge-graph input cap derives from it. |
| `RAGAS_DOC_CHAR_CAP` | `auto` | Per-prompt character cap derived from the window; explicit number wins, `0` disables. |
| `RAGAS_DOC_CHAR_MAX` | `48000` | Auto-mode ceiling so huge windows stop somewhere sane. |
| `RAGAS_EMBED_API` | `tei` | `tei` POSTs `/embed` with `{inputs, truncate}`; set `openai` for an OpenAI-compatible embeddings endpoint. |
| `RAGAS_LLM_MAX_CONCURRENCY` | `8` | Judge calls in flight at once — the real ceiling an upstream rate limit has to accommodate. Lower on a stricter or shared plan. |
| `RAGAS_LLM_MAX_RETRIES` | `5` | Retries for a rate-limited (429) call before the question is lost. Backoff is exponential with jitter and honours `Retry-After`. |
| `RAGAS_LLM_CACHE_LEGACY` | `0` | Migration switch for the cache-key fix that binds the judge's ENDPOINT into the cache key. Leave `0` unless the judge endpoint has not changed since old entries were written. |
| `RAGAS_EVAL_MAX_WORKERS` | `8` | Judge calls ragas' own executor runs at once during the scoring leg. Raise together with `RAGAS_EVAL_BATCH_ROWS`. |
| `RAGAS_EVAL_BATCH_ROWS` | `1` | Rows scored per `evaluate()` call — `1` makes the progress bar tick per question. |
| `RAGAS_EVAL_TIMEOUT_SECONDS` | `600` | Per-call scoring budget; a call exceeding it scores NULL for that metric. Keep well under the client's own HTTP timeout. |
| `RAGAS_DO_NOT_TRACK` | `true` | ragas's own per-call usage telemetry — OFF (sovereignty: a public-sector deployment must not ship per-call usage events to a third-party endpoint). Set `false` only deliberately. |

## The Testing Lab's model calls

| Variable | Default | Purpose |
|---|---|---|
| `OKF_RERANK_ENDPOINT` | unset | The TEI `/rerank` endpoint the Lab's corpus probe calls — the same reranker the chat pipeline grounds on. Unset, the probe answers *unknown* with an honest note instead of coverage verdicts. |
| `OKF_RERANK_TOKEN` | unset | Bearer token for that endpoint (cloud deployments against the shared TEI set the same token the reranker stack uses). |
| `OKF_HEAD_TEST_SIBLING_LIMIT` | `20` | Maximum competing heads scored in one routing test. |
| `OKF_ADVISOR_MIN_NEGATIVE_GAIN` | `2` | A simulated tag change must suppress at least this many more negatives to be proposed. |
| `OKF_ADVISOR_MAX_ADDS` | `3` | Maximum forbidden tags the advisor proposes adding per cycle. |
| `OKF_GUARD_SELF_SUBJECT` | `0.55` | Suggestion guardrail: a proposed forbidden tag scoring at/above this against ANY of the repository's own topic/entity/keyword head vectors is rejected as self-forbidding. |
| `OKF_GUARD_DUPLICATE_FORBIDDEN` | `0.9` | Suggestion guardrail: a proposal scoring at/above this against an existing forbidden vector is rejected as a near-duplicate. |

## The PII sidecar

| Variable | Default | Purpose |
|---|---|---|
| `PII_WEB_CONCURRENCY` | `4` | Documented above under [Import capacity](#import-capacity-creating-a-repository) — the sidecar's worker-process/memory knob. |
| `PII_REGION_MAX_CHARS` | `50000` | Max characters per analysis region. A single long scan can starve the sidecar's own supervisor into killing a worker; smaller regions stay under the ~5 s kill threshold. Lower it on a slower host — smaller regions cost a little throughput, never recall. |

## Retrieval mode governance

| Variable | Default | Purpose |
|---|---|---|
| `OKF_RETRIEVAL_MODE` | `legacy` | Boot default for how chat queries reach OKF graphs: `legacy` (the free-form corpus, byte-for-byte), `okf_only`, or `hybrid`. The steward's saved posture (Query Inspector tab) overrides field-by-field once set. |
| `OKF_RETRIEVAL_MAX_FANOUT_GRAPHS` | `5` | Maximum graphs one query fans out across. |
| `OKF_RETRIEVAL_SPINE_MAX_HOPS` | `2` | Graph-spine traversal depth. |
| `OKF_RETRIEVAL_EXTRACTED_HOP_CAP` | `1` | Hop cap for extracted-entity expansion. |
| `OKF_RETRIEVAL_CANDIDATE_CAP_PER_GRAPH` / `OKF_RETRIEVAL_CANDIDATE_CAP_GLOBAL` | `50` / `200` | Candidate caps per graph and per query. |

The carrier semantics and fail-closed behavior on a config outage are in
[Architecture → OPEA microservices](/docs/architecture/opea-microservices/).

## dataprep OKF labeling retries

How dataprep's OKF labeling rides out model-server storms (shared GPU, vLLM
restarts):

| Variable | Default | Purpose |
|---|---|---|
| `OKF_LLM_RETRY_ATTEMPTS` | `5` | Retry attempts on a failed labeling call. |
| `OKF_LLM_RETRY_BASE_MS` / `OKF_LLM_RETRY_MAX_MS` | `2000` / `90000` | Exponential backoff base and ceiling. |
| `OKF_LLM_STORM_COOLDOWN_S` / `OKF_LLM_STORM_COOLDOWN_MAX_S` | `20` / `120` | Cooldown after a burst of failures, and its cap. |
| `OKF_LLM_ROUND2_DELAY_S` | `45` | Delay before the second labeling round. |

## Related variables

These are set once per deployment and rarely touched; they are listed in the
environment template with the rest of the secrets:

- `OKF_INTERNAL_SECRET` — shared secret authenticating dataprep's
  completion callbacks to okf-server (fail-closed: must be set on both sides).
- `KC_OKF_SERVER_CLIENT_SECRET` — okf-server's service-account secret for
  service-to-service calls.
- `OKF_INGEST_WORKER_ENABLED` — the drain worker's on/off switch.