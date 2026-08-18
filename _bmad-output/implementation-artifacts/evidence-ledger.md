# Evidence Ledger — OPEA v1.5 Upgrade

**Generated:** 2026-08-18 22:52:54 UTC
**Baseline revision:** `fef51ae5e8cfe8519f9bb18167704735d2fd15e2`
**Scope:** Epics 1–3 (RAG parity, CVE baseline-diff, contract tests, override manifest, upstream improvements)
**Status:** ⚠️ **BLOCKED — CVE baseline-diff shows 83 net-new HIGH/CRITICAL CVEs, pending human risk-acceptance decision**

---

## Executive Summary

This ledger indexes all verification artifacts produced during the OPEA v1.5 upgrade (Epics 1–3). It provides a unified audit trail so reviewers can trace every verification artifact (override manifest, CVE baseline-diff, parity report, red-run log, contract matrix, upstream improvements) by path and checksum without manually searching directories.

**Key findings:**
- ✅ **RAG parity:** v1.5 matches v1.3 baseline (recall 88.2%, precision 31.4%, retrieval recall 100%)
- ⚠️ **CVE baseline-diff:** 83 net-new HIGH/CRITICAL CVEs detected — **UPGRADE BLOCKED**, pending human risk-acceptance
- ✅ **Contract tests:** 59 tests across 10 files, all modules covered (chatqna, retriever, reranker, dataprep, embedding)
- ✅ **Override manifest:** 19 overrides documented with dispositions
- ✅ **Upstream improvements:** 16 present, 3 not ported (documented), 2 false claims discarded

**Verification posture:** All gates pass **except** the CVE baseline-diff, which requires human risk-acceptance before the upgrade can proceed to production.

---

## Artifact Index

| Artifact | Path (relative to repo root) | SHA256 | Status | Notes |
|----------|------------------------------|--------|--------|-------|
| Override manifest | `genie-ai-overlay/OVERRIDES.yaml` | `997b367e77f0cf595bf2bb0be3a2f55b8e4a0be6ae5c9ffa421bbc6aaa4c7d5c` | ✅ Present | 19 overrides, all with disposition `re-graft-to-new-API` |
| RAG baseline v1.3 | `_bmad-output/implementation-artifacts/rag-baseline-v1.3.json` | `1777eac40b3c92e095b4ee911842937d13c179f29da67f1d7bdec9716572d940` | ✅ Present | 17 anchor queries, recall 88.2% |
| RAG parity v1.5 | `_bmad-output/implementation-artifacts/rag-parity-v1.5.json` | `484cafba877e698351c21eefbf64ee4e04b9924352ec9bf23fee205d899013d3` | ✅ Present | Matches v1.3 baseline (parity confirmed) |
| CVE baseline-diff report | `_bmad-output/implementation-artifacts/cve-baseline-diff/cve-baseline-diff.md` | `42f33891ac1447c9eadb322d35a2eea43a5308a973022083cd68edd4ec8b9f78` | ✅ Present | ⚠️ **BLOCKED** — 83 net-new HIGH/CRITICAL CVEs |
| CVE baseline-diff bundle | `_bmad-output/implementation-artifacts/cve-baseline-diff/` | (directory) | ✅ Present | 16 files (JSON, logs, diff script, SHA256SUMS) |
| Red-run log | `_bmad-output/implementation-artifacts/red-run-v1.5-bare.md` | `0545b6401ecc63812b7a933786ad98838b4e8d86b0c8165ecce57754009f24b4` | ✅ Present | Bare v1.5 bump fails (build surface red) |
| Contract matrix | `_bmad-output/implementation-artifacts/contract-matrix.md` | `a9ea65fa14db700d4b53275d4b7be2c5db3c863a5ba8b8876d3231ec6f357c36` | ✅ Present | 59 tests, 10 files, 5 modules covered |
| Upstream improvements | `_bmad-output/implementation-artifacts/upstream-improvements-verification.md` | `8f9fb45638ee62c979fcf6a6f91226acccfa912013f2ee467dacc62361d2fde6` | ✅ Present | 16 present, 3 not ported, 2 false claims discarded |
| Evidence ledger | `_bmad-output/implementation-artifacts/evidence-ledger.md` | (this file) | ✅ Present | This document |

**Required artifacts for `verify:evidence` CI stage:** All 8 artifacts above (excluding this ledger's own checksum, which is self-referential).

---

## Override Dispositions

**Manifest:** `genie-ai-overlay/OVERRIDES.yaml`
**Checksum:** `997b367e77f0cf595bf2bb0be3a2f55b8e4a0be6ae5c9ffa421bbc6aaa4c7d5c`
**Entry count:** 19 overrides

All overrides have disposition `re-graft-to-new-API` and are tied to story 2.1 or DW-5. Every override is accounted for in the upstream improvements verification (see §Upstream Improvements below).

**Override categories:**
- `core.constants.ServiceType` — enum renumbering (TRANSLATOR moved to slot 29)
- `core.genieai_api_protocol.ChatCompletionRequest.*` — 14 field-level overrides (k, fetch_k, lambda_mult, score_threshold, max_tokens, n, seed, temperature, top_p, best_of, repetition_penalty, top_k, timeout, top_n)
- `build-patches.docarray_alias_shim` — sys.modules alias for docarray rename
- `build-patches.install_site_startup` — site-packages patch installation
- `contracts._harness.import_docarray` — test harness import shim

**Verification:** `build-patches/lint_overrides.py` enforces manifest↔source marker sync (exit 0 required).

---

## CVE Baseline-Diff

**Report:** `_bmad-output/implementation-artifacts/cve-baseline-diff/cve-baseline-diff.md`
**Bundle:** `_bmad-output/implementation-artifacts/cve-baseline-diff/`
**Checksum (report):** `42f33891ac1447c9eadb322d35a2eea43a5308a973022083cd68edd4ec8b9f78`
**Generated:** 2026-08-18 23:15:58 CEST

### ⚠️ UPGRADE BLOCKED

**Verdict:** BLOCKED
**Net-new HIGH/CRITICAL CVEs:** 83
**Status:** Pending human risk-acceptance decision

**Summary by image:**

| Image | v1.3 CVEs | v1.5 CVEs | Closures | Net-New | Persisted |
|-------|-----------|-----------|----------|---------|-----------|
| genie-ai-chatqna | 31 | 49 | 3 | 21 | 28 |
| genie-ai-retriever | 25 | 30 | 14 | 19 | 11 |
| genie-ai-dataprep | 46 | 53 | 20 | 27 | 26 |
| genie-ai-reranker | 10 | 22 | 4 | 16 | 6 |
| **TOTAL** | **112** | **154** | **41** | **83** | **71** |

**Key net-new CVEs (examples):**
- CVE-2026-69844 (langchain-core, CRITICAL) — fixed in 1.2.5, 0.3.81
- CVE-2026-69247 (cryptography, HIGH) — fixed in 50.0.0
- CVE-2026-59950 (mcp, HIGH) — fixed in 1.28.1
- CVE-2026-44432 (urllib3, HIGH) — fixed in 2.7.0

**Closures (41 CVEs fixed by upgrade):**
- CVE-2025-48379 (pillow 11.2.1 → 11.3.0)
- CVE-2025-62727 (starlette 0.46.2 → 0.49.1)
- CVE-2025-5302 (llama-index-core 0.12.19 → 0.12.38)
- ... (41 total)

**Resolution:** This is a **human risk-acceptance decision**, not an agent decision. The ledger documents the BLOCKED verdict but does not resolve it. If the ledger must claim "all gates pass" while CVE says "blocked," the agent HALTs and escalates.

**Bundle contents:**
- `v1.3-*.json` (4 files) — Trivy scan results for v1.3 images
- `v1.5-*.json` (4 files) — Trivy scan results for v1.5 images
- `build-v1.3-*.log` (4 files) — Image build logs (v1.3)
- `build-v1.5-*.log` (4 files) — Image build logs (v1.5)
- `diff-advisories.py` — Script that computes the diff
- `README.md` — Bundle documentation
- `SHA256SUMS.txt` — Checksums for all files

---

## RAG Parity Report

**Baseline (v1.3):** `_bmad-output/implementation-artifacts/rag-baseline-v1.3.json`
**Parity run (v1.5):** `_bmad-output/implementation-artifacts/rag-parity-v1.5.json`
**Checksums:** `1777eac4...` (v1.3), `484cafba...` (v1.5)

### Metric Comparison

| Metric | v1.3 Baseline | v1.5 Parity | Delta | Status |
|--------|---------------|-------------|-------|--------|
| Anchor queries | 17 | 17 | 0 | ✅ Match |
| Recall | 88.2% | 88.2% | 0.0% | ✅ Parity |
| Precision | 31.4% | 31.4% | 0.0% | ✅ Parity |
| Complete recall | 88.2% | 88.2% | 0.0% | ✅ Parity |
| Noise | 68.6% | 68.6% | 0.0% | ✅ Parity |
| Retrieval recall | 100% | 100% | 0.0% | ✅ Parity |
| Semantic | Skipped | Skipped | — | N/A |

**Conclusion:** v1.5 matches v1.3 baseline exactly. No regression in RAG retrieval quality.

**Stack details:**
- Harness SHA: `7fb8bc2e3f1716c241c4004c397149d10b03f561d01a8b253f105c701dd17610`
- Test stack: `test-opea-1.5-el-salvador`
- Capture date (v1.3): 2026-08-17T20:55:03+00:00
- Capture date (v1.5): 2026-08-18 (see JSON for exact timestamp)

---

## Red-Run Logs

**Log:** `_bmad-output/implementation-artifacts/red-run-v1.5-bare.md`
**Checksum:** `0545b6401ecc63812b7a933786ad98838b4e8d86b0c8165ecce57754009f24b4`

**Summary:** A bare v1.5 bump (without overlay re-graft) fails at the build surface. The red proves the contract tests are not green-on-green — they catch real breaks.

**Failure modes observed:**
1. `REQ_PATH` points at `retrievers/src/requirements.txt` which does not exist in v1.5 (compiled lock)
2. Compiled lock requires Python 3.11 (v1.3 image base is 3.10)
3. GPU-adjacent pins pull system libs the image lacks

**Conclusion:** The safety net catches real 1.5 breaks, not hypothetical ones. The overlay re-graft (stories 2-1 through 2-8) made the suite green again on v1.5.

---

## Contract Matrix

**Matrix:** `_bmad-output/implementation-artifacts/contract-matrix.md`
**Checksum:** `a9ea65fa14db700d4b53275d4b7be2c5db3c863a5ba8b8876d3231ec6f357c36`

**Summary:**
- Total test files: 10
- Total test functions: 59
- Modules covered: 5 (chatqna, retriever, reranker, dataprep, embedding)
- Test environment: In-image (real `comps`) + dev venv (pure logic)
- CI stage: `contract-in-image` (per-module jobs with `--junitxml`)

**Module coverage:**
- **chatqna:** 9 tests (orchestrator wire, e2e pipeline)
- **retriever:** 23 tests (label filter, retriever fusion, NFRP budgets)
- **reranker:** 6 tests (adapter imports, registry, enum, telemetry, invoke signature)
- **dataprep:** 3 tests (ingest, NFRP budgets)
- **embedding:** Covered via retriever/chatqna orchestrator
- **all (pure logic):** 17 tests (harness, telemetry, mock-reality parity)

**CI jobs:**
- `contract:retriever-arango` — retriever + chatqna tests
- `contract:reranker` — reranker tests
- `contract:dataprep-arango` — dataprep tests
- `contract:unit` — pure logic tests (dev venv)

**Red-green validation:** Suite proven green on v1.3 (story 1-5), red on bare v1.5 bump (story 1-5), green again on v1.5 with overlay re-graft (stories 2-1 through 2-8).

---

## Upstream Improvements

**Verification:** `_bmad-output/implementation-artifacts/upstream-improvements-verification.md`
**Checksum:** `8f9fb45638ee62c979fcf6a6f91226acccfa912013f2ee467dacc62361d2fde6`

**Counts:**
- **Present:** 16 improvements (A1–A5, B1–B4, B6–B10, C3, C4)
- **Not ported (optional/documented):** 3 improvements (C1, C2, B5)
- **False claims discarded:** 2 (D1, D2)

**Categories:**
- **A. Hard Blockers (5):** MCPFuncType enum, ServiceType members, TRANSLATOR slot collision, enum auto(), OPEA_VERSION in Dockerfiles
- **B. Build/Dependency Adoption (10):** requirements-cpu.txt path, Python 3.11, langchain-arangodb over-pin, dependency bumps, retired #834 lock machinery, Pydantic v2 field tightening, opea_telemetry byte-identical, embedding/textgen base images bumped, cross-module overlay-locks CI job
- **C. Optional/Noted Changes (4):** align_generator null-skip (not ported, optional), DocList→List switch (not applicable), docarray rename shim (present), schedule() kwargs bundle (present)
- **D. False Claims Discarded (2):** opea_telemetry renamed (false), docarray.py renamed upstream (false)

**Override audit:** All 19 overrides in `OVERRIDES.yaml` are accounted for in the verification above.

**Epic 2 coverage map:** Stories 2.1–2.8 each verify specific improvements (see verification doc for details).

---

## Audit Trail

| Timestamp (UTC) | Actor | Action | Details |
|-----------------|-------|--------|---------|
| 2026-08-17 20:55:03 | CI | RAG baseline v1.3 captured | 17 anchor queries, recall 88.2% |
| 2026-08-18 ~20:00 | CI | RAG parity v1.5 captured | Matches v1.3 baseline exactly |
| 2026-08-18 23:15:58 | CI | CVE baseline-diff generated | 83 net-new HIGH/CRITICAL CVEs, BLOCKED |
| 2026-08-18 ~22:00 | CI | Red-run log generated | Bare v1.5 bump fails (build surface red) |
| 2026-08-18 ~22:30 | CI | Contract tests run | 59 tests, all pass on v1.5 with overlay re-graft |
| 2026-08-19 ~10:00 | Agent (story 3-4) | Upstream improvements verified | 16 present, 3 not ported, 2 false claims discarded |
| 2026-08-18 22:52:54 | Agent (story 3-5) | Contract matrix generated | 10 files, 59 tests, 5 modules covered |
| 2026-08-18 22:52:54 | Agent (story 3-5) | Evidence ledger generated | This document |
| 2026-08-18 23:13:48 | CI (mutation-probe job) | Mutation probe executed | Deliberate break in test_contract_harness.py::test_mutation_probe_deliberate_break, pytest exit code 1, confirmed red, reverted |

---

## Verification Commands

```bash
# Check ledger exists and is non-empty
test -f _bmad-output/implementation-artifacts/evidence-ledger.md && \
test -s _bmad-output/implementation-artifacts/evidence-ledger.md

# Check verify:evidence stage exists in CI
grep -q "verify:evidence" .gitlab-ci.yml

# Check allow_failure: false
grep -A 5 "verify:evidence" .gitlab-ci.yml | grep -q "allow_failure: false"

# Check mutation probe job exists
grep -q "mutation-probe" .gitlab-ci.yml

# Verify ledger checksum
sha256sum _bmad-output/implementation-artifacts/evidence-ledger.md

# Verify CVE BLOCKED verdict is documented
grep -q "BLOCKED" _bmad-output/implementation-artifacts/evidence-ledger.md
```

---

## Conclusion

The evidence ledger indexes all verification artifacts from Epics 1–3 with paths, checksums, and statuses. All gates pass **except** the CVE baseline-diff, which shows 83 net-new HIGH/CRITICAL CVEs and requires human risk-acceptance before the upgrade can proceed to production.

**Mutation probe:** ✅ Executed successfully on 2026-08-18 23:13:48 UTC. Deliberate break in `test_contract_harness.py::test_mutation_probe_deliberate_break` caused pytest to fail (exit code 1), confirming the gates are not theater. The break was reverted, and the execution is recorded in the audit trail above.

**Next steps:**
1. Human reviews CVE baseline-diff and decides whether to accept the risk or defer the upgrade
2. If accepted, update this ledger to remove the BLOCKED status

**Ledger status:** ⚠️ **BLOCKED — pending human risk-acceptance decision on CVE baseline-diff**
