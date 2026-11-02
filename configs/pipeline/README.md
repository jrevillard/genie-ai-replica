# Pipeline Settings — what's editable where (Epic K, DEC-29)

Runtime-editable pipeline settings live in JSON files under this directory's
**seed** copies; the admin dashboard's **Pipeline Settings** tab is the edit
surface. This map says what the UI can change, what is hardcoded, and which
file wins.

## Where values live (three layers)

| Layer | File | Role |
|---|---|---|
| Repo (git) | `configs/pipeline/*.seed.json` | First-boot SEED only — copied to a box once (`force:false`); never overwrites live edits |
| **Box (live truth)** | `<deploy_dir>/data/pipeline-settings/*.json` | THE source of truth once seeded; only admin PUTs touch it; survives every redeploy (rsync excludes `data/`) |
| Containers | `/configs/pipeline/*.json` | Bind-mount of the box file (backend rw, pipeline readers ro), re-read per request on mtime/inode change |

Precedence: **per-request API field > settings file > env var (seed only) > coded default.**

## Editable from the UI (admin-only; live on the next request — no restart)

**LLM panel** → `llm-settings.json`:
- `systemPrompt` — the assistant identity body
- `enforceAbstention` + `abstentionInstructions` — behavior when retrieval returns nothing
- `generation`: temperature, topP, repetitionPenalty, frequencyPenalty, presencePenalty, maxTokens (clamped to the model-length budget)

**Retrieval panel** → `rag-tuning.json`: all 24 knobs — retriever counts
(k, fetchK, scoreThreshold, lambdaMult), searchStart, searchMode,
filterStrategy, the traversal set (enable/depth/returned/scoreThreshold/
concurrentBatches), the hybrid set (enabled, rrfK, denseWeight,
lexicalWeight, bm25Candidates), and the reranker set (strategy, threshold,
topN + the 4 adaptive params).

**Ingest section** → `llm-settings.json` `ingest.*` — labelSelectorPrompt and
contextualRetrievalPrompt. ⚠️ Applies only at the **next re-ingestion**
(existing corpus untouched). ⚠️ TRAP: contextualRetrievalPrompt edits the
*per-chunk* prompt, but the deployed strategy is `doc_level` — that field is
dormant until the strategy changes; the doc-level prompt is code-only (below).

## Hardcoded (edit the .py + redeploy — a code change needs the image rebuild)

| What | Where (symbol-first; lines drift) |
|---|---|
| ENGLISH-ONLY rule (DEC-26 language contract) | `genie-ai-overlay/chatqna/genieai_chatqna.py`, inside `align_inputs` — the `MANDATORY: You MUST respond ONLY in English` block |
| Section headers (`USER INFORMATION:` / `CHAT HISTORY:` / `CONTENT FROM THE KNOWLEDGE BASE:` / `CURRENT WEATHER DATA:`) | same file, TWO assembly sites (streaming + non-streaming) — grep `CONTENT FROM THE KNOWLEDGE BASE` and keep them in sync |
| Self-confidence instruction (inert — `LLM_SELF_CONFIDENCE_ENABLED=0`) | same file, `_CHATQNA_SELF_CONF_INSTRUCTION` |
| Doc-level contextual prompt (the one ingest actually uses) | `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`, `_CONTEXTUAL_DOC_PROMPT_DEFAULT` |
| Translation-leg prompts | outside Epic-K scope |

The coded **defaults** for the UI-editable fields (`_CHATQNA_SYSTEM_DEFAULT`,
`_ABSTENTION_INSTRUCTIONS_DEFAULT`, ingest defaults, `_RAG_DEFAULTS`) are
fallbacks for fresh boxes only. If you change one, mirror it into the matching
`*.seed.json` here — the no-drift pytest pin (`test_seed_matches_coded_defaults`)
fails and reminds you otherwise.

*Map recorded 10-05; the DEC-26a proposal to make the EN rule UI-editable was
built and reverted — the rule stays hardcoded by K.2's spec.*
