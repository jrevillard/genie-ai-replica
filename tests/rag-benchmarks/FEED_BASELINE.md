# Feed relevance baseline procedure (story 3-11 / ADR 0004)

How to prove that feed-sourced chunks never degrade curated-corpus retrieval,
and that feed retraction never touches file-sourced chunks. Ratified by
[ADR 0004](../../docs/adr/0004-feed-relevance-baseline.md); uses the existing
anchor eval — **no new harness code**.

Prerequisites: read `CLAUDE.md` in this directory (anchor methodology, CLI
positional args, content-hash identity). All commands run ON the swarm node —
substitute your stack's chatqna container name and service names.

## Run 1 — curated-only baseline (feeds OFF)

1. Ensure no feed-sourced chunks exist: all feeds disabled in the `feeds`
   collection (or a fresh corpus that never had feeds on).
2. If feed chunks from earlier experiments exist, retract them first
   (`retract_expired_chunks` or retract their fileIds via dataprep) and verify:
   no chunk with `source_type == "feed"` remains.
3. Run the anchor eval:

   ```bash
   python3 eval/run_eval.py anchor gold_dataset.json baseline-curated-only.json
   ```

4. **This is the baseline.** Keep it with the deployment's records: recall,
   precision, complete_recall, noise per query.

## Run 2 — mixed corpus (feeds ON)

1. Enable the feeds; wait for ingestion to land (dataprep status green, chunks
   with `source_type == "feed"` present).
2. Re-run the anchor eval:

   ```bash
   python3 eval/run_eval.py anchor gold_dataset.json mixed-feeds-on.json
   ```

3. **Acceptance: no recall regression on any gold query** vs Run 1.
   - recall same or better → pass.
   - recall dropped on a query → a feed chunk displaced gold chunks past the
     selection cut. Compare `retrieval_recall` (pre-rerank): if retrieval
     recall held but recall fell, the reranker is ranking feed chunks above
     gold ones — inspect the feed chunk quality before shipping feeds on.
   - precision moves within noise → expected; feed chunks legitimately join
     candidate sets.

## Run 3 — after retraction

1. Let a retraction pass remove expired feed chunks (or trigger one manually).
2. Re-run the anchor eval → `after-retraction.json`.
3. **Acceptance: file-chunk recall unchanged vs Run 1** — retraction removed
   only feed-sourced content. Any regression here means retraction leaked into
   the curated corpus — stop and investigate.

The unit-level invariant behind Run 3 (the retraction AQL filters on
`source_type == 'feed'`, so file chunks are unreachable by construction) is
pinned CI-side in
`genie-ai-overlay/tests/test_stream_ingestor.py::TestRetractionIsolation`.

## Notes

- Chunk identity is content-hash-based; a chunking-parameter change invalidates
  the gold set → re-baseline (signal, not bug). See `CLAUDE.md`.
- All three runs must use the same stack, same gold set, and comparable corpus
  size apart from feed chunks.
- The eval is on-demand (deployed stack); it is not CI-runnable. CI pins only
  the unit invariant.
