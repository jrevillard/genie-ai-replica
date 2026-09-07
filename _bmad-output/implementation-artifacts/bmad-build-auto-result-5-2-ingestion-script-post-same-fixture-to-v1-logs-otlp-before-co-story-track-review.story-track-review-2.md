---
status: done
---

Story 5-2 review-2 completed.

Third review pass on `tests/scripts/post-fixture-to-vl-otlp.sh` against the
post-#2-patch working tree (HEAD = `9abe910b0`). Verified all 8 patches from
the prior pass hold; no new defects found. No further modifications produced.

Verifications run:
- `bash -n tests/scripts/post-fixture-to-vl-otlp.sh` → SYNTAX_OK.
- HIGH `iso_to_nanos` IEEE-754 overflow: reproduced pre-fix with
  `jq -n '1786752154.818 * 1000000000 | tostring'` → `"1786752154818000100"`
  (off by 100 ns per record). Post-fix integer-string concat path yields
  `"1786752154818000000"` on the same input — truth confirmed.
- MEDIUM OTEL scheme gate: `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=javascript://evil bash ...`
  exits 1 with "must use http:// or https://".
- MEDIUM VL whitespace-trim symmetry: `xargs` now applied in the `VICTORIALOGS_URL`
  branch (line 167) symmetrically with the OTEL branch (line 155).
- MEDIUM empty-string service coalesce: both `group_by` key and resource
  attribute use `(.service // "") | if . == "" then "unknown" else . end`.
- MEDIUM BOM strip: `sed -n '1s/^\xEF\xBB\xBF//;p' "$FIXTURE_PATH"` precedes
  `jq -s` on both the count probe (line 223) and the main translation
  (line 281). Probed with a synthetic `\xEF\xBB\xBF`-prefixed 2-record
  fixture — `jq -s 'length'` returned `2` and `.[0].message` parsed to
  `"BOM test"`.
- MEDIUM `--connect-timeout 5`: present alongside `--max-time` (line 390).
- LOW portable `mktemp`: bare positional template `mktemp otlp-payload.XXXXXX.json`
  (lines 243/251/252).
- LOW tightened trap window: `trap cleanup EXIT` set at line 250 right after
  the first mktemp; cleanup list extended at line 253 after subsequent mktemps.
- REGRESSION FIX (SIGPIPE on BOM branch): redundant `"$FIXTURE_PATH"` positional
  removed from the main `jq -s` invocation; the BOM-strip sed pipes via stdin.
- #1 octal trap still holds: `MAX_ATTEMPTS=010 bash ...` exits 1 with
  "must be a non-negative integer without leading zeros".
- Working tree clean for the script and story spec; no further patches needed.

Orchestrator bookkeeping untouched: `sprint-status.yaml` and `deferred-work.md`
remain at their `M` state from the prior review pass — orchestrator-owned, not
reverted.
