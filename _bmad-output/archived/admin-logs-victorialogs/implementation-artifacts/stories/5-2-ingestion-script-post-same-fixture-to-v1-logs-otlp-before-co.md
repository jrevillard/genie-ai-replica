---
key: 5-2-ingestion-script-post-same-fixture-to-v1-logs-otlp-before-co
title: "ingestion script: POST same fixture to `/v1/logs` (OTLP) before contract test"
epic: epic-5
status: done
effort: 0.1
depends_on: [5.1]
files: new shell script
baseline_revision: 119b31803a5a728f7694dd85744f9b9980f48d0d
followup_review_recommended: true
review_loop_iteration: 0
deferred:
  - summary: >-
      Producer unit-test harness for `post-fixture-to-vl-otlp.sh`: invoke the jq
      translation portion against tiny fixtures and assert on the produced
      OTLP shape (severity numbers, timeUnixNano precision, traceId/spanId
      gating, service.name placement on the resource).
    evidence: |-
      The script's 60-line jq programme is the load-bearing piece and is
      currently exercised only by story 5.8's contract test, which is a
      consumer-side gate. A standalone test would catch regressions
      before the contract test runs.
    severity: medium
  - summary: >-
      Wire the script into CI (`.gitlab-ci.yml` deploy or test job, and
      optionally a `package.json` test script) so it actually runs
      before the contract test.
    evidence: |-
      The script ships as a runnable orphan. The deps graph names 5.8 as
      the consumer, but nothing in this repo invokes the producer yet.
    severity: medium
  - summary: >-
      Pin the OTel semconv version for `deployment.environment` —
      semconv 1.27+ renamed the attribute to `deployment.environment.name`.
      Coordinate with the consumer story before flipping.
    evidence: |-
      The producer currently emits `deployment.environment`. If the
      downstream VL query / Grafana panel reads `deployment.environment.name`,
      the attribute will not match.
    severity: low
---

# Story 5.2 — ingestion script: POST same fixture to `/v1/logs` (OTLP) before contract test

**Epic**: epic-5 (0.1 SP)
**Files**: `new shell script`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#5` for the epic-level acceptance criteria; this story is one contributing step.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Review Triage Log

### 2026-09-07 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 0, medium 4, low 8)
- defer: 3
- reject: 22
- addressed_findings:
  - `[medium]` `[patch]` record-count source switched from `wc -l` to `jq -s 'length'`.
  - `[medium]` `[patch]` trace/span ID hex regex added.
  - `[medium]` `[patch]` empty fixture early-reject (exit 6).
  - `[medium]` `[patch]` cleanup trap covers stderr temp file.
  - `[low]` `[patch]` `PRODUCED_COUNT` jq-error swallowing replaced with explicit exit-5 path.
  - `[low]` `[patch]` `iso_to_nanos` no-fractional-seconds double-Z branch fixed.
  - `[low]` `[patch]` `iso_to_nanos` null-guard added.
  - `[low]` `[patch]` `HTTP_TIMEOUT_SECS` / `MAX_ATTEMPTS` numeric + min validation up-front.
  - `[low]` `[patch]` severity whitespace trimmed before `ascii_upcase`.
  - `[low]` `[patch]` null `service` coalesce to `"unknown"`.
  - `[low]` `[patch]` usage text lists all env vars.
  - `[low]` `[patch]` second positional arg → exit 1.

### 2026-09-07 — Review pass (follow-up)

Fresh review pass after the initial review closed; verifies that
post-merge review-receipt files surface no new defects beyond what the
deferred-work ledger already captures.

- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 0
- reject: 30
- addressed_findings:
  - `[medium]` `[patch]` `MAX_ATTEMPTS=010` rejected by tightened validator (regex `^([1-9][0-9]*|0)$`); bash arithmetic would otherwise parse the leading-zero as octal and silently use 8 instead of 10.
  - `[medium]` `[patch]` `VICTORIALOGS_URL` without an `http(s)://` scheme now exits 1 with a clear message; curl would otherwise treat `host:9428` as a local file path and silently no-op the POST.
  - `[low]` `[patch]` `VICTORIALOGS_URL` with multiple trailing slashes is now loop-stripped to a single trailing-slash-less base; previously only the first `/` was stripped per `${var%/}`.
  - `[low]` `[patch]` `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` whitespace trimmed via `xargs` before the `/v1/logs` suffix check; pasted-in trailing newlines or stray spaces no longer corrupt the URL.
  - `[low]` `[patch]` `curl` invoked with `--max-redirs 0` so the no-follow behaviour is explicit and a stray 3xx response surfaces as exit 4 instead of an HTTP 200 from the redirect target.
  - `[low]` `[patch]` jq `attributes` array is now `[]` when `severityText` is empty (records with missing or whitespace-only `.level`); previously emitted `{key: "level", value: {stringValue: ""}}`, which surfaces in VictoriaLogs as an empty-string `level` stream field.

### 2026-09-07 — Review pass (follow-up #2)

Fresh review pass after the second review closed; orchestrator-driven
`done → in-review → done` cycle. Run with all four review layers
(blind hunter, edge-case hunter, verification-gap, intent-alignment).

- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 1, medium 5, low 2)
- defer: 0
- reject: 53
- addressed_findings:
  - `[high]` `[patch]` `iso_to_nanos` IEEE-754 overflow fixed: switched from `($epoch * 1000000000) + $frac_ns` (double arithmetic, loses precision past 2^53) to integer-string concat `($epoch | floor | tostring) + $frac_ns`, returning `timeUnixNano` as a string (OTLP JSON uint64 spec). Verified: `1786752154.818 * 1e9` yielded `"1786752154818000100"` (off by 100 ns); integer path yields `"1786752154818000000"` (correct). Every modern-date record was wrong; this fix corrects all 500 fixture records.
  - `[medium]` `[patch]` `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` scheme validation added (regex `^https?://`); previously curl would silently POST to `javascript://evil`, `file:///etc/passwd`, `ftp://`, etc.
  - `[medium]` `[patch]` `VICTORIALOGS_URL` whitespace-trim symmetry: the OTEL endpoint branch already trimmed via `xargs`; the VL branch now does the same so pasted-in leading/trailing whitespace no longer produces a malformed URL.
  - `[medium]` `[patch]` empty-string `service` coalesced to `"unknown"` in BOTH the `group_by` key (`.service // "" | if . == "" then "unknown" else . end`) and the resource attribute; previous `//` operator only coalesced null/false, so `"service": ""` produced a resource block with `service.name = ""`.
  - `[medium]` `[patch]` BOM (UTF-8 byte-order mark) stripped from the fixture before jq slurp; previously `jq -s` rejected BOM-prefixed files with a cryptic parse error. The wrong claim "jq -s tolerates BOM" in the RECORD_COUNT comment was removed.
  - `[medium]` `[patch]` `curl` now invoked with `--connect-timeout 5` alongside `--max-time` so a slow TCP handshake doesn't burn the full per-attempt budget before any HTTP exchange happens.
  - `[low]` `[patch]` `mktemp -t PREFIX` replaced with bare `mktemp TEMPLATE` for portability across GNU and BSD `mktemp` (the `-t` flag has divergent meanings — GNU treats the arg as a TMPDIR hint, BSD as a literal template).
  - `[low]` `[patch]` cleanup trap now set immediately after the first `mktemp` and the cleanup function list is extended after each subsequent `mktemp`, narrowing the temp-file leak window on early failure.

## Auto Run Result

- Summary: Third (orchestrator-driven fresh) review pass on `tests/scripts/post-fixture-to-vl-otlp.sh`. The script implements the producer half of story 5.2's contract — same NDJSON fixture as the legacy file path, translated to OTLP `resourceLogs` JSON, POSTed to the OTel Collector at `:4318/v1/logs` (D6) with `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` and `VICTORIALOGS_URL` overrides. The implementation matches Reading D of the intent (producer with consumer-side acceptance at story 5.8); all Reading-C concerns (CI wiring, jq unit-test harness, semconv pin) remain parked in the existing deferred list as DW-392/393/394.
- Files changed:
  - `tests/scripts/post-fixture-to-vl-otlp.sh` — 8 follow-up patches (HIGH iso_to_nanos precision fix; 5 medium: OTEL scheme validation, VL whitespace-trim symmetry, empty-string service coalesce, BOM strip, `--connect-timeout`; 2 low: portable `mktemp`, tightened trap window).
  - `_bmad-output/implementation-artifacts/stories/5-2-ingestion-script-post-same-fixture-to-v1-logs-otlp-before-co.md` — this triage-log entry, status flipped to `done`.
- Review findings breakdown: 8 patches applied (high × 1, medium × 5, low × 2); 0 new defers (the three prior-pass defers cover the meaningful future work and the user instruction prohibits modifying existing deferred-work ledger entries); 53 noise items rejected (process-level concerns like CI wiring/semconv already covered by the existing DW-392/393/394, feature-add requests like `--dry-run` / stdin / custom headers, and orchestrator-owned bookkeeping).
- Follow-up review recommendation: **true** — `3 × 5 + 1 × 2 = 17 ≥ 5`. One HIGH-severity patch (iso_to_nanos precision) drives the score; the script's central OTLP-translation contract remains unverified in-repo (covered by DW-392 producer unit-test harness — owned by a follow-up story).
- Verification performed:
  - `bash -n tests/scripts/post-fixture-to-vl-otlp.sh` → syntax OK.
  - `bash tests/scripts/post-fixture-to-vl-otlp.sh` (no overrides, no reachable OTLP endpoint) → resolved 500-record fixture, jq translation emitted 2 resourceLogs × 250/250 records, curl exhausted retries on `Could not resolve host: otel-collector` (exit 2, documented transport-failure path). Confirms end-to-end plumbing through BOM strip, jq translation, retry loop, and exit-code classification.
  - `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=javascript://evil bash tests/scripts/post-fixture-to-vl-otlp.sh` → exits 1 with "must use http:// or https://".
  - `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=file:///etc/passwd bash tests/scripts/post-fixture-to-vl-otlp.sh` → exits 1 with the same scheme message.
  - `VICTORIALOGS_URL="  http://victorialogs:9428  " bash tests/scripts/post-fixture-to-vl-otlp.sh` → endpoint resolved to `http://victorialogs:9428/insert/opentelemetry/v1/logs` (whitespace trimmed symmetrically).
  - `MAX_ATTEMPTS=010 bash tests/scripts/post-fixture-to-vl-otlp.sh` → exits 1 with "must be a non-negative integer without leading zeros" (prior-pass fix still holds).
  - jq probe against `tests/test-fixtures/logs/combined-2026-08-15.log`: produced `timeUnixNano: "1786752684119000000"` for first record (correct 19-digit nanosecond precision; the prior implementation would have given `"1786752684119000100"`, off by 100 ns due to IEEE-754 overflow).
  - jq probe with `[{service:"",...}]`: `group_by` key resolved to `"unknown"` and resource attribute `service.name` rendered as `"unknown"` (empty-string coalesce works in both spots).
  - jq probe with BOM-prefixed fixture (`\xEF\xBB\xBF` + JSON): jq translation succeeded without parse error (BOM stripped before slurp).
  - mktemp portability: temp files now named `otlp-payload.<6 random>.json` (no `tmp.` prefix that GNU `mktemp -t` would emit); portable across GNU/BSD.
  - Cleanup trap window: temp files present immediately after mktemp; trap registered right after first mktemp; cleanup function list extended after each subsequent mktemp. A failure between subsequent mktemps now cleans up whatever was allocated so far.
- Residual risks: AD-17 (round-trip parity vs. legacy file path) is still unverified — the contract test in story 5.8 is `ready-for-dev`, not in this story. Until that test runs against VL fed by this script, the OTLP payload shape is asserted only by inspection of the produced JSON. The three deferred items (DW-392 producer unit-test harness, DW-393 CI wiring, DW-394 semconv pin) cover that gap; this story cannot close it.
