⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
**Blind review of `part-b-code-diff.patch`. Scope: code only, no spec/repo. Note: patch file itself truncated — 113 test lines hidden ("... (113 lines truncated)"). Reviewed visible portion only.**

## Blockers / Majors

**1. AQL injection surface — `genieai_retriever_arangodb.py:185-198` (and `:146-147`)**
```python
aql = f"""
    FOR doc IN {view_name}
        SEARCH ANALYZER(doc.{ARANGO_TEXT_FIELD} IN TOKENS(@query, @analyzer), @analyzer)
        ...
        RETURN {{ "key": doc._key, "text": doc.{ARANGO_TEXT_FIELD}, "file_id": doc.{ARANGO_FILE_ID_FIELD}, ... }}
"""
```
`@query`, `@analyzer`, `@n` correctly bind-var'd. But `view_name` (`= f"{graph_name}_BM25_VIEW"`), `graph_name`/`collection`, and `ARANGO_TEXT_FIELD`/`ARANGO_FILE_ID_FIELD` are **f-string-interpolated into the query body**. `graph_name` is per-request (comment at `:119`, "graph_name is per-request"). The user query is safe, but `graph_name` is not — any value flowing from a request into `graph_name` is direct AQL injection. The whole point of bind vars is defeated by interpolating an adjacent identifier. **Severity: major** (blocker if `graph_name` ever sourced from request input — cannot prove from diff).

**2. Hybrid skipped when dense returns empty — `genieai_retriever_arangodb.py:231`**
```python
if HYBRID_RETRIEVAL_ENABLED and search_start == "chunk" and search_res:
```
Guard requires `search_res` non-empty. If dense finds nothing, BM25 channel never runs and fusion is skipped — exactly the case BM25 is meant to rescue (rare-term / keyword / exact-match queries dense ranks poorly). Defeats the stated purpose. The spec blurb claims BM25 "recovers exact-match / rare-term / keyword-heavy queries"; this guard throws away that recovery precisely when dense recall = 0. **Severity: major.**

**3. `_bm25_search` docstring is false — `:174-181` + `:182`**
Docstring: *"Never raises — logs and returns []."*. But `_ensure_bm25_view(graph_name)` is called at `:182` **outside** the `try` (try begins at the `aql.execute` call, `:203`). `_ensure_bm25_view` raises on first failure (`:168 raise`). So on first view-create failure `_bm25_search` propagates. It only becomes "never raises" after the failure is cached. Caller happens to wrap in try (`:232-246`) so no crash today — but contract is wrong, and any future caller trusting the docstring is broken. **Severity: major** (latent).

**4. Failure caching in `finally` prevents self-heal — `:169-172`**
```python
finally:
    self._bm25_views_ensured.add(graph_name)
```
`finally` runs on success AND on exception (`raise` at `:168` executes before `finally`). A transient ArangoDB error (network blip during boot) marks the graph "ensured" permanently → BM25 channel silently disabled for that graph for the process lifetime. Comment acknowledges the choice ("should not retry every request") but offers no recovery path. Combined with #2-style skip this can permanently kneecap hybrid for a graph. **Severity: major.**

**5. RRF cross-channel identity is an unverified contract — `:82-110`**
`rrf_fuse` keys on `item["doc"].id`. BM25 path sets `Document(id=row.get("key"))` = `_key` (`:209`). For a doc in both channels to get both contributions, the **dense** path must also set `.id = _key`. Diff shows no dense-path code → cannot verify. If dense sets `id` differently (or not at all / None), every BM25 doc is a fresh key → zero fusion, pure interleaving by single-contribution score. The flagship test (`test_doc_in_both_channels_gets_both_contributions`) only proves the function given matching ids — it does **not** prove the two channels produce matching ids in production. **Severity: major** (contract risk; unverifiable from diff).

**6. Mixed metadata shape across channels — `:208-215`**
BM25 docs get `metadata={"chunk_labels": ..., ARANGO_FILE_ID_FIELD: ...}`. Dense docs (unknown) carry their own metadata shape. Downstream comment at `:250` says *"Retrieve file_id for each chunk using AQL (search_start == 'chunk')"* — if that downstream block reads `doc.metadata[<key>]` rather than re-querying, bm25-surfaced docs in the fused top-k may KeyError or yield wrong/None file_id. Cannot prove dense shape, but the two channels producing divergent `Document.metadata` is a real contract hazard. **Severity: major** (unverifiable).

## Minors

**7. Duplicate-rank double counting in `rrf_fuse` — `:102-109`**
No de-dup within a single channel. If dense (or bm25) returns the same `_key` twice, both rank contributions are summed → inflated score. ArangoDB dense/vector can return dupes under certain traversals. Low likelihood but unhandled. **Severity: minor.**

**8. `int(input.k)` TypeError on None — `:233`**
```python
bm25_n = max(int(input.k), HYBRID_BM25_CANDIDATES)
```
`input.k` None → `TypeError`. Caught by outer try → silent dense-only fallback, masking a malformed request. **Severity: minor.**

**9. `Document(id=...)` kwarg version coupling — `:208-215`**
`langchain_core.documents.Document` accepted `id` only from ~0.2.x. Test note (`:262-268`) confirms Document is a MagicMock at test time, so this constructor path is **untested in CI**. On an older langchain_core, `TypeError` → caught → empty BM25. **Severity: minor.**

**10. Thread-safety on singleton — `:120`, `:143`**
`self._bm25_views_ensured` mutated without lock on a singleton retriever. Concurrent first-request race → two `create_arangosearch_view` calls; second raises (already exists), caught upstream. Benign in practice, non-ideal. **Severity: minor.**

**11. ArangoSearch field-return semantics — `:150-163`**
View built with `includeAllFields: False`, `storeValues: "none"`, listing `chunk_labels`/`file_id` as bare `{}` fields. `RETURN doc.chunk_labels` for non-SEARCH fields under these flags can yield `null` in some ArangoDB versions → `_chunk_passes_label_filter(None, …)` returns False → chunk silently dropped. Not provable without ArangoDB version, but plausible silent data loss. **Severity: minor.**

**12. Negative-weight validation absent — `config.py:40-41`**
`HYBRID_DENSE_WEIGHT` / `HYBRID_LEXICAL_WEIGHT` parsed as bare `float`, no sign/range check. Negative value inverts fusion ranking. **Severity: minor.**

## Summary
Strongest provable defects: **#1 (AQL f-string interpolation of `graph_name`)**, **#2 (dense-empty skips BM25)**, **#3+4 (never-raises lie + cached failures)**. **#5/#6** are unverifiable-from-diff contract risks that the tests do not cover (tests use hand-built docs with matching ids, not real channel outputs). The RRF arithmetic itself is correct and weights apply as documented — no fusion-math bug found.

Cannot fully review: 113 lines of tests truncated in the patch file itself.
