# Sweep Protocol — CAP-3 execution

How CAP-3 finds the winning config for an instance. The protocol is structured for the 2-hour budget; every step either runs offline (cheap, deterministic) or live (costly, requires redeploy).

## Inputs

- A CAP-1 profile.
- A CAP-2 baseline config.
- The deployed instance's chatqna container + VictoriaTraces service.
- The 42-query gold dataset (assumed already authored; out of scope here).

## Output

- One recommended config (winner).
- A sensitivity report (per-axis effect size relative to baseline).
- Traceability: every deployed config scored against a specific `adaptive_breakdown` log entry + RAGAS report JSON.

## Step-by-step

### Step 1 — Baseline anchor (mandatory first)

```
python3 tests/rag-benchmarks/eval/run_eval.py anchor \
  <gold-dataset>.json /tmp/baseline-anchor.json
```

This captures the live `adaptive_breakdown` per candidate against the current config. **No redeploy yet.** Wall budget: ~25 minutes for 42 queries.

The captured `adaptive_breakdown[]` is the basis for every offline replay in step 2.

### Step 2 — Offline candidate sweep (pure-function replay)

For each candidate config (typically: baseline + 4 neighbors, e.g. `CONTEXT_DECAY_FACTOR` × 0.5, 1.0, 1.5, 2.0 and `MIN_VALUE_THRESHOLD` × -0.5, -0.25, 0.0):

```
python3 tests/rag-benchmarks/eval/calibrate.py /tmp/baseline-anchor.json \
  --factors 0.0003,0.0006,0.0010,0.0015 \
  --thresholds -0.5,-0.25,0.0 \
  --metric f1
```

The calibrator replays the selection logic against the logged breakdown — pure function of (score, novelty, token_count, factor, threshold). It does not call chatqna. It does not deploy.

Cost: ~5 seconds total.

Output: a top-N cell ranking per candidate, with predicted F1 / recall / precision.

### Step 3 — Top-3 selection

From the offline ranking, pick the top 3 candidates by F1 (subject to a recall floor — recall-only rankings game toward "select everything").

If two candidates differ by <2% predicted F1, keep both as live A/B candidates; if three or more cluster within noise, fall back to baseline + 2 most-diverse neighbors.

### Step 4 — Live A/B (top-3 only)

For each of the 3 candidates:

1. Apply the candidate config via `docker service update --env-add` (or Ansible `image_tag_overrides` for non-env knobs).
2. Wait for the service to converge (`docker service ps` shows Running for 60s).
3. Re-run anchor (`run_eval.py anchor`) → captures the live `adaptive_breakdown` + per-query selection.
4. Optionally run RAGAS (`run_ragas_eval.py`) → 4-metric semantic score. ~15 minutes per config.
5. Record scores + sensitivity deltas.

Total: 3 × (5 min redeploy + 25 min anchor + 15 min RAGAS) ≈ 135 minutes.

### Step 5 — Winner selection

Compare across candidates:

| Winner criterion | Tie-break |
|---|---|
| Higher RAGAS faithfulness | n/a |
| If tie within SE | Higher anchor recall |
| If still tied | Smaller diff from baseline (stability) |
| If still tied | Operator chooses |

Emit the winner config as `vars.yml` patch (only the changed keys, not a full file).

### Step 6 — Sensitivity report

For each tuned knob, the report includes:
- The baseline value + winner value + delta.
- The offline-predicted F1 lift.
- The live-observed RAGAS faithfulness lift.
- A "pivotal" flag — knobs whose win required changing this knob AND where the offline prediction matched the live outcome.

## Failure handling

| Failure | Action |
|---|---|
| Step 1 trace miss (no `reranker_selection` span) | Observability not enabled. Abort + tell operator to set `ENABLE_OBSERVABILITY=1` and re-run. |
| Step 1 anchor file empty (no chunks selected for any query) | Retriever broken. Abort + tell operator to verify ingest. |
| Step 2 calibrator emits NaN | The breakdown has a corrupt entry (zero utility, zero token_count). Skip that candidate. |
| Step 4 redeploy fails | Roll back to baseline; abort + tell operator. |
| Step 4 RAGAS judge times out on >50% of queries | Lower `EVAL_JUDGE_MAX_TOKENS` or switch judge model. The protocol is sovereign-only, so the judge endpoint is a local vLLM — bump `--max-model-len` if the LLM is the bottleneck. |
| Step 5 all 3 candidates within SE noise | Recommend no change to baseline. Document the null result. |

## Determinism guarantees

- Step 2 is pure-function over the captured breakdown. Replays are byte-identical for the same (factor, threshold, confusion formula) combo.
- Step 4 requires deterministic seeding on the eval harness. `capture_baseline.py` already sets `PYTHONHASHSEED`; CAP-3 inherits this.
- The winner selection uses paired metrics per query (not aggregate-only), so the comparison respects within-query variance.

## Wall budget breakdown

| Step | Time |
|---|---|
| 1 | 25 min |
| 2 | 5 sec |
| 3 | <1 min |
| 4 | 135 min (top-3) |
| 5 | <1 min |
| 6 | <1 min |
| **Total** | **~160 min ≈ 2.5h** |

Slightly over the 2-hour target. CAP-3 can drop to top-2 live A/B if Step 4 is the bottleneck (drops to ~95 min). Top-2 is acceptable when the offline sweep is confident.

## What CAP-3 is NOT

- Not a continuous tuner. The protocol runs once per instance-version.
- Not a drift detector. Sweep on demand only.
- Not a multi-reranker A/B. Re-rankers live outside this scope.
- Not a way to deploy the winner automatically. Operator review + manual deploy.