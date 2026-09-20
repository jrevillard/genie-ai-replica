# Story 1.0b — Boundary Probe: `graph_names` survives the deployed mega-service

**Status:** IN-PROGRESS — unit leg DONE 2026-09-20; live-deploy leg (LG-5
launch gate) requires a real retriever container POST and is queued as a smoke
harness extension (`scripts/check-okf-retriever-boundary.py`, runs on
`release/el-salvador`).
**Sources:** [ADR-okf-023](../../../docs/adr/okf-023.md) (label-contract carrier is
the proven pattern), [ADR-okf-039](../../../docs/adr/okf-039-retrieval-mode-governance.md),
[fan-out course-correction](../planning-artifacts/okf-fanout-course-correction-2026-09-20.md)
amendment E (router selection cache + transport shape decision gates the rest of
Epic 1).

## Story

As a **platform engineer**,
I want **to prove `graph_names` survives the ChatQnA → retriever boundary in the
deployed stack**,
So that **fan-out code is not built on an unverified transport assumption**.

## Acceptance criteria

1. **Carrier: extend `label_contract.py`** — the proven
   `encode_filter_labels` / `decode_filter_labels` (the `search_start::labels:`
   segment) is the established workaround for the OPEA mega-service's
   dropped-custom-fields gap. `graph_names` rides a parallel
   `::graphs:<comma-separated>` segment; chatqna encodes (in `align_inputs`,
   next to the existing labels encoding), retriever decodes at the top of
   `invoke()` BEFORE any `search_start` reads — same decode point that
   `label_contract.decode_filter_labels` already uses
   ([genieai_retriever_arangodb.py:769-774](file:///d:/ITU-Gitlab/genie-ai-overlay/retriever/genieai_retriever_arangodb.py#L769)).
2. **In-process probe (LG-5 unit leg)** — pytest asserts: empty input is the
   no-op path (no segment emitted); round-trip preserves any graph set; the
   base mode survives intact (`chunk`/`node`/`edge`); labels and graphs
   segments coexist without interfering with each other.
3. **Live-deploy probe (LG-5 integration leg)** — a real HTTP POST to
   `/v1/retrieval` on the deployed retriever container must show `graph_names`
   arriving at `invoke()` (asserted in logs/span). The probe is a small
   standalone script (under `scripts/check-okf-retriever-boundary.py` or
   similar), runnable on `release/el-salvador`, that proves the carrier end to
   end.
4. **The probe is the LG-5 launch gate** — Story 1.1 fan-out cannot merge
   until this is GREEN. If the carrier fails the live probe, the chosen
   transport is wrong (no production code change in this story — only the
   probe + the carrier extension).
5. **Documentation** — ADR-023 updated to name the third segment, and the
   chatqna + retriever module headers carry the contract reference.

## Non-goals / later waves

- Story 1.2 (chatqna → retriever production forwarding) rides this probe's
  outcome — no fan-out code lands until the carrier is GREEN.
- Story 1.3's ≤20ms router selection cache is independent of the carrier.

## Verification plan

- pytest for the carrier module (new tests appended to `test_label_contract.py`,
  house pattern) — 41 tests pass (24 legacy + 17 new for the graph-names carrier);
  ORDER-INSENSITIVE dual-segment decode is pinned (peels whichever marker appears
  FIRST, then handles the other inside the consumed tail).
- retriever `genieai_retriever_arangodb.py` decode point switched to the new
  `decode(...)` and now populates `input_dict["_encoded_graph_names"]` so the
  Story 1.1 fan-out orchestration can read it from the same code path that
  already exposes `_encoded_filter_labels`.
- chatqna `align_inputs` keeps the legacy `encode_filter_labels` call surface
  when graphs is empty (existing chatqna test mocks the shim); only the
  graphs-present path uses the new combined `encode(...)`.
- Live boundary script: deferred to a follow-up deploy (smoke harness
  extension, runs on `release/el-salvador`). The unit leg is sufficient for
  Wave R4 — R5 (1.2 production forwarding) is the natural moment to land the
  live-deploy assertion alongside the production code it gates.
- Rerun in CI before Story 1.1 merges.
