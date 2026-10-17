# Model requirements — minimums per operation class

Companion to SPEC.md. Continues the spec-okf-ragas-benchmarking model-requirements
discipline: nothing is indexed on a specific model; these are the documented floors the
deployment's choice must meet. "Local" floors describe the default vLLM path;
"frontier" floors what the profile's model must provide.

## Per-class minimums

| Operation class | Context window | Strict JSON | Streaming | Output budget | Notes |
|---|---|---|---|---|---|
| Ingestion labeling (`ingest_labeling`) | ≥ 8k tokens (batch = chunks + taxonomy) | REQUIRED (label lists) | no | ~256 tok/chunk | parse+retry per chunk; guided JSON on vLLM, json_schema on frontiers |
| Contextual generation (`ingest_contextual`) | sized by derivation (the DATAPREP_CONTEXTUAL_DOC_BUDGET pattern — derives from the selected window) | REQUIRED (`{"context": …}`) | no | 512+/chunk (RAGAS precedent: 200 was too tight) | never blocks ingest |
| Import curation (`import_curation`) | ≥ 8k | REQUIRED ({type,label,summary}) | no | ~300/concept | bounded label vocabulary in prompt |
| Head/tag generation (`head_tags`) | ≥ 16k (repo context) | REQUIRED | no | ~1500 | truncated-JSON salvage already exists |
| Test-suite generation (`suite_generation`) | ≥ 32k | REQUIRED (class-structured suites) | no | ≤ 6000/call | loop+dedup today; frontier handles in fewer calls |
| RAGAS generation (`ragas_generation`) | ≥ 32k recommended (KG transforms + pair joins) | REQUIRED (RAGAS internals) | no | per-leg caps | window drives `_doc_char_cap`-style KG-input sizing |
| RAGAS judging (`ragas_judging`) | ≥ 32k | REQUIRED (metric outputs) | no | per-metric | default-off toggle |
| Inference (`inference`) | ≥ 32k recommended (prompt + contexts + history) | no (prose; abstention phrasing) | **REQUIRED** for chat UX | answer-sized, capped | local fallback must resume mid-conversation |

## Cross-cutting requirements (all classes)

- **Context-window adherence is mechanical, not aspirational**: the profile carries
  `context_tokens`; every routed leg subtracts prompt overhead + output reserve and
  sizes/clamps its inputs from the remainder (the RAGAS `RAGAS_DOC_CHAR_CAP=auto`
  derivation — `(window − overhead − reserve) ÷ pair-factor × chars/token, clamped` —
  is the canonical formula; per-leg budgets publish through the router).
- **No reasoning-token leakage**: completions must carry answer text only (models that
  emit chain-of-thought in `content` break the parsers — prefer non-reasoning modes or
  strip per provider semantics, e.g. Anthropic thinking blocks are separate by design).
- **Temperature discipline**: send temperature only when a leg needs it; current-model
  400s on non-default values are a provider fact, not an error (see provider-adapters).
- **Latency floors**: frontier TTFT dominates; the class timeout budgets
  (labels 120 s / generation 300–600 s / streaming for inference) exist so a slow model
  degrades to local rather than hanging a job.

## Selection guidance (for the config screen's helper text)

- Any model meeting the class floor works; bigger windows buy larger corpus-context
  budgets, not better labels.
- For the admin set, mid-tier frontier models are usually sufficient — the work is
  extraction and synthesis over provided text, not open reasoning.
- For inference, choose for answer quality in the deployment's languages; the chat
  system prompt and abstention behavior are unchanged by routing.
