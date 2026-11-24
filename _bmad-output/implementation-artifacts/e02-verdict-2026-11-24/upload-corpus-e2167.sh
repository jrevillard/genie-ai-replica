#!/usr/bin/env bash
# The #2167 phase-2 uploads: the 7 e01- fixtures through the doc-repo API
# (realm user e01-sec-eval, the #2148/#2162 method), writing the ledger in
# the dict shape serial-ingest-e2162.sh reads: {"uploads": {<name>: <fid>}}.
set -euo pipefail
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
echo "upload bearer ok (${#BEARER} chars)"

EDGE="https://genieai-forge.local:4443"
RESOLVE="--resolve genieai-forge.local:4443:$EDGE_IP"

if [ ! -f "$LEDGER" ]; then echo '{"uploads": {}}' > "$LEDGER"; fi

upload_one() {  # <file> <labels-csv-or-empty>
  local f="$1" labels="$2"
  local name; name=$(basename "$f")
  echo "--- upload $name (labels: ${labels:-none})"
  local args=(-sk $RESOLVE -X POST "$EDGE/api/files/upload" -H "Authorization: Bearer $BEARER"
      -F "file=@$f;filename=$name;type=text/markdown" -w "\nHTTP %{http_code}"
      -o /tmp/e2167-upload-body.json)
  if [ -n "$labels" ]; then args+=(-F "labels=$labels"); fi
  local code; code=$(curl "${args[@]}" | tail -1)
  local fid; fid=$(python3 -c "
import json
body = json.load(open('/tmp/e2167-upload-body.json'))
fid = (body.get('data') or {}).get('file_id') or (body.get('file') or {}).get('file_id') or body.get('file_id')
assert fid, 'no file_id in: ' + json.dumps(body)[:300]
print(fid)
")
  echo "  http=$code file_id=$fid"
  case "$code" in HTTP\ 2*) ;; *) exit 1;; esac
  python3 - "$LEDGER" "$name" "$fid" <<'PYEOF'
import json, sys
ledger, name, fid = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(ledger))
d.setdefault("uploads", {})[name.replace("e01-sec-doc-", "doc-").replace(".md", "")] = fid
json.dump(d, open(ledger, "w"), indent=1)
PYEOF
}

upload_one "$FIXTURES/e01-sec-doc-restricted-e01.md" ""
upload_one "$FIXTURES/e01-sec-doc-shared-e01.md" ""
upload_one "$FIXTURES/e01-sec-doc-wide-e01.md" ""
upload_one "$FIXTURES/e01-sec-doc-revoked-e01.md" ""
upload_one "$FIXTURES/e01-sec-doc-forestry-e01.md" "Natural Resources"
upload_one "$FIXTURES/e01-sec-doc-catalogue-e01.md" ""
upload_one "$FIXTURES/e01-sec-doc-servicerequest-e01.md" ""
echo "uploads complete:"; python3 -c "import json,sys; print(json.load(open('$LEDGER'))['uploads'])"
