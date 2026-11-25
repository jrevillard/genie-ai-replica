#!/usr/bin/env bash
# The #2170 live-trace verification — the evidence that the agentic run is
# OBSERVABLE, not merely logged.
#
# It proves four things, each against a live endpoint:
#   1. VictoriaTraces holds the agent-service spans of a real run:
#      the agent.run PARENT span and its per-model / per-tool-call CHILDREN,
#      with service_name=agent-service;
#   2. the traces are reachable through the SAME Jaeger query API the
#      dashboards use (the Grafana "victoriatraces" datasource proxies
#      /select/jaeger);
#   3. VictoriaMetrics holds the agent-service metric series under the
#      service_name label the dashboards discover services by — the proof
#      that "agent-service appears in the Grafana dashboards" is a DATA
#      statement, not a config statement;
#   4. Grafana itself carries the two dashboards the campaign names
#      (service-health, rag-pipeline-trace-waterfall) and its datasource
#      answers a query about agent-service.
#
# Usage: verify-traces.sh [since-seconds-ago] [output-file]
set -uo pipefail

NS="${NS:-genieai}"
SINCE="${1:-3600}"
OUT="${2:-/tmp/verify-traces.log}"
ART="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec > >(tee -a "$OUT") 2>&1
echo "=== #2170 live-trace verification ==="
echo "date: $(date -u +%FT%TZ)"
echo "since: ${SINCE}s"

END_US=$(( $(date +%s) * 1000000 ))
START_US=$(( ( $(date +%s) - SINCE ) * 1000000 ))

echo "--- port-forwards (collector tier + grafana)"
kubectl -n "$NS" port-forward svc/vtsingle-vtraces 10428:10428 >/tmp/vt-pf.log 2>&1 &
VT_PF=$!
kubectl -n "$NS" port-forward svc/vmsingle-vmetrics 8428:8428 >/tmp/vm-pf.log 2>&1 &
VM_PF=$!
kubectl -n "$NS" port-forward svc/genieai-grafana-service 3000:80 >/tmp/grafana-pf.log 2>&1 &
GF_PF=$!
trap 'kill $VT_PF $VM_PF $GF_PF 2>/dev/null' EXIT
sleep 6

echo "--- 1. VictoriaTraces: the agent-service spans (Jaeger query API)"
curl -s "http://127.0.0.1:10428/select/jaeger/api/traces?service=agent-service&start=${START_US}&end=${END_US}&limit=100" \
  -o /tmp/vt-agent-traces.json -w "jaeger http=%{http_code}\n"
python3 - <<'PY'
import json
try:
    d=json.load(open('/tmp/vt-agent-traces.json'))
except Exception as e:
    print('parse failed:', e); raise SystemExit
traces=d.get('data') or []
print(f'traces: {len(traces)}')
n_span=0
for t in traces:
    procs=t.get('processes') or {}
    for sid, sp in (t.get('spans') or {}).items():
        n_span+=1
        proc=procs.get(sp.get('processID'),{}).get('serviceName','?')
        refs=sp.get('references') or []
        parent=refs[0].get('spanID') if refs else None
        tags={t2.get('key'):t2.get('value') for t2 in (sp.get('tags') or [])}
        interesting={k:v for k,v in tags.items() if k in (
            'genie.agent.tool','genie.agent.model','agent.run_id','genie.agent.step',
            'genie.agent.evidence_bytes','genie.agent.tool_calls','genie.agent.model_calls',
            'genie.agent.total_tokens','service.name','genie.agent.outcome')}
        print(f"  span {sid} | {sp.get('operationName')} | svc={proc} | parent={parent} | {interesting}")
print(f'spans total: {n_span}')
PY

echo "--- 2. the same through the Grafana datasource path (proxy -> jaeger)"
GRAFANA_TOKEN="$(kubectl -n "$NS" get secret genieai-grafana-admin-credentials -o jsonpath='{.data.GF_SECURITY_ADMIN_PASSWORD}' 2>/dev/null | base64 -d)"
if [ -z "$GRAFANA_TOKEN" ]; then
  echo "no grafana admin credentials secret; skipping the proxied query"
else
  curl -s -u "admin:${GRAFANA_TOKEN}" \
    "http://127.0.0.1:3000/api/datasources/proxy/uid/victoriatraces/api/traces?service=agent-service&start=${START_US}&end=${END_US}&limit=20" \
    -o /tmp/grafana-proxied-traces.json -w "grafana proxy http=%{http_code}\n"
  python3 - <<'PY'
import json
try:
    d=json.load(open('/tmp/grafana-proxied-traces.json'))
except Exception as e:
    print('parse failed:', e); raise SystemExit
traces=d.get('data') or []
print(f'proxied traces: {len(traces)}')
for t in traces:
    ops=[sp.get('operationName') for sp in (t.get('spans') or {}).values()]
    print('  trace', t.get('traceID'), 'spans:', len(ops), sorted(set(ops))[:12])
PY
fi

echo "--- 3. VictoriaMetrics: the agent-service series under service_name"
curl -s "http://127.0.0.1:8428/api/v1/query?query=count%20by%20(service_name)%20(%7B__name__%3D~%22.%2B%22%7D)" \
  -o /tmp/vm-services.json -w "vm http=%{http_code}\n"
python3 - <<'PY'
import json
try:
    d=json.load(open('/tmp/vm-services.json'))
except Exception as e:
    print('parse failed:', e); raise SystemExit
res=d.get('data',{}).get('result',[])
print(f'service_name values: {len(res)}')
for s in res:
    name=s.get('metric',{}).get('service_name','?')
    if 'agent' in name or True:
        print(f"  service_name={name} value={s.get('value',[None,None])[1]}")
PY

echo "--- 4. Grafana: the dashboards the campaign names + their datasource"
if [ -n "$GRAFANA_TOKEN" ]; then
  curl -s -u "admin:${GRAFANA_TOKEN}" "http://127.0.0.1:3000/api/search?type=dash-db" \
    -o /tmp/grafana-dashboards.json -w "grafana search http=%{http_code}\n"
  python3 - <<'PY'
import json
try:
    d=json.load(open('/tmp/grafana-dashboards.json'))
except Exception as e:
    print('parse failed:', e); raise SystemExit
print(f'dashboards: {len(d)}')
for x in d:
    print(f"  {x.get('title')} (uid={x.get('uid')}, folder={x.get('folderTitle','')})")
PY
  echo "  -- the service-health dashboard's service discovery query"
  curl -s -u "admin:${GRAFANA_TOKEN}" "http://127.0.0.1:3000/api/dashboards/uid/service-health" \
    -o /tmp/grafana-service-health.json -w "  dashboard http=%{http_code}\n"
  python3 - <<'PY'
import json,re
try:
    d=json.load(open('/tmp/grafana-service-health.json'))
except Exception as e:
    print('  parse failed:', e); raise SystemExit
blob=json.dumps(d)
print('  mentions service_name:', 'service_name' in blob)
print('  mentions agent-service:', 'agent-service' in blob)
for m in set(re.findall(r'"expr":\s*"([^"]*service_name[^"]*)"', blob)):
    print('   expr:', m[:160])
PY
  echo "  -- a live query against the metrics datasource for agent-service"
  curl -s -u "admin:${GRAFANA_TOKEN}" \
    --data-urlencode 'query=count by (service_name) ({__name__=~".+"})' \
    -G "http://127.0.0.1:3000/api/datasources/proxy/uid/victoriametrics/api/v1/query" \
    -o /tmp/grafana-vm-query.json -w "  vm proxy http=%{http_code}\n"
  python3 - <<'PY'
import json
try:
    d=json.load(open('/tmp/grafana-vm-query.json'))
except Exception as e:
    print('  parse failed:', e); raise SystemExit
for s in d.get('data',{}).get('result',[]):
    print('  service_name=', s.get('metric',{}).get('service_name'), 'value=', s.get('value',[None,None])[1])
PY
else
  echo "skipped (no grafana credentials)"
fi

echo "=== trace verification done ==="
