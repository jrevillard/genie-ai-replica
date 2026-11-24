#!/usr/bin/env bash
# The #2148 ingestion verification: reads ArangoDB live and prints the
# seeded state — per-graph chunk counts, per-file ids, chunk labels, and
# the doc-repo statuses. Persists the verified state to
# $STATE/verify-result.json (the cleanup contract's proof input).
set -euo pipefail

ARANGO_PWD=$(kubectl -n genieai get secret arango-root-secret -o jsonpath='{.data.password}' | base64 -d)
AQL() { curl -s -u "root:$ARANGO_PWD" -X POST "http://127.0.0.1:8529/_db/_system/_api/cursor" \
  -H "Content-Type: application/json" -d "$1"; }
STATE=${STATE:-.}

echo "=== graphs"
AQL '{"query": "FOR g IN _graphs RETURN g._key"}'
echo

echo "=== GRAPH_RESTRICTED_E01_SOURCE chunks"
AQL '{"query": "FOR c IN GRAPH_RESTRICTED_E01_SOURCE RETURN {key: c._key, file_id: c.file_id, labels: c.chunk_labels, has_embedding: c.embedding != null, text: LEFT(c.text, 70)}"}' > "$STATE/verify-result.json"
python3 -c "
import json
d = json.load(open('$STATE/verify-result.json'))
if d.get('error'): print('ERROR:', d); exit(1)
for r in d['result']:
    print(' ', r['file_id'], '| labels:', r['labels'], '| emb:', r['has_embedding'])
    print('    ', r['text'][:66])
print('total:', len(d['result']))
"
echo

echo "=== GRAPH_SOURCE chunks (before: 3 × test-document.md)"
AQL '{"query": "FOR c IN GRAPH_SOURCE COLLECT file_id = c.file_id INTO g RETURN {file_id: file_id, chunks: LENGTH(g)}"}' > "$STATE/verify-result-graph-source.json"
cat "$STATE/verify-result-graph-source.json" | python3 -c "
import sys, json
for r in json.load(sys.stdin)['result']: print(' ', r['file_id'], r['chunks'])
"
echo

echo "=== doc-repo statuses (the 7 files)"
EDGE_IP=${EDGE_IP:?}; BEARER=${BEARER:?}
for fid in $(python3 -c "import json;print(' '.join(json.load(open('$STATE/ingestion-ledger.json'))['uploads'].values()))"); do
  curl -sk --resolve genieai-forge.local:4443:$EDGE_IP "https://genieai-forge.local:4443/api/files/$fid" \
    -H "Authorization: Bearer $BEARER" | python3 -c "
import sys, json
d = json.load(sys.stdin)
f = d.get('data') or d.get('file') or d
print(' ', f.get('file_id'), '| status:', (f.get('dataprep') or {}).get('status'), '| chunks:', f.get('chunk_count'), '| labels:', f.get('labels'))
"
done
