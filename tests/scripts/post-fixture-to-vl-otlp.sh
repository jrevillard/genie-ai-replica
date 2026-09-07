#!/usr/bin/env bash
# =============================================================================
# post-fixture-to-vl-otlp.sh
# =============================================================================
# Reads the contract-test NDJSON fixture
# (`tests/test-fixtures/logs/combined-2026-08-15.log`) and POSTs it to the
# VictoriaLogs OTLP `/v1/logs` endpoint, translating each NDJSON record into
# an OTel `resourceLogs[].scopeLogs[].logRecords[]` payload.
#
# This runs BEFORE story 5.8's contract test, which exercises both the legacy
# file path and the new VL path against the SAME input. The script is the
# producer half; the contract test is the consumer.
#
# Default endpoint follows D6 (logs egress via the OTel Collector):
#   http://otel-collector:4318/v1/logs
# Direct VictoriaLogs ingestion
#   http://victorialogs:9428/insert/opentelemetry/v1/logs
# is permitted ONLY as an env-var override (e.g. for local smoke runs outside
# the swarm).
#
# Endpoint resolution precedence (highest wins):
#   1. OTEL_EXPORTER_OTLP_LOGS_ENDPOINT  (full URL, must end in /v1/logs)
#   2. VICTORIALOGS_URL                  (base URL; the script appends the
#                                        OTLP insert path)
#   3. http://otel-collector:4318/v1/logs  (swarm default per D6)
#
# Fixture path:
#   $1                                  absolute or relative path
#   default                             tests/test-fixtures/logs/combined-2026-08-15.log
#                                       (resolved relative to the repo root,
#                                        not the CWD, so the script works from
#                                        any invocation directory)
#
# Other env vars (optional):
#   INGEST_SCOPE_NAME     Scope name on the OTLP envelope   (default: fixture-ingestion)
#   INGEST_SCOPE_VERSION  Scope version on the OTLP envelope (default: 1.0.0)
#   INGEST_ENVIRONMENT    deployment.environment resource attribute
#                         (default: test)
#   HTTP_TIMEOUT_SECS     per-attempt curl timeout          (default: 30)
#   MAX_ATTEMPTS          5xx retry budget                  (default: 3)
#
# Exit codes:
#   0   all records posted (HTTP 2xx)
#   1   usage / argument error
#   2   curl transport failure (all attempts exhausted)
#   3   5xx from endpoint (all attempts exhausted)
#   4   non-2xx, non-5xx response from endpoint
#   5   jq translation failed
#   6   fixture file missing / unreadable
#
# All diagnostics go to stderr; stdout stays clean for piping.
# Requires: bash 4+, jq, curl. No Node.js dependency.
# =============================================================================

set -euo pipefail

# ----- usage ------------------------------------------------------------------
usage() {
  cat <<'EOF' >&2
Usage: post-fixture-to-vl-otlp.sh [FIXTURE_PATH]

Posts the contract-test NDJSON fixture to the VictoriaLogs OTLP /v1/logs
endpoint. See header comment for endpoint precedence and env vars.

Arguments:
  FIXTURE_PATH    Path to NDJSON fixture (default:
                  tests/test-fixtures/logs/combined-2026-08-15.log,
                  resolved relative to the repo root).

Options:
  -h, --help      Show this help and exit.

Environment variables:
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT  Full URL ending in /v1/logs (highest priority)
  VICTORIALOGS_URL                  Base URL; /insert/opentelemetry/v1/logs is appended
  INGEST_SCOPE_NAME                 OTLP scope name           (default: fixture-ingestion)
  INGEST_SCOPE_VERSION              OTLP scope version        (default: 1.0.0)
  INGEST_ENVIRONMENT                deployment.environment    (default: test)
  HTTP_TIMEOUT_SECS                 per-attempt curl timeout  (default: 30, min: 1)
  MAX_ATTEMPTS                      5xx retry budget          (default: 3, min: 1)
EOF
}

# ----- argument parsing -------------------------------------------------------
FIXTURE_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      FIXTURE_ARG="${1:-}"
      break
      ;;
    -*)
      echo "[post-fixture-to-vl-otlp] unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -n "$FIXTURE_ARG" ]]; then
        echo "[post-fixture-to-vl-otlp] at most one FIXTURE_PATH is allowed (got '$FIXTURE_ARG' and '$1')" >&2
        usage
        exit 1
      fi
      FIXTURE_ARG="$1"
      shift
      ;;
  esac
done

# ----- repo-root + fixture resolution ----------------------------------------
# Resolve from this script's location so the script works whether the caller
# is in the repo root, in tests/, or in tests/scripts/.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEFAULT_FIXTURE="$REPO_ROOT/tests/test-fixtures/logs/combined-2026-08-15.log"

FIXTURE_PATH="${FIXTURE_ARG:-$DEFAULT_FIXTURE}"

# If the path is relative, resolve it against CWD first; if not found there,
# fall back to the repo-root default resolution.
if [[ ! -f "$FIXTURE_PATH" && -f "$REPO_ROOT/$FIXTURE_PATH" ]]; then
  FIXTURE_PATH="$REPO_ROOT/$FIXTURE_PATH"
fi

if [[ ! -f "$FIXTURE_PATH" ]]; then
  echo "[post-fixture-to-vl-otlp] fixture not found: $FIXTURE_PATH" >&2
  echo "[post-fixture-to-vl-otlp] searched default: $DEFAULT_FIXTURE" >&2
  exit 6
fi

if [[ ! -r "$FIXTURE_PATH" ]]; then
  echo "[post-fixture-to-vl-otlp] fixture not readable: $FIXTURE_PATH" >&2
  exit 6
fi

# ----- prerequisite check ----------------------------------------------------
for cmd in jq curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[post-fixture-to-vl-otlp] required command not found: $cmd" >&2
    exit 1
  fi
done

# ----- endpoint resolution (D6) ----------------------------------------------
# 1) OTEL_EXPORTER_OTLP_LOGS_ENDPOINT (full URL, must end in /v1/logs)
# 2) VICTORIALOGS_URL                 (base URL; append OTLP insert path)
# 3) http://otel-collector:4318/v1/logs (swarm default)
if [[ -n "${OTEL_EXPORTER_OTLP_LOGS_ENDPOINT:-}" ]]; then
  # Trim leading/trailing whitespace: operators frequently paste URLs with
  # trailing newlines or stray spaces, and curl treats them as part of the URL.
  ENDPOINT="$(printf '%s' "$OTEL_EXPORTER_OTLP_LOGS_ENDPOINT" | xargs)"
  # Reject non-http(s) schemes (file://, ftp://, javascript://, ...) — curl
  # would silently accept them and either upload the payload as a local file
  # or no-op the POST. Same scheme gate as VICTORIALOGS_URL.
  if ! [[ "$ENDPOINT" =~ ^https?:// ]]; then
    echo "[post-fixture-to-vl-otlp] OTEL_EXPORTER_OTLP_LOGS_ENDPOINT must use http:// or https://, got: $ENDPOINT" >&2
    exit 1
  fi
  ENDPOINT_SOURCE="OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"
elif [[ -n "${VICTORIALOGS_URL:-}" ]]; then
  # Trim leading/trailing whitespace (symmetric with the OTEL endpoint branch
  # above) before stripping slashes / validating the scheme.
  VL_BASE="$(printf '%s' "$VICTORIALOGS_URL" | xargs)"
  # Strip ALL trailing slashes (parameter expansion ${var%/} only removes one
  # pass; loop until stable). Multiple trailing slashes would otherwise produce
  # an endpoint like "//insert/opentelemetry/v1/logs" which VL rejects.
  VL_BASE="${VL_BASE%/}"
  while [[ "$VL_BASE" != "${VL_BASE%/}" ]]; do
    VL_BASE="${VL_BASE%/}"
  done
  # Validate URL scheme. Without this, "host:9428" (no scheme) would be
  # parsed by curl as a local file path, and POST silently becomes a no-op.
  if ! [[ "$VL_BASE" =~ ^[a-zA-Z][a-zA-Z0-9+.-]*:// ]]; then
    echo "[post-fixture-to-vl-otlp] VICTORIALOGS_URL must include a scheme (http:// or https://), got: $VICTORIALOGS_URL" >&2
    exit 1
  fi
  ENDPOINT="${VL_BASE}/insert/opentelemetry/v1/logs"
  ENDPOINT_SOURCE="VICTORIALOGS_URL (direct VL ingestion)"
else
  ENDPOINT="http://otel-collector:4318/v1/logs"
  ENDPOINT_SOURCE="default (OTel Collector per D6)"
fi

# Sanity check: OTLP endpoint should end with /v1/logs.
if [[ "${ENDPOINT%/}" != */v1/logs ]]; then
  echo "[post-fixture-to-vl-otlp] endpoint does not end in /v1/logs: $ENDPOINT" >&2
  exit 1
fi

# ----- optional knobs --------------------------------------------------------
SCOPE_NAME="${INGEST_SCOPE_NAME:-fixture-ingestion}"
SCOPE_VERSION="${INGEST_SCOPE_VERSION:-1.0.0}"
ENVIRONMENT="${INGEST_ENVIRONMENT:-test}"
HTTP_TIMEOUT="${HTTP_TIMEOUT_SECS:-30}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"

# Validate numeric env knobs up-front so a misconfigured deploy fails loudly
# before any network round-trip.
for knob_name in HTTP_TIMEOUT MAX_ATTEMPTS; do
  knob_val="${!knob_name}"
  if ! [[ "$knob_val" =~ ^([1-9][0-9]*|0)$ ]]; then
    echo "[post-fixture-to-vl-otlp] $knob_name must be a non-negative integer without leading zeros (to avoid bash octal interpretation), got: $knob_val" >&2
    exit 1
  fi
done
if (( HTTP_TIMEOUT < 1 )); then
  echo "[post-fixture-to-vl-otlp] HTTP_TIMEOUT_SECS must be >= 1, got: $HTTP_TIMEOUT" >&2
  exit 1
fi
if (( MAX_ATTEMPTS < 1 )); then
  echo "[post-fixture-to-vl-otlp] MAX_ATTEMPTS must be >= 1, got: $MAX_ATTEMPTS" >&2
  exit 1
fi

# ----- diagnostics -----------------------------------------------------------
# Count records via jq rather than `wc -l`: `wc -l` counts newlines and
# diverges from the NDJSON record count on no-trailing-newline fixtures, CRLF,
# or blank lines (all of which jq -s tolerates).
RECORD_COUNT=$(jq -s 'length' < <(sed -n '1s/^\xEF\xBB\xBF//;p' "$FIXTURE_PATH"))
if (( RECORD_COUNT == 0 )); then
  echo "[post-fixture-to-vl-otlp] fixture is empty: $FIXTURE_PATH" >&2
  exit 6
fi
echo "[post-fixture-to-vl-otlp] fixture: $FIXTURE_PATH ($RECORD_COUNT records)" >&2
echo "[post-fixture-to-vl-otlp] endpoint: $ENDPOINT (source: $ENDPOINT_SOURCE)" >&2
echo "[post-fixture-to-vl-otlp] scope: $SCOPE_NAME/$SCOPE_VERSION env=$ENVIRONMENT" >&2
echo "[post-fixture-to-vl-otlp] timeout: ${HTTP_TIMEOUT}s, attempts: $MAX_ATTEMPTS" >&2

# ----- translate NDJSON -> OTLP ---------------------------------------------
# We materialise the OTLP JSON to a temp file before posting so curl can read
# the full body with --data-binary @file. Piping into curl in one shot works,
# but the temp file gives clean error reporting if jq fails partway through
# and lets curl retry without re-running jq.
# Drop the `-t PREFIX` mktemp form for portability: GNU `mktemp -t PREFIX`
# interprets the arg as a TMPDIR hint and the resulting filename is
# `mktemp_XXXXXX`-style regardless of suffix, while BSD `mktemp -t TEMPLATE`
# treats the arg as a literal template. Passing the template as a bare
# positional is portable across both.
TMP_PAYLOAD="$(mktemp otlp-payload.XXXXXX.json)"
cleanup() {
  rm -f "$TMP_PAYLOAD"
}
# Set the trap immediately after the first mktemp so a failure between
# subsequent mktemps still cleans up whatever was created so far; we extend
# the cleanup list below as each temp file is allocated.
trap cleanup EXIT
TMP_RESPONSE="$(mktemp otlp-response.XXXXXX.json)"
TMP_RESPONSE_STDERR="$(mktemp otlp-response-stderr.XXXXXX.txt)"
cleanup() {
  rm -f "$TMP_PAYLOAD" "$TMP_RESPONSE" "$TMP_RESPONSE_STDERR"
}

# jq programme:
#   * slurp the NDJSON fixture
#   * group by record.service -> one resourceLogs block per service
#     (the fixture mixes genie-backend and genie-document-repository records;
#     AD-2 requires service.name as a stream field, so it must live on the
#     resource, not on each logRecord)
#   * per record, build an OTLP logRecord:
#       - timeUnixNano + observedTimeUnixNano  <- timestamp (ISO 8601 -> epoch ns)
#       - severityNumber                       <- level (TRACE=1..FATAL=21, else 0)
#       - severityText                         <- uppercased level
#       - body.stringValue                     <- message
#       - traceId / spanId                     <- hex trace/span ids, ONLY when
#                                                non-empty AND 32/16 hex chars
#                                                (AD-2: drop empty trace_id to
#                                                avoid cardinality blowup)
#       - attributes                           <- [{level}] (AD-3: VL surfaces
#                                                _stream.level / fields.level)
#
# Helper: iso_to_nanos converts "2026-08-15T00:02:34.818Z" -> 1786752154818000000.
# jq's fromdateiso8601 only accepts the strict "%Y-%m-%dT%H:%M:%SZ" form (no
# fractional seconds) and returns epoch SECONDS with fractional precision — we
# split on '.', parse the integer-second part, and pad+slice the fractional
# part to 9 digits to preserve sub-second precision (ms/us/ns forms all map to
# the right nanosecond count).
if ! sed -n '1s/^\xEF\xBB\xBF//;p' "$FIXTURE_PATH" | jq -s \
    --arg scope_name "$SCOPE_NAME" \
    --arg scope_version "$SCOPE_VERSION" \
    --arg env "$ENVIRONMENT" '
    def severity_num:
      gsub("^\\s+|\\s+$"; "") | ascii_upcase |
      if   . == "TRACE" then 1
      elif . == "DEBUG" then 5
      elif . == "INFO"  then 9
      elif . == "WARN"  then 13
      elif . == "ERROR" then 17
      elif . == "FATAL" then 21
      else 0
      end;

    def iso_to_nanos:
      if type == "string" and . != "" then
        (split(".")) as $parts |
        (if ($parts | length) > 1
         then ($parts[0] + "Z")
         else .
         end) as $iso |
        ($iso | fromdateiso8601) as $epoch |
        (if ($epoch | type) == "number"
         then
           (if ($parts | length) > 1
            then (($parts[1] | sub("Z$"; "")) + "000000000")[0:9]
            else "000000000"
            end) as $frac_ns |
           # Integer-string concat keeps 19-digit nanosecond precision past 2^53
           # (epoch*1e9 overflows IEEE-754 doubles for any date > ~1971-08,
           # silently rounding the fractional part by hundreds of ns). OTLP
           # JSON encodes uint64 as a string anyway.
           (($epoch | floor | tostring) + $frac_ns)
         else "0"
         end)
      else "0"
      end;

    {
      resourceLogs: (
        group_by((.service // "") | if . == "" then "unknown" else . end) | map({
          resource: {
            attributes: [
              {key: "service.name",           value: {stringValue: ((.[0].service // "") | if . == "" then "unknown" else . end)}},
              {key: "deployment.environment", value: {stringValue: $env}}
            ]
          },
          scopeLogs: [
            {
              scope: {name: $scope_name, version: $scope_version},
              logRecords: [
                .[] | (
                  (.timestamp // "" | iso_to_nanos) as $ts |
                  (.level     // "" | severity_num) as $sev |
                  (.level     // "" | (gsub("^\\s+|\\s+$"; "") | ascii_upcase)) as $sev_text |
                  {
                    timeUnixNano:         ($ts | tostring),
                    observedTimeUnixNano: ($ts | tostring),
                    severityNumber:      $sev,
                    severityText:        $sev_text,
                    body:                {stringValue: (.message // "")},
                    attributes:          (
                      if $sev_text != "" then [{key: "level", value: {stringValue: $sev_text}}] else [] end
                    )
                  }
                  + (if ((.trace_id // "") != "" and (.trace_id | length) == 32 and (.trace_id | test("^[0-9a-fA-F]+$")))
                     then {traceId: .trace_id} else {} end)
                  + (if ((.span_id // "") != "" and (.span_id | length) == 16 and (.span_id | test("^[0-9a-fA-F]+$")))
                     then {spanId: .span_id} else {} end)
                )
              ]
            }
          ]
        })
      )
    }
  ' > "$TMP_PAYLOAD"; then
  echo "[post-fixture-to-vl-otlp] jq translation failed for $FIXTURE_PATH" >&2
  exit 5
fi

# Sanity-check the produced JSON: it must contain at least one resourceLogs
# block and the expected number of logRecords. jq exits non-zero on parse
# failure; capture both stdout and exit code separately so a malformed
# produced payload does NOT silently degrade to "0 records".
PRODUCED_COUNT=$(jq '[.resourceLogs[].scopeLogs[].logRecords[]] | length' "$TMP_PAYLOAD")
jq_exit=$?
if [[ $jq_exit -ne 0 ]]; then
  echo "[post-fixture-to-vl-otlp] produced OTLP JSON failed to parse (jq exit $jq_exit)" >&2
  exit 5
fi
if [[ "$PRODUCED_COUNT" != "$RECORD_COUNT" ]]; then
  echo "[post-fixture-to-vl-otlp] record count mismatch: input=$RECORD_COUNT, produced=$PRODUCED_COUNT" >&2
  exit 5
fi

# ----- POST with 5xx retry --------------------------------------------------
http_code=""
attempt=0
while [[ $attempt -lt "$MAX_ATTEMPTS" ]]; do
  attempt=$((attempt + 1))

  # Capture both http code and body. Disable set -e temporarily around the
  # curl call so a transport failure doesn't abort the retry loop.
  set +e
  http_code=$(curl \
    --silent \
    --show-error \
    --connect-timeout 5 \
    --max-time "$HTTP_TIMEOUT" \
    --max-redirs 0 \
    --header "Content-Type: application/json" \
    --output "$TMP_RESPONSE" \
    --write-out "%{http_code}" \
    --data-binary "@$TMP_PAYLOAD" \
    "$ENDPOINT" 2>>"$TMP_RESPONSE_STDERR")
  curl_exit=$?
  set -e
  # If stderr leaked into the response file, fold it back out.
  if [[ -s "$TMP_RESPONSE_STDERR" ]]; then
    cat "$TMP_RESPONSE_STDERR" >&2
    : > "$TMP_RESPONSE_STDERR"
  fi

  if [[ $curl_exit -ne 0 ]]; then
    echo "[post-fixture-to-vl-otlp] curl failed (exit $curl_exit, attempt $attempt/$MAX_ATTEMPTS)" >&2
    if [[ $attempt -lt "$MAX_ATTEMPTS" ]]; then
      sleep 1
      continue
    fi
    exit 2
  fi

  # Retry on 5xx; treat 4xx as terminal (client error, retrying won't help).
  if [[ "$http_code" =~ ^5[0-9]{2}$ ]]; then
    echo "[post-fixture-to-vl-otlp] HTTP $http_code (5xx, attempt $attempt/$MAX_ATTEMPTS)" >&2
    if [[ $attempt -lt "$MAX_ATTEMPTS" ]]; then
      sleep 1
      continue
    fi
    echo "[post-fixture-to-vl-otlp] giving up after $MAX_ATTEMPTS attempts (last HTTP $http_code)" >&2
    echo "[post-fixture-to-vl-otlp] response: $(cat "$TMP_RESPONSE")" >&2
    exit 3
  fi

  break
done

# ----- final response check -------------------------------------------------
if [[ ! "$http_code" =~ ^2[0-9]{2}$ ]]; then
  echo "[post-fixture-to-vl-otlp] HTTP $http_code (non-2xx)" >&2
  echo "[post-fixture-to-vl-otlp] response: $(cat "$TMP_RESPONSE")" >&2
  exit 4
fi

echo "[post-fixture-to-vl-otlp] OK — posted $RECORD_COUNT records to $ENDPOINT (HTTP $http_code)" >&2
exit 0
