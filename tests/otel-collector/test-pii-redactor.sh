#!/usr/bin/env bash
# Smoke test for the OTel Collector transform/pii_redact processor.
# Strategy: 1-shot sidecar that loads the production otel-collector-config.yaml
# (so the production transforms run), plus a tiny overlay that adds a
# filelog receiver and routes logs through the same transform chain to VL.
# Write a known-PII record. Read back the VL row and assert redaction.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="${TMPDIR:-/tmp}/pii-redact-$$"
mkdir -p "$TMP"
# On failure, keep TMP for inspection; on success, clean up.
cleanup() {
  local rc=$?
  if [ "$rc" -eq 0 ]; then rm -rf "$TMP"; fi
  echo "TMP=$TMP (exit=$rc)" >&2
  exit "$rc"
}
trap cleanup EXIT

# --- Discover compose project + key service names from the live stack ---
# Hardcoded compose names (`admin-logs-prd_genieai_network`,
# `admin-logs-prd-victorialogs-1`) would break CI: the worktree directory
# may be checked out under a different name (e.g. `build` on the shared
# runner, any user override of `--project-name`). Discover the actual
# project + container at runtime instead.
COMPOSE_PROJECT=$(docker compose -f "${ROOT}/docker-compose.yaml" ps --format json 2>/dev/null \
  | python3 -c "
import sys, json
try:
    services = json.load(sys.stdin)
    for s in services:
        n = s.get('Name', '')
        if n.endswith('-victorialogs-1'):
            # Strip the trailing -victorialogs-1 to get the project name
            print(n[: -len('-victorialogs-1')])
            sys.exit(0)
except Exception:
    pass
" 2>/dev/null)
# Fallback to the directory basename (compose default convention) when
# the live-stack probe returned empty — e.g. when the smoke is run with
# the stack already up under a docker-compose project that doesn't
# follow the `<project>-victorialogs-1` shape (custom service names).
if [ -z "${COMPOSE_PROJECT}" ]; then
  COMPOSE_PROJECT="$(basename "${ROOT}")"
fi
VL_CONTAINER="${COMPOSE_PROJECT}-victorialogs-1"
# Find the compose-managed genieai network: it's `<project>_genieai_network`
# under default Compose naming, or any single existing match.
NETWORK=$(docker network ls --filter "name=_genieai_network" --format '{{.Name}}' \
  | grep -E "^${COMPOSE_PROJECT}_genieai_network$" || true)
if [ -z "${NETWORK}" ]; then
  # Fallback: any genieai network belonging to the project (handles
  # --project-name overrides that don't produce the default name).
  NETWORK=$(docker network ls --filter "name=_genieai_network" --format '{{.Name}}' | head -1)
fi
if [ -z "${NETWORK}" ]; then
  echo "FAIL: could not locate the compose-managed genieai network."
  echo "  COMPOSE_PROJECT=${COMPOSE_PROJECT}"
  docker network ls --format '{{.Name}}' | head -20
  exit 1
fi
echo "INFO: COMPOSE_PROJECT=${COMPOSE_PROJECT}  VL_CONTAINER=${VL_CONTAINER}  NETWORK=${NETWORK}" >&2

# 1. Generate a STANDALONE test config that includes the production
#    transforms inline (no merge) plus a filelog receiver and a VL exporter.
#    Standalone avoids the OTel config-merge quirk where the base
#    service.pipelines block is REPLACED by the overlay — referencing
#    the base `otlp_http` exporter from the overlay pipeline fails
#    to instantiate it because nothing in the overlay service block
#    declares it as part of a pipeline that ALSO runs.
cat > "$TMP/collector-test.yaml" <<'YAML'
receivers:
  filelog/test:
    include:
      - /tmp/in.log
    start_at: beginning

processors:
  # === INLINED FROM configs/otel/otel-collector-config.yaml ===
  # (Production config ships these; we copy verbatim so the test runs
  # WITHOUT depending on OTel's config-merge behavior. Keep in sync.)
  transform/pii_redact:
    error_mode: propagate
    log_statements:
      - context: log
        statements:
          - 'replace_pattern(body, "(?i)\"((?:password|api[_-]?key|apikey|session[_-]?id|user[_-]?id|email|mail|auth[_-]?token|bearer[_-]?token|authorization|token|secret|api[_-]?secret|credential|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|private[_-]?key|secret[_-]?value|user[_-]?query|llm[_-]?response|document[_-]?text))\"\\s*[:=]\\s*\"[^\"]*\"", "\"$1\":\"[REDACTED]\"") where IsString(body)'
          - 'replace_pattern(body, "(?i)\"((?:password|api[_-]?key|apikey|session[_-]?id|user[_-]?id|email|mail|auth[_-]?token|bearer[_-]?token|authorization|token|secret|api[_-]?secret|credential|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|private[_-]?key|secret[_-]?value|user[_-]?query|llm[_-]?response|document[_-]?text))\"\\s*[:=]\\s*\"[^\"]*\"", "\"$1\":\"[REDACTED]\"") where IsString(body)'
          - 'replace_pattern(body, "(?i)\"((?:password|api[_-]?key|apikey|session[_-]?id|user[_-]?id|email|mail|auth[_-]?token|bearer[_-]?token|authorization|token|secret|api[_-]?secret|credential|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|private[_-]?key|secret[_-]?value|user[_-]?query|llm[_-]?response|document[_-]?text))\"\\s*[:=]\\s*\"[^\"]*\"", "\"$1\":\"[REDACTED]\"") where IsString(body)'
          - 'replace_pattern(body, "(?i)\"((?:password|api[_-]?key|apikey|session[_-]?id|user[_-]?id|email|mail|auth[_-]?token|bearer[_-]?token|authorization|token|secret|api[_-]?secret|credential|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|private[_-]?key|secret[_-]?value|user[_-]?query|llm[_-]?response|document[_-]?text))\"\\s*[:=]\\s*\"[^\"]*\"", "\"$1\":\"[REDACTED]\"") where IsString(body)'
          - 'replace_pattern(body, "(?i)\"((?:password|api[_-]?key|apikey|session[_-]?id|user[_-]?id|email|mail|auth[_-]?token|bearer[_-]?token|authorization|token|secret|api[_-]?secret|credential|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|private[_-]?key|secret[_-]?value|user[_-]?query|llm[_-]?response|document[_-]?text))\"\\s*[:=]\\s*\"[^\"]*\"", "\"$1\":\"[REDACTED]\"") where IsString(body)'
          - 'replace_pattern(body, "(?i)bearer\\s+[a-z0-9\\-_]{20,}", "bearer [REDACTED_BEARER]") where IsString(body)'
          - 'replace_pattern(body, "sk-[a-z0-9]{20,}", "[REDACTED_APIKEY]") where IsString(body)'
          - 'replace_pattern(body, "eyJ[A-Za-z0-9_\\-]+\\.[A-Za-z0-9_\\-]+\\.[A-Za-z0-9_\\-]+", "[REDACTED_JWT]") where IsString(body)'
          # Map-body fallback: same logic as production.
          - 'replace_all_patterns(body, "value", "(?i)^(password|api[_-]?key|apikey|session[_-]?id|user[_-]?id|email|mail|auth[_-]?token|bearer[_-]?token|authorization|token|secret|api[_-]?secret|credential|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|private[_-]?key|secret[_-]?value|user[_-]?query|llm[_-]?response|document[_-]?text)$", "[REDACTED]") where IsMap(body)'
      - context: log
        statements:
          - 'replace_all_patterns(attributes, "value", "(?i)\"((?:password|api[_-]?key|apikey|session[_-]?id|user[_-]?id|email|mail|auth[_-]?token|bearer[_-]?token|authorization|token|secret|api[_-]?secret|credential|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key|private[_-]?key|secret[_-]?value|user[_-]?query|llm[_-]?response|document[_-]?text))\"\\s*[:=]\\s*\"[^\"]*\"", "\"$1\":\"[REDACTED]\"") where IsMap(attributes)'
  transform/set_trace_id_from_body:
    error_mode: ignore
    log_statements:
      - context: log
        statements:
          - 'set(attributes["trace_id"], body["trace_id"]) where IsMap(body) and IsString(body["trace_id"])'
  batch:
    timeout: 1s
    send_batch_size: 1

exporters:
  otlp_http/vl:
    endpoint: http://victorialogs:9428/insert/opentelemetry
  debug:
    verbosity: detailed

service:
  telemetry:
    metrics:
      level: none
  pipelines:
    logs/test:
      receivers: [filelog/test]
      processors:
        - transform/pii_redact
        - transform/set_trace_id_from_body
        - batch
      exporters: [otlp_http/vl, debug]
YAML

# Pre-create the test log file BEFORE starting the collector so the
# filelog operator discovers it at startup (start_at: beginning).
# trace_id MUST be 32-char hex — VictoriaLogs indexes trace_id as a
# dedicated field and non-hex values are dropped from the index.
# Body intentionally has NO "message" key so stamp_log_metadata_from_msg
# (NOT included here — see comment above) does not overwrite body with
# just the message; the redacted JSON survives into VL as `_msg`.
cat > "$TMP/in.log" <<LOG
{"level":"info","session_id":"abc-123","email":"u@x.com","mail":"v@y.z","trace_id":"deadbeefcafebabe1234567890abcdef"}
LOG

# 2. Start a one-shot collector container with the test config
docker run --rm --name "pii-redact-test-$$" \
    --network "${NETWORK}" \
    -v "$TMP:/tmp" \
    -v "$TMP/collector-test.yaml:/etc/otel/collector-test.yaml:ro" \
    otel/opentelemetry-collector-contrib:0.152.0 \
    --config /etc/otel/collector-test.yaml \
    > "$TMP/collector.log" 2>&1 &
COLLECTOR_PID=$!

# Wait for collector to be ready and process the log (batch timeout 5s + export)
for i in $(seq 1 20); do
  if ! kill -0 "$COLLECTOR_PID" 2>/dev/null; then
    echo "FAIL: collector exited before ready"
    cat "$TMP/collector.log"
    exit 1
  fi
  sleep 1
done

# 4. Stop the collector
kill $COLLECTOR_PID 2>/dev/null || true
wait $COLLECTOR_PID 2>/dev/null || true

# 5. Read back VL and assert redaction.
# Note: the test uses a filelog receiver so `body` is a raw STRING
# (not the Map that set_trace_id_from_body expects). The body content
# — including the redacted trace_id — ends up in `_msg`, not as a
# top-level VL stream field. Production fluentd path uses Map bodies.
# We query `_msg:REDACTED` (full-text on the body content).
docker exec "${VL_CONTAINER}" \
  wget -qO- 'http://127.0.0.1:9428/select/logsql/query?query=_msg:REDACTED&limit=1' > "$TMP/vl.json"

if ! grep -q '"_msg"' "$TMP/vl.json"; then
  echo "FAIL: no VL row found"
  cat "$TMP/collector.log" | tail -20
  echo "--- vl.json ---"
  cat "$TMP/vl.json"
  exit 1
fi

# Original PII value must NOT appear in VL
if grep -q '"session_id":"abc-123"' "$TMP/vl.json"; then
  echo "FAIL: session_id still contains original PII"
  cat "$TMP/vl.json"
  exit 1
fi

# email must be redacted
if grep -q '"email":"u@x.com"' "$TMP/vl.json"; then
  echo "FAIL: email not redacted in VL row"
  cat "$TMP/vl.json"
  exit 1
fi

# mail (alias of email per configs/otel/pii-key-list.md) must be redacted
if grep -q '"mail":"v@y.z"' "$TMP/vl.json"; then
  echo "FAIL: mail alias not redacted in VL row (regex missing |mail alternative)"
  cat "$TMP/vl.json"
  exit 1
fi

# The [REDACTED] placeholder MUST appear (proves redaction ran)
if ! grep -q '\[REDACTED\]' "$TMP/vl.json"; then
  echo "FAIL: no [REDACTED] placeholder in VL row"
  cat "$TMP/vl.json"
  exit 1
fi

echo "PASS: PII redactor transform works"
