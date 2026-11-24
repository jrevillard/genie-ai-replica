# The FINAL A-reference campaign — forge k3s, 2026-11-24 (issue #2162)

The acceptance-grade set (#2151, !1068) superseded the set digest the
signed M-1 names, so the lineage needed one final confirmation on the NEW
set. This campaign re-seeded the #2148 security corpus on the shared forge
k3s stack (that campaign's own cleanup had retracted it), resolved the
graded gold's venue identities, measured ONE config-A reference through the
protocol's own commands, and restored the venue with proofs. **No signature
is composed here** — the lineage confirmation (or a re-signature) is the
operator's decision. No B/C verdict composed.

## 1. Legitimacy

The issue is the operator-driven campaign the #2151 acceptance README
prescribes as its post-merge step ("ONE re-measured A reference + re-signed
M-1 on that final corpus+set basis — before any B/C verdict is
composed"), dispatched as issue #2162 with the signature reserved to the
operator. The premise was verified against the venue before any work: the
legacy graph sat at the 3-chunk baseline with no named restricted graph and
the observability tier off (the #2148 cleanup's documented end state), so
the set's fixture-referencing gold was unmeasurable without the re-seed the
README itself orders.

## 2. The venue work (deploy / verify / restore)

Dedicated `e01-`-prefixed fixtures only (the committed
`tests/rag-benchmarks/fixtures/security-corpus/`), through the #2148
method with two run-specific adaptations:

- **Serial single-slot ingestion.** The venue's dataprep serves ONE ingest
  slot (`DATAPREP_INGEST_CONCURRENCY=1`); the #2148 batch script's parallel
  submissions 429'd. `serial-ingest-e2162.sh` re-submits each fixture until
  accepted, waiting for the document to settle before the next, with a
  status guard that prevents a double-ingest of an in-flight document (a
  guard the first pass needed: its very first re-POST raced the initial
  submission — the final chunk counts prove no duplication).
  Two script bugs found and fixed on the way (both in the run's own script,
  not the product): a `kubectl exec -i` inside the order loop consumed the
  loop's stdin (fd-3 fix), and the doc-status read the wrong doc-repo field
  (the state lives at `dataprep.status`).
- **The #2121 workaround re-applied**: the slim dataprep image cannot
  ingest on this venue's LLM (no `json_repair`); the pure-python wheel was
  extracted into the running pod at `/app`. Any pod restart reverts it; the
  cleanup restarts the pod.
- **The forestry label patch** (the documented fixture-state patch): the
  five forestry chunks landed with `chunk_labels: []` again — updated in
  place to `["Natural Resources"]` (AQL, recorded in the ledger).

Verification: 18 chunks in `GRAPH_RESTRICTED_E01_SOURCE` (3+4+3+3+5) and 11
in `GRAPH_SOURCE` (3 baseline + 4 + 4) — byte-for-byte the #2148 counts;
all 7 doc-repo records `Ingested`. The chunk counts matching #2148's
exactly is also the no-double-ingest proof for the raced first submission.

The observability tier the A anchor needs (the `reranker_selection` spans):
run-scoped, nothing Flux-owned touched — the collector `OpenTelemetryCollector`
CR + `VTSingle` CR (the chart's own render with the storage block in the
PVC-spec shape the venue's vm-operator webhook accepts, `local-path` +
mmap disabled) + two NetworkPolicies, all run-labeled; chatqna
`ENABLE_OBSERVABILITY=1` (baseline 0, recorded in `before-chatqna-env.json`).
The trace chain was probed end-to-end BEFORE the measurement (one query →
`chatqna.reranker_selection` present in VictoriaTraces at probe time).
One venue observation: the re-applied `VTSingle` came up already holding
the #2148-era traces — the vm-operator re-attached the retained volume
from that run. Harmless here (the eval fetches spans by per-query time
window; the runs are hours apart) but worth knowing when reading VT on this
venue.

## 3. The gold resolution — and the harness defect it surfaced

The #2151 README's two passes, run in order:

1. `match_gold_chunks.py --chunk-text-field text` (the #2153 pin — the
   served field is the contextualized `text`) against `GRAPH_SOURCE`:
   43 of 57 previews resolved, 14 unresolved (exactly the 14 graded
   restricted cases — their gold lives in the restricted graph, which the
   A leg does not serve; their venue product is the `authorized_source_ids`
   pass below, and their hash resolution belongs to the B/C campaign), 0
   skipped-short. The 6 inherited cases' hashes re-resolved IDENTICAL —
   the measurement instrument is unchanged.
2. `build-set-e2162.py`: the inherited cases' `authorized_source_ids`
   remapped from the #2148 file ids to THIS run's (the venue generates a
   fresh id per upload), and the 14 graded restricted cases GAINED their
   ids from the gold's `source_doc`. `validate-set`: **67 cases OK**.

**The first match pass silently gutted the set** — 33 of 67 entries lost
their gold to `match_gold_chunks.py`'s F7 cross-entry passage dedup (MR
!505): every case whose preview resolves to a chunk-key set another case
already resolved to is dropped as a "near-duplicate". That invariant is
right for accidental xlsx double-annotations and exactly wrong for the
#2151 design, where duplicate gold IS the instrument (phrasing twins,
language variants, paraphrase probes over an 11-chunk fixture corpus) — it
emptied 30 graded cases and 3 of the 6 inherited M-1 cases. The run added
`--keep-duplicate-passages` to the matcher (default behavior unchanged,
`duplicate_passages_kept` recorded in the set's `match_run`, unit test
added) and re-ran the resolution with it. Filed as a follow-up finding
(see §7). The gutted first output is not kept as an artifact — the log line
(`deduped_passages=36`) and this section are the record.

## 4. The measurement

Through the protocol's own commands (`run_protocol.py capture-a` +
`reference`, seed 42, `--compute-fingerprint`, `--resolved-env` read live
from the chatqna pod — the !1056 method), with the run-defining
`ARANGO_TEXT_FIELD=text` pin (the #2153 finding; the default hashes the
display-only field and scores a silent all-zero reference).

**Capture-a: 68 rows — 60 ok / 8 skipped / 0 failed.** The 8 skips are the
protocol's own security-surface rows (config A has no agent surface to
authorize or steer — the same `security_skip_rows` behavior #2148
documented; the security scenarios execute on the B/C legs). The coverage
census: 67/67 cases with a resolved surface — retrieval 40, restricted 14,
security 7, outcome 6.

**The reference: 40 anchor-scored cases, 0 missed traces, every case
trace_found.** Every row: 11 candidates (the full 11-chunk legacy corpus),
3 selected (TOP_N=3, slice), gold 1–2 (the set's three multi-gold
combinations scored both chunks). Not a vacuous pass: the rows carry real
candidates and selections, and the aggregate sits at the corpus-shape
ceiling, not at a degenerate zero or one.

| metric | measured | M-1 signed | delta | floor | verdict |
|---|---|---|---|---|---|
| retrieval_recall | 1.000 | 1.000 | 0.000 | ≥ 0.95 | **PASS** |
| recall@10 | 1.000 | 1.000 | 0.000 | ≥ 0.95 | **PASS** |
| ndcg@10 | 1.000 | 1.000 | 0.000 | ≥ 0.90 | **PASS** |
| passage_recall | 1.000 | 1.000 | 0.000 | ≥ 0.95 | **PASS** |
| noise | 0.667 | 0.667 | 0.000 | ≤ 0.80 | **PASS** |

The remaining anchor metrics — recall 1.000, complete_recall 1.000,
precision 0.333, recall@1/3/5 1.000, ndcg@1/3/5 1.000 — are delta-0.000 vs
the signed M-1 values as well. precision/noise sit at the TOP_N=3 /
single-gold construction ceiling, exactly where they sat at signing.

## 5. Lineage (what the operator is asked to confirm)

| artifact | M-1 signed basis (#2148 re-anchor) | this run |
|---|---|---|
| corpus fingerprint | `f82298c0852a39c8…` | `f82298c0852a39c8…` — **unchanged**: the same seven fixtures re-seeded byte-identical after the cleanup; the fingerprint is content-based over the served `text` field |
| set digest | `8016d4a26a45…` (16 cases) | `cb371f1a67d7…` (67 cases — the #2151 extension with venue-resolved identities; the digest move is the documented, expected outcome) |
| evaluator-instructions | `d629ff99e6273f3f` | `d629ff99e6273f3f` — unchanged |

The signature's lineage names the old set digest, so M-1 must be
re-anchored onto this basis to stay coherent. The measured values are
unchanged and every floor holds; the re-signing act itself stays the
operator's.

## 6. Cleanup and the proof

`cleanup-e2148.sh` (the #2148 script, driven from this run's ledger):
retract + delete all 7 files (dataprep retract per ingest graph, then the
doc-repo DELETE), restore chatqna's `ENABLE_OBSERVABILITY=0`, remove the
run-scoped observability objects behind the ownership guard (the overlay's
tier flags are read live; the script refuses when the baseline is not
all-off), restart the dataprep pod (reverts the #2121 wheel), delete the
realm entities, kill the port-forwards, print the before/after proof.
The proof output is appended below.

<!-- CLEANUP_PROOF -->

```text
=== 1. retract + delete the 7 ingested files (retract MUST hit the graph the file was ingested into; the doc-repo DELETE refuses an ingested file, so every file retracts first)
  doc-restricted-e01 (1795534397591_95baf9e6): dataprep retract (graph GRAPH_RESTRICTED_E01) http=200 -> {"status":200,"message":"Retraction Complete. Deleted: 3 Chunks, 33 Edges, 14 Entities.","details":{"deleted_chunks":3,"deleted_edges":33,"deleted_ent
  doc-restricted-e01 (1795534397591_95baf9e6): doc-repo delete http=200
  doc-shared-e01 (1795534398055_4ecc807a): dataprep retract (graph GRAPH_RESTRICTED_E01) http=200 -> {"status":200,"message":"Retraction Complete. Deleted: 4 Chunks, 27 Edges, 20 Entities.","details":{"deleted_chunks":4,"deleted_edges":27,"deleted_ent
  doc-shared-e01 (1795534398055_4ecc807a): doc-repo delete http=200
  doc-wide-e01 (1795534398520_e68eb718): dataprep retract (graph GRAPH_RESTRICTED_E01) http=200 -> {"status":200,"message":"Retraction Complete. Deleted: 3 Chunks, 22 Edges, 22 Entities.","details":{"deleted_chunks":3,"deleted_edges":22,"deleted_ent
  doc-wide-e01 (1795534398520_e68eb718): doc-repo delete http=200
  doc-revoked-e01 (1795534398923_f1756973): dataprep retract (graph GRAPH_RESTRICTED_E01) http=200 -> {"status":200,"message":"Retraction Complete. Deleted: 3 Chunks, 29 Edges, 27 Entities.","details":{"deleted_chunks":3,"deleted_edges":29,"deleted_ent
  doc-revoked-e01 (1795534398923_f1756973): doc-repo delete http=200
  doc-forestry-e01 (1795534399299_d0fa01a8): dataprep retract (graph GRAPH_RESTRICTED_E01) http=200 -> {"status":200,"message":"Retraction Complete. Deleted: 5 Chunks, 31 Edges, 28 Entities.","details":{"deleted_chunks":5,"deleted_edges":31,"deleted_ent
  doc-forestry-e01 (1795534399299_d0fa01a8): doc-repo delete http=200
  doc-catalogue-e01 (1795534400323_753b4ec9): dataprep retract (graph default) http=200 -> {"status":200,"message":"Retraction Complete. Deleted: 4 Chunks, 33 Edges, 27 Entities.","details":{"deleted_chunks":4,"deleted_edges":33,"deleted_ent
  doc-catalogue-e01 (1795534400323_753b4ec9): doc-repo delete http=200
  doc-servicerequest-e01 (1795534400782_7b426ef0): dataprep retract (graph default) http=200 -> {"status":200,"message":"Retraction Complete. Deleted: 4 Chunks, 32 Edges, 30 Entities.","details":{"deleted_chunks":4,"deleted_edges":32,"deleted_ent
  doc-servicerequest-e01 (1795534400782_7b426ef0): doc-repo delete http=200

=== 2. the restricted graph's leftover state (dataprep retract removes its chunks; verify)
  GRAPH_RESTRICTED_E01_SOURCE chunks after retract: None (expect 0 or COLLECTION_GONE)

=== 3. chatqna env restored to the baseline (ENABLE_OBSERVABILITY=0)
Waiting for deployment spec update to be observed...
Waiting for deployment spec update to be observed...
Waiting for deployment "genieai-genieai-umbrella-chatqna" rollout to finish: 0 out of 1 new replicas have been updated...
Waiting for deployment "genieai-genieai-umbrella-chatqna" rollout to finish: 1 old replicas are pending termination...
Waiting for deployment "genieai-genieai-umbrella-chatqna" rollout to finish: 1 old replicas are pending termination...
deployment "genieai-genieai-umbrella-chatqna" successfully rolled out
ENABLE_OBSERVABILITY=0

=== 4. the run-scoped observability objects go (ONLY after the ownership guard: these names are the chart's own observability names — deleting them on a venue whose baseline has the tier ON would destroy Helm-owned objects)
  overlay tier state: baseline-off
  guard ok: the baseline renders no observability objects — the same-named CRs are this run's
networkpolicy.networking.k8s.io "e2148-chatqna-vt-egress" deleted from genieai namespace
opentelemetrycollector.opentelemetry.io "genieai-collector" deleted from genieai namespace
networkpolicy.networking.k8s.io "collector-gateway" deleted from genieai namespace
vtsingle.operator.victoriametrics.com "vtraces" deleted from genieai namespace
vtsingle-vtraces-54c84d7b99-cnlfq                              1/1     Terminating              0              46m

=== 5. the wheel side-install disappears with any dataprep pod restart — force the honest state
pod "genieai-genieai-umbrella-dataprep-67f746fd8d-jw68v" deleted from genieai namespace
deployment "genieai-genieai-umbrella-dataprep" successfully rolled out

=== 6. the realm entities go
  e01-sec-eval users deleted http=204
  e01-sec-eval clients deleted http=204
  e01-sec-eval users gone (verified)
  e01-sec-eval clients gone (verified)

=== 7. the port-forwards go
  no 18082 listener

=== 8. the proof
--- GRAPH_SOURCE back to the 3-chunk baseline:
{"result":[{"file_id":"1794934129627_3d7afab4","chunks":3}],"hasMore":false,"cached":false,"extra":{"warnings":[],"stats":{"writesExecuted":0,"writesIgnored":0,"documentLookups":0,"seeks":0,"scannedFull":3,"scannedIndex":0,"cursorsCreated":0,"cursorsRearmed":0,"cacheHits":0,"cacheMisses":0,"filtered":0,"httpRequests":0,"executionTime":0.007171676028519869,"peakMemoryUsage":163840,"intermediateCommits":0}},"error":false,"code":201}
--- graphs:
[]
--- no run workload:
  clean
--- HelmRelease still at the baseline render:
78 ready=True
  traces:
    enabled: false
--- realm clean: (the two gates above printed gone/verified)
```


## 7. Extracted findings

1. **The F7 dedup vs designed-duplicate sets** (new issue to file): the
   cross-entry passage dedup in `match_gold_chunks.py` (MR !505) empties
   every case whose gold resolves to an already-seen chunk-key set. Sets
   whose duplicate gold is the measurement design (twins/variants/probes)
   are gutted silently — 33 of 67 on this campaign's set. The run's
   `--keep-duplicate-passages` flag is the immediate remedy (default
   unchanged); the deeper question — whether the invariant belongs at
   cross-entry scope at all when the eval scores per case — is the
   follow-up's scope.
2. `tests/rag-benchmarks/eval/CLAUDE.md`'s VT query examples predate the
   LogsQL syntax this VictoriaTraces build serves (label names with a dot
   need quoting; the stream-filter forms error). The campaign probed the
   working forms by hand; the doc's query examples are stale. (Minor;
   bundled into the findings issue.)

## 8. What this means for the signed registry

The FINAL A reference is measured on the full acceptance-grade set; every
registry floor holds; the corpus basis is unchanged and the set basis is
the new one. Per the campaign contract the lineage confirmation /
re-signature is the operator's decision against §5 — nothing here signs,
gates or promotes, and no B/C verdict is composed.
