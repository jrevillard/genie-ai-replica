#!/usr/bin/env bash
# e2162 serial ingestion: the venue's dataprep has ONE ingest slot
# (DATAPREP_INGEST_CONCURRENCY=1), so the 7 fixtures are submitted one at a
# time — a 429 means "slot busy", not a failure: wait and re-submit.
# Idempotent: files already Ingested are skipped (doc-repo status check).
set -uo pipefail

FIXTURES="${FIXTURES:?}"
STATE="${STATE:?}"
EDGE_IP="${EDGE_IP:?}"
LEDGER="$STATE/ingestion-ledger.json"

KCURL="${KCURL:-http://127.0.0.1:18082}"
BEARER=$(curl -s -X POST "$KCURL/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=e01-sec-eval" -d "grant_type=password" \
  --data-urlencode "username=e01-sec-eval" --data-urlencode "password=e01-sec-eval-PASS_f3a9c2d1" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
[ -n "$BEARER" ] || { echo "REFUSED: no upload bearer"; exit 1; }

EDGE="https://genieai-forge.local:4443"
RESOLVE="--resolve genieai-forge.local:4443:$EDGE_IP"

doc_status() {  # <fileId> -> status string (the doc-repo nests the state under dataprep.status)
  curl -sk $RESOLVE "$EDGE/api/files/$1" -H "Authorization: Bearer $BEARER" \
    | python3 -c "import sys,json
try:
    d=json.load(sys.stdin)
    f=d.get('data') or d.get('file') or d
    print((f.get('dataprep') or {}).get('status') or f.get('status') or '')
except Exception:
    print('')"
}

wait_ingested() {  # <fileId> <name> — poll until Ingested (max 15 min)
  local fid="$1" name="$2" i
  for i in $(seq 1 90); do
    st=$(doc_status "$fid")
    case "$st" in
      Ingested) echo "  $name: Ingested (poll $i)"; return 0;;
      Failed|ScanFailed) echo "  REFUSED: $name status=$st"; return 1;;
    esac
    sleep 10
  done
  echo "  TIMEOUT waiting for $name (last status=$st)"; return 1
}

submit_restricted() {  # <file> <fileId> <labels-json>
  local f="$1" fid="$2" labels="${3:-[]}" name b64 code
  name=$(basename "$f")
  b64=$(python3 - "$f" "$fid" "$name" "$labels" <<'PYEOF'
import base64, json, sys
path, fid, name, labels = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4])
payload = {
    "fileId": fid, "fileName": name,
    "fileBase64": base64.b64encode(open(path, "rb").read()).decode(),
    "fileType": "text/markdown", "fileLabels": labels,
    "storagePath": None, "graphName": "GRAPH_RESTRICTED_E01",
}
print(base64.b64encode(json.dumps(payload).encode()).decode())
PYEOF
)
  for i in $(seq 1 60); do
    # a concurrent submission (the initial POST that 429'd the others) may
    # already have ingested this file — check before re-submitting or the
    # retry loop double-ingests the in-flight document
    if [ "$(doc_status "$fid")" = "Ingested" ]; then
      echo "  $name: Ingested (concurrent submission won)"; return 0
    fi
    code=$(kubectl -n genieai exec -i deploy/genieai-genieai-umbrella-dataprep -- \
      sh -c "printf %s '$b64' | base64 -d > /tmp/e2162-payload.json && curl -s -o /tmp/e2162-resp.json -w '%{http_code}' -X POST http://127.0.0.1:5000/v1/dataprep/ingest_file -H 'Content-Type: application/json' -d @/tmp/e2162-payload.json")
    case "$code" in
      200) echo "  $name: dataprep accepted (attempt $i)"; return 0;;
      429) sleep 20;;
      *) echo "  REFUSED: $name http=$code"; kubectl -n genieai exec deploy/genieai-genieai-umbrella-dataprep -- sh -c "head -c 200 /tmp/e2162-resp.json; echo"; return 1;;
    esac
  done
  echo "  TIMEOUT submitting $name"; return 1
}

submit_legacy() {  # <name> <fileId>
  local label="$1" fid="$2" code i
  for i in $(seq 1 60); do
    if [ "$(doc_status "$fid")" = "Ingested" ]; then
      echo "  doc-$label-e01: Ingested (concurrent submission won)"; return 0
    fi
    code=$(curl -sk $RESOLVE -X POST "$EDGE/api/files/$fid/ingest" -H "Authorization: Bearer $BEARER" \
      -o /tmp/e2162-ingest-$label.json -w "%{http_code}")
    case "$code" in
      200) echo "  doc-$label-e01: doc-repo accepted (attempt $i)"; return 0;;
      429) sleep 20;;
      *) echo "  REFUSED: doc-$label-e01 http=$code"; head -c 200 /tmp/e2162-ingest-$label.json; echo; return 1;;
    esac
  done
  echo "  TIMEOUT submitting doc-$label-e01"; return 1
}

python3 - "$LEDGER" <<'PYEOF' > /tmp/e2162-order.txt
import json, sys
ledger = json.load(open(sys.argv[1]))
u = ledger["uploads"]
for key in ["doc-restricted-e01","doc-shared-e01","doc-wide-e01","doc-revoked-e01","doc-forestry-e01","doc-catalogue-e01","doc-servicerequest-e01"]:
    print(key, u[key])
PYEOF

FAILED=0
# the loop reads on fd 3: `kubectl exec -i` inside the functions consumes
# stdin, and a loop fed on stdin loses the rest of its order file (the bug
# that silently skipped five fixtures on the first pass)
while read -r key fid <&3; do
  echo "=== $key ($fid)"
  st=$(doc_status "$fid")
  if [ "$st" = "Ingested" ]; then echo "  already Ingested — skip"; continue; fi
  case "$key" in
    doc-catalogue-e01)    submit_legacy catalogue "$fid"    || FAILED=1;;
    doc-servicerequest-e01) submit_legacy servicerequest "$fid" || FAILED=1;;
    doc-forestry-e01)     submit_restricted "$FIXTURES/e01-sec-doc-forestry-e01.md" "$fid" '["Natural Resources"]' || FAILED=1;;
    doc-restricted-e01)   submit_restricted "$FIXTURES/e01-sec-doc-restricted-e01.md" "$fid" '[]' || FAILED=1;;
    doc-shared-e01)       submit_restricted "$FIXTURES/e01-sec-doc-shared-e01.md" "$fid" '[]' || FAILED=1;;
    doc-wide-e01)         submit_restricted "$FIXTURES/e01-sec-doc-wide-e01.md" "$fid" '[]' || FAILED=1;;
    doc-revoked-e01)      submit_restricted "$FIXTURES/e01-sec-doc-revoked-e01.md" "$fid" '[]' || FAILED=1;;
  esac
  # wait for THIS doc to settle before submitting the next (single slot)
  if [ "$st" != "Ingested" ]; then wait_ingested "$fid" "$key" || FAILED=1; fi
done 3< /tmp/e2162-order.txt

echo "=== serial ingestion complete (FAILED=$FAILED)"
exit $FAILED
