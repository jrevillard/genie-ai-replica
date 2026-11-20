---
title: 'Story 1.8 — Implement the input-preparation module'
type: 'feature'
created: '2026-11-20'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'a1f5589a45636b51d370f601e4836f8f6d1e2354'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The port (story 1.6) requires an already-prepared English query — `PreparedQuery` refuses every non-prepared status — but nothing produces one yet. The deployed pipeline detects the conversation's language, translates the query/history to English through the vLLM translation endpoint under a character budget, and records `query_translation_status`; the epic assigns that job to the loop side, not the port. Until the module lands, the agent path has no way to prepare an initial or a refined query, and config B's fixed pipeline (story 1.9) has no preparation stage to call.

**Approach:** Implement the input-preparation module as a new `components/agent-service/preparation/` package — the loop-side component the epic context assigns preparation to ("the agent application layer prepares every query … the port requires prepared English queries and never calls vLLM"). It ports the deployed preparation pipeline's behavior, frozen to the V02 record (`docs/baselines/v02-opea-query-path-contract.md` §5): language detection across the supported locales (registry-driven, `langdetect`), any-source-language → English history translation through the vLLM translation endpoint as a budgeted auxiliary call with cancellation propagation, the recorded bounds (derived character budget, newest-first trim, single-message refusal), the recorded `query_translation_status` vocabulary (the contract's `QueryPreparationStatus`), and the three failure classes with their distinct V02 outcomes mapped onto the contract's taxonomy. One entry point serves the initial request and refined mid-loop queries identically; configs B/C consume it unchanged as a plain injectable component.

## Boundaries & Constraints

**Always:**
- Behavior is frozen to V02 §5 (order of operations, status values, bounds, failure classes, locale coverage shape); the structure is free (clean-slate per AD-10 — no `comps` import, no OPEA service call, no shared library with the overlay).
- The port is never touched: `capabilities/contract.py` stays unchanged (`PreparedQuery` keeps refusing non-prepared statuses), and the preparation package lives OUTSIDE `capabilities/` — it calls the vLLM translation endpoint directly, which the port may never do.
- The three failure classes keep distinct outcomes (no single fallback hardcoded): oversized input raises an explicit refusal (`translation_input_too_long`, the abstention class — never an untranslated fallback); translator unavailable and blank translation RETURN an unprepared result carrying the recorded `fallback_timeout` / `fallback_error` status — the caller answers with degradation, never confident data, and never receives a source-language query dressed as prepared.
- Statuses use the contract's `QueryPreparationStatus` vocabulary only (`translated`, `passthrough_english`, `passthrough_unknown_language`, `fallback_timeout`, `fallback_error`); only `translated` / `passthrough_english` produce a `PreparedQuery`.
- The translation call is budgeted: the derived character budget, the measured completion cap (server `/tokenize` count when available, the recorded estimate otherwise), and the recorded service timeout; `asyncio.CancelledError` propagates untouched — never caught, never mapped to any status.
- Env knobs keep the deployed names and code defaults (`VLLM_TRANSLATION_ENDPOINT`, `TRANSLATION_SERVICE_TIMEOUT`, `MAX_TRANSLATION_CHARS`, `LANGUAGE_REGISTRY_FILEPATH`, `VLLM_TRANSLATION_MODEL_ID`, …) so a deployment tuning the legacy path tunes this module identically.
- Answer translation stays BFF-owned: the module never translates the answer and never decides the answer's language; the BFF's `language_refused` case cannot reach the module (the BFF answers 400 first) and is documented as unreachable here.
- Every new dependency clears the pre-adoption checklist (V07a exact-version licence + NFR-2 defaults audit) and lands pinned in `requirements.txt` + `docs/dependencies/agent-service-dependency-evidence.json`.
- All artefacts in English; ruff + pytest green on the component; the story 1.4 OPEA-free gate stays green.

**Never:**
- No port implementation changes: `capabilities/**` is untouched by this story.
- No agent loop, runtime seam, tool registry or internal envelope (story 2.1); no config-B fixed pipeline (story 1.9) — the module is only made available to them.
- No HTTP surface on agent-service, no compose env wiring — nothing reachable calls the module yet; the Dockerfile COPY carries the package into the image (the 1.6 first-importer precedent), nothing more.
- No change to okf-server, document-repository, the BFF, the OPEA overlay or the chart.
- No answer-language logic: no `is_supported` answer fallback, no answer translation, no BFF language refusal replication.
- No new store, no persistence of preparation state.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| named English, English history | `source_language="en"`, history EN | status `passthrough_english`, query = last `USER:` segment, flattened within budget | N/A |
| named non-EN, translatable | `source_language="fr"`, fr history | history translated to EN, status `translated`, query = last `USER:` segment of the TRANSLATED blob | N/A |
| no name, detectable | `source_language=None`, fr last user message | langdetect detects `FR`, history language = detected code, translated | N/A |
| non-Latin script | no name, Arabic last user message (V02 §5.6 sample family) | detected code (`AR`), translated to English, status `translated` | N/A |
| detected code the map does not key | detected `zh-cn` | history STILL translated to English (the code names the source; the prompt does not carry it — TranslateGemma path omits the source name) | N/A |
| nothing named, nothing detected | blank / undetectable input, no name | status `passthrough_unknown_language` — returned UNPREPARED (the port would refuse it) | N/A — caller answers with degradation |
| detection crashes | langdetect raises | treated as no detection → `passthrough_unknown_language` | never crashes the caller |
| oversized single-message | history string over the derived char budget (+20 overhead) | explicit refusal raised BEFORE the language map (the refusal must not depend on registry health) | typed `translation_input_too_long` refusal — the abstention class |
| oversized list shape | flattened history over the char budget | oldest turns dropped, newest message's tail truncated to budget; same kept turns as the passthrough path | N/A (V02 §5.3 list shape never refuses at the char budget) |
| translation window overflow | the translation request exceeds the discovered window (local budget check or server 400 with overflow markers) | explicit refusal — NO untranslated fallback, either shape | typed refusal (`translation_input_too_long`) |
| translator unreachable / times out | endpoint down, DNS error, or past `TRANSLATION_SERVICE_TIMEOUT` | returned UNPREPARED, status `fallback_timeout` (timeout) / `fallback_error` (other) | degradation reported, never a prepared label on source text |
| translation errors otherwise | HTTP 5xx, malformed body | returned UNPREPARED, status `fallback_error` | same |
| blank completion | model answers 200 with empty completion (or `finish_reason="length"` cut-off) | returned UNPREPARED, status `fallback_error` — a blank/cut translation is a failure, never a silent success | same |
| blank history guards | all-blank message list, or blank single message, with English established | status `fallback_error` (never the healthy passthrough label); with NO established language stays `passthrough_unknown_language` | N/A |
| empty history | `[]` / empty string | returned UNPREPARED, status `fallback_error`, empty text | N/A |
| registry unreadable | registry file missing/corrupt at translation time | English target name unresolvable → returned UNPREPARED, status `fallback_error` (the deployed "map does not know English" branch) | retried after the 60 s window, never crashes |
| caller cancels mid-translation | task cancelled while the translation call is in flight | `asyncio.CancelledError` propagates untouched | never mapped to any status or outcome |
| refined mid-loop query | same entry, query-only (no history, no name) | identical treatment: same detection, budget, translation, statuses — one code path | N/A |

</frozen-after-approval>

## Code Map

**Deployed behavior to port (read these before writing anything):**
- `genie-ai-overlay/chatqna/genieai_chatqna.py:4578-4672` — the detection block: `langdetect.detect` on the last `USER:` message when nothing usable is named; the detected code becomes the HISTORY language regardless of translation coverage; `history_language = detected_language or original_language`; the `is_supported` gate steers only the ANSWER (out of scope here); detection crash → answer-side EN fallback, history side falls to `passthrough_unknown_language`.
- `genie-ai-overlay/chatqna/genieai_chatqna.py:4682-4752` — the status decision: translate when history language ≠ EN; otherwise the `english_established` rule (named-and-not-refused, or detected `EN`) deciding `passthrough_english` vs `passthrough_unknown_language`; the blank guards that downgrade an established-English blank to `fallback_error`; the passthrough flatten under the same budget as the translation path.
- `genie-ai-overlay/chatqna/genieai_chatqna.py:4753-4806` — the `TranslationInputTooLongError` boundary (raise, metrics, refusal body) and the query extraction: last `USER:` segment via `USER_MSG_PATTERN`, whole-blob fallback.
- `genie-ai-overlay/chatqna/genieai_chatqna.py:4084-4243` — `_get_translated_history_string`: both history shapes (list + single string), trim-then-flatten, blank guards, the English target resolved ONCE against the language map ("the map does not know English — refusing to translate" → `fallback_error`), the TranslateGemma-vs-generic prompt split, and the typed-failure→status mapping (`TranslationTimeoutError` → `fallback_timeout`, other `TranslationFailedError` → `fallback_error`; `TranslationInputTooLongError` deliberately NOT caught → refusal).
- `genie-ai-overlay/chatqna/genieai_chatqna.py:711-795` — `_translate_prompt` + `_completion_truncated` + `_choice_content`: the one translation seam; payload by model shape; `max_tokens` from `_translation_completion_cap`; overflow-classified failures; truncated-completion refusal; chat/completions content extraction.
- `genie-ai-overlay/chatqna/genieai_chatqna.py:632-710` — `_translation_base_cap` / `_translation_completion_cap` / `_translation_payload` with the recorded constants: `TRANSLATION_COMPLETION_SAFETY_TOKENS=128` (:606), `MIN_ROOM=256` (:610), `NEEDED_MULTIPLIER=4` + `MARGIN=256` (:615-616), `BASE_CEILING=4096` (:629); payloads: TranslateGemma → `/v1/completions` pre-formatted prompt (temperature 0.0, repetition_penalty 1.2, model id), generic → `/v1/chat/completions` single user message (temperature 0, stream false).
- `genie-ai-overlay/chatqna/genieai_chatqna.py:821-968` — `_get_translation_window` (discovery), `_get_max_translation_chars` (`(window − 512) // 2 × 3`, `MAX_TRANSLATION_CHARS` caps the derivation AND is the fallback when the window is unknown, floor 1), `_flatten_history_string` (`ROLE: content` joined with ` |<-MSG->| `, missing role → `UNKNOWN:`, missing content → empty), `TRANSLATION_MSG_OVERHEAD_CHARS=20` (:880), `_refuse_oversized_query` (single-message: `len + 20 > budget` → raise, BEFORE the language map), `_select_history_within_budget` (newest-first walk; first message that alone overflows keeps its TAIL truncated to budget; one dict copied, others shared).
- `genie-ai-overlay/chatqna/genieai_chatqna.py:1321-1322` — `MAX_TRANSLATION_CHARS` code default 2000 and `USER_MSG_PATTERN = re.compile(r"USER:\s*(.*?)(?:\s*\|<-MSG->\||$)", re.DOTALL)`.
- `genie-ai-overlay/chatqna/genieai_chatqna.py:1055-1075` — `LANGUAGE_REGISTRY_FILEPATH` (module-relative default), `LANGUAGE_MAP_RETRY_SECONDS=60`, `HISTORY_TRANSLATION_TARGET="en"` (a constant, never an argument).
- `genie-ai-overlay/chatqna/genieai_chatqna.py:1241-1303` — `_load_language_registry`: read-once cache with a 60 s failure retry window; unreadable registry → empty maps (every language unknown), never None.
- `genie-ai-overlay/chatqna/genieai_chatqna.py:3994-4082` — `_build_translategemma_prompt`: Gemma chat template, roles/scripts from the registry tables, target code unknown → English fallback, source code unmapped (`zh-cn`, `jw`, `tl`) → source NOT named, script clauses (Latin-only clause; source-script-avoidance clause).
- `genie-ai-overlay/chatqna/genieai_chatqna.py:560-575` — `_get_translation_model_id` (`VLLM_TRANSLATION_MODEL_ID` env else discovered at the translation endpoint; None is valid) and `_is_translategemma` (matcher on the model id).
- `genie-ai-overlay/chatqna/genieai_chatqna.py:2378-2435` — `_count_translation_tokens`: POST `{endpoint}/tokenize` with the SAME credentials and the payload's prompt half as sent; permanent negative cache once the server cannot count; best-effort → None.
- `genie-ai-overlay/chatqna/genieai_chatqna.py:1028` + `:473-490` — `OPENAI_API_KEY` bearer, `TRANSLATION_SERVICE_TIMEOUT` (default 180 s), endpoint resolution (`VLLM_TRANSLATION_ENDPOINT` set → direct vLLM for BOTH translation and discovery; else the compose-internal translation service), `TRANSLATION_LLM_URL` = `{endpoint}/v1/chat/completions`, `TRANSLATION_COMPLETIONS_URL` = `{endpoint}/v1/completions`.
- `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:79-182` — `_VLLM_CONTEXT_OVERFLOW_MARKERS` (`context length`, `context_length_exceeded`, `maximum context length`, `reduce the length`, `context window`) and `_overflow_message_from_exc` (aggregate every string-shaped surface of the exception, lowercased) — port the matcher (agent-service has no dataprep to import from; reimplement, do not import).
- `genie-ai-overlay/core/model_cache.py` — the window/model discovery to reimplement: GET `{endpoint}/v1/models`, first `data[]` entry, `max_model_len` via `coerce_int` (bools rejected, digit strings accepted), TTL 60 s (`MODEL_DETECT_TTL`), negative cache 60 s, sane-window ceiling 10 000 000, stale-serve on re-probe failure, None when absent; auth headers + `endpoint_verify()` from `core/model_http_policy.py` (`MODEL_PROBE_TIMEOUT_SECONDS` default 10.0).
- `components/gov-chat-backend/services/translation/language-maps/language-registry.json` — the registry data (`{"languages": {code: {name, script}}}`, 41 codes): VENDOR a copy into the package (the agent-service build context is the component directory — a COPY from the backend tree is impossible), read via `LANGUAGE_REGISTRY_FILEPATH` with a package-relative default.

**Component conventions to reuse (do not reinvent):**
- `components/agent-service/capabilities/contract.py` — `QueryPreparationStatus` (the status vocabulary), `PreparedQuery` (the only prepared shape; validator refuses the rest). NOTHING in this file changes.
- `components/agent-service/capabilities/adapters/env_config.py` — the frozen-dataclass `load(env=None)` knob pattern with deployed names/defaults; the preparation config mirrors it (own file in the package — the port's file is untouched).
- `components/agent-service/capabilities/search_knowledge.py` — module docstring style (behavior frozen, structure free, cancellation declaration); the pattern of constructor-injected dependencies with a `create()` classmethod assembling the default wiring.
- `components/agent-service/tests/conftest.py` + `tests/test_tracing.py` — the fake-transport test style and the tracing-test pattern; `requirements-test.txt` / `pyproject.toml` (ruff py311 line-length 120, pytest `pythonpath = ["."]`).
- `components/agent-service/Dockerfile:33-35` — the COPY block; add `preparation/` beside `capabilities/`.
- `components/agent-service/requirements.txt` — fully pinned tree; `httpx==0.28.1` already runtime (async translation calls reuse it); add `langdetect==1.0.9` (the overlay's pin, `genie-ai-overlay/dataprep/requirements-cpu.txt:1851`) and recompile the tree.
- `docs/dependencies/agent-service-dependency-evidence.json` + `scripts/dependencies/verify-dependency-licenses.py` + `docs/dependencies/pre-adoption-checklist.md` — the dependency-adoption gate: evidence regenerated with the new pins, no NOASSERTION.
- `docs/baselines/v02-opea-query-path-contract.md` §5 — the behavioral record this story freezes to (order §5.1, statuses §5.2, bounds §5.3, failure classes §5.4, locale coverage §5.6); the `fr`/`es`/`ar` samples there are test fixtures' shape reference (a sample, not a contract — assert shape + status + vocabulary, not exact model wording).

## Tasks & Acceptance

**Execution:**
- [x] `components/agent-service/preparation/__init__.py` — the package's public surface: `PreparationConfig`, the preparation entry, the result/refusal types, re-exported contract types. The entry is ONE function/method serving initial and refined queries identically; the result carries the `PreparedQuery` (contract type) when prepared, the exact `QueryPreparationStatus` when not, the prepared history text, and the resolved language.
- [x] `components/agent-service/preparation/config.py` — the frozen env-knob surface (`load(env=None)` pattern): translation endpoint, model id, service timeout (180), `MAX_TRANSLATION_CHARS` (2000), the completion-cap constants (512/3/20/128/256/4/256/4096), registry path (package-relative default), probe timeout (10) and TTL (60), bearer env, TLS-verify knob. Same names, same code defaults as the deployed module.
- [x] `components/agent-service/preparation/registry.py` — the vendored language registry reader: `{"languages": {code: {name, script}}}` → code→name and code→script maps, read-once cache with the 60 s failure retry window, unreadable → empty maps (never crash, never None); `components/agent-service/preparation/language-registry.json` — the vendored copy (byte-identical to the backend source today).
- [x] `components/agent-service/preparation/detection.py` — the ported detection: langdetect on the last `USER:` message when nothing usable is named; crash → no detection (never raises); the history-language rule (`detected or named`); the `english_established` rule; uppercase canonical codes. No answer-language logic.
- [x] `components/agent-service/preparation/bounds.py` — the ported bounds: char-budget derivation (window-discovered, `MAX_TRANSLATION_CHARS` cap + fallback, floor 1), `_flatten_history_string` port, newest-first trim with the newest-tail rule (`path` in the log line, same kept turns for translation and passthrough), single-message refusal check (+20 overhead, raised before the language map), `USER_MSG_PATTERN` query extraction with the whole-blob fallback, blank-content guards.
- [x] `components/agent-service/preparation/translation.py` — the ported translation client (async httpx, injected transport/probe seam for tests): endpoint + `/v1/models` discovery (TTL, negative cache, sane ceiling, stale-serve, `coerce_int` semantics), model id + TranslateGemma detection, both prompt builders (generic + Gemma template with script clauses and the unmapped-source rule), both payload shapes, `/tokenize`-measured completion cap with the degraded estimate and the room refusal, error classification (overflow markers → typed refusal; timeout → `fallback_timeout` class; other → `fallback_error` class), truncated- and blank-completion refusals, bearer auth, cancellation untouched.
- [x] `components/agent-service/preparation/prepare.py` — the entry orchestrating the recorded §5.1 order: bounds first (the oversized refusal precedes the language map), detection, the status decision, translate-or-passthrough, query extraction; returns the preparation result or raises the typed refusal; `CancelledError` never caught.
- [x] `components/agent-service/tests/test_preparation_config.py`, `tests/test_preparation_registry.py`, `tests/test_preparation_detection.py`, `tests/test_preparation_bounds.py`, `tests/test_preparation_translation.py`, `tests/test_preparation_prepare.py` — the acceptance evidence: every matrix row covered; the `ar` non-Latin sample detected and translated with a REAL langdetect (production code stays unseeded; tests may seed `DetectorFactory` for determinism); the failure-class distinctness test (refusal vs `fallback_timeout`/`fallback_error` vs `passthrough_unknown_language` — no single fallback); the refined-query parity test; the cancellation test; mutation-sensitivity for the budget, the refusal and the status mapping.
- [ ] `tests/test_preparation_registry.py` additionally pins the vendored copy: byte-equality with `components/gov-chat-backend/services/translation/language-maps/language-registry.json` — a static repository check (both files must exist; a moved or edited source fails loudly, never silently).
- [x] `components/agent-service/requirements.txt` + recompiled tree + `docs/dependencies/agent-service-dependency-evidence.json` — `langdetect==1.0.9` adopted (runtime pin, licence + defaults evidence rows, no NOASSERTION).
- [x] `components/agent-service/Dockerfile` — `COPY preparation/ ./preparation/` beside the capabilities copy.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` — the story entry to `review`.

**Acceptance Criteria:**
- Given a conversation in any supported locale (tests include the Arabic non-Latin sample), when preparation runs, then the language is detected (registry-validated), the query/history is translated to English through the vLLM translation endpoint under the derived character budget with the measured completion cap, bounds are applied (trim/refusal per shape), and the exact `query_translation_status` is recorded on the result.
- Given the three preparation failure classes, when each triggers, then the outcomes stay distinct per the V02 record and mutually consistent with the contract's taxonomy: oversized input raises the typed `translation_input_too_long` refusal (the abstention class — never an untranslated fallback); translator unavailable returns the query UNPREPARED with `fallback_timeout`/`fallback_error`; a blank (or cut-off) translation returns UNPREPARED with `fallback_error` — and no code path returns a source-language query carrying a prepared status.
- Given a refined mid-loop query, when the module serves it through the same entry, then its treatment (detection, budget, translation, statuses) is identical to the initial request's — proven by test, one code path.
- Given the module, when configs B/C consume it, then it is a plain injectable component (no HTTP surface, no loop coupling, no agent runtime needed) — importable and callable standalone.
- Given a caller cancellation during the translation call, when the task is cancelled, then `asyncio.CancelledError` propagates untouched — never caught, never mapped to a status.
- Given the component tree, when `ruff check`, `ruff format --check` and `pytest` run, then all are green, the vendored registry parity check passes, and the story 1.4 OPEA-free gate stays green.

## Implementation Notes

- **The degraded classes return unprepared instead of embedding source text — this is the contract's decision, not a divergence.** Deployed (V02 §5.4), translator-unavailable/blank degrade the turn by embedding the source-language history. The accepted contract (story 1.5) refuses exactly that at the port (`PreparedQuery._require_prepared`); the story AC says the classes must be "mutually consistent with the capability contract's error taxonomy". The consistent mapping: the per-class SHAPES carry over (unavailable/blank still answer — as degradation-reported-to-caller, matching story 1.7's "degraded downstream availability reports insufficiency/degradation — never confident data"; oversized refuses loud), the one mechanism that cannot cross (embedding untranslated text into the English space) is replaced by the refusal the port already makes. The `fallback_*` statuses keep their V02 meanings so the runbook vocabulary survives intact.
- **The BFF's refused-language case is unreachable here**: the BFF answers HTTP 400 `UNSUPPORTED_LANGUAGE` before the agent path sees the request (V02 §5.5), so the module's `english_established` rule only ever sees named-and-accepted or detection. Record that in a comment; do not build the refused branch.
- **Both history shapes are ported** (message list — the deployed BFF shape — and plain string): the recorded bounds differ per shape (list trims, string refuses) and config B must reproduce both.
- **The `is_supported` answer gate is NOT ported**: it steers the ANSWER language (BFF-owned). Preparation only needs whether English is established and the history language. This is a deliberate scope line, recorded here.
- **langdetect is unseeded in production** (deployed parity — V02 notes the detector is non-deterministic); tests seed `DetectorFactory` for stability and use the real detector for the non-Latin sample (Arabic detects robustly).
- **No tracing overhaul**: the module accepts the component's existing tracing setup; the result carries the status, and a `preparation.prepare` span with `query_translation_status` follows the `test_tracing.py` pattern. Ported tracing carries no `comps` hooks (epic constraint).
- **`USER_MSG_PATTERN` extraction runs on the TRANSLATED blob** (deployed order): the query is the last user turn of the English-normalized history, never of the source text.
- The vendored registry is a data copy with a parity test, the same defense the chart carries for its copies; a runtime override (`LANGUAGE_REGISTRY_FILEPATH`) exists for deployments that ship their own registry, exactly as deployed.

## Spec Change Log

- **2026-11-20, verification-phase correction 1 — the CI lint lane covers the new package.** The implementer's report flagged that `lint:agent-service` (`.gitlab-ci.yml`) runs ruff over `app.py tracing.py capabilities/ tests/` only — this story's ~1,300-line `preparation/` package would ship unlinted in CI. That gap is the story's own delivery (the package must be linted like the port's), so it is fixed in this MR: `preparation/` added to both ruff lines of the lane. This extends the diff to `.gitlab-ci.yml` beyond the file list the Verification section below names; the Verification expectation is amended accordingly (the story file's own file list gains the CI lane).
- **2026-11-20, verification-phase correction 2 — the langdetect licence evidence row was wrong.** The row recorded `MIT` from PyPI's `info.license` field; the field is stale upstream metadata. The classifier on the same page and the exact-version artifact itself (sdist digest verified against PyPI; `langdetect-1.0.9/LICENSE`, sha256 recorded in the row) are Apache-2.0 — plus an Apache-2.0 NOTICE for the vendored Cybozu Labs language-detection. The row now records Apache-2.0 with the artifact evidence and the contradiction documented, per the evidence file's stated method (artifact files are authoritative over the stale field). `--verify` re-run: OK, 47 packages.

## Review Triage Log

Global code-review, round 1 (high effort, full diff `a1f5589a4..95c92034d`) — 1 important + 4 nit. Every claim verified against the code and the deployed source before disposition:

| Finding | Severity | Verdict | Disposition |
|---|---|---|---|
| Numeric env knobs crash `PreparationConfig.load` on set-to-empty/garbage values where the deployed `_env_int` tolerates both (compose default-injection; issue #1091's crash class) | important | confirmed (deployed `_env_int` docstring is explicit; port used bare `int()`) | **Fixed**: tolerant `_env_int`/`_env_float` parsers, deployed parity for the path/model_id knobs (set-to-empty honored, not repaired); 2 tests pinned |
| The model id is read twice per request (prepare for the prompt choice, `translate_prompt` for the payload/parse) — the deployed module resolved once and passed it down; a down endpoint pays a failed probe per read and a TTL rotation can mismatch prompt and payload | nit | confirmed | **Fixed**: `translate_prompt(prompt, translategemma, model_id)` now takes the caller's resolution (deployed shape); prepare passes its one read down; test seams updated, env-wins test moved to the resolver seam |
| The list-shape window-overflow refusal depends on registry health (target name resolved before the completion-cap refusal) | nit | **false** — deployed parity: `_get_translated_history_string` resolves the target name at `:4174-4179` before the translation call in exactly the same order; V02 freezes that behavior, the port reproduces it faithfully | No change — recorded here as the deliberate deployed-parity reading |
| `is_translategemma` crashes on a non-string discovered id (AttributeError out of `prepare`) | nit | confirmed (deployed has the same latent crash, but the module's own contract promises degraded inputs never crash the caller) | **Fixed**: `isinstance` guard answers False → generic path degrades; cache-level test pinned with the scalar-id proxy scenario |
| Dead code: `detection.is_code_shaped` (+ its regex twin) unused; `registry.LANGUAGE_MAP_RETRY_SECONDS`/`NEGATIVE_CACHE_TTL` re-exports unconsumed | nit | confirmed (repo no-dead-code convention) | **Fixed**: all three removed; `__init__` export list updated |

The scoped fix review of the correction diff follows (f=0).

## Design Notes

**Why a `preparation/` package and not part of `capabilities/`.** The epic context assigns preparation to the loop side ("the agent application layer prepares every query … The port requires prepared English queries and never calls vLLM"), and `search_knowledge`'s own docstring repeats it ("preparation is the loop's business (story 1.8)"). The port package imports no vLLM anywhere; putting a vLLM-calling module inside it would blur the boundary the contract draws. A sibling top-level package keeps the dependency arrow one-way: preparation imports the contract's types, the port never imports preparation.

**Why the oversized refusal RAISES while the unavailable/blank classes return.** The contract's carriers: raised = refused outright (authorization, transient); returned = answer types. An oversized input is a refusal of the turn (deployed: HTTP 422 with `abstained: true` — the abstention class); unavailable/blank are degradations the caller answers around (deployed: the turn still answers). Mapping refusal→raise and degradation→return keeps the module's callers shape-compatible with the contract's carrier table, and the refusal type carries `translation_input_too_long` so the serving layer's eventual 422 mapping (and the abstention reason) is spelled by the type, not by a string at the call site.

**Why the window probe is reimplemented rather than imported.** Clean-slate (AD-10): the overlay's `core/model_cache.py` is OPEA-overlay code; importing it would couple the paths the epic explicitly separates ("no shared library, no wrapping, no dual-mode code"). The discovery behavior (TTL, negative cache, sane ceiling, stale-serve, `coerce_int`) is ported to match, under the same env knobs.

**Why httpx directly.** The deployed seam is httpx-async (`AsyncClient`, `TRANSLATION_SERVICE_TIMEOUT`, bearer header, `endpoint_verify`); the component already pins httpx 0.28.1 at runtime (story 1.6). The tests inject fakes at the probe/transport seam, so no network in the suite — the `RequestsTransport` GET-only adapter does not fit a POST seam and is not forced in.

## Verification

**Commands:**
- `cd components/agent-service && ruff check . && ruff format --check .` — expected: clean
- `cd components/agent-service && python -m pytest tests/ -q` — expected: green, including the new suites
- `uv pip compile <top-level pins> --python-version 3.11` (the documented regeneration path in the `requirements.txt` header) — expected: tree resolves with `langdetect==1.0.9`
- `python3 scripts/dependencies/verify-dependency-licenses.py --fetch components/agent-service/requirements.txt --fetch components/agent-service/requirements-test.txt --out docs/dependencies/agent-service-dependency-evidence.json` — expected: evidence regenerated, no NOASSERTION
- `cd tests/config-validator && npm test` — expected: green (the OPEA-free tree-walking gate and the V07a evidence gate)
- `git diff origin/feat/agentic-foundations/prd --stat` — expected: only `components/agent-service/**`, the dependency evidence file, the sprint-status entry, and the `lint:agent-service` lane in `.gitlab-ci.yml` (see Spec Change Log, correction 1)
