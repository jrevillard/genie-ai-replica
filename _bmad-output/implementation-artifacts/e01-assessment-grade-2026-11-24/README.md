# The acceptance-grade assessment set (issue #2151)

The graded E01 assessment set: `assessment-set.json`, digest
`88b270ad42a7` (plain file sha256, the convention the #2148 digest
follows) — it supersedes the #2148 campaign set (digest
`8016d4a26a45…`, 16 cases) as the set a run consumes. Authored
2026-11-24; no venue was touched and no measurement was taken for this
authoring (the re-baseline is the operator-driven campaign after merge).

## Composition (the census, `protocol/evalset.py::coverage_census`)

| surface | cases | what grew |
|---|---|---|
| `retrieval` | 40 | the #2151 floor: 6 inherited + 34 graded, anchor-scored (public, single-turn) |
| `restricted_access` | 14 | new — the permission variety: 2+ retrieval-class cases per restricted fixture |
| `outcome` | 6 | 3 inherited + 3 graded abstention probes (2 public, 1 restricted-context) |
| `security` | 7 | unchanged — every #2148 fixture already carried ≥1 scenario case |

Graded retrieval-case breakdown (34): 16 distinct-fact singles, 3
multi-gold combinations (the set's first cases scoring recall over TWO
chunks), 6 phrasing twins of an existing fact (the rerank-robustness
axis the issue names), 9 language variants (es ×4, fr ×3, zh ×2).

## The gold model

The 16 inherited cases are byte-identical — the measurement instrument
the signed M-1 binds. The graded cases carry Phase-1 gold
(`preview` + `source_doc`, no identity):

- every preview is VERBATIM committed-fixture text;
  `tests/rag-benchmarks/test_assessment_grade_set.py` fails the set if a
  preview is not a normalized substring of the fixture its `source_doc`
  names (the #2145 no-invented-gold rule, mechanical);
- `content_hash` / `chunk_key` and the restricted cases'
  `authorized_source_ids` are venue-resolved products: the served chunk
  text carries the LLM-generated doc-context prefix, so no offline
  computation can produce an honest hash. Until the resolution pass the
  anchor driver REFUSES the graded retrieval gold (`_gold_without_identity`)
  — by design: an unresolved set must not measure.

## What the post-merge campaign does (operator-driven)

1. Seed the corpus on the venue per the fixtures README protocol
   (`tests/rag-benchmarks/fixtures/security-corpus/README.md`) — the
   #2148 method end-to-end, including the forestry label patch;
2. Resolve the graded gold identities: the Phase-2 pass
   (`eval/match_gold_chunks.py --chunk-text-field text` — the served field
   is the contextualized `text`, the #2153 finding; the flag, not the
   `ARANGO_TEXT_FIELD` env var that `run_eval.py` reads) matches every
   preview against the live collection and fills `content_hash`; a
   `build-set` pass (the #2148 pattern) remaps the inherited restricted
   cases' `authorized_source_ids` to the campaign's real file ids AND
   ADDS ids to the 14 graded restricted cases (they carry none, so the
   verdict layer's mechanical subset check stays inert until the campaign
   gives them the real vocabulary);
3. The RESOLVED set lands in a NEW dated campaign artifact directory
   (the #2148 pattern: that campaign's committed set carries its real
   hashes). This directory stays Phase-1 — the identity gate
   (`test_graded_public_gold_defers_identity_to_the_venue`) correctly
   refuses committed hashes here, because an offline-committed hash is
   indistinguishable from an invented one;
4. At the re-sign, reconcile the 16 inherited cases' reference answers
   with the seeded fixtures — four known divergences (all inherited
   byte-identical from the pre-fixture E01 set, preserved by the
   byte-identity gate): `e01-sec-xuser-a/b` name "the civil-protection
   agency" where the shared fixture says "the Regional Emergency
   Management Agency"; `e01-sec-restricted` cites a "classification
   note" the restricted fixture does not contain; `e01-sec-injection-document`
   and `e01-sec-injection-tool` reference answers paraphrase content the
   fixtures do not carry. Correct them or record the divergence the
   evaluator instructions absorb — the reference answers do not touch the
   A-leg anchor (it scores chunks, not answers) but the B/C semantic
   judging reads them;
5. `run_protocol.py validate-set` — the set must validate with its
   resolved identities (67 cases);
6. ONE re-measured A reference + re-signed M-1 on that final
   corpus+set basis — before any B/C verdict is composed (the #2151
   acceptance's single re-baseline).

A preview that fails to match at Phase 2 is reworked or dropped
explicitly, per the #2145 rule — never silently skipped.
