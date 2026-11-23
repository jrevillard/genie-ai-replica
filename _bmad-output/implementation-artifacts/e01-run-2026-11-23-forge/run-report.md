# E01 live run — forge k3s, 2026-11-23 (issue #2118)

The residual of story 4.3 (!1049): the E01 comparison layer shipped, but
`capture-a` had never run against a live venue. This is that run, on the
forge k3s (`namespace genieai`, Helm release `genieai`, chart
`genieai-umbrella` 0.2.183), executed with the protocol's own commands.

Everything in `run-artifacts/` was produced by the harness
(`tests/rag-benchmarks/protocol/run_protocol.py`) — no row, manifest or
report was hand-built.

---

## 1. Legitimacy

**Valid run task.** The protocol layer exists and is complete
(`protocol/e01.py`, `protocol/drivers.py`, `protocol/run_protocol.py`,
`protocol/evaluator-instructions.md`), story 4.3's own record states
"capture-a against a live venue is unproven in this session", and story 4.4
(#1980) needs the measured reference this run produces. The issue's scope
was verified against the deployed reality before any change was made; the
deployed state matched the issue's description except for the chart version
(0.2.183, not 0.2.182) and the two agentic workloads (absent, as stated).

## 2. What the run produced

| Artifact | Command | Result |
|---|---|---|
| `assessment-set.json` | `run_protocol.py validate-set` | 16 cases, valid against the composition floor |
| `config-a.captured.json` | `run_protocol.py capture-a` | 17 rows — 9 answered, 8 security cases skipped, 0 failures |
| `config-a.report.json` | `run_protocol.py reference` | **blocked** — see §4 (the GPU venue's granite instance stopped answering) |
| `reference.manifest.json` | `run_protocol.py reference` | **blocked** — same |
| `config-b.rows.json` / `config-b.manifest.json` | `run_protocol.py assess --config B` | **refused by the gate** — see §5 |
| `e01.report.json` | `run_protocol.py e01` | **refused** — the missing legs are named, verbatim, in §5 |

## 3. The measured reference values (config A) — per dimension, with the surface

The numbers below are what story 4.4 needs in order to agree thresholds.
Each row names the surface it was measured on: the two legs are NOT
comparable numbers (PRD §8 / evaluator-instructions §"E01 comparison
dimensions").

### M-1 — Retrieval quality (chunk level, the anchor's surface)

**Not measured in this run.** The A-leg anchor is the chunk-level surface
(the `rag.candidate_chunk_keys` / `rag.selected_chunk_keys` spans the anchor
harvests). It requires chatqna to answer 2xx, and the venue stopped
answering (§4). No hollow anchor report was written in its place.

What the run does establish for M-1: the venue CAN carry the surface —
the traces tier was enabled, an OpenTelemetry Collector and a
VictoriaTraces instance were brought up, and the collector's spans landed
in VictoriaTraces for `genieai-chatqna`, `genieai-retriever`,
`genieai-reranker`, `genieai-dataprep`, `backend`,
`document-repository`, `agent-service` and `genie-okf-server`.

### M-2 — Answer grounding (answer level)

Surface: the captured answer text per case (config A's response carries no
citation envelope — `metadata.source_documents` is empty on this venue, so
grounding is judged from the answer text against the case's
`reference_answer`).

9 cases answered, HTTP 200 each:

| Case | Grounded in the corpus? | Note |
|---|---|---|
| `e01-ans-purpose` | yes | names the E2E upload-validation purpose |
| `e01-ans-items` | yes | "Item one, Item two, Item three" |
| `e01-ans-formatting` | yes | italic + bold |
| `e01-cite-items` | yes | names Section 1 |
| `e01-lang-es` | yes | Spanish answer, translated by the venue's translation model |
| `e01-lang-zh` | yes | Chinese answer, translated |
| `e01-unans-upload-count` | **no** | answered "at least two test documents" — the corpus does not carry a count (M-3 finding) |
| `e01-fail-saturation` | n/a | the failure case answered normally — config A has no admission lane to fail (M-3 finding) |
| `e01-cancel-checklist` | **no** | answered with the corpus's items — config A has no cancellation (M-3 finding) |

### M-3 — Abstention correctness

Surface: config A's answer text (config A carries no mechanical
`abstained` / `abstention_reason` fields — the response envelope carries
neither).

- 1 `unanswerable` case (`e01-unans-upload-count`) — **answered, not
  abstained**. The legacy RAG path does not abstain on an unanswerable
  question.
- 1 `failure` case (`e01-fail-saturation`) — **answered** (no typed failure
  surface on config A).
- 1 `cancellation` case (`e01-cancel-checklist`) — **answered** (no
  cancellation surface on config A).
- 8 security cases — **skipped** by the protocol's own rule (config A is
  the legacy fixed RAG: no agent surface to authorize or steer). Recorded
  as `status: skipped`, counted apart, never a finding.

These three are findings against config A's behaviour, not against the
reference: they are the reason the E01 comparison exists.

### M-4 — Latency

Surface: the protocol layer's `wall_ms` (monotonic-timed per case at the
capture layer; the anchor's own timing is whole-set).

| statistic | value (9 answered cases) |
|---|---|
| min | 5 210 ms |
| median | 7 349 ms |
| max | 10 230 ms |

All nine are HTTP 200. The spread is the venue's (a shared external GPU
venue plus a CPU-only node); no tolerance band is published here — the
thresholds are story 4.4's to sign.

### M-5 — Resource consumption

**No surface recorded.** Neither leg's rows carry a resource record on this
venue (no token/usage metadata in config A's response envelope), so M-5
carries no number and no comparison. That is the recorded absence, not a
zero.

### The corpus the reference rests on

`GRAPH_SOURCE` holds **3 chunks of one document** (`test-document.md`, the
venue's E2E upload-validation fixture). The corpus fingerprint is
`6c9f73719c04…`; the assessment set digest is `58850161afeb…`; both are
stamped in `config-a.captured.json` and in the manifest chain.

**This is the reference's weakest point and 4.4 must weigh it:** three
chunks of a test fixture make every M-1/M-2/M-3 number a statement about a
fixture, not about the product. A richer corpus needs an ingestion that
works on this venue — see §6, finding 1.

## 4. The anchor leg's blocker — the GPU venue's granite instance

The A-leg anchor needs chatqna to answer 2xx. The venue stopped answering:

| probe | result |
|---|---|
| `GET .../llm/v1/models` | 200 in 0.10 s |
| `POST .../translation/v1/chat/completions` (`google/gemma-3-4b-it`) | 200 in 0.29 s |
| `POST .../embed` | 200 |
| `POST .../llm/v1/chat/completions` (`ibm-granite/granite-4.1-8b`) | **no response** — curl exit 28, `http=000`, timed out at 40/60/120 s |
| the same with `tools` + `tool_choice: auto` | **no response** (40 s) |
| `POST .../llm/v1/completions` (legacy shape) | **no response** (40 s) |
| through the stack: `POST /v1/chatqna` | 500 after 307 851 ms (chatqna log 2026-11-23T15:39:31) |

There is **no 400** in any of it and the tool-calling request is not the
failing one, so this is a different condition from the pre-restart
`auto tool choice requires --enable-auto-tool-choice …` error: the
granite instance accepts the request and never answers it, while the other
two models on the same venue answer in under 0.3 s.

The capture in §3 was produced **before** the venue broke (2026-11-23
~15:05) and is unaffected. The anchor's window closed at ~15:39 (the first
wedged request, logged above).

## 5. The gated config-B leg and the E01 join — the protocol's own refusals

Both are recorded verbatim. Neither a threshold nor a B row was fabricated.

**The gate (config B)** — `run_protocol.py assess --config B`:

```
REFUSED: gated run refused (config B): no reference manifest for corpus
fingerprint 6c9f73719c04… + assessment set digest 58850161afeb…. Run the
A-only reference measurement first (`run_protocol.py reference`).
```

This is the gate's `missing_reference` refusal — the FIRST predecessor.
With the reference manifest in place, the gate's next refusal is
`missing_thresholds`: a **signed** thresholds file referencing that exact
reference manifest, corpus fingerprint and set digest. Story 4.4 signs it,
because the thresholds are the numbers agreed AGAINST the measured
reference (PRD §8: "numerical thresholds are set after measuring the
reference and before assessing the candidate"). The gate verifies presence,
integrity and lineage and never reads the numbers — so there is no way to
produce a legitimate signed thresholds file from inside this run: signing
it would assert an operator's agreement that does not exist yet, and
inventing the numbers would fabricate the baseline the issue forbids.

**The E01 join** — `run_protocol.py e01`:

```
REFUSED: the A-leg reference manifest (…/reference.manifest.json):
[Errno 2] No such file or directory
```

With the reference in place and no signed thresholds, the join's own
refusal follows the same chain: the B-leg gated manifest is the missing
artifact (`E01Refusal(missing_artifact)`).

**What this means for the E01 report.** `e01.report.json` is unreachable
before story 4.4 signs — by the protocol's own load-bearing order, not by
a defect. The issue's acceptance criterion allows exactly this outcome
("OR the typed refusal naming the missing artifact"), and the two refusals
above name their missing artifacts.

## 6. The agentic side — deployed from the umbrella tip

**Method: (a) — a local helm render, applied as manifests, no release
drift.** Chosen over (b) (helm upgrade from the umbrella source, which
Flux reconciles back to main's render) and (c) (pointing the Flux
GitRepository at the umbrella branch) because it leaves the shared
release's state untouched: no chart version bump, no Flux source change,
and the cleanup is exactly "delete what I applied". The operator's
ruling named the least blast radius as the criterion, and this method has
the smallest: nothing that Flux owns is modified.

| workload | source | image | digest (verified from the running pod) |
|---|---|---|---|
| `okf-server` | the umbrella chart's `templates/opea/okf-server.yaml`, rendered locally with the deployed overlay values + `okf.enabled=true` | `registry.opensource.unicc.org/un/itu/genie-ai/genie-ai-okf-server:feat-agentic-foundations-prd-820fc9d7` | `sha256:b0eb9df1bb7d1d7f9dc4fd5e3fda83aeeb003b9e26eface1f6c6765a2706a821` |
| `agent-service` | **no chart template exists** (not on the umbrella either — the chart carries `okf-server` only), so the workload is declared in `run-artifacts/agent-service-manifests.yaml`, mirroring the compose service block and the V08 rehearsal record | `registry.opensource.unicc.org/un/itu/genie-ai/genie-ai-agent-server:feat-agentic-foundations-prd-820fc9d7` | `sha256:45e4e2d04c7925d2d4249caf4fdfeb1c21bb4ac89716283007dfea366a9fab14` |

`feat-agentic-foundations-prd-820fc9d7` is the umbrella tip
(`feat/agentic-foundations/prd` @ `820fc9d75`); the digest is read from the
running pod's `imageID`, not assumed from the tag.

Both pods ran: `agent-service` answers `GET /ready` with
`{"status":"ready","agent_enabled":true}`; `okf-server` answers
`GET /health` with `{"status":"ok","service":"okf-server"}` and is
connected to ArangoDB. Both emit spans into VictoriaTraces.

Two secrets the umbrella's okf tier needs were missing from the cluster
and had to be restored before the pod could start (both reverts are part
of §8):

- `keycloak-proxy-client-secret` — its SealedSecret was `Synced` but the
  Secret had been deleted from the namespace; the sealed-secrets
  controller rematerialised it on request.
- `okf-internal-secret` — present in the overlay's `secrets/` directory but
  **not wired into the overlay's `kustomization.yaml`**, so it was never
  applied. Wired for the run, reverted at the end.

## 7. The retriever pod's `ContainerStatusUnknown`

**Cause: node ephemeral-storage exhaustion, not the retriever.** The pod's
`DisruptionTarget` condition reads:

> `TerminationByKubelet` — "The node was low on resource:
> ephemeral-storage. Threshold quantity: 4211081688, available: 0."
> (2026-11-19T06:54:09Z)

The kubelet evicted the container and the pod was never reaped: a
terminated container with no status left behind by the eviction. Its
replica-mate (`…-retriever-6bfd45b48b-h66th`) has been `1/1 Running` for
the whole time, so the service never lost a ready replica. The node is
healthy now (`DiskPressure=False`, 15.9 GB ephemeral-storage allocatable).

**What was done:** nothing to the shared workload. The pod is a dead
tombstone from a 4-day-old eviction; reaping it (or letting the ReplicaSet
replace it) is the operator's call on a shared stack, and the run's own
resources were the only thing this run touched. The watch item it raises
is the disk: the run added a collector, a VictoriaTraces instance, an
okf-server and an agent-service to that single node.

## 8. The restore and the cleanup

Recorded in `restore-and-cleanup.md` (the proof, item by item).

## 9. Extracted findings

Each is a distinct defect, out of this issue's scope, filed as a backlog
issue (never promoted):

1. **The dataprep slim image cannot ingest a document on a venue whose LLM
   does not do native function calling** — `json-repair` is in
   `requirements-cpu.txt` but NOT in the slim lock, and the fallback path
   raises `ImportError` instead of degrading.
2. **The chart's observability tier hard-depends on the OpenTelemetry
   Operator's CRDs** — without them, enabling the traces tier fails the
   WHOLE release upgrade ("no matches for kind OpenTelemetryCollector"),
   and the deploy overlay ships neither the operator nor a note that the
   tier needs it.
3. **VictoriaTraces cannot run on the forge node's filesystems** — its
   mmap of the index files fails with `ENODEV` (tmpfs AND the
   disk-backed class), and the chart exposes no way to pass
   `-fs.disableMmap`.
