#!/usr/bin/env bash
# The #2148 security-corpus ingestion. deploy/verify/restore: every object
# created here is recorded and retracted by the cleanup script.
#
#   5 restricted fixtures -> doc-repo upload, then dataprep
#       POST /v1/dataprep/ingest_file with graphName=GRAPH_RESTRICTED_E01
#       (the doc-repo ingest route cannot carry a graph name; dataprep's
#       payload accepts one — the same field the doc-repo itself fills from
#       the files doc. A non-OKF_ graph name keeps the completion callback on
#       the legacy doc-repo route.)
#   2 injection fixtures  -> doc-repo upload, then the normal
#       POST /api/files/<id>/ingest (default graph GRAPH_SOURCE).
#
# Bearer: ROPC of e01-sec-eval (realm role admin) via the Keycloak
# port-forward; the dataprep call is service-internal, no bearer.
set -euo pipefail

FIXTURES="${FIXTURES:?set FIXTURES to the fixtures dir}"
STATE="${STATE:?set STATE to the run dir (the file-id ledger lands there)}"
EDGE_IP="${EDGE_IP:?set EDGE_IP to the envoy LoadBalancer IP}"
LEDGER="$STATE/ingestion-ledger.json"

KCURL="${KCURL:-http://127.0.0.1:18082}"
BEARER=$(curl -s -X POST "$KCURL/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=e01-sec-eval" -d "grant_type=password" \
  --data-urlencode "username=e01-sec-eval" --data-urlencode "password=e01-sec-eval-PASS_f3a9c2d1" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
[ -n "$BEARER" ] || { echo "REFUSED: no upload bearer"; exit 1; }
echo "upload bearer ok (${#BEARER} chars)"

EDGE="https://genieai-forge.local:4443"
RESOLVE="--resolve genieai-forge.local:4443:$EDGE_IP"

python3 - "$LEDGER" <<'PYEOF'
import json, os, sys
ledger = sys.argv[1]
if not os.path.exists(ledger):
    json.dump({"uploads": [], "restricted_ingests": [], "legacy_ingests": []}, open(ledger, "w"), indent=1)
    print(f"ledger initialized: {ledger}")
PYEOF

upload_one() {  # <file> <labels-csv-or-empty>
  local f="$1" labels="$2"
  local name; name=$(basename "$f")
  echo "--- upload $name (labels: ${labels:-none})"
  local args=(-sk $RESOLVE -X POST "$EDGE/api/files/upload" -H "Authorization: Bearer $BEARER"
      -F "file=@$f;filename=$name;type=text/markdown" -w "\nHTTP %{http_code}"
      -o /tmp/e2148-upload-body.json)
  if [ -n "$labels" ]; then args+=(-F "labels=$labels"); fi
  local code; code=$(curl "${args[@]}" | tail -1)
  FID=$(python3 -c "
import json
body = json.load(open('/tmp/e2148-upload-body.json'))
fid = (body.get('data') or {}).get('file_id') or (body.get('file') or {}).get('file_id') or body.get('file_id')
assert fid, 'no file_id in: ' + json.dumps(body)[:300]
print(fid)
")
  echo "  http=$code file_id=$FID"
  case "$code" in HTTP\ 2*) ;; *) exit 1;; esac
}

# ---------------------------------------------------------------- uploads
upload_one "$FIXTURES/e01-sec-doc-restricted-e01.md" ""
FID_RESTRICTED=$FID
upload_one "$FIXTURES/e01-sec-doc-shared-e01.md" ""
FID_SHARED=$FID
upload_one "$FIXTURES/e01-sec-doc-wide-e01.md" ""
FID_WIDE=$FID
upload_one "$FIXTURES/e01-sec-doc-revoked-e01.md" ""
FID_REVOKED=$FID
upload_one "$FIXTURES/e01-sec-doc-forestry-e01.md" "Natural Resources"
FID_FORESTRY=$FID
upload_one "$FIXTURES/e01-sec-doc-catalogue-e01.md" ""
FID_CATALOGUE=$FID
upload_one "$FIXTURES/e01-sec-doc-servicerequest-e01.md" ""
FID_SERVICEREQ=$FID

python3 - "$LEDGER" <<PYEOF
import json
ledger = json.load(open("$LEDGER"))
ledger["uploads"] = {
    "doc-restricted-e01": "$FID_RESTRICTED",
    "doc-shared-e01": "$FID_SHARED",
    "doc-wide-e01": "$FID_WIDE",
    "doc-revoked-e01": "$FID_REVOKED",
    "doc-forestry-e01": "$FID_FORESTRY",
    "doc-catalogue-e01": "$FID_CATALOGUE",
    "doc-servicerequest-e01": "$FID_SERVICEREQ",
}
json.dump(ledger, open("$LEDGER", "w"), indent=1)
print("ledger uploads:", json.dumps(ledger["uploads"], indent=1))
PYEOF

# ------------------------------------------------- restricted ingests (dataprep direct)
dataprep_ingest() {  # <file> <fileId>
  local f="$1" fid="$2"
  local name; name=$(basename "$f")
  echo "--- dataprep ingest $name -> GRAPH_RESTRICTED_E01"
  # the payload is exactly the shape the document repository itself POSTs
  # (fileId/fileName/fileBase64/fileType/fileLabels/storagePath) plus the
  # graphName the doc-repo route cannot carry for a legacy file.
  local labels="[]"
  if [[ "$name" == *forestry* ]]; then labels='["Natural Resources"]'; fi
  local b64
  b64=$(python3 - "$f" "$fid" "$name" "$labels" <<'PYEOF'
import base64, json, sys
path, fid, name, labels = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4])
payload = {
    "fileId": fid,
    "fileName": name,
    "fileBase64": base64.b64encode(open(path, "rb").read()).decode(),
    "fileType": "text/markdown",
    "fileLabels": labels,
    "storagePath": None,
    "graphName": "GRAPH_RESTRICTED_E01",
}
print(base64.b64encode(json.dumps(payload).encode()).decode())
PYEOF
)
  # the dataprep service is reached INSIDE the cluster: kubectl exec into the
  # dataprep pod, the endpoint is localhost:5000 from its own pod.
  local code
  code=$(kubectl -n genieai exec -i deploy/genieai-genieai-umbrella-dataprep -- \
    sh -c "printf %s '$b64' | base64 -d > /tmp/e2148-payload.json && curl -s -o /tmp/e2148-resp.json -w '%{http_code}' -X POST http://127.0.0.1:5000/v1/dataprep/ingest_file -H 'Content-Type: application/json' -d @/tmp/e2148-payload.json")
  echo "  dataprep http=$code"
  kubectl -n genieai exec deploy/genieai-genieai-umbrella-dataprep -- \
    sh -c "head -c 300 /tmp/e2148-resp.json 2>/dev/null; echo"
  # the ledger's restricted_ingests key exists so a failed ingest is VISIBLE
  # in the run record, not just in stdout — and a non-accepted code stops the
  # run (an unseeded restricted graph would fail later, far from the cause).
  python3 - "$LEDGER" "$name" "$code" <<'PYEOF'
import json, sys
ledger, name, code = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
ledger.setdefault("restricted_ingests", []).append({"file": name, "http": code})
json.dump(ledger, open(sys.argv[1], "w"), indent=1)
if code not in ("200", "429"):
    print(f"REFUSED: dataprep ingest of {name} answered http={code} (429 = the single slot is busy — retry)", file=sys.stderr)
    sys.exit(1)
PYEOF
}

echo "=== restricted ingests (dataprep direct, graphName=GRAPH_RESTRICTED_E01)"
dataprep_ingest "$FIXTURES/e01-sec-doc-restricted-e01.md" "$FID_RESTRICTED"
dataprep_ingest "$FIXTURES/e01-sec-doc-shared-e01.md" "$FID_SHARED"
dataprep_ingest "$FIXTURES/e01-sec-doc-wide-e01.md" "$FID_WIDE"
dataprep_ingest "$FIXTURES/e01-sec-doc-revoked-e01.md" "$FID_REVOKED"
dataprep_ingest "$FIXTURES/e01-sec-doc-forestry-e01.md" "$FID_FORESTRY"

# ------------------------------------------------- legacy ingests (doc-repo route)
echo "=== legacy ingests (doc-repo /ingest, default graph)"
for pair in "catalogue:$FID_CATALOGUE" "servicerequest:$FID_SERVICEREQ"; do
  label=${pair%%:*}; fid=${pair#*:}
  CODE=$(curl -sk $RESOLVE -X POST "$EDGE/api/files/$fid/ingest" -H "Authorization: Bearer $BEARER" \
    -o /tmp/e2148-ingest-$label.json -w "%{http_code}")
  echo "ingest $label http=$CODE"
  cat /tmp/e2148-ingest-$label.json | python3 -c "import sys,json;d=json.load(sys.stdin);print(' ', json.dumps(d)[:200])" || true
  python3 - "$LEDGER" "$label" "$CODE" <<'PYEOF'
import json, sys
ledger, label, code = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
ledger.setdefault("legacy_ingests", []).append({"file": f"doc-{label}-e01", "http": code})
json.dump(ledger, open(sys.argv[1], "w"), indent=1)
if code not in ("200", "429"):
    print(f"REFUSED: legacy ingest of {label} answered http={code}", file=sys.stderr)
    sys.exit(1)
PYEOF
done

echo "=== done. statuses settle asynchronously — the verify script reads them."
