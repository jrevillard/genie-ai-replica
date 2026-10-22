# Configuration Directory

This directory contains OPEA (Open Platform for Enterprise AI) configuration files.

## Contents

- `keycloak/` - Keycloak Identity Provider (Dockerfiles, realm configuration)
- `opea-config/` - OPEA service configuration files
- `postgres/` - PostgreSQL initialization (multi-database setup)

## LLM Prompts

LLM prompts are now **built into the Python code** with a two-tier override system:

1. **ENV VAR** (highest) - Override in `.env` for deployment-specific customization
2. **DEFAULT** (lowest) - Built-in prompts in Python code

### Prompt Variables

| Variable | Service | Purpose |
|----------|---------|---------|
| `CHATQNA_SYSTEM_PROMPT` | ChatQnA | Main LLM system prompt for RAG responses |
| `CHATQNA_ABSTENTION_INSTRUCTIONS` | ChatQnA | Instructions when no relevant documents found |
| `CHATQNA_ENFORCE_ABSTENTION` | ChatQnA | Whether to enforce abstention (default: "true") |
| `CHATQNA_STRICT_GROUNDING` | ChatQnA | Strict containment: refuse unless a document grounds the answer (default: "false") |
| `CHATQNA_STRICT_MIN_SCORE` | ChatQnA | Minimum reranker score that counts as grounding (default: `RERANKING_THRESHOLD`) |
| `CHATQNA_STRICT_REFUSAL` | ChatQnA | Message returned when nothing is grounded |
| `CHATQNA_NO_CAPABILITY_CLAIMS` | ChatQnA | Forbid offering actions the product cannot perform (default: "true") |
| `LABEL_SELECTOR_SYSTEM_PROMPT` | Dataprep | LLM prompt for automatic document labeling |

### Customization

**Environment variable override in `.env`:**
```bash
CHATQNA_SYSTEM_PROMPT="Your custom prompt here..."
```

**To change built-in defaults**, edit the Python code:
- `genie-ai-overlay/chatqna/genieai_chatqna.py` - CHATQNA_SYSTEM_PROMPT default
- `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` - LABEL_SELECTOR_SYSTEM_PROMPT default

## Strict Grounding (Containment) Mode

`CHATQNA_ENFORCE_ABSTENTION` alone does **not** contain answers to the document
repository. When retrieval returns nothing it asks the model to hedge briefly and
then continue from its own general knowledge — appropriate for a conversational
health companion, but it cannot support a claim that every answer comes from
operator-vetted documents.

`CHATQNA_STRICT_GROUNDING=true` enforces that claim in code rather than by prompt
instruction:

| Leak channel | Default behavior | Strict behavior |
|---|---|---|
| No documents retrieved | Model answers from general knowledge | Generated answer discarded, `CHATQNA_STRICT_REFUSAL` returned |
| System prompt | Tells the model to extend beyond documents and never reveal the knowledge base | Containment block appended last, overriding this (including per-twin prompts stored in ArangoDB) |
| Short questions | Any message ≤4 words skips retrieval entirely | Only purely conversational turns skip retrieval |

**Safety carve-out.** Turns describing an emergency (chest pain, stroke signs,
blood pressure ≥ 180/110, self-harm) are exempt from the refusal gate — a
containment rule must never suppress an urgent-care referral. Exemptions are
logged as `[STRICT_GROUNDING] ... red flag`.

**Auditing.** Every response carries `metadata.grounding`
(`strict`, `refused`, `documents_used`), and each gate decision logs a
`[STRICT_GROUNDING]` line with the document count and scores.

### Tuning the grounding bar

`CHATQNA_STRICT_MIN_SCORE` defaults to the reranking threshold ChatQnA itself
applies (`0.42` in code), and that default is load-bearing. The reranker's
`threshold` strategy can return chunks *below* its bar: once at least one chunk
clears it, the `RERANKING_MIN_N` floor tops the list up with near-miss chunks
(score at least half the bar) so a typo cannot collapse the context — see
`select_by_threshold` in `genie-ai-overlay/reranker/genieai_tei_reranker.py`.
Which means:

- A bar of `0.0` would count those topped-up chunks as grounding, so a single
  weak survivor could carry near misses in as evidence.
- Matching the reranker threshold makes the gate read as "the best chunk must
  have cleared the bar on its own — topped-up near misses are context, not
  grounding", which is the intended behavior.
- When nothing clears the bar the reranker returns no documents at all, so the
  gate sees an empty list and strict mode refuses.

Raise it if irrelevant documents still get through; lower it if legitimate
questions are refused. Every turn logs its scores, so tune from real traffic:

```bash
docker service logs genieai_chatqna -f | grep STRICT_GROUNDING
```

Two wiring details worth knowing before you tune:

- **`RERANKING_THRESHOLD` in `.env` does not move this bar.** That variable is
  read by the reranker service; ChatQnA is not passed it (see the `chatqna` env
  block in `docker-compose.yaml`) and sends its own value, which takes precedence
  per request. The env template suggests `RERANKING_THRESHOLD=0.9` as a tuning
  example — uncommenting that changes the reranker but leaves this bar at `0.42`.
  Set `CHATQNA_STRICT_MIN_SCORE` explicitly whenever you tune reranking.
- **With no reranker in the graph** (`CHATQNA_TYPE=CHATQNA_NO_RERANK`) the bar is
  skipped and the gate only checks whether anything was retrieved, because
  retriever cosine scores are not on the cross-encoder scale this bar is
  calibrated against. The `[STRICT_GROUNDING]` line reports `min_score=n/a` when
  this applies.

Since 2026-09-30 the reranker distinguishes "no good match" from "weak match
on a paraphrase" itself: nothing above the bar returns no documents (no more
top-N fallback), while a partial match is topped up to `RERANKING_MIN_N`
near-miss chunks. The bar the floor engages on is the per-request threshold
ChatQnA sends, not `RERANKING_THRESHOLD` in `.env`.

## Capability Claims

Independent of grounding, and **enabled by default**. Nothing in the prompts
mentions booking, reminders, or messaging, but the model volunteers them anyway
("I can set up an appointment for you") because nothing forbids it — an absent
capability is not an implicit prohibition as far as the model is concerned. Those
are not features, so the offer is a promise the product cannot keep.

`CHATQNA_NO_CAPABILITY_CLAIMS=true` appends an explicit non-capability list
(appointments, reminders, SMS/email, calling, record lookup, registration) and
redirects to what the user's health worker or clinic can do instead.

Set it to `false` to allow the aspirational framing — for example to show pilot
users what an integrated version could do. That is the setting which risks
overselling the current build.

**Verifying:**
```bash
python3 -m unittest tests.test_strict_grounding -v   # no dependencies required
```
