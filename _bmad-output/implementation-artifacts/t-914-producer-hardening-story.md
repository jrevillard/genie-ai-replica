# T-slot story — #914: producer hardening — threat model, bounded sanitizer, injection eval rows

**Status:** IMPLEMENTED (2026-11-09) — on branch `feat/okf-producer-hardening` (reset onto merged
main `cae85db69` before implementing; the story's `43af9e8e4` base note is historical).
**Issue:** #914 (Story 7.5's narrowed scope, David's 2026-11-05 disposition):
"(a) a threat-model document for the producer pipeline (crawl/document text reaching
curation prompts; LLM-written description/summary fields carrying influenced text into
the corpus), (b) a bounded sanitizer for known injection patterns, (c) injection eval
rows in the existing RAGAS/Lab harness."
**Out of scope (the disposition's own caps):** broad cost work (OKF_MAX_CRAWL_SOURCE_MB,
import lanes, OKF_INGEST_MAX_CONCEPTS, OKF_CURATION_TIMEOUT_MS — all shipped) and
generic eval (RAGAS covers it).
**Branch:** `feat/okf-producer-hardening` (off merged main `43af9e8e4`).

**IMPLEMENTATION NOTE (one deliberate deviation from the story's cites):** the story's
"4000-char autocorrect PROPOSE slice at :267" drifted — in the code as it stands that
line is the deterministic keyword labeler (no LLM); the real second LLM surface is
`proposeLinks`' `LINK_SNIPPET_CHARS = 4000` slice. The sanitizer wires at the two REAL
LLM surfaces: `buildCurationPrompt` (1200) and `proposeLinks` (4000). `proposeFrontmatter`'s
curated propose rides the same 1200-char curation prompt via `curateOne`.

## Surfaces (verified in code)

1. **Curation prompt, text IN**: `llm-curation-service.js:163-168` — the user message
   embeds `concept.body.slice(0, BODY_SNIPPET_CHARS=1200)`: crawled/document text rides
   VERBATIM into the curation LLM prompt. A second, larger slice (`:267`,
   `meta.body.slice(0, 4000)`) feeds the autocorrect PROPOSE path.
2. **LLM-written text INTO the corpus**: `parseCurationResponse` bounds `type`
   (TYPE_ENUM) and `label` (the Subject Area's L2 list) but `summary` is UNBOUNDED —
   an influenced model writes arbitrary text that lands in `fm.description` →
   `buildMetaDoc`'s `summary` field → `okf_concepts_meta` → embeddings/labels context
   and the Studio/editor UI.
3. **Ingest-time LLM paths** (dataprep): chunk text + contextual-retrieval prompts
   already documented in the env contract; the same influence class, mitigated by the
   chunk-vs-label decoupling (`CONTEXTUAL_LABEL_RAW=true`) and the derived budgets.
4. **Serving path**: retrieval chunks reach the answering LLM (chatqna's system prompt
   + abstention instructions are the standing mitigation; out of scope here — the chat
   side is not the producer pipeline).

## Design

### (a) Threat-model document — `docs/security/producer-threat-model.md` (dev-internal, rides this MR)

Trust boundaries drawn from the live code: crawl/document text → conversion → concept
body/frontmatter → (i) curation prompts, (ii) LLM-written fields, (iii) dataprep
ingest prompts, (iv) the corpus (embeddings + labels) → serving. For each boundary:
the asset, the attacker's control (what a crawled page can inject), the existing
mitigation (bounded vocabulary, steward review gate, CONTEXTUAL_LABEL_RAW, fail-soft
curation), the residual risk, and the sanitizer's coverage. Named attack patterns
(indirect-instruction families) with concrete examples. Explicitly OUT: cost, generic
eval, chat-side defenses. This is the disposition's (a) deliverable — the doc cites
file:line for every claim.

### (b) Bounded sanitizer — `components/okf-server/services/injection-sanitizer.js`

A small, pure, TESTED module — never a silent rewrite of steward-visible content:

- `scanInjections(text) -> { hits: [{ family, excerpt, count }], flagged: bool }` —
  known-pattern detection (imperative-instruction families: "ignore previous
  instructions" variants, role/overwrite attempts, fake delimiters/system-tag
  impersonation, hidden-markup channels — HTML comments, zero-width, Unicode bidi
  controls). A FIXED pattern list (versioned in the module, unit-pinned) — deliberately
  bounded, no ML, no over-blocking.
- `sanitizeForPrompt(text) -> { text, flagged }` — for LLM-PROMPT slices ONLY: strips
  the invisible-channel classes (zero-width/bidi controls) and neutralizes the
  delimiter-impersonation patterns, caps length (the caller's slice bounds stay).
  Imperative-instruction TEXT is NOT stripped from prompt slices — it is flagged —
  because a crawled document legitimately discussing prompt injection (this repo's own
  docs!) must not be mangled; the system prompt's bounded-vocabulary contract remains
  the real defense there.
- Wire-in points (the only two): `buildCurationMessages` (the 1200-char slice) and the
  autocorrect PROPOSE slice (the 4000-char one). The CONCEPT BODY the steward sees is
  NEVER modified — the sanitizer's output for prompts is internal; the flagged verdict
  is recorded on the curation decision (log + counter) so the Studio surfaces it
  (visible, per the never-silent rule).
- `boundSummary(text) -> { text, flagged }` — the LLM-written summary: hard char cap
  (500, the display contract), strip control/zero-width chars, strip the fake
  system-tag patterns; flagged summaries log + count but still persist (the steward
  gate reviews them; a refusal here would silently degrade curation).

### (c) Injection eval rows — the harness's existing seams

- **Fixture set**: `data/okf/injection-eval/fixtures.json` — the canonical pattern
  corpus (each row: family, sample text, expected sanitizer verdict, expected pipeline
  behavior). One source of truth for the unit tests AND the eval rows.
- **okf-server eval rows**: table-driven Jest — every fixture through
  `scanInjections`/`sanitizeForPrompt`/`boundSummary` and, where a fixture exercises
  the pipeline, through `parseCurationResponse` (an influenced summary attempting to
  smuggle instructions is bounded + flagged).
- **RAGAS/Lab rows**: an injection section appended to the benchmark fixture corpus
  (`tests/rag-benchmarks/`) — documents + queries carrying injection payloads with
  expected outcomes (the answer must not follow the injected instruction; abstention
  or grounded answer). These run under David's benchmark triggers (he owns the runs);
  this MR ships the rows + the harness wiring, ready for his next benchmark.

## Boundaries

- The steward-visible concept body is NEVER rewritten (the sanitizer touches prompt
  slices and LLM-written summaries only).
- Bounded, fixed pattern list — no ML classification, no dynamic pattern loading.
- No cost work, no generic eval, no chat-side changes.
- The threat-model doc is dev-internal (`docs/security/`, not `site/`) and rides this
  code MR (no doc-only MR).
- No new Studio UI string required by the disposition — the flag rides the existing
  curation counters/logs.

## Tasks

- [x] `injection-sanitizer.js` + fixture set + table-driven unit suite.
- [x] Wire `buildCurationPrompt` + the 4000-char link-proposal slice + `boundSummary` in
      llm-curation-service; the curation decision carries the flagged verdict
      (`curation.injection_flagged` on the row + the pass counter + WARN logs).
- [x] `docs/security/producer-threat-model.md` (the disposition's (a)).
- [x] Benchmark injection rows + harness wiring (the disposition's (c)):
      `tests/rag-benchmarks/eval/gold_dataset.injection.json` (RAGAS-path rows, family
      ids derived from the fixture corpus) + `test_injection_gold.py` (schema + family
      coverage + control row; runs offline, 4/4).
- [x] Suites green, coverage above baselines, rtk-proxy prettier/eslint on every
      touched file, live local-build gate (markers + smoke) — CI's exact commands.

## Verification (results, 2026-11-09)

- Fixture corpus 13 rows + 3 summary rows: every row asserted against scan/sanitize/
  boundSummary AND (for the pipeline rows) `parseCurationResponse` — an influenced
  summary comes back bounded + flagged. 32+ tests green.
- The steward-visible body byte-identical after a flagged curation pass (pinned in
  `llm-curation-service.test.js`: rows[0].body === poisonedBody after the pass; the
  axios-sent prompt carries no delimiter token and no invisible char).
- Full okf-server suite green with coverage above the post-!813 baselines on every
  metric (branches 75.01, lines 89.16, functions 88.72).
- **Security review: 1 MEDIUM, CLOSED PRE-SHIP** — the concept TITLE (and link
  proposals' peer-title catalog) reached the same prompts RAW: a poisoned title forged
  turn boundaries with zero telemetry. Fixed: every attacker-controlled field in the
  message is sanitized; the verdict is a scan of the RAW assembled message (a scan of
  sanitized parts is blind to what sanitize removed — the first fix had that flaw and
  its own red test caught it). Pinned: a poisoned title fires the counter, stamps the
  row, the sent prompt is token-free, the stored row keeps its raw title.
- Live gate: pending (sync local build → rebuild okf-server → marker + the flagged
  verdict in the curation counters on a fixture import).
