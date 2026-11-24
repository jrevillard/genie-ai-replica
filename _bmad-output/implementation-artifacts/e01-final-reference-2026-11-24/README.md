# The FINAL A-reference campaign (issue #2162, 2026-11-24)

The final re-measurement of the config-A reference on the acceptance-grade
assessment set (#2151) — the last piloted step before any B/C verdict
composes. The method is the #2118/#2148 one: dedicated `e01-`-prefixed
fixtures re-seeded on the shared forge k3s stack (the #2148 cleanup had
retracted them), deploy/verify/restore with GET-based proofs, the protocol's
own commands for every measured row. **No signature is composed here** —
the lineage confirmation (or a re-signature) is the operator's decision.

## Artifacts

| file | what |
|---|---|
| `assessment-set.json` | the RESOLVED acceptance-grade set (67 cases): Phase-1 set + venue-resolved gold (content hashes over the served `text` field) + this run's `authorized_source_ids`. Set digest `cb371f1a67d7…` (plain file sha256, `set-digest.txt`) |
| `ingestion-ledger.json` | the run's uploads (server-generated file ids) + ingest outcomes |
| `verify-result*.json` | the seeded state (per-graph chunks, labels, embeddings) |
| `config-a.captured.json` | capture-a: 68 rows (60 ok / 8 skipped / 0 failed) — the A leg's judgment inputs |
| `config-a.report.json` | the reference: the anchor aggregate + 40 per-case rows |
| `reference.manifest.json` | the lineage manifest (corpus fingerprint, set digest, resolved env, evaluator-instructions digest) |
| `findings.report.json` | the findings layer: 68 skipped (the verdict layer does not run on config A) |
| `resolved-env.json` | the config resolved from the live chatqna pod at run time |
| `build-set-e2162.py`, `serial-ingest-e2162.sh`, `run-measurement-e2162.sh`, `analyze-delta-e2162.py` | the campaign scripts (the #2148 scripts adapted: serial single-slot ingestion, the #2151 gold resolution, the floors table) |
| `serial-ingest-log.txt`, `measurement-log.txt`, `cleanup-proof.txt` | the run's execution logs |
| `before-graphs.txt`, `before-graph-source-chunks.json`, `before-chatqna-env.json` | the venue's before-state proofs |

## The result (the deliverable)

| metric | measured | M-1 signed | floor | verdict |
|---|---|---|---|---|
| retrieval_recall | 1.000 | 1.000 | ≥ 0.95 | **PASS** |
| recall@10 | 1.000 | 1.000 | ≥ 0.95 | **PASS** |
| ndcg@10 | 1.000 | 1.000 | ≥ 0.90 | **PASS** |
| passage_recall | 1.000 | 1.000 | ≥ 0.95 | **PASS** |
| noise | 0.667 | 0.667 | ≤ 0.80 | **PASS** |

n = 40 anchor-scored retrieval cases, 0 missed traces, every case
trace_found. The remaining anchor metrics (recall, complete_recall 1.000;
precision 0.333; recall@1/3/5, ndcg@1/3/5 1.000) are all delta-0.000 vs the
signed M-1 values — the corpus-shape numbers M-1 signed are stable as
NUMBERS on the extended set. precision/noise sit at the TOP_N=3 / 1-gold
construction ceiling, as they did at signing.

## Lineage

| artifact | M-1 signed basis (#2148 re-anchor) | this run |
|---|---|---|
| corpus fingerprint | `f82298c0852a39c8…` | `f82298c0852a39c8…` — **UNCHANGED** (the same seven fixtures re-seeded byte-identical; the fingerprint is content-based) |
| set digest | `8016d4a26a45…` (16 cases) | `cb371f1a67d7…` (67 cases — the #2151 extension with venue-resolved identities; the move is the documented outcome of the campaign) |
| evaluator-instructions | `d629ff99e6273f3f` | `d629ff99e6273f3f` — unchanged |

The M-1 signature's lineage names the OLD set digest, so the signature must
still be re-anchored onto this basis — **that act is the operator's**, per
the issue: values unchanged, no re-signature performed by the run.

## The harness change this run needed (see the run report §3)

`match_gold_chunks.py`'s F7 cross-entry passage dedup (MR !505) empties
every case whose gold resolves to a chunk-key set another case already
resolved to. On a set whose duplicate gold IS the design (the #2151
phrasing twins, language variants, paraphrase probes) that gutted **33 of
67 cases** — including 3 of the 6 inherited M-1 instrument cases. The run
added `--keep-duplicate-passages` (default unchanged; tested) and filed the
follow-up.
