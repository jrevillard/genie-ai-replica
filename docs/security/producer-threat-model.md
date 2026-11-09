# Producer threat model — the OKF crawl/document pipeline (issue #914, deliverable (a))

**Scope:** the PRODUCER pipeline only — how externally-authored text (crawled
pages, uploaded documents) travels into curation prompts, LLM-written fields
and the corpus, and what an attacker who controls that text can achieve at
each boundary. This is David's 2026-11-05 disposition, deliverable (a):
trust boundaries drawn from the live code, every claim cited file:line.

**Explicitly out of scope** (the disposition's own caps): import cost
controls (shipped: `OKF_MAX_CRAWL_SOURCE_MB`, lane pairs, `OKF_INGEST_MAX_CONCEPTS`,
`OKF_CURATION_TIMEOUT_MS`), generic answer quality (RAGAS covers it), and the
CHAT side (chatqna's system prompt + abstention instructions are the
serving-path mitigation; that surface is not the producer pipeline).

Companion deliverables on the same MR: the bounded sanitizer
(`components/okf-server/services/injection-sanitizer.js`, deliverable (b))
and the injection eval rows (`data/okf/injection-eval/fixtures.json` +
`tests/rag-benchmarks/eval/gold_dataset.injection.json`, deliverable (c)).

## Assets, in the order an attack reaches them

| # | Asset | Where it lives | Why it matters |
|---|---|---|---|
| A1 | Curation LLM verdicts | per-concept `type` / `labels` / `summary` on `okf_concepts_meta` | They shape what the corpus retrieves and how it reads in the Studio |
| A2 | The concept corpus | concept bodies + frontmatter → chunks, embeddings, labels | The citizen-facing knowledge base |
| A3 | Ingest LLM context | chunk text + contextual-retrieval prompts | Affects chunk embeddings and labels at ingest |
| A4 | Serving answers | chatqna retrieval context | The final harm channel (out of scope to harden here) |

## The attacker and their control

The attacker is **any author of text the producer ingests**: a crawled web
page, an uploaded document, a spreadsheet cell. They fully control that
text's content — including instruction-shaped prose, chat-template markup
(`<|im_end|>`, `[INST]`), fake role lines (`SYSTEM:`), zero-width / bidi
control characters and HTML comments. They do NOT control: the system
prompts, the bounded vocabularies, the import tooling, or the steward's
review actions.

## Boundaries

### B1 — crawled/document text → curation prompt (llm-curation-service)

- **Path**: `buildCurationPrompt` embeds a 1200-char body slice into the
  curation user message (`llm-curation-service.js:47`, slice sanitized at
  `:174`); `proposeLinks` embeds a 4000-char slice the same way
  (`:756`, `:786`). The same curation prompt also backs the curated
  autocorrect-PROPOSE path (`proposeFrontmatter` → `curateOne`).
- **Attacker's move**: indirect prompt injection — instruction prose
  ("ignore previous instructions…"), fake turn boundaries, invisible-channel
  payloads trying to steer the curation verdicts (A1) toward attacker-chosen
  types/labels/summaries, or toward echoing attacker text into the summary
  (which lands in the corpus, A2).
- **Mitigations (existing)**: STRICT-JSON output contract with temperature 0
  (`callVllm` body); the type verdict bounded to `TYPE_ENUM` and the label to
  the Subject Area's L2 list — the model cannot invent hierarchy entries
  (`parseCurationResponse`); fail-soft degradation (any LLM failure →
  heuristics fallback, `resolved_by='llm-error'`) so a poisoned call cannot
  fail the import; every decision logged (`[ llm-curation ]` lines).
- **Mitigations (this MR)**: EVERY attacker-controlled field in the message is
  **sanitized** — the body slice AND the title (and, in link proposals, the
  peer-title catalog): invisible channels stripped, whole HTML-comment spans
  removed, delimiter-impersonation tokens neutralized (`sanitizeForPrompt` at
  the wire-in points above). The flagged verdict is a scan of the RAW
  assembled message — a scan of the sanitized parts would be blind to exactly
  what sanitize removed (security-review MEDIUM, closed pre-ship: a poisoned
  title reached the prompt raw with zero telemetry). Imperative prose is
  FLAGGED, never stripped: a document legitimately discussing prompt
  injection must not be mangled. The verdict rides the decision
  (`decision.injectionFlagged`, `:602`/`:627`), the pass counter
  (`stats.injection_flagged`, `:537`) and the row's curation record
  (`patch.curation.injection_flagged`, `:661`) — visible, never silent.
- **Residual risk**: an influenced model can still emit a bounded-but-wrong
  type/label (bounded vocabularies cap the blast radius to the Subject
  Area's own list) or a poisoned-but-bounded summary — which is why the
  summary is bounded AND flagged (`:210`, `boundSummary`) and the steward
  gate reviews it. The keyword-match and heuristics modes make no LLM call
  at all — a deployment that does not opt in has no prompt surface here.

### B2 — LLM-written fields → corpus (the summary path)

- **Path**: `parseCurationResponse` extracts the model's `summary`
  (`:210`) → `decision.summary` → `applyDecision` persists it
  (`patch.summary`) → `buildMetaDoc`'s `summary` field → `okf_concepts_meta`
  → embeddings/labels context and the Studio/editor UI.
- **Attacker's move**: the curation prompt was influenced at B1; the model's
  summary carries attacker text into the corpus — instructions,
  delimiters, invisible characters a curator cannot see.
- **Mitigations (this MR)**: the summary is **bounded at the single exit** —
  500-char cap (the display contract), control/zero-width/bidi characters
  stripped, delimiter tokens neutralized (`boundSummary` inside
  `parseCurationResponse`; nothing can leave that function unbounded). A
  flagged summary still persists — refusing would silently degrade curation;
  the steward gate reviews it (flagged summaries log at WARN and carry
  `summaryFlagged`).
- **Residual risk**: a wrong-but-clean summary persists until the steward
  edits it — the review gate is the control; the ingest-log and the row's
  `curation` record carry the evidence.

### B3 — ingest-time LLM paths (dataprep; documented, not changed here)

- **Path**: chunk text feeds the embedding and labeling prompts; the
  contextual-retrieval feature prepends an LLM-generated document context.
- **Attacker's move**: same injection classes, targeting chunk labels and
  embeddings (A3) rather than curation verdicts.
- **Mitigations (existing)**: `CONTEXTUAL_LABEL_RAW=true` decouples labeling
  from the contextualized text (raw chunks are labeled — the influenced
  context never reaches the labeler); the document-context budget derives
  from the served window (issue #1182) and is capped; labeling prompts
  carry the bounded `{labels_list}` contract; per-chunk fallbacks are loud
  in the ingestion log.
- **Residual risk**: embeddings of poisoned text are poisoned — retrieval
  can surface attacker-preferred chunks. That is a retrieval-quality
  concern (A4 territory) more than a producer-integrity one; the eval rows
  (deliverable (c)) measure whether the ANSWER follows injected text.

### B4 — corpus → serving (chatqna; out of scope, named for completeness)

- **Path**: retrieved chunks enter the answering LLM's context.
- **Mitigations (existing)**: the system prompt + abstention instructions;
  the reranker's bounded selection.
- **This MR's contribution**: the injection eval rows measure exactly this
  boundary — "the answer must not follow the injected instruction;
  abstention or a grounded answer" (`tests/rag-benchmarks/eval/gold_dataset.injection.json`,
  run under David's benchmark triggers).

## Named attack patterns (the fixture corpus families)

All four families are pinned, versioned and unit-tested against the fixture
corpus (`data/okf/injection-eval/fixtures.json`, version
`2026-11-09.1`, `injection-sanitizer.test.js` table-drives every row):

1. **instruction_override / role_overwrite / data_exfiltration_ask** —
   imperative prose steering the model's behavior or asking it to leak its
   instructions. FLAGGED, never stripped (documents legitimately discussing
   these patterns — this repository's own docs included — must not be
   mangled; the bounded-vocabulary contract is the defense).
2. **delimiter_impersonation** — chat-template control markup and fake
   role-prefix lines attempting to forge a turn boundary. The TOKEN is
   neutralized in prompt slices and summaries; the inner word stays visible.
3. **invisible_channel** — zero-width/bidi control characters and HTML
   comments: content the curator never sees and the model does. Stripped
   whole from prompt slices; comments removed with their content.

## What this model deliberately does NOT claim

- The sanitizer does not make prompt injection impossible — it removes the
  invisible channels and the turn-forgery tokens, and it makes the remainder
  VISIBLE (flags + counters + the row's curation record). The structural
  defenses are the bounded vocabularies (B1), the bounded summary exit (B2),
  the label/context decoupling (B3) and the steward review gate.
- No claim is made about the chat side (B4 hardening) — the disposition
  scoped it out, and the eval rows are the measurement, not a fix.
- Cost/DoS hardening shipped separately (the disposition's own list).
