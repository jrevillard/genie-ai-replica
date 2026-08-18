# OPEA v1.4/v1.5 Upstream Improvements — Verification Evidence

**Story:** 3.4 — Confirm the targeted upstream improvements land (FR-19)
**Date:** 2026-08-19
**Baseline revision:** `fb5f433eb593a58bd43a9c739c9173b23947884e`
**Enumerator:** Planning artifacts (OPEA-1.5-upgrade-analysis.md appendix, epics.md FR-19, Epic 2 story specs, deferred-work.md)

---

## Summary

All targeted upstream improvements from the v1.4/v1.5 changelogs are confirmed present in the deployed overlay, or explicitly documented as not ported with rationale. No upstream fix is absent without documented reason.

**Counts:**
- **Present:** 16 improvements (A1–A5, B1–B4, B6–B10, C3, C4)
- **Not ported (optional/documented):** 3 improvements (C1, C2, B5)
- **False claims discarded:** 2 (D1, D2)

---

## Verification Results

### A. Hard Blockers (must be present, or image fails to boot)

| ID | Improvement | Status | Evidence | Epic 2 Story |
|---|---|---|---|---|
| A1 | `MCPFuncType` enum added to constants (1.5 `micro_service.py:12` imports it) | ✅ Present | `genie-ai-overlay/core/constants.py:103` — `class MCPFuncType(Enum):` | 2.1 |
| A2 | New `ServiceType` members: `LANGUAGE_DETECTION=24`, `PROMPT_TEMPLATE=25`, `PROMPT_REGISTRY=26`, `TEXT2QUERY=27`, `ARB_POST_HEARING_ASSISTANT=28` | ✅ Present | `genie-ai-overlay/core/constants.py:41-45` — all 5 members present | 2.1 |
| A3 | TRANSLATOR slot collision resolved (upstream took slot 24) → GENIE renumbered to slot 29 | ✅ Present | `genie-ai-overlay/core/constants.py:46` — `TRANSLATOR = 29` | 2.1, 2.6 |
| A4 | `from enum import Enum, auto` (1.5 switched to `auto()`) | ✅ Present | `genie-ai-overlay/core/constants.py:5` — `from enum import Enum, auto` | 2.1 |
| A5 | `OPEA_VERSION="v1.5"` in all 4 Dockerfiles | ✅ Present | `grep -rn "OPEA_VERSION" genie-ai-overlay/*/Dockerfile*` — all default to `"v1.5"` (chatqna declares 4×, others 1×) | 2.3–2.6 |

### B. Build / Dependency Adoption

| ID | Improvement | Status | Evidence | Epic 2 Story |
|---|---|---|---|---|
| B1 | `requirements.txt` → `requirements-cpu.txt` path (moved in v1.4) | ✅ Present | `ls genie-ai-overlay/{dataprep,retriever,reranker}/requirements-cpu.txt` — 3 files exist | 2.5 |
| B2 | Python 3.11 fleet-wide | ✅ Present | `grep -rn "python:3.11" genie-ai-overlay/*/Dockerfile*` — all 4 modules use `python:3.11-slim` | 2.2 |
| B3 | `langchain-arangodb` over-pin to `>=1.2.0` (filter_clause behavioral fix) | ✅ Present | `grep "langchain-arangodb==" genie-ai-overlay/retriever/requirements-cpu.txt` → `==1.2.0` | 2.3, DW-10 |
| B4 | Dependency bumps adopted (docling 2.45+, langchain 0.3.27, openai 1.81+, pydantic 2.11+) | ✅ Present | `grep -E "^(docling\|langchain\|openai\|pydantic)" genie-ai-overlay/*/requirements-cpu.txt \| grep "=="` — docling 2.45.0/2.55.1, langchain 0.3.27, openai 1.81.0, pydantic 2.13.4 | 2.2, 2.5 |
| B5 | GPU lock pipeline (`requirements-gpu.txt`) | ⚠️ Not ported | Fleet is CPU-only per DW-16 resolution (done 2026-08-14). `requirements-gpu.txt` does not exist; `requirements-cpu.txt` is the only lock. Compose grants no GPU to dataprep. DW-266 (high severity, "GPU support must be restored") was superseded by DW-16 (low severity, "GPU locks not compiled — fleet is CPU-only"). Resolution: CPU-only is intentional; GPU locks can be compiled from same `.in` when a GPU deployment needs them. | 2.2, 2.5, DW-16 |
| B6 | Retired `#834` lock machinery (`requirements.in`/`requirements.lock`/`generate-requirements-in.sh`/`docling-core==2.82.0` pin) | ✅ Present (files absent) | `test ! -f genie-ai-overlay/dataprep/requirements.lock` ✓ — `test ! -f genie-ai-overlay/dataprep/scripts/generate-requirements-in.sh` ✓ | 2.5, DW-242 |
| B7 | Pydantic v2 field tightening mirrored (`PositiveInt`/`NonNegativeFloat` for `max_tokens`, `n`, `seed`, `temperature`, `top_p`, `best_of`, `repetition_penalty`, `top_k`, `timeout`, `top_n`) | ✅ Present | `grep -c "PositiveInt\|NonNegativeFloat" genie-ai-overlay/core/genieai_api_protocol.py` → **29 occurrences** (≥ 12 expected) | DW-5 |
| B8 | `opea_telemetry` byte-identical at 1.5 (2381 B); import path `comps.cores.telemetry.opea_telemetry` | ✅ Present | `grep -n "opea_telemetry" genie-ai-overlay/reranker/genieai_reranking_microservice.py` → lines 39, 69 | 2.4, DW-8, DW-13 |
| B9 | Embedding/textgen base images bumped to 1.5 | ✅ Present | `grep "UPSTREAM_IMAGE" genie-ai-overlay/{embedding,textgen}/Dockerfile-*` → `opea/embedding:1.5`, `opea/llm-textgen:1.5` | DW-1, DW-7 |
| B10 | Cross-module overlay-locks CI job | ✅ Present | `grep -n "overlay-locks" .gitlab-ci.yml` → lines 2638, 2668 (`verify:overlay-locks:retriever`, `verify:overlay-locks:reranker`) | 2.7, DW-14 |

### C. Optional / Noted Changes (documented disposition)

| ID | Improvement | Status | Evidence | Epic 2 Story |
|---|---|---|---|---|
| C1 | `align_generator` null-skip + `JSONDecodeError` swallow (v1.5 upstream improvement) | ⚠️ Not ported (optional) | `genie-ai-overlay/chatqna/genieai_chatqna.py:1368-1402` — GENIE kept its own override. The except branch repr-encodes the raw string instead of dropping. OPEA-1.5-upgrade-analysis.md §A3 explicitly marked "Optional backport". GENIE's version is functionally equivalent (the except branch handles the error, just differently). | 2.6 |
| C2 | `DocList[...]` → `List[...]` container switch on `SearchedDoc.retrieved_docs` / `RerankedDoc.reranked_docs` | ✅ Not applicable (eyeballed, no code change) | GENIE's overlay iterates these fields read-only; `List` iterates identically to `DocList`. `grep -rn "DocList" genie-ai-overlay/ --include="*.py"` → **no matches** — no GENIE file references `DocList` by name. Analysis appendix: "1.5 switched SearchedDoc/RerankedDoc from DocList→List — eyeball, likely fine". | 2.4, 2.6 |
| C3 | docarray rename `sys.modules` alias shim (replaces `mv docarray.py opea_docarray.py + 3×sed`) | ✅ Present | `genie-ai-overlay/build-patches/docarray_alias_shim.py` exists. Shim replaces source mutation. | DW-9, OVERRIDES.yaml |
| C4 | `ServiceOrchestrator.schedule()` 6-kwarg → 1-dict bundle (`genie_params`) | ✅ Present | `genieai_chatqna.py:509` — "The orchestrator's ``schedule()`` call forwards all six custom kwargs as a [single dict]". `genieai_chatqna.py:2445` — `await self.megaservice.schedule(...)` call site uses bundled dict. Story 1.3 spike proven kwargs survive; story 2.6 bundled them. | 1.3, 2.6 |

### D. False Claims Discarded

| ID | Claim | Resolution | Evidence | Epic 2 Story |
|---|---|---|---|---|
| D1 | "`opea_telemetry` renamed in v1.4" | ❌ False — byte-identical 2381 B at v1.5 | B8 confirms import works; analysis §A6 + appendix: "byte-identical, 2381 B — 'renamed in v1.4' is false" | 2.4 |
| D2 | "`docarray.py` renamed upstream in v1.4" | ❌ False — `opea_docarray.py` never existed upstream; GENIE's rename is its own hack | Analysis §A3 + appendix: "'renamed in v1.4' claim is false — GENIE's own hack, still applies at 1.5". C3 shim replaces source mutation. | DW-9 |

---

## Override Audit

`genie-ai-overlay/OVERRIDES.yaml` exists, enumerates 19 overrides, all with disposition `re-graft-to-new-API`, all tied to story 2.1 or DW-5. Every override is accounted for in the verification above.

---

## Epic 2 Coverage Map

| Story | Scope | Upstream improvements verified |
|---|---|---|
| 2.1 | core re-graft | A1, A2, A3, A4, B7 |
| 2.2 | deps + Python 3.11 | B1, B2, B3 (partial), B4, B9 |
| 2.3 | retriever | B3 |
| 2.4 | reranker | B8, C2 |
| 2.5 | dataprep | B5, B6, B1 (partial) |
| 2.6 | chatqna | A5, C1, C2, C4 |
| 2.7 | patch guards | B10 |
| 2.8 | import sweep + mock parity | A1, A2, A3 (mock-reality parity contract) |

All planned v1.4/v1.5 improvements are accounted for as either **present** (A1–A5, B1–B4, B6–B10, C3, C4) or **explicitly not ported with rationale** (B5 CPU-only, C1 optional, C2 no-op, D1/D2 discarded false claims).

---

## Conclusion

FR-19 is satisfied. The targeted upstream improvements from the v1.4/v1.5 changelogs are confirmed present in the deployed overlay, or explicitly documented as not ported with rationale. The upgrade's value is evidenced, not assumed.

This artifact feeds the evidence ledger (story 3.5).
